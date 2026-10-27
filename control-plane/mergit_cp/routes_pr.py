"""Pull-request gate routes (plan task O9).

    GET  /v0/plans/{plan_uuid}/diff     the final diff, so the requester can review it
    POST /v0/plans/{plan_uuid}/open-pr  the requester's approval; queues the PR for the worker
    GET  /v0/plans/{plan_uuid}/pr       status, branch, commit SHA, PR number and URL

The API never holds a GitHub token. Approval only records a `pr_requests` row; the worker, which has the
token, opens the PR. `build_router` takes the session and store dependencies so the app (plan task O1)
wires in its own and tests wire in theirs.
"""

# No `from __future__ import annotations` here: FastAPI resolves the Annotated dependencies of the
# nested route functions at runtime, and they close over `get_requester` and `get_store`.
import uuid
from collections.abc import Callable
from dataclasses import asdict
from typing import Annotated, Any, Protocol

from fastapi import APIRouter, Depends, HTTPException, Response

from .pr_gate import PlanInfo, TaskChange, blockers, combined_diff, same_address
from .pr_store import PrRequest


class PrStoreLike(Protocol):
    def plan(self, plan_uuid: str) -> PlanInfo | None: ...
    def changes(self, plan_uuid: str) -> list[TaskChange]: ...
    def request(self, plan_uuid: str) -> PrRequest | None: ...
    def approve(self, plan_uuid: str, requested_by: str) -> PrRequest: ...


def build_router(
    get_requester: Callable[..., str],
    get_store: Callable[..., PrStoreLike],
) -> APIRouter:
    """`get_requester` returns the signed-in wallet address or raises 401; `get_store` returns the store."""
    router = APIRouter(prefix="/v0/plans", tags=["pull-request"])

    def own_plan(store: PrStoreLike, plan_uuid: str, requester: str) -> PlanInfo:
        try:
            plan_uuid = str(uuid.UUID(plan_uuid))
        except ValueError:
            raise HTTPException(404, "plan not found") from None
        plan = store.plan(plan_uuid)
        if plan is None:
            raise HTTPException(404, "plan not found")
        if not same_address(plan.requester, requester):
            raise HTTPException(403, "only the requester of this plan may do that")
        return plan

    def ready_changes(store: PrStoreLike, plan: PlanInfo) -> list[TaskChange]:
        changes = store.changes(plan.plan_uuid)
        problems = blockers(plan, changes)
        if problems:
            raise HTTPException(
                409, {"message": "the plan is not ready for a pull request", "blockers": problems}
            )
        return changes

    @router.get("/{plan_uuid}/diff")
    def diff(
        plan_uuid: str,
        requester: Annotated[str, Depends(get_requester)],
        store: Annotated[PrStoreLike, Depends(get_store)],
    ) -> dict[str, Any]:
        plan = own_plan(store, plan_uuid, requester)
        changes = ready_changes(store, plan)
        return {
            "plan_uuid": plan.plan_uuid,
            "repo_url": plan.repo_url,
            "base_ref": plan.ref,
            "tasks": [{"index": c.index, "title": c.title, "task_id": c.task_id} for c in changes],
            "diff": combined_diff(changes),
        }

    @router.post("/{plan_uuid}/open-pr", status_code=202)
    def open_pr(
        plan_uuid: str,
        response: Response,
        requester: Annotated[str, Depends(get_requester)],
        store: Annotated[PrStoreLike, Depends(get_store)],
    ) -> dict[str, Any]:
        plan = own_plan(store, plan_uuid, requester)
        ready_changes(store, plan)
        request = store.approve(plan.plan_uuid, requester.lower())
        if request.status == "done":
            response.status_code = 200  # already opened: the same answer, not a second PR
        return asdict(request)

    @router.get("/{plan_uuid}/pr")
    def pr_status(
        plan_uuid: str,
        requester: Annotated[str, Depends(get_requester)],
        store: Annotated[PrStoreLike, Depends(get_store)],
    ) -> dict[str, Any]:
        plan = own_plan(store, plan_uuid, requester)
        request = store.request(plan.plan_uuid)
        if request is None:
            raise HTTPException(404, "no pull request has been requested for this plan")
        return asdict(request)

    return router
