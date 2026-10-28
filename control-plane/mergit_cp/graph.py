"""The task graph: which indexes may be dispatched right now (plan task O4).

A pure function over each index's dependencies and job history, with no database in it, so plan task O4's
first dispatch (on ``plan.funded``) and plan task O6's dispatch after an outcome share the exact same rule
instead of two copies that can drift apart.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TaskState:
    index: int
    depends_on: tuple[int, ...]
    passed: bool
    """Some attempt of this index sealed a receipt with ``phi_eval.holds = true``."""
    in_flight: bool
    """This index has already been dispatched at least once. A further attempt (a retry after a failing
    or inconclusive Φ) is plan task O6's decision, made with the next agent in the requester's list; it is
    never picked up again by the generic "dispatch what just became ready" rule below."""


def ready_tasks(states: Sequence[TaskState]) -> list[int]:
    """Indexes that have never been dispatched, are not already passed, and whose every dependency has.

    Order is index order, but nothing downstream should rely on that: these are meant to dispatch in
    parallel, not in sequence.
    """
    passed = {s.index for s in states if s.passed}
    return [
        s.index for s in states if not s.passed and not s.in_flight and all(d in passed for d in s.depends_on)
    ]
