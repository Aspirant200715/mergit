"""Tests for the mergit_receipt Python binding. The Rust crates are the only implementation; these check
that Python reaches it unchanged and cannot get around the harness-only rule."""

import json
import pathlib

import pytest

import mergit_receipt as mr

VECTORS = pathlib.Path(__file__).resolve().parents[3] / "spec" / "vectors"
KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
REGISTRY = "0x0000000000000000000000000000000000000001"
CHAIN_ID = 84532


def vector(name: str) -> dict:
    return json.loads((VECTORS / f"{name}.json").read_text())


def header_json() -> str:
    return json.dumps(vector("valid_minimal")["bundle"]["receipt"]["header"])


def cost(usd: int = 5) -> str:
    return json.dumps({"model": None, "input_tokens": 0, "output_tokens": 0, "tool_calls": 1, "wall_ms": 10, "usd_micros": usd})


def phi_result(holds: bool = True) -> str:
    return json.dumps({
        "exit_code": 0 if holds else 1,
        "changed_paths": ["payments/refund.py"],
        "observed_artifact_hashes": {},
        "stdout_digest": mr.keccak_hex(b"1 passed"),
        "holds": holds,
    })


def test_add_step_rejects_phi_eval():
    b = mr.ReceiptBuilder(header_json())
    with pytest.raises(ValueError, match="phi_eval is reserved"):
        b.add_step("phi_eval", b"in", b"out", 0, cost())


def test_add_step_returns_gapless_seq():
    b = mr.ReceiptBuilder(header_json())
    assert [b.add_step("tool_call", b"i", b"o", None, cost()) for _ in range(3)] == [1, 2, 3]


def test_header_with_wrong_phi_hash_raises():
    h = json.loads(header_json())
    h["phi_hash"] = "0x" + "0" * 64
    with pytest.raises(ValueError):
        mr.ReceiptBuilder(json.dumps(h))


def test_seal_then_verify_is_unattested_valid():
    b = mr.ReceiptBuilder(header_json())
    seq = b.add_step("command", b"pytest -q", b"1 passed", 0, cost())
    b.mark_evidence(seq)
    sealed = b.seal_with_phi(phi_result(), cost(0), KEY, CHAIN_ID, REGISTRY)
    report = json.loads(mr.verify(sealed.bundle_json, CHAIN_ID, REGISTRY, None))
    assert report["status"] == "unattested_valid"
    assert report["phi_holds"] is True
    assert sealed.cost_micros == 5
    assert len(sealed.signature) == 2 + 130
    assert json.loads(sealed.bundle_json)["receipt"]["root"] == sealed.root


def test_seal_rejects_contradicted_phi_result():
    b = mr.ReceiptBuilder(header_json())
    lie = json.loads(phi_result(holds=False))
    lie["holds"] = True
    with pytest.raises(ValueError, match="holds"):
        b.seal_with_phi(json.dumps(lie), cost(0), KEY, CHAIN_ID, REGISTRY)


def test_builder_cannot_be_used_after_sealing():
    b = mr.ReceiptBuilder(header_json())
    b.seal_with_phi(phi_result(), cost(0), KEY, CHAIN_ID, REGISTRY)
    with pytest.raises(ValueError, match="sealed"):
        b.add_step("tool_call", b"i", b"o", None, cost())


def test_vectors_verify_as_expected():
    for path in sorted(VECTORS.glob("*.json")):
        if path.name == "ids.json":
            continue
        v = json.loads(path.read_text())
        if v["commitment"] is not None:
            continue  # the binding's verify takes no commitment; the Rust tests cover those
        report = json.loads(mr.verify(json.dumps(v["bundle"]), v["domain"]["chain_id"], v["domain"]["registry"], v["signer"]))
        assert report["status"] == v["expect"]["status"], path.name
        assert set(v["expect"]["reasons"]) <= set(report["reasons"]), path.name


def test_task_id_matches_vector():
    for case in json.loads((VECTORS / "ids.json").read_text()):
        pid = mr.plan_id(case["plan_uuid"])
        assert pid == case["plan_id"]
        assert mr.task_id(pid, case["index"], case["attempt"]) == case["task_id"]


def test_phi_hash_and_phi_holds():
    phi = json.loads(header_json())["phi"]
    assert mr.phi_hash(json.dumps(phi)) == json.loads(header_json())["phi_hash"]
    assert mr.phi_holds(json.dumps(phi), phi_result(True)) is True
    assert mr.phi_holds(json.dumps(phi), phi_result(False)) is False


def test_keccak_hex():
    assert mr.keccak_hex(b"") == "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"


def test_bundle_carries_evidence_only_and_the_trajectory_is_kept_separately():
    b = mr.ReceiptBuilder(header_json())
    b.add_step("model_call", b"prompt", b"plan", None, cost())  # not evidence
    sealed = b.seal_with_phi(phi_result(), cost(0), KEY, CHAIN_ID, REGISTRY)
    bundle = json.loads(sealed.bundle_json)
    trajectory = json.loads(sealed.trajectory_blobs_json)
    model_step = bundle["receipt"]["steps"][0]
    assert model_step["output_digest"] not in bundle["blobs"]
    assert model_step["output_digest"] in trajectory
