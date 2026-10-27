from __future__ import annotations

from typing import Any

from mergit_cp.pr_gate import PlanInfo, TaskChange
from mergit_worker.github import GitHubError, PrResult, PrSpec
from mergit_worker.pr_worker import PrHandler
from tests.support import PLAN_UUID, REQUESTER

PLAN = PlanInfo(PLAN_UUID, REQUESTER, "done", "goal", "https://github.com/acme/widgets", "main")
GOOD = [TaskChange(0, "t0", "0xaa", "patch0"), TaskChange(1, "t1", "0xbb", "patch1")]


class FakeStore:
    def __init__(
        self, plan: PlanInfo | None = PLAN, changes: list[TaskChange] | None = None, queued: bool = True
    ):
        self._plan, self._changes, self._queued = plan, GOOD if changes is None else changes, queued
        self.finished: list[tuple[Any, ...]] = []
        self.failed: list[tuple[str, str]] = []

    def claim(self) -> str | None:
        queued, self._queued = self._queued, False
        return PLAN_UUID if queued else None

    def plan(self, plan_uuid: str) -> PlanInfo | None:
        return self._plan

    def changes(self, plan_uuid: str) -> list[TaskChange]:
        return self._changes

    def finish(self, *args: Any) -> None:
        self.finished.append(args)

    def fail(self, plan_uuid: str, error: str) -> None:
        self.failed.append((plan_uuid, error))


class FakeOpener:
    def __init__(self, error: Exception | None = None) -> None:
        self.error, self.specs = error, []

    def open(self, spec: PrSpec) -> PrResult:
        self.specs.append(spec)
        if self.error:
            raise self.error
        return PrResult("mergit/x", "c0ffee", 9, "https://github.com/acme/widgets/pull/9")


def test_no_request_means_nothing_happens():
    opener = FakeOpener()
    assert PrHandler(FakeStore(queued=False), opener).run_once() is False  # type: ignore[arg-type]
    assert opener.specs == []


def test_approved_request_opens_the_pr_and_records_branch_sha_and_number():
    store, opener = FakeStore(), FakeOpener()
    assert PrHandler(store, opener).run_once() is True  # type: ignore[arg-type]
    assert store.finished == [(PLAN_UUID, "mergit/x", "c0ffee", 9, "https://github.com/acme/widgets/pull/9")]
    spec = opener.specs[0]
    assert [(t.index, t.task_id, t.patch) for t in spec.tasks] == [
        (0, "0xaa", "patch0"),
        (1, "0xbb", "patch1"),
    ]
    assert (spec.repo_url, spec.base_ref) == (PLAN.repo_url, "main")


def test_github_error_is_recorded_for_the_requester():
    store = FakeStore()
    PrHandler(store, FakeOpener(GitHubError("token rejected"))).run_once()  # type: ignore[arg-type]
    assert store.failed == [(PLAN_UUID, "token rejected")]
    assert store.finished == []


def test_unexpected_crash_is_recorded_without_leaking_its_message():
    store = FakeStore()
    PrHandler(store, FakeOpener(RuntimeError("secret ghp_x in message"))).run_once()  # type: ignore[arg-type]
    assert store.failed == [(PLAN_UUID, "internal error: RuntimeError")]


def test_gate_is_rechecked_when_the_worker_picks_the_request_up():
    store, opener = FakeStore(plan=None), FakeOpener()
    PrHandler(store, opener).run_once()  # type: ignore[arg-type]
    assert opener.specs == [] and "no longer exists" in store.failed[0][1]

    regressed = [TaskChange(0, "t0", "0xaa", "p"), TaskChange(1, "t1", None, None)]
    store, opener = FakeStore(changes=regressed), FakeOpener()
    PrHandler(store, opener).run_once()  # type: ignore[arg-type]
    assert opener.specs == [] and "task 1 has no passing attempt" in store.failed[0][1]
