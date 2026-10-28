"""PR gate SQL against a real Postgres. Run with `pytest -m postgres`."""

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import mergit_receipt
import psycopg
import pytest
from psycopg.rows import dict_row
from testcontainers.community.postgres import PostgresContainer

from mergit_cp.pr_store import PgPrStore
from tests.support import REQUESTER, phi

pytestmark = pytest.mark.postgres
HERE = Path(__file__).parent
SCHEMA = (HERE / "jobs_schema.sql").read_text()
MIGRATION = (HERE.parent / "migrations" / "0009_pr_requests.sql").read_text()


@pytest.fixture(scope="module")
def dsn() -> Iterator[str]:
    with PostgresContainer("postgres:16") as pg:
        url = pg.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(SCHEMA)
            conn.execute(MIGRATION)
        yield url


@pytest.fixture
def db(dsn: str) -> Iterator[Any]:
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:  # type: ignore[arg-type]
        conn.execute("TRUNCATE pr_requests, jobs, tasks, plans CASCADE")
        yield conn


def seed_plan(db: Any, n_tasks: int = 2, state: str = "done") -> tuple[str, list[str]]:
    plan_uuid = str(uuid.uuid4())
    plan_id = mergit_receipt.plan_id(plan_uuid)
    db.execute(
        "INSERT INTO plans VALUES "
        "(%s, %s, %s, 'https://github.com/acme/widgets', 'main', 'c', 'the goal', %s)",
        (plan_uuid, plan_id, REQUESTER, state),
    )
    ids = []
    for i in range(n_tasks):
        db.execute(
            'INSERT INTO tasks (plan_uuid, "index", title, instructions, phi, budget_usdc_units)'
            " VALUES (%s, %s, %s, 'x', %s, 1)",
            (plan_uuid, i, f"task {i}", json.dumps(phi())),
        )
        ids.append(mergit_receipt.task_id(plan_id, i, 1))
    return plan_uuid, ids


def add_job(db: Any, plan_uuid: str, index: int, attempt: int, holds: bool | None, patch: str | None) -> str:
    plan_id = mergit_receipt.plan_id(plan_uuid)
    task_id = mergit_receipt.task_id(plan_id, index, attempt)
    db.execute(
        'INSERT INTO jobs (task_id, plan_uuid, "index", attempt, agent_id, status, phi_holds, patch) '
        "VALUES (%s, %s, %s, %s, '1', 'done', %s, %s)",
        (task_id, plan_uuid, index, attempt, holds, patch),
    )
    return task_id


def test_plan_row(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    plan = PgPrStore.connect(dsn).plan(plan_uuid)
    assert plan is not None and (plan.state, plan.goal, plan.ref) == ("done", "the goal", "main")
    assert PgPrStore.connect(dsn).plan(str(uuid.uuid4())) is None


def test_changes_pick_the_latest_passing_attempt_per_task(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    add_job(db, plan_uuid, 0, 1, False, None)  # failed first try
    second = add_job(db, plan_uuid, 0, 2, True, "patch0-v2")
    add_job(db, plan_uuid, 1, 1, True, "patch1")
    changes = PgPrStore.connect(dsn).changes(plan_uuid)
    assert [(c.index, c.task_id, c.patch) for c in changes] == [
        (0, second, "patch0-v2"),
        (1, mergit_receipt.task_id(mergit_receipt.plan_id(plan_uuid), 1, 1), "patch1"),
    ]


def test_task_without_a_passing_attempt_is_listed_with_nothing(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    add_job(db, plan_uuid, 0, 1, True, "p0")
    add_job(db, plan_uuid, 1, 1, None, None)  # inconclusive does not count
    add_job(db, plan_uuid, 1, 2, False, None)
    changes = PgPrStore.connect(dsn).changes(plan_uuid)
    assert (changes[1].task_id, changes[1].patch) == (None, None)


def test_approve_queues_once_and_is_idempotent(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    store = PgPrStore.connect(dsn)
    first = store.approve(plan_uuid, REQUESTER)
    again = store.approve(plan_uuid, "0xsomeoneelse")
    assert (first.status, again.status, again.requested_by) == ("queued", "queued", REQUESTER)
    assert db.execute("SELECT count(*) AS n FROM pr_requests").fetchone()["n"] == 1


def test_claim_finish_records_branch_sha_number_and_url(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    api, worker = PgPrStore.connect(dsn), PgPrStore.connect(dsn, "w1")
    api.approve(plan_uuid, REQUESTER)
    assert worker.claim() == plan_uuid
    assert worker.claim() is None
    worker.finish(plan_uuid, "mergit/x", "c0ffee", 9, "https://github.com/acme/widgets/pull/9")
    req = api.request(plan_uuid)
    assert req is not None
    assert (req.status, req.branch, req.commit_sha, req.pr_number) == ("done", "mergit/x", "c0ffee", 9)
    assert api.approve(plan_uuid, REQUESTER).status == "done"  # approving again does not open a second PR


def test_error_can_be_re_requested(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    api, worker = PgPrStore.connect(dsn), PgPrStore.connect(dsn, "w1")
    api.approve(plan_uuid, REQUESTER)
    worker.claim()
    worker.fail(plan_uuid, "token rejected")
    failed = api.request(plan_uuid)
    assert failed is not None and (failed.status, failed.error) == ("error", "token rejected")
    again = api.approve(plan_uuid, REQUESTER)
    assert (again.status, again.error) == ("queued", None)


def test_only_the_claiming_worker_can_finish(dsn: str, db: Any):
    plan_uuid, _ = seed_plan(db)
    PgPrStore.connect(dsn).approve(plan_uuid, REQUESTER)
    PgPrStore.connect(dsn, "w1").claim()
    PgPrStore.connect(dsn, "w2").finish(plan_uuid, "b", "s", 1, "u")
    assert db.execute("SELECT status FROM pr_requests").fetchone()["status"] == "running"


def test_two_workers_never_claim_the_same_request(dsn: str, db: Any):
    plans = [seed_plan(db)[0] for _ in range(12)]
    api = PgPrStore.connect(dsn)
    for p in plans:
        api.approve(p, REQUESTER)
    got: list[str] = []
    lock = threading.Lock()

    def drain(name: str) -> None:
        store = PgPrStore.connect(dsn, name)
        while (p := store.claim()) is not None:
            with lock:
                got.append(p)

    threads = [threading.Thread(target=drain, args=(f"w{i}",)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(got) == sorted(plans)


def test_requeue_only_this_workers_running_requests(dsn: str, db: Any):
    a, _ = seed_plan(db)
    b, _ = seed_plan(db)
    api = PgPrStore.connect(dsn)
    api.approve(a, REQUESTER)
    api.approve(b, REQUESTER)
    PgPrStore.connect(dsn, "w1").claim()
    PgPrStore.connect(dsn, "w2").claim()
    assert PgPrStore.connect(dsn, "w1").requeue_own_running() == 1
    assert sorted(r["status"] for r in db.execute("SELECT status FROM pr_requests")) == ["queued", "running"]


def test_reclaim_stale_requeues_any_workers_claim_past_its_lease(dsn: str, db: Any):
    """Unlike a job, a stuck PR request is simply requeued, never marked error: opening a PR is
    idempotent, so there is no double-pay risk in trying again."""
    a, _ = seed_plan(db)
    b, _ = seed_plan(db)
    api = PgPrStore.connect(dsn)
    api.approve(a, REQUESTER)
    api.approve(b, REQUESTER)
    PgPrStore.connect(dsn, "w1").claim()
    PgPrStore.connect(dsn, "w2").claim()
    db.execute("UPDATE pr_requests SET claimed_at = now() - interval '2 hours' WHERE claimed_by = 'w1'")
    assert PgPrStore.connect(dsn, "w3").reclaim_stale(lease_s=3600) == 1
    rows = {r["claimed_by"]: r["status"] for r in db.execute("SELECT claimed_by, status FROM pr_requests")}
    assert rows == {None: "queued", "w2": "running"}


def test_claim_reconnects_after_the_connection_is_lost(dsn: str, db: Any):
    seed_plan(db)
    (plan_uuid,) = [r["plan_uuid"] for r in db.execute("SELECT plan_uuid::text FROM plans")]
    PgPrStore.connect(dsn).approve(plan_uuid, REQUESTER)
    store = PgPrStore.connect(dsn, "w1")
    store._conn.close()  # simulate the connection dying under it, between requests
    assert store.claim() == plan_uuid
