"""The pull-request gate: when may a plan's changes become a PR, and what is shown first.

Pure functions over rows the store loaded. The rule is deliberately stricter than "the plan state says
done": every task of the plan needs a passing job with a stored patch. The state is a summary, the jobs
are the evidence.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PlanInfo:
    plan_uuid: str
    requester: str
    state: str
    goal: str
    repo_url: str
    ref: str


@dataclass(frozen=True, slots=True)
class TaskChange:
    """One task index and its passing attempt, if it has one."""

    index: int
    title: str
    task_id: str | None  # the passing attempt; None when no attempt passed Φ
    patch: str | None


def same_address(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


def blockers(plan: PlanInfo, tasks: Sequence[TaskChange]) -> list[str]:
    """Reasons the PR cannot be opened. Empty means it can."""
    problems: list[str] = []
    if plan.state != "done":
        problems.append(f"the plan is {plan.state!r}, not 'done'")
    if not tasks:
        problems.append("the plan has no tasks")
    for task in tasks:
        if task.task_id is None:
            problems.append(f"task {task.index} has no passing attempt")
        elif not task.patch:
            problems.append(f"task {task.index} passed but has no stored change")
    return problems


def combined_diff(tasks: Sequence[TaskChange]) -> str:
    """The patches in task order, each under a header naming its task. This is what the requester
    reviews; the worker applies the same patches in the same order."""
    parts: list[str] = []
    for task in sorted(tasks, key=lambda t: t.index):
        if task.patch:
            parts.append(f"# task {task.index}: {task.title}\n{task.patch}")
    return "\n".join(parts)
