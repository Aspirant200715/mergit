"""The real Docker sandbox. Needs a Docker daemon and the image:
`docker build -t mergit-sandbox:dev control-plane/sandbox`.
Run with `uv run pytest -m docker tests/test_sandbox.py`."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import docker
import pytest

from mergit_worker.harness import run_task
from mergit_worker.sandbox import SANDBOX_ENV, Sandbox, SandboxConfig, reap_stale
from tests.support import (
    FIX,
    LOCAL_GIT,
    RecordingPublisher,
    ScriptedLLM,
    make_agent,
    make_harness_config,
    make_job,
    make_prices,
    phi,
    turn,
)

pytestmark = pytest.mark.docker

OWNER = "pytest-worker"


@pytest.fixture
def cfg(tmp_path: Path) -> SandboxConfig:
    return SandboxConfig(
        image="mergit-sandbox:dev",
        memory="256m",
        nano_cpus=1_000_000_000,
        pids_limit=128,
        runtime=None,
        max_output_bytes=1_048_576,
        workspace_root=tmp_path / "ws",
        git=LOCAL_GIT,
        owner=OWNER,
    )


@pytest.fixture
def sbx(repo_url: str, cfg: SandboxConfig) -> Iterator[Sandbox]:
    s = Sandbox.create(repo_url, "main", cfg)
    yield s
    s.destroy()


def test_container_has_no_network(sbx: Sandbox):
    result = sbx.run(
        ["python", "-c", "import socket; socket.create_connection(('1.1.1.1', 53), timeout=3)"], ".", 20
    )
    assert result.exit_code != 0
    names = sbx.run(["sh", "-c", "ls /sys/class/net"], ".", 10).stdout.decode().split()
    assert names == ["lo"]


def test_no_secrets_in_container_env(sbx: Sandbox, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    monkeypatch.setenv("MERGIT_AGENT_KEY_1", "0xsecret")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    configured = {e.split("=", 1)[0] for e in sbx.inspect_env()}
    assert {"ANTHROPIC_API_KEY", "MERGIT_AGENT_KEY_1", "GITHUB_TOKEN"}.isdisjoint(configured)
    seen = sbx.run(["env"], ".", 10).stdout.decode()
    assert "secret" not in seen
    assert set(SANDBOX_ENV) <= {line.split("=", 1)[0] for line in seen.splitlines()}


def test_only_the_checkout_is_mounted_and_root_is_read_only(sbx: Sandbox):
    assert sbx.run(["sh", "-c", "touch /usr/x"], ".", 10).exit_code != 0
    assert sbx.run(["sh", "-c", "touch ok.txt"], ".", 10).exit_code == 0
    assert (sbx.workspace.work / "ok.txt").exists()
    assert sbx.run(["sh", "-c", "ls /var/run/docker.sock"], ".", 10).exit_code != 0


def test_runs_as_the_host_user_so_the_host_can_read_what_it_wrote(sbx: Sandbox):
    sbx.run(["sh", "-c", "echo hi > made.txt"], ".", 10)
    assert (sbx.workspace.work / "made.txt").stat().st_uid == os.getuid()


def test_memory_limit_kills_the_command_not_the_host(sbx: Sandbox):
    result = sbx.run(["python", "-c", "x = bytearray(2 * 1024**3)"], ".", 60)
    assert result.exit_code != 0


def test_timeout_kills_every_process_and_the_sandbox_stays_usable(sbx: Sandbox):
    sbx.run(["sh", "-c", "(sleep 300 &) ; sleep 300"], ".", 2)  # timed out below
    result = sbx.run(["sh", "-c", "sleep 300"], ".", 2)
    assert result.timed_out and result.exit_code == -1
    ps = sbx.run(["sh", "-c", "ps -eo comm | grep -c '^sleep$' || true"], ".", 10)
    assert ps.stdout.strip() in (b"0", b"1")  # only the `sleep infinity` init process may remain
    assert sbx.run(["echo", "alive"], ".", 10).stdout == b"alive\n"


def test_background_process_is_killed_before_phi(sbx: Sandbox):
    sbx.run(["sh", "-c", "nohup sh -c 'sleep 300' >/dev/null 2>&1 &"], ".", 10)
    sbx.reset_processes()
    out = sbx.run(["sh", "-c", "ps -eo args | grep -c 'sleep 300' || true"], ".", 10).stdout.strip()
    assert out in (b"0", b"1")  # at most the grep itself


def test_missing_executable_is_reported_not_raised(sbx: Sandbox):
    result = sbx.run(["/no/such/binary"], ".", 10)
    assert result.could_not_start


def test_workdir_escape_is_refused(sbx: Sandbox):
    from mergit_worker.workspace import WorkspaceError

    with pytest.raises(WorkspaceError):
        sbx.run(["ls"], "../..", 10)


def test_output_is_captured_up_to_the_cap_plus_one_byte(repo_url: str, cfg: SandboxConfig):
    small = replace(cfg, max_output_bytes=100)
    s = Sandbox.create(repo_url, "main", small)
    try:
        result = s.run(["python", "-c", "print('z' * 1000)"], ".", 20)
        assert len(result.stdout) == 101
    finally:
        s.destroy()


def test_reap_stale_removes_only_this_owners_containers(repo_url: str, cfg: SandboxConfig):
    mine = Sandbox.create(repo_url, "main", cfg)
    other = Sandbox.create(repo_url, "main", replace(cfg, owner="someone-else"))
    try:
        assert reap_stale(OWNER) >= 1
        client = docker.from_env()
        left = {c.id for c in client.containers.list(all=True)}
        assert mine.container_id not in left
        assert other.container_id in left
    finally:
        mine.workspace.destroy()
        other.destroy()


def test_fake_agent_fixes_fixture_and_phi_holds(repo_url: str, cfg: SandboxConfig):
    sandbox = Sandbox.create(repo_url, "main", cfg)
    publisher = RecordingPublisher(sealed=[])
    job = make_job(
        repo_url,
        phi=phi(command=["python", "-c", "from payments.refund import refund; assert refund(10, 2) == 8"]),
    )
    try:
        outcome = run_task(
            job,
            make_agent(),
            sandbox,
            ScriptedLLM([turn(FIX), turn(("finish", {}))]),
            make_prices(),
            publisher,
            make_harness_config(),
        )
    finally:
        sandbox.destroy()
    assert outcome.holds is True
    assert publisher.sealed[0].root.startswith("0x")
