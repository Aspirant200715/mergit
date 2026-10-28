"""`python -m mergit_worker`: build every dependency from configuration and run the worker loop."""

from __future__ import annotations

import logging
import signal
import socket
import threading

from .agents import validate_agents_are_priced
from .config import ConfigError, WorkerConfig, load_config
from .harness import HarnessConfig
from .jobs import PgJobStore
from .llm import AnthropicLLM
from .meter import PriceTable
from .models import Job
from .publish import ReceiptPublisher
from .sandbox import Sandbox, SandboxConfig, reap_stale
from .tools import ToolLimits
from .worker import Worker, WorkerDeps
from .workspace import GitLimits


def build_worker(cfg: WorkerConfig, worker_id: str) -> tuple[Worker, PgJobStore]:
    sandbox_cfg = SandboxConfig(
        image=cfg.sandbox_image,
        memory=cfg.sandbox_memory,
        nano_cpus=cfg.sandbox_nano_cpus,
        pids_limit=cfg.sandbox_pids_limit,
        runtime=cfg.sandbox_runtime,
        max_output_bytes=cfg.max_output_bytes,
        workspace_root=cfg.sandbox_workspace_root,
        git=GitLimits(cfg.sandbox_allowed_url_schemes, cfg.git_timeout_s),
        owner=worker_id,
    )

    def make_sandbox(job: Job) -> Sandbox:
        return Sandbox.create(job.repo_url, job.ref, sandbox_cfg)

    prices = PriceTable.load(cfg.prices_file)
    validate_agents_are_priced(cfg.agents_file, cfg.agents_config, prices)
    store = PgJobStore.connect(cfg.database_url.get_secret_value(), worker_id)
    deps = WorkerDeps(
        store=store,
        llm=AnthropicLLM(timeout_s=cfg.http_timeout_s * 20),
        prices=prices,
        publisher=ReceiptPublisher(
            store_url=cfg.store_url,
            gateway_url=cfg.gateway_url,
            store_token=cfg.store_write_token.get_secret_value(),
            events_token=cfg.events_token.get_secret_value(),
            timeout_s=cfg.http_timeout_s,
            retry_window_s=cfg.publish_retry_window_s,
        ),
        make_sandbox=make_sandbox,
        harness=HarnessConfig(
            chain_id=cfg.chain_id,
            registry=cfg.receipt_registry,
            runtime_image=cfg.runtime_image,
            max_steps=cfg.max_steps,
            job_deadline_s=cfg.job_deadline_s,
            model_max_tokens=cfg.model_max_tokens,
            max_output_bytes=cfg.max_output_bytes,
            max_hash_bytes=cfg.max_hash_bytes,
            tool_limits=ToolLimits(
                command_timeout_s=cfg.command_timeout_s,
                max_output_bytes=cfg.max_output_bytes,
                max_write_bytes=cfg.max_write_bytes,
                model_output_bytes=cfg.model_output_bytes,
            ),
        ),
    )
    return Worker(cfg, deps), store


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    log = logging.getLogger("mergit_worker")
    try:
        cfg = load_config()
    except ConfigError as exc:
        log.error("configuration error: %s", exc)
        return 2

    worker_id = cfg.worker_id or socket.gethostname()
    worker, store = build_worker(cfg, worker_id)
    log.info("failed %d jobs this worker left running before a restart", store.fail_own_running())
    log.info(
        "reclaimed %d jobs left running past their lease by any worker",
        store.reclaim_stale(cfg.job_lease_s),
    )
    log.info("removed %d stale sandbox containers", reap_stale(worker_id))

    stop = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()  # finish the current job, then exit

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, request_stop)
    try:
        worker.run_forever(stop)
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
