"""The run API and live stream (plan task O7): a requester's own plans, one plan's full detail, the
agent roster, and Server-Sent Events as a run moves. The worker reports live steps to
`POST /v0/internal/progress`; everything else streamed here is read straight from the database on a
short timer, since it is written by other requests, not by that endpoint.

Verdicts and money came from `chain_events_seen`, O6's stand-in (see `runs.py`'s module docstring): once
O6 exists, only the queries in `runs.py` should need to change, not this file.
"""

from __future__ import annotations

import asyncio
import hmac
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from . import plans, runs
from .agents import Agent
from .auth import AddressDep, PoolDep, SettingsDep
from .db import Pool
from .routes_plans import get_agents
from .stream import PlanBroadcaster, sse

router = APIRouter(prefix="/v0/plans", tags=["runs"])
agents_router = APIRouter(prefix="/v0/agents", tags=["agents"])
internal_router = APIRouter(prefix="/v0/internal", tags=["internal"])


def get_broadcaster(request: Request) -> PlanBroadcaster:
    return request.app.state.broadcaster


BroadcasterDep = Annotated[PlanBroadcaster, Depends(get_broadcaster)]


async def _owned_plan(conn: Any, plan_uuid: UUID, address: str) -> plans.StoredPlan:
    plan = await plans.load(conn, plan_uuid)
    if plan is None:
        raise HTTPException(status_code=404, detail="no such plan")
    if plan.requester != address:
        raise HTTPException(status_code=403, detail="only the requester may view this plan")
    return plan


@router.get("")
async def list_plans(address: AddressDep, pool: PoolDep) -> list[dict[str, Any]]:
    async with pool.connection() as conn:
        summaries = await runs.list_for_requester(conn, address)
    return [runs.plan_summary_view(s) for s in summaries]


@router.get("/{plan_uuid}")
async def plan_detail(plan_uuid: UUID, address: AddressDep, pool: PoolDep) -> dict[str, Any]:
    async with pool.connection() as conn:
        plan = await _owned_plan(conn, plan_uuid, address)
        attempts = await runs.attempts(conn, plan_uuid)
        money = await runs.money_events(conn, plan_uuid, plan.plan_id)
    view = plans.view(plan)
    view["attempts"] = [runs.attempt_view(a) for a in attempts]
    view["money_events"] = [runs.money_event_view(m) for m in money]
    return view


@agents_router.get("")
async def list_agents(agents: Annotated[list[Agent], Depends(get_agents)]) -> list[dict[str, str]]:
    return [{"agent_id": a.agent_id, "name": a.name, "model": a.model} for a in agents]


class ProgressStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    seq: int
    type: str
    cost: dict[str, Any]


@internal_router.post("/progress", status_code=202)
async def internal_progress(
    body: ProgressStep,
    settings: SettingsDep,
    pool: PoolDep,
    broadcaster: BroadcasterDep,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    expected = f"Bearer {settings.worker_token.get_secret_value()}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="bad or missing token")
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT plan_uuid FROM jobs WHERE task_id = %s", (body.task_id,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown task_id")
    broadcaster.publish(
        str(row[0]),
        {"task_id": body.task_id, "seq": body.seq, "type": body.type, "cost": body.cost},
    )
    return {"status": "accepted"}


@router.get("/{plan_uuid}/events")
async def plan_events(
    plan_uuid: UUID,
    request: Request,
    address: AddressDep,
    pool: PoolDep,
    settings: SettingsDep,
    broadcaster: BroadcasterDep,
) -> StreamingResponse:
    async with pool.connection() as conn:
        await _owned_plan(conn, plan_uuid, address)
    return StreamingResponse(
        _stream(pool, broadcaster, plan_uuid, request, settings.sse_poll_s),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(
    pool: Pool, broadcaster: PlanBroadcaster, plan_uuid: UUID, request: Request, poll_s: float
) -> AsyncIterator[str]:
    """Steps posted to `/v0/internal/progress` are relayed as soon as they arrive; `plan.state`,
    `task.state`, `verdict` and `money` are polled from the database at most every `poll_s` and only sent
    when something changed since the last poll. The first poll always sends: a client that just
    connected gets the full current state, not only what changes after it.
    """
    key = str(plan_uuid)
    queue = broadcaster.subscribe(key)
    last_state: str | None = None
    last_tasks: dict[int, tuple[str, bool | None]] = {}
    last_money_at: datetime | None = None
    try:
        while True:
            if await request.is_disconnected():
                return
            try:
                step = await asyncio.wait_for(queue.get(), timeout=poll_s)
            except TimeoutError:
                step = None
            if step is not None:
                yield sse("step.recorded", step)
                continue

            async with pool.connection() as conn:
                plan = await plans.load(conn, plan_uuid)
                if plan is None:
                    return
                attempts = await runs.attempts(conn, plan_uuid)
                money = await runs.money_events(conn, plan_uuid, plan.plan_id)

            if plan.state != last_state:
                yield sse("plan.state", {"state": plan.state})
                last_state = plan.state
            for a in attempts:
                current = (a.status, a.phi_holds)
                if last_tasks.get(a.index) != current:
                    yield sse("task.state", runs.attempt_view(a))
                    last_tasks[a.index] = current
            for m in money:
                if last_money_at is not None and m.received_at <= last_money_at:
                    continue
                event = "verdict" if m.type == "verdict.recorded" else "money"
                yield sse(event, runs.money_event_view(m))
            if money:
                last_money_at = money[-1].received_at
    finally:
        broadcaster.unsubscribe(key, queue)
