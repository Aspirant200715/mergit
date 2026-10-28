"""Planner (HLD C27): drafts a task graph for a goal, one predicate Φ per task.

A draft binds nobody: the requester edits and approves it (O3). The model's answer is untrusted, so
every field is checked here, and an invalid answer gets one re-ask that lists what was wrong.

The planner's own model spend is recorded per call in ``planner_costs``, including calls whose answer is
thrown away. No receipt covers it, because no task exists yet (HLD D18).
"""

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, ValidationError

from mergit_worker.meter import PriceTable

from .db import Pool
from .llm import LLM, LLMError, LLMResult
from .predicates import check_predicate

SYSTEM_PROMPT = """\
You plan software work for Mergit. A requester gives a goal for one git repository. You split it into a \
small number of tasks that agents will do one at a time in a sandbox with a checkout of that repository.

Each task needs a check, called phi, that the platform runs after the agent stops. The task counts as \
done only if the check holds, so the check must be able to fail when the work is not done:
- command is an argv list run without a shell, for example ["pytest", "tests/test_refund.py", "-q"].
- expected_exit is the exit code that means success, usually 0.
- workdir is a directory relative to the repository root, usually ".".
- allowed_paths lists glob patterns of the files the agent may change ("*" is one path segment, "**" \
any number), or null if any file may change. Prefer a narrow list.
- artifact_hashes is always null.
- timeout_s is between 1 and 3600.
Never use a check that always passes, such as true, echo, exit 0, or a command ending in "|| true".

Give each task a budget in USDC base units (1 USDC = 1000000 units). The budgets must add up to no more \
than the total budget. depends_on lists the 0-based positions of earlier tasks that must finish first. \
Tasks that do not depend on each other may run in parallel.

Write instructions for the agent: what to change and why, in plain words. Do not invent file paths you \
were not given unless the goal implies them; the requester reviews and edits the plan before approving it.\
"""

_PHI_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "kind",
        "command",
        "expected_exit",
        "workdir",
        "allowed_paths",
        "artifact_hashes",
        "timeout_s",
    ],
    "properties": {
        "kind": {"const": "exec/0"},
        "command": {"type": "array", "items": {"type": "string"}},
        "expected_exit": {"type": "integer"},
        "workdir": {"type": "string"},
        "allowed_paths": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
        "artifact_hashes": {"type": "null"},
        "timeout_s": {"type": "integer"},
    },
}

PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tasks"],
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "instructions", "phi", "budget_usdc_units", "depends_on"],
                "properties": {
                    "title": {"type": "string"},
                    "instructions": {"type": "string"},
                    "phi": _PHI_SCHEMA,
                    "budget_usdc_units": {"type": "integer"},
                    "depends_on": {"type": "array", "items": {"type": "integer"}},
                },
            },
        }
    },
}


@dataclass(frozen=True)
class TaskDraft:
    index: int
    title: str
    instructions: str
    phi: dict[str, Any]
    budget_usdc_units: int
    depends_on: list[int]


@dataclass(frozen=True)
class PlanDraft:
    plan_uuid: str
    tasks: list[TaskDraft]


class PlanningFailed(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


class CostSink(Protocol):
    async def record(self, plan_uuid: str, usage: LLMResult) -> None: ...


class PgCostSink:
    def __init__(self, pool: Pool, prices: PriceTable) -> None:
        self._pool = pool
        self._prices = prices

    async def record(self, plan_uuid: str, usage: LLMResult) -> None:
        # The same meter that prices receipt steps, so planner and agent spend follow one rule.
        usd_micros = self._prices.model_call_cost(
            usage.model,
            usage.input_tokens,
            usage.output_tokens,
            0,
            cache_read_tokens=usage.cache_read_tokens,
            cache_write_tokens=usage.cache_write_tokens,
        ).usd_micros
        async with self._pool.connection() as conn:
            await conn.execute(
                "INSERT INTO planner_costs (plan_uuid, model, input_tokens, output_tokens,"
                " cache_read_tokens, cache_write_tokens, usd_micros) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    plan_uuid,
                    usage.model,
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_read_tokens,
                    usage.cache_write_tokens,
                    usd_micros,
                ),
            )


def _request(goal: str, repo_url: str, budget: int, category: str, max_tasks: int) -> str:
    return (
        f"Repository: {repo_url}\n"
        f"Task category: {category}\n"
        f"Total budget: {budget} USDC base units\n"
        f"At most {max_tasks} tasks.\n\n"
        f"The requester's goal, between the markers:\n<goal>\n{goal}\n</goal>"
    )


class _RawTask(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: str
    instructions: str
    phi: dict[str, Any]
    budget_usdc_units: int
    depends_on: list[int]


class _RawPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    tasks: list[_RawTask]


def _check_graph(deps: list[list[int]]) -> list[str]:
    problems: list[str] = []
    n = len(deps)
    for i, edges in enumerate(deps):
        if len(set(edges)) != len(edges):
            problems.append(f"task {i}: depends_on lists a task twice")
        for d in edges:
            if d == i:
                problems.append(f"task {i}: depends on itself")
            elif not 0 <= d < n:
                problems.append(f"task {i}: depends on task {d}, which does not exist")
    if problems:
        return problems
    # Kahn's algorithm: whatever cannot be scheduled sits on a cycle.
    remaining = {i: set(edges) for i, edges in enumerate(deps)}
    while ready := [i for i, edges in remaining.items() if not edges]:
        for i in ready:
            del remaining[i]
        for edges in remaining.values():
            edges.difference_update(ready)
    if remaining:
        problems.append(f"tasks {sorted(remaining)} depend on each other in a cycle")
    return problems


def check_tasks(tasks: list[TaskDraft], budget: int, max_tasks: int) -> list[str]:
    """Every problem with a task list, whether the model drafted it or the requester edited it."""
    if not 1 <= len(tasks) <= max_tasks:
        return [f"the plan has {len(tasks)} tasks; it needs between 1 and {max_tasks}"]
    problems: list[str] = []
    for t in tasks:
        i = t.index
        if not t.title.strip():
            problems.append(f"task {i}: title is empty")
        if not t.instructions.strip():
            problems.append(f"task {i}: instructions are empty")
        if t.budget_usdc_units <= 0:
            problems.append(f"task {i}: budget_usdc_units must be positive")
        problems.extend(f"task {i}: {p}" for p in check_predicate(t.phi))
    total = sum(t.budget_usdc_units for t in tasks)
    if total > budget:
        problems.append(f"task budgets add up to {total}, more than the total budget of {budget}")
    problems.extend(_check_graph([t.depends_on for t in tasks]))
    return problems


def _parse(text: str, budget: int, max_tasks: int) -> tuple[list[TaskDraft], list[str]]:
    try:
        plan = _RawPlan.model_validate_json(text)
    except ValidationError as invalid:
        return [], [
            f"{'.'.join(str(part) for part in error['loc']) or 'answer'}: {error['msg']}"
            for error in invalid.errors()
        ]
    tasks = [
        TaskDraft(i, t.title.strip(), t.instructions.strip(), t.phi, t.budget_usdc_units, t.depends_on)
        for i, t in enumerate(plan.tasks)
    ]
    problems = check_tasks(tasks, budget, max_tasks)
    return ([], problems) if problems else (tasks, [])


async def plan_goal(
    goal: str,
    repo_url: str,
    budget_usdc_units: int,
    category: str,
    llm: LLM,
    *,
    model: str,
    costs: CostSink,
    max_tasks: int = 8,
) -> PlanDraft:
    """Draft a plan for ``goal``. Raises PlanningFailed after one re-ask if the answer stays invalid."""
    if not goal.strip():
        raise ValueError("goal is empty")
    if budget_usdc_units <= 0:
        raise ValueError("budget must be positive")

    plan_uuid = str(uuid.uuid4())
    request = _request(goal, repo_url, budget_usdc_units, category, max_tasks)
    prompt = request
    problems: list[str] = []
    for attempt in range(2):
        try:
            answer = await llm.complete(
                [{"role": "user", "content": prompt}],
                None,
                model,
                system=SYSTEM_PROMPT,
                output_schema=PLAN_SCHEMA,
            )
        except LLMError as stopped:
            await costs.record(plan_uuid, stopped.usage)
            answer_text, problems = (
                stopped.usage.text,
                [f"the answer was cut off or declined ({stopped.reason})"],
            )
        else:
            await costs.record(plan_uuid, answer)
            answer_text = answer.text
            tasks, problems = _parse(answer_text, budget_usdc_units, max_tasks)
            if not problems:
                return PlanDraft(plan_uuid, tasks)
        if attempt == 0:
            # A fresh single-turn request rather than a conversation, so no earlier turn is replayed.
            prompt = (
                f"{request}\n\nA previous answer to this request was rejected:\n<previous_answer>\n"
                f"{answer_text}\n</previous_answer>\n\nProblems:\n"
                + "\n".join(f"- {p}" for p in problems)
                + "\n\nAnswer again with a plan that fixes every problem."
            )
    raise PlanningFailed(problems)
