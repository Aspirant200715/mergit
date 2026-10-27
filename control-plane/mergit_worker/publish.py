"""Publishing a sealed receipt: upload the bundle to the receipt store, then send `receipt.sealed`.

The order is a rule of spec/events-v0.md: a committed receipt must always have a body to audit, so the
event is never sent unless the store accepted the bundle. Transport follows the same spec: bearer
tokens, `Idempotency-Key: <event_id>`, retry on 5xx and timeouts with backoff for a bounded window.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import mergit_receipt

log = logging.getLogger(__name__)

_BACKOFF_START_S = 1.0
_BACKOFF_MAX_S = 30.0


class PublishError(Exception):
    """The bundle or the event was rejected for good, or retries ran out."""


class ReceiptPublisher:
    def __init__(
        self,
        *,
        store_url: str,
        gateway_url: str,
        store_token: str,
        events_token: str,
        timeout_s: float,
        retry_window_s: float,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store_url = store_url
        self._gateway_url = gateway_url
        self._store_token = store_token
        self._events_token = events_token
        self._window_s = retry_window_s
        self._http = client or httpx.Client(timeout=timeout_s)
        self._sleep = sleep
        self._clock = clock

    def publish(self, sealed: mergit_receipt.SealedBundle) -> None:
        self._upload_bundle(sealed)
        self._send_sealed_event(sealed)

    # -- store ---------------------------------------------------------------------------------

    def _upload_bundle(self, sealed: mergit_receipt.SealedBundle) -> None:
        response = self._with_retries(
            "store upload",
            lambda: self._http.put(
                f"{self._store_url}/v0/bundles",
                content=sealed.bundle_json.encode(),
                headers={
                    "Authorization": f"Bearer {self._store_token}",
                    "Content-Type": "application/json",
                },
            ),
        )
        if response.status_code not in (200, 201):  # 200: the same bundle was already stored
            raise PublishError(
                f"receipt store refused the bundle: {response.status_code} {response.text[:200]}"
            )

    # -- gateway -------------------------------------------------------------------------------

    def _send_sealed_event(self, sealed: mergit_receipt.SealedBundle) -> None:
        event = receipt_sealed_event(sealed)
        response = self._with_retries(
            "receipt.sealed",
            lambda: self._http.post(
                f"{self._gateway_url}/v0/events",
                json=event,
                headers={
                    "Authorization": f"Bearer {self._events_token}",
                    "Idempotency-Key": event["event_id"],
                },
            ),
        )
        if response.status_code != 200:
            raise PublishError(
                f"gateway refused receipt.sealed: {response.status_code} {response.text[:200]}"
            )

    # -- retries -------------------------------------------------------------------------------

    def _with_retries(self, what: str, send: Callable[[], httpx.Response]) -> httpx.Response:
        """Retry timeouts, connection errors and 5xx with backoff; return any other response."""
        deadline = self._clock() + self._window_s
        delay = _BACKOFF_START_S
        while True:
            try:
                response = send()
                if response.status_code < 500:
                    return response
                reason = f"HTTP {response.status_code}"
            except httpx.TransportError as exc:
                reason = type(exc).__name__
            if self._clock() + delay > deadline:
                raise PublishError(f"{what} failed after retries: {reason}")
            log.warning("%s failed (%s), retrying in %.0fs", what, reason, delay)
            self._sleep(delay)
            delay = min(delay * 2, _BACKOFF_MAX_S)


def receipt_sealed_event(sealed: mergit_receipt.SealedBundle) -> dict[str, Any]:
    """The `receipt.sealed` envelope of spec/events-v0.md, built from the sealed receipt's own fields."""
    return {
        "event_id": str(uuid.uuid4()),
        "type": "receipt.sealed",
        "at": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "payload": {
            "task_id": sealed.task_id,
            "agent_id": sealed.agent_id,
            "root": sealed.root,
            "terminal_hash": sealed.terminal_hash,
            "body_hash": sealed.body_hash,
            "cost_micros": sealed.cost_micros,
            "signature": sealed.signature,
        },
    }
