from __future__ import annotations

import json
from pathlib import Path

import httpx
import jsonschema
import mergit_receipt
import pytest
import respx
from referencing import Registry, Resource

from mergit_worker.harness import run_task
from mergit_worker.publish import PublishError, ReceiptPublisher, receipt_sealed_event
from tests.support import (
    ProcessSandbox,
    RecordingPublisher,
    ScriptedLLM,
    make_agent,
    make_harness_config,
    make_job,
    make_prices,
    turn,
)

SPEC = Path(__file__).resolve().parents[2] / "spec" / "schemas"
STORE, GATEWAY = "http://store.test", "http://gateway.test"


@pytest.fixture
def sealed(sandbox: ProcessSandbox, repo_url: str) -> mergit_receipt.SealedBundle:
    rec = RecordingPublisher(sealed=[])
    run_task(
        make_job(repo_url),
        make_agent(),
        sandbox,
        ScriptedLLM([turn(("finish", {}))]),
        make_prices(),
        rec,
        make_harness_config(),
    )
    return rec.sealed[0]


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.now += s


def publisher(clock: Clock, window: float = 600.0) -> ReceiptPublisher:
    return ReceiptPublisher(
        store_url=STORE,
        gateway_url=GATEWAY,
        store_token="store-secret",
        events_token="events-secret",
        timeout_s=5,
        retry_window_s=window,
        sleep=clock.sleep,
        clock=clock.time,
    )


def test_event_validates_against_the_spec_schema(sealed: mergit_receipt.SealedBundle):
    schemas = {p.name: json.loads(p.read_text()) for p in SPEC.glob("*.json")}
    registry = Registry().with_resources(
        [(f"https://mergit.site/spec/v0/{n}", Resource.from_contents(s)) for n, s in schemas.items()]
    )
    validator = jsonschema.Draft202012Validator(schemas["event.json"], registry=registry)
    validator.validate(receipt_sealed_event(sealed))


def test_event_payload_comes_from_the_sealed_receipt(sealed: mergit_receipt.SealedBundle):
    payload = receipt_sealed_event(sealed)["payload"]
    assert payload["root"] == sealed.root
    assert payload["cost_micros"] == sealed.cost_micros
    assert payload["signature"] == sealed.signature


@respx.mock
def test_bundle_is_uploaded_before_receipt_sealed_is_sent(sealed: mergit_receipt.SealedBundle):
    order: list[str] = []
    respx.put(f"{STORE}/v0/bundles").mock(
        side_effect=lambda r: order.append("store") or httpx.Response(201, json={})
    )
    respx.post(f"{GATEWAY}/v0/events").mock(
        side_effect=lambda r: order.append("gateway") or httpx.Response(200)
    )
    publisher(Clock()).publish(sealed)
    assert order == ["store", "gateway"]


@respx.mock
def test_tokens_and_idempotency_key_are_sent(sealed: mergit_receipt.SealedBundle):
    store = respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(201))
    gw = respx.post(f"{GATEWAY}/v0/events").mock(return_value=httpx.Response(200))
    publisher(Clock()).publish(sealed)
    assert store.calls[0].request.headers["authorization"] == "Bearer store-secret"
    uploaded = json.loads(store.calls[0].request.content)
    assert uploaded["receipt"] == json.loads(sealed.bundle_json)["receipt"]
    req = gw.calls[0].request
    assert req.headers["authorization"] == "Bearer events-secret"
    assert req.headers["idempotency-key"] == json.loads(req.content)["event_id"]


@respx.mock
def test_event_not_sent_when_the_store_refuses(sealed: mergit_receipt.SealedBundle):
    respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(400, json={"error": "X"}))
    gw = respx.post(f"{GATEWAY}/v0/events").mock(return_value=httpx.Response(200))
    with pytest.raises(PublishError, match="store refused"):
        publisher(Clock()).publish(sealed)
    assert not gw.called


@respx.mock
def test_trajectory_blobs_are_uploaded_with_the_bundle(sealed: mergit_receipt.SealedBundle):
    """`bundle_json` alone carries only the evidence blobs; the store must also get every step's, from
    `trajectory_blobs_json`, or a bonded challenge would have nothing to compel a disclosure of."""
    store = respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(201))
    respx.post(f"{GATEWAY}/v0/events").mock(return_value=httpx.Response(200))
    publisher(Clock()).publish(sealed)

    uploaded = json.loads(store.calls[0].request.content)
    bundle = json.loads(sealed.bundle_json)
    trajectory = json.loads(sealed.trajectory_blobs_json)
    assert set(trajectory) - set(bundle["blobs"])  # the trajectory really does add non-evidence blobs
    assert set(bundle["blobs"]) <= set(uploaded["blobs"])
    assert set(trajectory) <= set(uploaded["blobs"])
    for digest, data in trajectory.items():
        assert uploaded["blobs"][digest] == data


@respx.mock
def test_existing_identical_bundle_is_fine(sealed: mergit_receipt.SealedBundle):
    respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(200))
    respx.post(f"{GATEWAY}/v0/events").mock(return_value=httpx.Response(200))
    publisher(Clock()).publish(sealed)


@respx.mock
def test_5xx_and_timeouts_are_retried_with_the_same_event_id(sealed: mergit_receipt.SealedBundle):
    respx.put(f"{STORE}/v0/bundles").mock(
        side_effect=[httpx.ConnectTimeout("t"), httpx.Response(503), httpx.Response(201)]
    )
    gw = respx.post(f"{GATEWAY}/v0/events").mock(side_effect=[httpx.Response(502), httpx.Response(200)])
    clock = Clock()
    publisher(clock).publish(sealed)
    ids = {json.loads(c.request.content)["event_id"] for c in gw.calls}
    assert len(gw.calls) == 2
    assert len(ids) == 1  # a retry must not look like a new event
    assert clock.sleeps == [1.0, 2.0, 1.0]  # exponential backoff, restarted per request


@respx.mock
def test_4xx_from_gateway_is_not_retried(sealed: mergit_receipt.SealedBundle):
    respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(201))
    gw = respx.post(f"{GATEWAY}/v0/events").mock(return_value=httpx.Response(401))
    with pytest.raises(PublishError, match="gateway refused"):
        publisher(Clock()).publish(sealed)
    assert len(gw.calls) == 1


@respx.mock
def test_retries_stop_after_the_window(sealed: mergit_receipt.SealedBundle):
    route = respx.put(f"{STORE}/v0/bundles").mock(return_value=httpx.Response(503))
    clock = Clock()
    with pytest.raises(PublishError, match="after retries"):
        publisher(clock, window=10.0).publish(sealed)
    assert clock.now <= 10.0
    assert len(route.calls) >= 3
