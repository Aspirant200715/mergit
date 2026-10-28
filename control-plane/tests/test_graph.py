"""The ready-to-dispatch rule (plan task O4): pure, no database."""

from __future__ import annotations

from mergit_cp.graph import TaskState, ready_tasks


def state(
    index: int, depends_on: tuple[int, ...] = (), *, passed: bool = False, in_flight: bool = False
) -> TaskState:
    return TaskState(index=index, depends_on=depends_on, passed=passed, in_flight=in_flight)


def test_independent_tasks_dispatch_in_parallel() -> None:
    assert ready_tasks([state(0), state(1), state(2)]) == [0, 1, 2]


def test_task_dispatched_only_after_dependencies_pass() -> None:
    waiting = [state(0), state(1, depends_on=(0,))]
    assert ready_tasks(waiting) == [0]

    once_0_passed = [state(0, passed=True, in_flight=True), state(1, depends_on=(0,))]
    assert ready_tasks(once_0_passed) == [1]


def test_a_task_waiting_on_two_dependencies_needs_both() -> None:
    one_done = [
        state(0, passed=True, in_flight=True),
        state(1, in_flight=True),
        state(2, depends_on=(0, 1)),
    ]
    assert ready_tasks(one_done) == []

    both_done = [
        state(0, passed=True, in_flight=True),
        state(1, passed=True, in_flight=True),
        state(2, depends_on=(0, 1)),
    ]
    assert ready_tasks(both_done) == [2]


def test_already_dispatched_or_passed_tasks_are_not_ready_again() -> None:
    assert ready_tasks([state(0, passed=True, in_flight=True)]) == []
    assert ready_tasks([state(0, in_flight=True)]) == []  # dispatched, no answer yet: not a fresh dispatch


def test_a_failed_attempt_is_not_redispatched_by_the_generic_rule() -> None:
    # passed stays False after a failing or inconclusive attempt; a retry is plan task O6's own call
    # (dispatch_task with the next agent and attempt + 1), never this function's.
    assert ready_tasks([state(0, in_flight=True, passed=False)]) == []
