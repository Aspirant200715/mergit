"""Read model for the run API (plan task O7): a plan's own list and its attempts.

Plans, tasks and jobs are structured tables (O3, O4, O5), so the list and the per-task attempts come
straight from them. A plan's money and verdict events are read from the ``money_events`` ledger by
``mergit_cp/money.py`` (plan task O6, money half), not from the raw ``chain_events_seen`` log.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow, dict_row


@dataclass(frozen=True, slots=True)
class PlanSummary:
    plan_uuid: str
    plan_id: str
    state: str
    goal: str
    category: str
    budget_usdc_units: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Attempt:
    """One row of `jobs`: one dispatched attempt at one task index."""

    task_id: str
    index: int
    attempt: int
    agent_id: str
    status: str
    phi_holds: bool | None
    receipt_root: str | None
    notes: str | None
    finished_at: datetime | None


async def list_for_requester(conn: AsyncConnection[TupleRow], requester: str) -> list[PlanSummary]:
    cur = conn.cursor(row_factory=dict_row)
    await cur.execute(
        "SELECT plan_uuid, plan_id, state, goal, category, budget_usdc_units, created_at"
        " FROM plans WHERE requester = %s ORDER BY created_at DESC",
        (requester,),
    )
    return [
        PlanSummary(
            plan_uuid=str(r["plan_uuid"]),
            plan_id=r["plan_id"],
            state=r["state"],
            goal=r["goal"],
            category=r["category"],
            budget_usdc_units=r["budget_usdc_units"],
            created_at=r["created_at"],
        )
        for r in await cur.fetchall()
    ]


async def attempts(conn: AsyncConnection[TupleRow], plan_uuid: UUID | str) -> list[Attempt]:
    cur = conn.cursor(row_factory=dict_row)
    await cur.execute(
        'SELECT task_id, "index", attempt, agent_id, status, phi_holds, receipt_root, notes, finished_at'
        ' FROM jobs WHERE plan_uuid = %s ORDER BY "index", attempt',
        (str(plan_uuid),),
    )
    return [
        Attempt(
            task_id=r["task_id"],
            index=r["index"],
            attempt=r["attempt"],
            agent_id=r["agent_id"],
            status=r["status"],
            phi_holds=r["phi_holds"],
            receipt_root=r["receipt_root"],
            notes=r["notes"],
            finished_at=r["finished_at"],
        )
        for r in await cur.fetchall()
    ]


def attempt_view(a: Attempt) -> dict[str, Any]:
    return {
        "task_id": a.task_id,
        "index": a.index,
        "attempt": a.attempt,
        "agent_id": a.agent_id,
        "status": a.status,
        "phi_holds": a.phi_holds,
        "receipt_root": a.receipt_root,
        "notes": a.notes,
        "finished_at": None if a.finished_at is None else a.finished_at.isoformat(),
    }


def plan_summary_view(p: PlanSummary) -> dict[str, Any]:
    return {
        "plan_uuid": p.plan_uuid,
        "plan_id": p.plan_id,
        "state": p.state,
        "goal": p.goal,
        "category": p.category,
        "budget_usdc_units": str(p.budget_usdc_units),
        "created_at": p.created_at.isoformat(),
    }
