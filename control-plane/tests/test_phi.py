from __future__ import annotations

import sys

import mergit_receipt

from mergit_worker.models import cap_output
from mergit_worker.phi import run_phi
from tests.support import ProcessSandbox, phi

CAP = 1_048_576
FIXED = b"def refund(a, f):\n    return a - f\n"
NOOP = [sys.executable, "-c", "pass"]


def test_phi_fails_before_fix_and_holds_after(sandbox: ProcessSandbox):
    before = run_phi(sandbox, phi(), CAP, CAP)
    assert before.holds is False
    assert before.result["exit_code"] != 0
    sandbox.workspace.write_file("payments/refund.py", FIXED)
    after = run_phi(sandbox, phi(), CAP, CAP)
    assert after.holds is True
    assert after.result["changed_paths"] == ["payments/refund.py"]
    assert sandbox.resets == 2


def test_change_outside_allowed_paths_fails_even_when_check_passes(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("payments/refund.py", FIXED)
    sandbox.workspace.write_file("docs/notes.md", b"edited\n")
    run = run_phi(sandbox, phi(), CAP, CAP)
    assert run.result["exit_code"] == 0
    assert run.holds is False


def test_null_allowed_paths_permits_any_change(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("payments/refund.py", FIXED)
    sandbox.workspace.write_file("docs/notes.md", b"edited\n")
    assert run_phi(sandbox, phi(allowed_paths=None), CAP, CAP).holds is True


def test_artifact_hashes_must_match_and_absent_file_is_omitted(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("out.txt", b"expected")
    good = {"out.txt": mergit_receipt.keccak_hex(b"expected")}
    ok = run_phi(sandbox, phi(command=NOOP, allowed_paths=None, artifact_hashes=good), CAP, CAP)
    assert ok.holds is True
    assert ok.result["observed_artifact_hashes"] == good

    missing = {"nope.txt": mergit_receipt.keccak_hex(b"x")}
    bad = run_phi(sandbox, phi(command=NOOP, allowed_paths=None, artifact_hashes=missing), CAP, CAP)
    assert bad.result["observed_artifact_hashes"] == {}
    assert bad.holds is False


def test_timeout_is_inconclusive_with_exit_minus_one(sandbox: ProcessSandbox):
    slow = phi(command=[sys.executable, "-c", "import time; time.sleep(30)"], timeout_s=1)
    run = run_phi(sandbox, slow, CAP, CAP)
    assert run.holds is None
    assert run.result["exit_code"] == -1
    assert run.result["holds"] is False  # what is recorded, per spec/predicate-v0.md


def test_missing_command_is_inconclusive(sandbox: ProcessSandbox):
    run = run_phi(sandbox, phi(command=["/no/such/binary"]), CAP, CAP)
    assert run.holds is None
    assert run.result["exit_code"] == -1


def test_stdout_digest_covers_capped_stdout(sandbox: ProcessSandbox):
    noisy = phi(command=[sys.executable, "-c", "print('y' * 5000)"], allowed_paths=None)
    run = run_phi(sandbox, noisy, 100, CAP)
    assert run.result["stdout_digest"] == mergit_receipt.keccak_hex(cap_output(run.command.stdout, 100))
