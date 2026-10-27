from __future__ import annotations

import json
import sys
from typing import Any

import pytest

from mergit_worker.llm import ToolCall
from mergit_worker.meter import Cost
from mergit_worker.tools import TOOL_SCHEMAS, ToolBox, ToolLimits
from tests.support import ProcessSandbox

LIMITS = ToolLimits(command_timeout_s=5, max_output_bytes=1000, max_write_bytes=100, model_output_bytes=1024)


class Steps:
    def __init__(self) -> None:
        self.rows: list[tuple[str, bytes, bytes, int | None, Cost]] = []

    def __call__(self, step_type: str, inp: bytes, out: bytes, exit_status: int | None, cost: Cost) -> int:
        self.rows.append((step_type, inp, out, exit_status, cost))
        return len(self.rows)


@pytest.fixture
def steps() -> Steps:
    return Steps()


@pytest.fixture
def box(sandbox: ProcessSandbox, steps: Steps) -> ToolBox:
    return ToolBox(sandbox, steps, LIMITS)


def call(name: str, **args: Any) -> ToolCall:
    return ToolCall("t1", name, args)


def test_no_tool_can_reach_phi_eval():
    assert {t["name"] for t in TOOL_SCHEMAS} == {
        "list_files",
        "read_file",
        "write_file",
        "run_command",
        "finish",
    }


def test_every_call_records_exactly_one_step(box: ToolBox, steps: Steps):
    box.execute(call("list_files"))
    box.execute(call("read_file", path="payments/refund.py"))
    box.execute(call("write_file", path="a.txt", content="x"))
    box.execute(call("run_command", argv=[sys.executable, "-c", "print(1)"]))
    box.execute(call("finish"))
    assert [r[0] for r in steps.rows] == ["tool_call", "tool_call", "artifact_write", "command", "tool_call"]
    assert all(r[4].tool_calls == 1 for r in steps.rows)


def test_command_step_records_exit_status_and_output(box: ToolBox, steps: Steps):
    out = box.execute(
        call("run_command", argv=[sys.executable, "-c", "import sys; print('hi'); sys.exit(3)"])
    )
    assert out.is_error is True
    assert steps.rows[0][3] == 3
    assert b"hi" in steps.rows[0][2]
    assert "exit code 3" in out.content


def test_bad_arguments_are_reported_to_the_model_and_still_recorded(box: ToolBox, steps: Steps):
    cases = [
        call("run_command", argv="ls"),
        call("run_command", argv=[]),
        call("run_command", argv=["ls", 3]),
        call("run_command", argv=["ls"], timeout_s=0),
        call("run_command", argv=["ls"], timeout_s=True),
        call("read_file"),
        call("write_file", path="a", content=5),
        call("nope"),
    ]
    for c in cases:
        result = box.execute(c)
        assert result.is_error, c
        assert not result.finished
    assert len(steps.rows) == len(cases)


def test_path_escape_is_an_error_result_not_a_crash(box: ToolBox, steps: Steps):
    for path in ["../secret", "/etc/passwd", "a/../../b"]:
        assert box.execute(call("read_file", path=path)).is_error
        assert box.execute(call("write_file", path=path, content="x")).is_error
    assert all(r[2] for r in steps.rows)  # each carries the error text


def test_oversized_write_is_refused_not_truncated(box: ToolBox, sandbox: ProcessSandbox):
    result = box.execute(call("write_file", path="big.txt", content="a" * 101))
    assert result.is_error
    assert not (sandbox.workspace.work / "big.txt").exists()


def test_finish_stops_and_records_summary(box: ToolBox, steps: Steps):
    result = box.execute(call("finish", summary="done"))
    assert result.finished
    assert steps.rows[0][2] == b"done"


def test_model_output_is_shortened_but_the_receipt_keeps_it(box: ToolBox, steps: Steps):
    box.execute(call("write_file", path="a.txt", content="z" * 90))
    result = box.execute(call("run_command", argv=[sys.executable, "-c", "print('q' * 900)"], timeout_s=5))
    assert len(result.content.encode()) <= 1024 + 80
    sandbox_out = steps.rows[-1][2]
    assert sandbox_out.count(b"q") == 900


def test_step_input_is_canonical_json_of_the_call(box: ToolBox, steps: Steps):
    box.execute(call("read_file", path="payments/refund.py"))
    assert json.loads(steps.rows[0][1]) == {"tool": "read_file", "input": {"path": "payments/refund.py"}}


def test_command_timeout_is_clamped_to_the_limit(box: ToolBox, steps: Steps):
    result = box.execute(
        call("run_command", argv=[sys.executable, "-c", "import time; time.sleep(30)"], timeout_s=3600)
    )
    assert result.is_error
    assert steps.rows[0][3] == -1
    assert b"timed out after 5s" in steps.rows[0][2]
