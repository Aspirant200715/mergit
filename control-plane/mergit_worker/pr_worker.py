"""Worker side of the PR gate: claim an approved request, open the pull request, record the result."""

from __future__ import annotations

import logging
from typing import Protocol

from mergit_cp.pr_gate import PlanInfo, TaskChange, blockers
from mergit_cp.pr_store import PgPrStore

from .github import GitHubError, PrResult, PrSpec, PrTask

log = logging.getLogger(__name__)


class PrOpener(Protocol):
    def open(self, spec: PrSpec) -> PrResult: ...


class PrHandler:
    def __init__(self, store: PgPrStore, opener: PrOpener) -> None:
        self._store = store
        self._opener = opener

    def run_once(self) -> bool:
        """Handle at most one approved request. Returns False when none was waiting."""
        plan_uuid = self._store.claim()
        if plan_uuid is None:
            return False
        try:
            result = self._opener.open(self._spec(plan_uuid))
        except GitHubError as exc:
            log.warning("pull request for plan %s failed: %s", plan_uuid, exc)
            self._store.fail(plan_uuid, str(exc))
        except Exception as exc:  # one bad request must not stop the worker
            log.exception("pull request for plan %s crashed", plan_uuid)
            self._store.fail(plan_uuid, f"internal error: {type(exc).__name__}")
        else:
            self._store.finish(plan_uuid, result.branch, result.commit_sha, result.pr_number, result.pr_url)
            log.info("opened PR #%d for plan %s", result.pr_number, plan_uuid)
        return True

    def _spec(self, plan_uuid: str) -> PrSpec:
        """Re-check the gate at the moment of opening: the state could have changed since approval."""
        plan: PlanInfo | None = self._store.plan(plan_uuid)
        if plan is None:
            raise GitHubError("the plan no longer exists")
        changes: list[TaskChange] = self._store.changes(plan_uuid)
        problems = blockers(plan, changes)
        if problems:
            raise GitHubError("; ".join(problems))
        tasks = [PrTask(c.index, c.task_id or "", c.title, c.patch or "") for c in changes]
        return PrSpec(plan_uuid, plan.goal, plan.repo_url, plan.ref, tasks)
