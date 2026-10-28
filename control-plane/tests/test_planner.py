"""The planner turns a goal into a task graph. Its model output is untrusted: every check here must fire."""

import asyncio
import json
import uuid
from decimal import Decimal
from typing import Any

import psycopg
import pytest

from mergit_cp.db import migrate, open_pool
from mergit_cp.llm import LLMError
from mergit_cp.planner import PgCostSink, PlanningFailed, plan_goal
from mergit_worker.meter import Price, PriceTable
from tests.cp_fakes import FakeLLM, ListCostSink, result

GOAL = "Fix the failing refund test in payments"
REPO = "https://github.com/mergit-io/demo-repo"
BUDGET = 2_000_000


def task(depends_on: list[int] | None = None, budget: int = 500_000, **phi: Any) -> dict[str, Any]:
    return {
        "title": "Fix refund rounding",
        "instructions": "Make tests/test_refund.py pass without touching other modules.",
        "phi": {
            "kind": "exec/0",
            "command": ["pytest", "tests/test_refund.py", "-q"],
            "expected_exit": 0,
            "workdir": ".",
            "allowed_paths": ["payments/**"],
            "artifact_hashes": None,
            "timeout_s": 600,
        }
        | phi,
        "budget_usdc_units": budget,
        "depends_on": depends_on or [],
    }


def plan_json(*tasks: dict[str, Any]) -> str:
    return json.dumps({"tasks": list(tasks)})


def run_planner(llm: FakeLLM, sink: ListCostSink | None = None, max_tasks: int = 8):
    return asyncio.run(
        plan_goal(
            GOAL,
            REPO,
            BUDGET,
            "test-repair",
            llm,
            model="claude-opus-5",
            costs=sink or ListCostSink(),
            max_tasks=max_tasks,
        )
    )


def test_plan_tasks_have_schema_valid_phi() -> None:
    llm = FakeLLM([result(plan_json(task(), task(depends_on=[0])))])
    draft = run_planner(llm)
    assert uuid.UUID(draft.plan_uuid).version == 4
    assert [t.index for t in draft.tasks] == [0, 1]
    assert draft.tasks[1].depends_on == [1 - 1]
    assert draft.tasks[0].phi["command"] == ["pytest", "tests/test_refund.py", "-q"]
    # The goal and repo reach the model only in the user turn, never in the system prompt.
    call = llm.calls[0]
    assert GOAL in call["messages"][0]["content"]
    assert GOAL not in (call["system"] or "")
    assert call["schema"] is not None


def test_planner_retries_once_then_fails_on_invalid_phi() -> None:
    bad = plan_json(task(command=["true"]))
    llm = FakeLLM([result(bad), result(bad)])
    with pytest.raises(PlanningFailed) as failed:
        run_planner(llm)
    assert len(llm.calls) == 2
    # The re-ask tells the model what was wrong.
    assert "cannot fail" in llm.calls[1]["messages"][-1]["content"]
    assert any("cannot fail" in p for p in failed.value.problems)


def test_planner_accepts_a_corrected_second_answer() -> None:
    llm = FakeLLM([result(plan_json(task(command=["true"]))), result(plan_json(task()))])
    draft = run_planner(llm)
    assert len(draft.tasks) == 1


@pytest.mark.parametrize(
    "tasks",
    [
        [task(depends_on=[1]), task(depends_on=[0])],  # two-node cycle
        [task(depends_on=[0])],  # self-dependency
        [task(depends_on=[5])],  # unknown index
        [task(), task(depends_on=[0, 0])],  # duplicate edge
    ],
)
def test_plan_rejects_cycle_in_dependencies(tasks: list[dict[str, Any]]) -> None:
    bad = plan_json(*tasks)
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([result(bad), result(bad)]))


def test_task_budgets_sum_within_requested_budget() -> None:
    over = plan_json(task(budget=1_500_000), task(budget=600_000))
    with pytest.raises(PlanningFailed) as failed:
        run_planner(FakeLLM([result(over), result(over)]))
    assert any("budget" in p for p in failed.value.problems)
    zero = plan_json(task(budget=0))
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([result(zero), result(zero)]))


def test_rejects_too_many_tasks_and_empty_plans() -> None:
    many = plan_json(*[task(budget=1) for _ in range(3)])
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([result(many), result(many)]), max_tasks=2)
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([result(plan_json()), result(plan_json())]))


def test_rejects_output_that_is_not_json() -> None:
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([result("here is your plan!"), result("{")]))


def test_cost_recorded_for_every_call_even_when_planning_fails() -> None:
    sink = ListCostSink()
    bad = plan_json(task(command=["true"]))
    truncated = LLMError("max_tokens", result("{", output_tokens=16000))
    with pytest.raises(PlanningFailed):
        run_planner(FakeLLM([truncated, result(bad)]), sink)
    assert [usage.output_tokens for _, usage in sink.rows] == [16000, 500]
    assert len({plan for plan, _ in sink.rows}) == 1


@pytest.mark.postgres
def test_planner_cost_recorded_outside_receipts(database_url: str) -> None:
    """Planner spend goes to planner_costs, priced from the list-price table, in micro-USD."""
    prices = PriceTable(
        {"claude-opus-5": Price(Decimal("5"), Decimal("25"), Decimal("0.5"), Decimal("6.25"))}
    )

    async def go() -> str:
        pool = await open_pool(database_url, 2)
        try:
            async with pool.connection() as conn:
                await migrate(conn)
            sink = PgCostSink(pool, prices)
            draft = await plan_goal(
                GOAL,
                REPO,
                BUDGET,
                "test-repair",
                FakeLLM([result(plan_json(task()))]),
                model="claude-opus-5",
                costs=sink,
                max_tasks=8,
            )
            return draft.plan_uuid
        finally:
            await pool.close()

    plan_uuid = asyncio.run(go())
    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            "SELECT model, input_tokens, output_tokens, usd_micros FROM planner_costs WHERE plan_uuid = %s",
            (plan_uuid,),
        ).fetchall()
    # 1000 input tokens at $5/MTok + 500 output tokens at $25/MTok = 5000 + 12500 micro-USD.
    assert rows == [("claude-opus-5", 1000, 500, 17_500)]


def test_self_dependency_is_named_plainly() -> None:
    bad = plan_json(task(depends_on=[0]))
    with pytest.raises(PlanningFailed) as failed:
        run_planner(FakeLLM([result(bad), result(bad)]))
    assert any("depends on itself" in p for p in failed.value.problems)


@pytest.mark.parametrize("field", ["title", "instructions"])
def test_rejects_blank_title_or_instructions(field: str) -> None:
    bad = plan_json(task() | {field: "   "})
    with pytest.raises(PlanningFailed) as failed:
        run_planner(FakeLLM([result(bad), result(bad)]))
    assert any(field in p for p in failed.value.problems)
