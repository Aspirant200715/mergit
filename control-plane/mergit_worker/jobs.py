"""The job queue as the worker sees it: Postgres rows claimed with `FOR UPDATE SKIP LOCKED`.

All SQL for the worker lives in this file. It relies on the tables of plan tasks O3 and O4; the columns
it reads and writes are listed in `control-plane/README.md` and exercised by `tests/jobs_schema.sql`, so
a change to those tables shows up here as a failing test.
"""

from __future__ import annotations

from typing import Any, Protocol, cast

import psycopg
from psycopg.rows import dict_row

from .models import Job, RunOutcome

_CLAIM = """
WITH next AS (
    SELECT task_id FROM jobs
    WHERE status = 'queued'
    ORDER BY created_at, task_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE jobs SET status = 'running', claimed_by = %(worker)s, claimed_at = now()
FROM next WHERE jobs.task_id = next.task_id
RETURNING jobs.task_id
"""

_LOAD = """
SELECT j.task_id, j.plan_uuid, p.plan_id, j."index", j.attempt, j.agent_id,
       p.requester, p.category, p.repo_url, p.ref, t.title, t.instructions, t.phi,
       t.budget_usdc_units
FROM jobs j
JOIN plans p ON p.plan_uuid = j.plan_uuid
JOIN tasks t ON t.plan_uuid = j.plan_uuid AND t."index" = j."index"
WHERE j.task_id = %(task_id)s
"""

_REPORT = """
UPDATE jobs SET status = %(status)s, phi_holds = %(holds)s, receipt_root = %(root)s,
                notes = %(notes)s, finished_at = now()
WHERE task_id = %(task_id)s AND status = 'running' AND claimed_by = %(worker)s
"""

_REQUEUE_OWN = """
UPDATE jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL
WHERE status = 'running' AND claimed_by = %(worker)s
"""


class JobStore(Protocol):
    def claim(self) -> Job | None: ...
    def report(self, outcome: RunOutcome) -> None: ...
    def fail(self, task_id: str, message: str) -> None: ...


class PgJobStore:
    def __init__(self, conn: psycopg.Connection[dict[str, Any]], worker_id: str) -> None:
        self._conn = conn
        self._worker = worker_id

    @classmethod
    def connect(cls, database_url: str, worker_id: str) -> PgJobStore:
        conn = cast(
            "psycopg.Connection[dict[str, Any]]",
            psycopg.connect(database_url, autocommit=True, row_factory=dict_row),  # pyright: ignore[reportArgumentType]
        )
        return cls(conn, worker_id)

    def requeue_own_running(self) -> int:
        """At start-up: a `running` job claimed under this worker id was left by a crashed process of
        the same worker, so it goes back to the queue. A worker never takes over another's jobs."""
        return self._conn.execute(_REQUEUE_OWN, {"worker": self._worker}).rowcount

    def claim(self) -> Job | None:
        with self._conn.transaction():
            claimed = self._conn.execute(_CLAIM, {"worker": self._worker}).fetchone()
            if claimed is None:
                return None
            row = self._conn.execute(_LOAD, {"task_id": claimed["task_id"]}).fetchone()
        if row is None:  # the plan or task row is missing: put nothing back, surface it
            self.fail(claimed["task_id"], "job has no plan or task row")
            return None
        return Job(
            task_id=row["task_id"],
            plan_uuid=str(row["plan_uuid"]),
            plan_id=row["plan_id"],
            index=row["index"],
            attempt=row["attempt"],
            agent_id=str(row["agent_id"]),
            requester=row["requester"],
            category=row["category"],
            repo_url=row["repo_url"],
            ref=row["ref"],
            title=row["title"],
            instructions=row["instructions"],
            phi=row["phi"],
            budget_usdc_units=int(row["budget_usdc_units"]),
        )

    def report(self, outcome: RunOutcome) -> None:
        """Store the Φ result (`holds` is None when Φ could not run) on the job row for O6."""
        self._finish(outcome.task_id, "done", outcome.holds, outcome.root, "; ".join(outcome.notes))

    def fail(self, task_id: str, message: str) -> None:
        """The task could not be run or sealed. `phi_holds` stays NULL: inconclusive, a person decides."""
        self._finish(task_id, "error", None, None, message[:2000])

    def _finish(self, task_id: str, status: str, holds: bool | None, root: str | None, notes: str) -> None:
        self._conn.execute(
            _REPORT,
            {
                "task_id": task_id,
                "status": status,
                "holds": holds,
                "root": root,
                "notes": notes,
                "worker": self._worker,
            },
        )

    def close(self) -> None:
        self._conn.close()
