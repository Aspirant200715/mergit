"""In-process pub/sub for live step progress, and the Server-Sent Events wire format (plan task O7).

The worker posts each step to `POST /v0/internal/progress` as it runs; this is relayed to whoever is
subscribed to that plan with `PlanBroadcaster`, in this one process. Plan and task state, verdicts and
money are not pushed here: `GET /v0/plans/{plan_uuid}/events` reads those straight from the database on a
short timer instead, since they are written by other requests and by the chain-events handler, not by the
worker's progress calls.

A single-process broadcaster means a step is only ever seen by a client connected to the same API
instance the worker happened to reach. Fine for one instance; a second instance would need Postgres
`LISTEN`/`NOTIFY` or a shared queue in front of this, which is out of scope here.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any


def sse(event: str, data: dict[str, Any]) -> str:
    """One Server-Sent Events frame. `event`/`data` only; SSE data may not contain a bare newline, so
    the payload is compact JSON on one line."""
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


class PlanBroadcaster:
    """Queues of pending step events, one set per plan currently being watched."""

    def __init__(self, *, queue_size: int = 200) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._queue_size = queue_size

    def subscribe(self, plan_uuid: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers.setdefault(plan_uuid, set()).add(queue)
        return queue

    def unsubscribe(self, plan_uuid: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        subscribers = self._subscribers.get(plan_uuid)
        if subscribers is None:
            return
        subscribers.discard(queue)
        if not subscribers:
            del self._subscribers[plan_uuid]

    def publish(self, plan_uuid: str, step: dict[str, Any]) -> None:
        """Never blocks and never raises: a slow or gone subscriber loses steps, not the publisher."""
        for queue in self._subscribers.get(plan_uuid, ()):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(step)
