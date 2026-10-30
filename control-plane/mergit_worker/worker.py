"""The worker loop: claim one job, run it in a fresh sandbox, report. One job at a time per process."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field

from .agents import load_agent_spec
from .config import WorkerConfig
from .harness import HarnessConfig, Publisher, run_task
from .jobs import JobStore
from .llm import LLM
from .meter import PriceTable
from .models import Job
from .progress import NullProgressReporter, ProgressReporter
from .sandbox import SandboxPort

log = logging.getLogger(__name__)

SandboxFactory = Callable[[Job], SandboxPort]


@dataclass(frozen=True, slots=True)
class WorkerDeps:
    store: JobStore
    llm: LLM
    prices: PriceTable
    publisher: Publisher
    make_sandbox: SandboxFactory
    harness: HarnessConfig
    progress: ProgressReporter = field(default_factory=NullProgressReporter)


class Worker:
    def __init__(self, cfg: WorkerConfig, deps: WorkerDeps) -> None:
        self._cfg = cfg
        self._deps = deps

    def run_once(self) -> bool:
        """Handle at most one job. Returns False when the queue was empty."""
        job = self._deps.store.claim()
        if job is None:
            return False
        log.info("claimed task %s (agent %s, attempt %d)", job.task_id, job.agent_id, job.attempt)
        try:
            self._run(job)
        except Exception as exc:  # one bad job must not stop the worker
            log.exception("task %s failed", job.task_id)
            self._deps.store.fail(job.task_id, f"{type(exc).__name__}: {exc}")
        return True

    def run_forever(self, stop: threading.Event) -> None:
        while not stop.is_set():
            if not self.run_once():
                stop.wait(self._cfg.poll_interval_s)

    def _run(self, job: Job) -> None:
        agent = load_agent_spec(job.agent_id, self._cfg.agents_file, self._cfg.agents_config)
        sandbox = self._deps.make_sandbox(job)
        try:
            outcome = run_task(
                job,
                agent,
                sandbox,
                self._deps.llm,
                self._deps.prices,
                self._deps.publisher,
                self._deps.harness,
                self._deps.progress,
            )
        finally:
            sandbox.destroy()
        self._deps.store.report(outcome)
        log.info("task %s done: holds=%s notes=%s", job.task_id, outcome.holds, outcome.notes)
