"""Postgres access for the PR gate, used by the API (approve, show diff) and by the worker (open the PR).

It reads `plans`, `tasks` and `jobs` (plan tasks O3, O4, O5; columns in `tests/jobs_schema.sql`) and owns
`pr_requests` (`migrations/0009_pr_requests.sql`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

import psycopg
from psycopg.rows import dict_row

from .pr_gate import PlanInfo, TaskChange

_PLAN = """
SELECT plan_uuid::text AS plan_uuid, requester, state, goal, repo_url, ref FROM plans
WHERE plan_uuid = %(plan)s
"""

# One row per task index: its passing attempt (the latest one if several passed), or NULLs if none did.
_CHANGES = """
SELECT t."index", t.title, j.task_id, j.patch
FROM tasks t
LEFT JOIN LATERAL (
    SELECT task_id, patch FROM jobs
    WHERE jobs.plan_uuid = t.plan_uuid AND jobs."index" = t."index" AND jobs.phi_holds IS TRUE
    ORDER BY attempt DESC LIMIT 1
) j ON true
WHERE t.plan_uuid = %(plan)s
ORDER BY t."index"
"""

_REQUEST_COLS = (
    "plan_uuid::text AS plan_uuid, requested_by, status, branch, commit_sha, pr_number, pr_url, error"
)

# Re-requesting after an error puts the row back in the queue; a queued, running or done row is left alone.
_INSERT = """
INSERT INTO pr_requests (plan_uuid, requested_by) VALUES (%(plan)s, %(by)s)
ON CONFLICT (plan_uuid) DO UPDATE
    SET status = 'queued', requested_by = EXCLUDED.requested_by, requested_at = now(),
        claimed_by = NULL, error = NULL, finished_at = NULL
    WHERE pr_requests.status = 'error'
RETURNING plan_uuid::text AS plan_uuid, requested_by, status, branch, commit_sha, pr_number, pr_url, error
"""

_GET_REQUEST = """
SELECT plan_uuid::text AS plan_uuid, requested_by, status, branch, commit_sha, pr_number, pr_url, error
FROM pr_requests WHERE plan_uuid = %(plan)s
"""

_CLAIM = """
WITH next AS (
    SELECT plan_uuid FROM pr_requests WHERE status = 'queued'
    ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE pr_requests SET status = 'running', claimed_by = %(worker)s
FROM next WHERE pr_requests.plan_uuid = next.plan_uuid
RETURNING pr_requests.plan_uuid::text AS plan_uuid
"""

_DONE = """
UPDATE pr_requests SET status = 'done', branch = %(branch)s, commit_sha = %(sha)s, pr_number = %(number)s,
                       pr_url = %(url)s, error = NULL, finished_at = now()
WHERE plan_uuid = %(plan)s AND status = 'running' AND claimed_by = %(worker)s
"""

_ERROR = """
UPDATE pr_requests SET status = 'error', error = %(error)s, finished_at = now()
WHERE plan_uuid = %(plan)s AND status = 'running' AND claimed_by = %(worker)s
"""

_REQUEUE_OWN = """
UPDATE pr_requests SET status = 'queued', claimed_by = NULL
WHERE status = 'running' AND claimed_by = %(worker)s
"""


@dataclass(frozen=True, slots=True)
class PrRequest:
    plan_uuid: str
    requested_by: str
    status: str
    branch: str | None
    commit_sha: str | None
    pr_number: int | None
    pr_url: str | None
    error: str | None


class PgPrStore:
    def __init__(self, conn: psycopg.Connection[dict[str, Any]], worker_id: str = "api") -> None:
        self._conn = conn
        self._worker = worker_id

    @classmethod
    def connect(cls, database_url: str, worker_id: str = "api") -> PgPrStore:
        conn = cast(
            "psycopg.Connection[dict[str, Any]]",
            psycopg.connect(database_url, autocommit=True, row_factory=dict_row),  # pyright: ignore[reportArgumentType]
        )
        return cls(conn, worker_id)

    def close(self) -> None:
        self._conn.close()

    # -- reads, API and worker -------------------------------------------------------------------

    def plan(self, plan_uuid: str) -> PlanInfo | None:
        row = self._conn.execute(_PLAN, {"plan": plan_uuid}).fetchone()
        return None if row is None else PlanInfo(**row)

    def changes(self, plan_uuid: str) -> list[TaskChange]:
        rows = self._conn.execute(_CHANGES, {"plan": plan_uuid}).fetchall()
        return [TaskChange(r["index"], r["title"], r["task_id"], r["patch"]) for r in rows]

    def request(self, plan_uuid: str) -> PrRequest | None:
        row = self._conn.execute(_GET_REQUEST, {"plan": plan_uuid}).fetchone()
        return None if row is None else PrRequest(**row)

    # -- the requester's approval, API -----------------------------------------------------------

    def approve(self, plan_uuid: str, requested_by: str) -> PrRequest:
        """Record the approval and queue the PR. Idempotent: an existing request is returned unchanged,
        except that one that ended in an error is queued again."""
        row = self._conn.execute(_INSERT, {"plan": plan_uuid, "by": requested_by}).fetchone()
        if row is not None:
            return PrRequest(**row)
        existing = self.request(plan_uuid)
        if existing is None:  # deleted between the two statements: ask again
            return self.approve(plan_uuid, requested_by)
        return existing

    # -- the worker --------------------------------------------------------------------------------

    def claim(self) -> str | None:
        """The plan_uuid of a queued request, now marked running for this worker."""
        with self._conn.transaction():
            row = self._conn.execute(_CLAIM, {"worker": self._worker}).fetchone()
        return None if row is None else str(row["plan_uuid"])

    def finish(self, plan_uuid: str, branch: str, sha: str, number: int, url: str) -> None:
        self._conn.execute(
            _DONE,
            {
                "plan": plan_uuid,
                "branch": branch,
                "sha": sha,
                "number": number,
                "url": url,
                "worker": self._worker,
            },
        )

    def fail(self, plan_uuid: str, error: str) -> None:
        self._conn.execute(_ERROR, {"plan": plan_uuid, "error": error[:2000], "worker": self._worker})

    def requeue_own_running(self) -> int:
        return self._conn.execute(_REQUEUE_OWN, {"worker": self._worker}).rowcount
