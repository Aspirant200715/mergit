"""Type stub for mergit_receipt, the Python binding of the Rust receipt crates (spec/receipt-v0.md)."""

def plan_id(plan_uuid: str) -> str: ...
def task_id(plan_id: str, index: int, attempt: int) -> str: ...
def phi_hash(predicate_json: str) -> str: ...
def phi_holds(predicate_json: str, phi_result_json: str) -> bool: ...
def keccak_hex(data: bytes) -> str: ...
def verify(bundle_json: str, chain_id: int, registry: str, signer: str | None = None) -> str:
    """Returns the verification report as JSON: {"status", "reasons", "phi_holds"}."""

class SealedBundle:
    bundle_json: str
    task_id: str
    agent_id: str
    root: str
    terminal_hash: str
    body_hash: str
    cost_micros: int
    signature: str
    trajectory_blobs_json: str  # every step's bytes, {digest: base64}; keep for challenge disclosure

class ReceiptBuilder:
    def __init__(self, header_json: str) -> None:
        """Raises ValueError if phi_hash does not match phi, or the header is not v0 and unattested."""
    def add_step(self, step_type: str, input: bytes, output: bytes, exit_status: int | None, cost_json: str) -> int:
        """Appends a step, returns its seq. step_type "phi_eval" raises ValueError: only sealing adds it."""
    def mark_evidence(self, seq: int) -> None: ...
    def seal_with_phi(self, phi_result_json: str, cost_json: str, signer_key_hex: str, chain_id: int, registry: str) -> SealedBundle:
        """Appends the phi_eval step last, marks it evidence, signs. Raises ValueError if the result's holds
        disagrees with the predicate, or the key is not the header's dev_key. The builder is unusable after."""
