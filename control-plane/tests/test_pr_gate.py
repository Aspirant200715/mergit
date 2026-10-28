from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from mergit_cp.pr_gate import PlanInfo, TaskChange, blockers, combined_diff, same_address
from mergit_cp.pr_store import PrRequest
from mergit_cp.routes_pr import build_router
from tests.support import PLAN_UUID, REQUESTER

PLAN = PlanInfo(PLAN_UUID, REQUESTER, "done", "fix refunds", "https://github.com/acme/widgets", "main")
PASSED = [
    TaskChange(0, "fix", "0xaa", "diff --git a/x b/x\n"),
    TaskChange(1, "docs", "0xbb", "diff --git a/y b/y\n"),
]


def test_ready_plan_has_no_blockers():
    assert blockers(PLAN, PASSED) == []


def test_pr_only_when_all_tasks_passed():
    one_failed = [PASSED[0], TaskChange(1, "docs", None, None)]
    assert any("task 1 has no passing attempt" in b for b in blockers(PLAN, one_failed))


@pytest.mark.parametrize("state", ["draft", "approved", "funded", "running", "failed", "closed"])
def test_pr_only_when_plan_state_is_done(state: str):
    assert any("not 'done'" in b for b in blockers(replace(PLAN, state=state), PASSED))


def test_done_state_alone_is_not_enough():
    assert blockers(PLAN, [TaskChange(0, "fix", None, None)])


def test_passed_task_without_stored_patch_blocks():
    assert any("no stored change" in b for b in blockers(PLAN, [TaskChange(0, "fix", "0xaa", None)]))


def test_passed_task_with_an_empty_patch_does_not_block():
    """An empty patch is a real outcome (the task passed without changing a tracked file), not a
    failed capture, and must not block the PR forever."""
    assert blockers(PLAN, [TaskChange(0, "fix", "0xaa", "")]) == []


def test_plan_with_no_tasks_blocks():
    assert blockers(PLAN, [])


def test_every_blocker_is_reported_not_just_the_first():
    problems = blockers(replace(PLAN, state="running"), [TaskChange(0, "a", None, None)])
    assert len(problems) == 2


def test_combined_diff_is_in_task_order_with_headers():
    out = combined_diff(list(reversed(PASSED)))
    assert out.index("# task 0: fix") < out.index("# task 1: docs")
    assert "diff --git a/x b/x" in out


def test_same_address_ignores_case_and_whitespace():
    assert same_address("0xABCDEF", " 0xabcdef ")
    assert not same_address("0x1", "0x2")


class FakeStore:
    def __init__(self, plan: PlanInfo | None = PLAN, changes: list[TaskChange] | None = None) -> None:
        self._plan = plan
        self._changes = PASSED if changes is None else changes
        self.requests: dict[str, PrRequest] = {}

    def plan(self, plan_uuid: str) -> PlanInfo | None:
        return self._plan if self._plan and self._plan.plan_uuid == plan_uuid else None

    def changes(self, plan_uuid: str) -> list[TaskChange]:
        return self._changes

    def request(self, plan_uuid: str) -> PrRequest | None:
        return self.requests.get(plan_uuid)

    def approve(self, plan_uuid: str, requested_by: str) -> PrRequest:
        existing = self.requests.get(plan_uuid)
        if existing is not None and existing.status != "error":
            return existing
        req = PrRequest(plan_uuid, requested_by, "queued", None, None, None, None, None)
        self.requests[plan_uuid] = req
        return req


def client(store: FakeStore, who: str | None = REQUESTER) -> TestClient:
    def requester() -> str:
        if who is None:
            raise HTTPException(401, "sign in")
        return who

    app = FastAPI()
    app.include_router(build_router(requester, lambda: store))
    return TestClient(app)


def url(suffix: str, plan: str = PLAN_UUID) -> str:
    return f"/v0/plans/{plan}/{suffix}"


def test_pr_requires_requester_approval_no_session():
    store = FakeStore()
    assert client(store, None).post(url("open-pr")).status_code == 401
    assert store.requests == {}


def test_another_wallet_cannot_approve_or_read_the_diff():
    store = FakeStore()
    stranger = client(store, "0x" + "9" * 40)
    assert stranger.post(url("open-pr")).status_code == 403
    assert stranger.get(url("diff")).status_code == 403
    assert stranger.get(url("pr")).status_code == 403
    assert store.requests == {}


def test_requester_address_matches_in_any_case():
    assert client(FakeStore(), REQUESTER.upper().replace("0X", "0x")).get(url("diff")).status_code == 200


def test_approval_queues_a_request_and_nothing_is_opened_by_the_api():
    store = FakeStore()
    res = client(store).post(url("open-pr"))
    assert res.status_code == 202
    body: dict[str, Any] = res.json()
    assert body["status"] == "queued"
    assert body["requested_by"] == REQUESTER.lower()
    assert body["pr_url"] is None


def test_approval_is_idempotent_and_a_done_request_answers_200():
    store = FakeStore()
    c = client(store)
    c.post(url("open-pr"))
    assert c.post(url("open-pr")).status_code == 202
    assert len(store.requests) == 1
    store.requests[PLAN_UUID] = replace_request(store.requests[PLAN_UUID], status="done", pr_number=7)
    res = c.post(url("open-pr"))
    assert res.status_code == 200
    assert res.json()["pr_number"] == 7


def replace_request(req: PrRequest, **kw: Any) -> PrRequest:
    return replace(req, **kw)


def test_not_ready_plan_is_409_with_every_blocker_and_nothing_queued():
    store = FakeStore(replace(PLAN, state="running"), [TaskChange(0, "a", None, None)])
    res = client(store).post(url("open-pr"))
    assert res.status_code == 409
    assert len(res.json()["detail"]["blockers"]) == 2
    assert store.requests == {}


def test_diff_shows_tasks_and_patches_for_review():
    res = client(FakeStore()).get(url("diff"))
    body = res.json()
    assert [t["task_id"] for t in body["tasks"]] == ["0xaa", "0xbb"]
    assert "diff --git a/x b/x" in body["diff"]
    assert body["base_ref"] == "main"


def test_diff_refused_until_ready():
    store = FakeStore(replace(PLAN, state="running"))
    assert client(store).get(url("diff")).status_code == 409


def test_unknown_or_malformed_plan_is_404():
    c = client(FakeStore())
    assert c.post(url("open-pr", "00000000-0000-4000-8000-000000000000")).status_code == 404
    assert c.post(url("open-pr", "not-a-uuid")).status_code == 404


def test_pr_status_404_before_approval_then_visible():
    store = FakeStore()
    c = client(store)
    assert c.get(url("pr")).status_code == 404
    c.post(url("open-pr"))
    assert c.get(url("pr")).json()["status"] == "queued"
