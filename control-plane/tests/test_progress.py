from __future__ import annotations

import json

import httpx
import respx

from mergit_worker.meter import Cost
from mergit_worker.progress import HttpProgressReporter, NullProgressReporter

URL = "http://control-plane.test"


def test_null_reporter_does_nothing() -> None:
    NullProgressReporter().report("0x" + "a" * 64, 1, "model_call", Cost())


@respx.mock
def test_reports_the_step_with_the_bearer_token() -> None:
    route = respx.post(f"{URL}/v0/internal/progress").mock(return_value=httpx.Response(202))
    cost = Cost(model="m", input_tokens=10, output_tokens=5, wall_ms=100, usd_micros=7)

    HttpProgressReporter(URL, "worker-secret").report("0x" + "a" * 64, 3, "model_call", cost)

    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "task_id": "0x" + "a" * 64,
        "seq": 3,
        "type": "model_call",
        "cost": json.loads(cost.to_json()),
    }
    assert route.calls[0].request.headers["authorization"] == "Bearer worker-secret"


@respx.mock
def test_a_refusal_is_logged_not_raised() -> None:
    respx.post(f"{URL}/v0/internal/progress").mock(return_value=httpx.Response(404))
    HttpProgressReporter(URL, "worker-secret").report("0x" + "a" * 64, 1, "model_call", Cost())


@respx.mock
def test_a_transport_error_is_logged_not_raised() -> None:
    respx.post(f"{URL}/v0/internal/progress").mock(side_effect=httpx.ConnectError("down"))
    HttpProgressReporter(URL, "worker-secret").report("0x" + "a" * 64, 1, "model_call", Cost())
