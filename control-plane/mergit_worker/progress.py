"""Reporting a step to the control plane the moment it is recorded (plan task O7's live stream).

Purely observational: a step that never reaches `POST /v0/internal/progress` only means a viewer does not
see it live, the same way they would not if nobody were watching at all. The receipt, the job row and the
run itself do not depend on this in any way, so a failed or slow report is logged and dropped, never
raised, and `NullProgressReporter` is a complete, correct choice when no control plane URL is configured.
"""

from __future__ import annotations

import json
import logging
from typing import Protocol

import httpx

from .meter import Cost

log = logging.getLogger(__name__)


class ProgressReporter(Protocol):
    def report(self, task_id: str, seq: int, step_type: str, cost: Cost) -> None: ...


class NullProgressReporter:
    def report(self, task_id: str, seq: int, step_type: str, cost: Cost) -> None:
        pass


class HttpProgressReporter:
    def __init__(
        self,
        control_plane_url: str,
        token: str,
        *,
        client: httpx.Client | None = None,
        timeout_s: float = 5.0,
    ) -> None:
        self._url = f"{control_plane_url.rstrip('/')}/v0/internal/progress"
        self._token = token
        self._http = client or httpx.Client(timeout=timeout_s)

    def report(self, task_id: str, seq: int, step_type: str, cost: Cost) -> None:
        body = {"task_id": task_id, "seq": seq, "type": step_type, "cost": json.loads(cost.to_json())}
        try:
            response = self._http.post(
                self._url, json=body, headers={"Authorization": f"Bearer {self._token}"}
            )
            if response.status_code >= 400:
                log.warning(
                    "progress report for %s step %d refused: %d %s",
                    task_id,
                    seq,
                    response.status_code,
                    response.text[:200],
                )
        except httpx.TransportError as exc:
            log.warning("progress report for %s step %d failed: %s", task_id, seq, exc)

    def close(self) -> None:
        self._http.close()
