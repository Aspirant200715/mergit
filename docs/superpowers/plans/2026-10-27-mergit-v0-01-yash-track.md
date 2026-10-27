# Mergit v0: Yash Track (Receipts, Contracts, Web3 Services, Wallet, Hosting) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything on the receipt and web3 side of Mergit v0: the Rust receipt core and verifier, the receipt store, the validator, six contracts, the chain gateway with payment path and free credits, the wallet and proofs screens, and hosting.

**Architecture:** One Rust workspace. `spec` holds types and hashing that both `runtime/receipt` (builder) and `verifier` use; `runtime/py` and `verifier/wasm` expose them to Python and the browser. `chain/client` wraps the contracts with alloy and is shared by the gateway and the validator. Contracts live in the separate `mergit-contracts` Foundry repository.

**Tech Stack:** Rust 1.98, alloy (primitives, sol-types, signer-local, provider, node-bindings for Anvil in tests), serde + serde_jcs, axum + tokio + tower, sqlx (Postgres), pyo3 + maturin, wasm-bindgen + wasm-pack; Solidity 0.8.28, Foundry 1.7, OpenZeppelin 5; React 19, wagmi 2, viem 2.

**Spec:** [`docs/superpowers/specs/2026-10-27-mergit-v0-build-design.md`](../specs/2026-10-27-mergit-v0-build-design.md). Shared definitions: [`00-overview-and-spec`](2026-10-27-mergit-v0-00-overview-and-spec.md) Tasks S2 and S3 are normative for every type and event named here.

## Global Constraints

- All of the overview's Global Constraints apply.
- `verifier` must not depend on `runtime/receipt`. Both depend on `spec`.
- The `phi_eval` step can only be created by `seal_with_phi`. No public API, binding or service can append one any other way.
- Forged receipts for tests come only from the `forgery-fixture` Cargo feature of `runtime/receipt`, which no service or binding enables and no Dockerfile builds.
- Verdict values are exactly `pass`, `fail`, `invalid`. A status of `unattested_valid` is valid for v0, and every UI says "unattested (development key)".
- Testnet parameters, all labelled in code and UI as "parameters, not measured": window `600` s; free credits `5000000` units per address; plan value cap for credits `2000000`; `3` credit-funded plans per address per day; blob cap `8 MiB`; bundle cap `64 MiB`; stake ratio `10000` bps of `V`; bond `max(1000000, V × 1000 bps)`; challenger reward `2000` bps of `V`; max open tasks per operator `5`.
- Every git write is run by Yash. Commits from Claude-assisted work end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

See the overview. The tests that pin items 2, 3, 4 and 5 live in Tasks Y5, Y7, Y8, Y9 and Y12 below.

---

### Task Y1: `spec` crate types and the receipt builder

**Files:**
- Create: `spec/Cargo.toml`, `spec/src/lib.rs`, `spec/src/types.rs`, `spec/src/hash.rs`, `spec/src/merkle.rs`, `spec/src/eip712.rs`, `spec/src/phi.rs`
- Create: `runtime/receipt/Cargo.toml`, `runtime/receipt/src/lib.rs`, `runtime/receipt/src/builder.rs`, `runtime/receipt/src/fixture.rs` (feature `forgery-fixture`)
- Test: `runtime/receipt/tests/builder.rs`, `spec/tests/merkle.rs`

**Interfaces:**
- Produces (`mergit_spec`): structs `Predicate`, `Header`, `Attestation`, `Step`, `StepType`, `Cost`, `Meter`, `PhiResult`, `SealedReceipt`, `Bundle` (serde, field names exactly as S2); `fn jcs_hash<T: Serialize>(v: &T) -> B256`; `fn leaf(step: &Step) -> B256`; `fn chain(h0: B256, leaves: &[B256]) -> B256`; `fn merkle_root(leaves: &[B256]) -> B256`; `fn merkle_proof(leaves: &[B256], index: usize) -> Vec<B256>`; `fn phi_holds(phi: &Predicate, r: &PhiResult) -> bool`; `fn body_hash(r: &SealedReceipt) -> B256`; `sol! struct Receipt { bytes32 taskId; bytes32 root; bytes32 terminalHash; bytes32 bodyHash; uint256 costMicros; }`; `fn receipt_domain(chain_id: u64, registry: Address) -> Eip712Domain`.
- Produces (`mergit_receipt`): `ReceiptBuilder::new(header: Header) -> Result<Self, BuildError>`; `add_step(&mut self, s: StepInput) -> Result<u32, BuildError>` where `StepInput { step_type: StepType, input: Vec<u8>, output: Vec<u8>, exit_status: Option<i32>, cost: Cost, at: DateTime<Utc> }`; `mark_evidence(&mut self, seq: u32) -> Result<(), BuildError>`; `seal_with_phi(self, result: PhiResult, cost: Cost, ended_at: DateTime<Utc>, signer: &PrivateKeySigner, domain: &Eip712Domain) -> Result<Bundle, BuildError>`. `BuildError::{PhiEvalReserved, UnknownSeq(u32), PhiHashMismatch, AttestationNotUnattested}`.

- [ ] **Step 1: Write the failing tests** in `runtime/receipt/tests/builder.rs` and `spec/tests/merkle.rs`:

```rust
#[test] fn add_step_rejects_phi_eval() { /* add_step(StepType::PhiEval, ..) == Err(BuildError::PhiEvalReserved) */ }
#[test] fn seq_starts_at_one_and_is_gapless() { /* three add_step calls return 1, 2, 3 */ }
#[test] fn sealed_receipt_ends_with_phi_eval_in_evidence() { /* steps.last().step_type == PhiEval; evidence contains its seq */ }
#[test] fn phi_eval_input_is_jcs_of_header_phi() { /* steps.last().input_digest == jcs_hash(&header.phi) */ }
#[test] fn terminal_hash_matches_chain_over_leaves() { /* receipt.terminal_hash == chain(jcs_hash(&header), &leaves) */ }
#[test] fn editing_any_step_changes_root_and_terminal_hash() { /* mutate steps[0].exit_status, recompute, both differ */ }
#[test] fn signature_recovers_to_signer() { /* Receipt{..}.eip712_signing_hash(&domain) recovers signer.address() */ }
#[test] fn header_with_wrong_phi_hash_is_rejected() { /* ReceiptBuilder::new == Err(PhiHashMismatch) */ }
#[test] fn merkle_root_one_leaf_is_leaf() {}
#[test] fn merkle_proof_verifies_with_sorted_pairs_for_every_index_of_7_leaves() {}
```

- [ ] **Step 2:** Run `cargo test -p mergit-spec -p mergit-receipt`. Expected: FAIL (items not defined).
- [ ] **Step 3:** Implement the `spec` crate. Use `alloy-primitives::{B256, Address, keccak256}`, `alloy-sol-types::{sol, Eip712Domain, eip712_domain}`, `serde_jcs::to_vec`. `phi_holds` uses the `globset` crate for `allowed_paths`.
- [ ] **Step 4:** Implement `ReceiptBuilder`. It keeps blobs in a `BTreeMap<B256, Vec<u8>>`; `seal_with_phi` appends the `phi_eval` step with input `JCS(header.phi)` and output `JCS(result)`, marks it evidence, sums the meter, computes root, terminal hash and body hash, signs the EIP-712 `Receipt`, and returns the `Bundle` with every referenced blob base64-encoded.
- [ ] **Step 5:** Implement `fixture.rs` behind `#[cfg(feature = "forgery-fixture")]`: `pub fn forge(bundle: Bundle, edit: impl FnOnce(&mut SealedReceipt), signer, domain) -> Bundle` that re-signs after an arbitrary edit.
- [ ] **Step 6:** Run the tests. Expected: PASS. Run `cargo clippy --workspace -- -D warnings`. Expected: clean.
- [ ] **Step 7: Commit**

```bash
git add spec runtime/receipt Cargo.lock
git commit -m "feat(receipt): spec types, hashing, Merkle and the receipt builder"
```

### Task Y2: Verifier library, CLI and test vectors

**Files:**
- Create: `verifier/Cargo.toml`, `verifier/src/lib.rs`, `verifier/src/main.rs` (binary `mergit-verify`)
- Create: `runtime/receipt/examples/gen_vectors.rs` (requires `forgery-fixture`)
- Create: `spec/vectors/*.json` (generated, committed)
- Test: `verifier/tests/vectors.rs`

**Interfaces:**
- Consumes: Y1 `mergit_spec` items.
- Produces: `pub fn verify(bundle: &Bundle, domain: &Eip712Domain, expected_signer: Option<Address>, commitment: Option<&Commitment>) -> Report`; `pub struct Commitment { root: B256, terminal_hash: B256, body_hash: B256, cost_micros: U256 }`; `pub struct Report { status: Status, reasons: Vec<Reason>, phi_holds: Option<bool> }`; `enum Status { UnattestedValid, Invalid }` serialised `"unattested_valid"` / `"invalid"`; `enum Reason` = the codes in S2, serialised in SCREAMING_SNAKE_CASE. `UNATTESTED` is always present for v0 receipts and never makes a receipt invalid.
- Vector file shape: `{ "name", "bundle", "domain": {"chain_id", "registry"}, "signer", "commitment" | null, "expect": {"status", "reasons"} }`.

- [ ] **Step 1:** Write `gen_vectors.rs`: fixed signer key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Anvil's public test key 0), chain id `84532`, registry `0x0000000000000000000000000000000000000001`, fixed timestamps. Emit `valid_minimal` (phi only), `valid_three_steps`, and one forged vector per reason code: `seq_gap`, `seq_order`, `chain_mismatch`, `root_mismatch`, `body_hash_mismatch`, `bad_signature`, `phi_hash_mismatch`, `no_phi_eval`, `phi_eval_not_last`, `phi_eval_not_evidence`, `meter_mismatch`, `blob_missing`, `blob_digest_mismatch`, `phi_result_contradicted` (holds = true, exit_code ≠ expected), `commitment_mismatch`.
- [ ] **Step 2:** Run `cargo run -p mergit-receipt --features forgery-fixture --example gen_vectors -- spec/vectors`. Expected: 17 files written.
- [ ] **Step 3: Write the failing test** `verifier/tests/vectors.rs`: for every file in `spec/vectors`, `verify(..)` returns exactly `expect.status`, and `expect.reasons` is a subset of the returned reasons.
- [ ] **Step 4:** Run `cargo test -p mergit-verifier`. Expected: FAIL.
- [ ] **Step 5:** Implement `verify`. Check order: structure (seq, phi_eval rules), blobs and digests, phi hash, chain, root, meter, body hash, signature (and `expected_signer` when given), commitment (when given), then `phi_holds` recomputed from the PhiResult blob and compared with its `holds` field (`PHI_RESULT_CONTRADICTED` when they differ). Collect every failing reason; do not stop at the first.
- [ ] **Step 6:** Implement `mergit-verify <bundle.json> --chain-id <id> --registry <addr> [--signer <addr>]`: prints the `Report` as JSON; exit code 0 for `unattested_valid`, 1 for `invalid`, 2 for unreadable input.
- [ ] **Step 7:** Run `cargo test -p mergit-verifier` and `cargo run -p mergit-verifier -- spec/vectors/valid_minimal.json --chain-id 84532 --registry 0x0000000000000000000000000000000000000001` (Expected: exit 0, `"status":"unattested_valid"`).
- [ ] **Step 8: Commit**

```bash
git add verifier runtime/receipt/examples spec/vectors Cargo.lock
git commit -m "feat(verifier): verifier library, CLI and receipt test vectors"
```

### Task Y3: Python binding (`mergit_receipt`) and the WASM verifier

**Files:**
- Create: `runtime/py/Cargo.toml` (crate-type `cdylib`), `runtime/py/pyproject.toml` (maturin), `runtime/py/src/lib.rs`, `runtime/py/mergit_receipt.pyi`
- Create: `runtime/py/tests/test_binding.py`
- Create: `verifier/wasm/Cargo.toml`, `verifier/wasm/src/lib.rs`, `verifier/wasm/tests/web.rs`

**Interfaces:**
- Produces (Python, module `mergit_receipt`; Abhinav and Soham code against exactly this):

```python
def plan_id(plan_uuid: str) -> str: ...                       # keccak(utf8), 0x-hex
def task_id(plan_id: str, index: int, attempt: int) -> str: ...
def phi_hash(predicate_json: str) -> str: ...
def phi_holds(predicate_json: str, phi_result_json: str) -> bool: ...
def keccak_hex(data: bytes) -> str: ...                       # for artifact hashes
class ReceiptBuilder:
    def __init__(self, header_json: str) -> None: ...         # raises ValueError on PhiHashMismatch etc.
    def add_step(self, step_type: str, input: bytes, output: bytes,
                 exit_status: int | None, cost_json: str) -> int: ...   # raises ValueError("phi_eval is reserved")
    def mark_evidence(self, seq: int) -> None: ...
    def seal_with_phi(self, phi_result_json: str, cost_json: str, signer_key_hex: str,
                      chain_id: int, registry: str) -> "SealedBundle": ...
class SealedBundle:
    bundle_json: str; task_id: str; agent_id: str; root: str; terminal_hash: str
    body_hash: str; cost_micros: int; signature: str
def verify(bundle_json: str, chain_id: int, registry: str, signer: str | None = None) -> str: ...  # Report JSON
```

- Produces (WASM, `wasm-pack build --target web`): `verify_bundle(bundle_json: string, chain_id: number, registry: string, signer?: string): string` returning Report JSON.

- [ ] **Step 1: Write the failing tests** `runtime/py/tests/test_binding.py`: `test_add_step_rejects_phi_eval`, `test_vectors_verify_as_expected` (loads `spec/vectors/*.json`, asserts `verify(..)` status equals `expect.status`), `test_task_id_matches_vector` (`task_id(plan_id("6f1c..."), 0, 1)` equals the value written to `spec/vectors/ids.json` by `gen_vectors`, which Step 2 adds), `test_seal_then_verify_is_unattested_valid`.
- [ ] **Step 2:** Add `ids.json` output (three `plan_uuid`/index/attempt cases with their ids) to `gen_vectors.rs` and regenerate.
- [ ] **Step 3:** Run `cd runtime/py && uv run --with maturin --with pytest maturin develop && uv run pytest`. Expected: FAIL.
- [ ] **Step 4:** Implement the binding as thin wrappers over `mergit_spec`, `mergit_receipt` and `mergit_verifier` (pyo3 0.23+, `abi3-py312`).
- [ ] **Step 5:** Run the Python tests. Expected: PASS.
- [ ] **Step 6:** Implement `verifier/wasm` with wasm-bindgen; test with `wasm-pack test --node verifier/wasm` asserting `valid_minimal` returns `unattested_valid` and `root_mismatch` returns `invalid`. Expected: PASS.
- [ ] **Step 7:** Publish the wheel for the orchestration team: `maturin build --release` in `runtime/py`; document in `runtime/py/README.md` that `control-plane` depends on it as a path dependency (`mergit-receipt = { path = "../runtime/py" }` in uv).
- [ ] **Step 8: Commit**

```bash
git add runtime/py verifier/wasm spec/vectors runtime/receipt/examples Cargo.lock
git commit -m "feat(receipt): Python binding and WASM verifier"
```

### Task Y4: Contracts — Identity and ReceiptRegistry

**Files (in `mergit-contracts`):**
- Create: `src/Identity.sol`, `src/ReceiptRegistry.sol`
- Test: `test/Identity.t.sol`, `test/ReceiptRegistry.t.sol`

**Interfaces:**

```solidity
// Identity is ERC721("Mergit Agent", "MAGENT"); the operator is the token owner.
function registerAgent(address runtimeKey, string calldata metadataURI) external returns (uint256 agentId);
function setRuntimeKey(uint256 agentId, address runtimeKey) external;          // owner only
function runtimeKeyOf(uint256 agentId) external view returns (address);
function operatorOf(uint256 agentId) external view returns (address);         // ownerOf
event AgentRegistered(uint256 indexed agentId, address indexed operator, address runtimeKey, string metadataURI);
event RuntimeKeyChanged(uint256 indexed agentId, address runtimeKey);

// ReceiptRegistry is EIP712("Mergit", "0"); typehash
// Receipt(bytes32 taskId,bytes32 root,bytes32 terminalHash,bytes32 bodyHash,uint256 costMicros)
struct Commitment { uint256 agentId; bytes32 root; bytes32 terminalHash; bytes32 bodyHash; uint256 costMicros; uint64 committedAt; }
function setEscrow(address escrow) external;                                   // admin, once
function commit(bytes32 taskId, uint256 agentId, bytes32 root, bytes32 terminalHash, bytes32 bodyHash, uint256 costMicros, bytes calldata signature) external;
function commitmentOf(bytes32 taskId) external view returns (Commitment memory);
event ReceiptCommitted(bytes32 indexed taskId, uint256 indexed agentId, bytes32 root, bytes32 terminalHash, bytes32 bodyHash, uint256 costMicros);
```

- [ ] **Step 1: Write the failing tests:** `test_registerAgentMintsToOperator`, `test_onlyOwnerSetsRuntimeKey`, `test_commitAcceptsSignatureFromRuntimeKey` (sign with `vm.sign` over the same typed hash the Rust `spec` computes; also assert the digest equals the value in `spec/vectors/valid_minimal.json` when the domain uses that vector's registry address, via `vm.etch` at `address(1)`), `test_commitRejectsWrongSigner`, `test_commitRejectsSecondCommitmentForTask`, `test_commitRejectsTaskNotLockedInEscrow`, `test_commitRejectsAgentMismatchWithEscrowTask`.
- [ ] **Step 2:** Run `forge test --match-contract 'Identity|ReceiptRegistry'`. Expected: FAIL.
- [ ] **Step 3:** Implement with OpenZeppelin `ERC721`, `EIP712`, `ECDSA`, `AccessControl`. ReceiptRegistry reads `IEscrow(escrow).taskOf(taskId)` for state `Locked` and the agent id.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** (in `mergit-contracts`)

```bash
git add src/Identity.sol src/ReceiptRegistry.sol test/Identity.t.sol test/ReceiptRegistry.t.sol
git commit -m "feat: Identity and ReceiptRegistry"
```

### Task Y5: Contracts — Escrow

**Files (in `mergit-contracts`):**
- Create: `src/Escrow.sol`
- Test: `test/Escrow.t.sol`, `test/mocks/MockUSDC.sol` (ERC20 with EIP-3009 `receiveWithAuthorization`, 6 decimals)

**Interfaces:**

```solidity
enum Tier { Staked, Onboarding }
enum TaskState { None, Locked, Released, Returned }
enum Verdict { None, Pass, Fail, Invalid }
// roles: GATEWAY_ROLE, VALIDATOR_ROLE, TREASURY_ROLE, CHALLENGE_ROLE
constructor(IERC20 usdc, IIdentity identity, uint64 window);
function setRegistry(address registry) external;                              // admin, once
function fundPlan(bytes32 planId, uint256 amount) external;                    // requester = msg.sender, Tier.Staked
function fundPlanFor(bytes32 planId, address requester, uint256 amount) external;   // TREASURY_ROLE, Tier.Onboarding
function fundPlanWithAuthorization(bytes32 planId, address requester, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external; // nonce must equal keccak256(abi.encode(planId, amount))
function lockTask(bytes32 taskId, bytes32 planId, uint256 agentId, uint256 amount, uint64 deadline) external;  // GATEWAY_ROLE
function recordVerdict(bytes32 taskId, Verdict verdict) external;             // VALIDATOR_ROLE, needs a commitment
function releaseExpired(bytes32 taskId) external;                             // anyone; Staked only
function returnExpired(bytes32 taskId) external;                              // anyone; no commitment and past deadline
function closePlan(bytes32 planId) external;                                   // requester or GATEWAY_ROLE
function planOf(bytes32 planId) external view returns (address requester, Tier tier, uint256 available, bool closed);
function taskOf(bytes32 taskId) external view returns (bytes32 planId, uint256 agentId, address payee, uint256 amount, uint64 deadline, TaskState state, Verdict verdict, uint64 settledAt);
event PlanFunded(bytes32 indexed planId, address indexed requester, address funder, uint256 amount, Tier tier);
event TaskLocked(bytes32 indexed taskId, bytes32 indexed planId, uint256 agentId, address payee, uint256 amount, uint64 deadline);
event VerdictRecorded(bytes32 indexed taskId, Verdict verdict);
event TaskReleased(bytes32 indexed taskId, address payee, uint256 amount);
event TaskReturned(bytes32 indexed taskId, uint256 amount, uint8 reason);   // 0 fail, 1 invalid, 2 deadline, 3 challenge
event PlanClosed(bytes32 indexed planId, uint256 refund, address to);
```

Rules: `Pass` releases at once and records `settledAt`; `Fail` and `Invalid` return `amount` to the plan's `available`; Onboarding plans refund to the treasury on close and their tasks can never `releaseExpired`; a plan cannot be funded by a different requester than its first funder; `lockTask` requires `available >= amount` and a payee of `identity.operatorOf(agentId)`.

- [ ] **Step 1: Write the failing tests:** `test_fundPlanPullsUsdcAndRecordsRequester`, `test_otherAddressCannotFundSomeoneElsesPlan`, `test_lockTaskOnlyGatewayAndWithinAvailable`, `test_passReleasesToOperatorAtOnce`, `test_failReturnsToPlanBalance`, `test_retryAfterFailLocksFromReturnedBalance`, `test_noReleaseTwice`, `test_releaseExpiredOnlyAfterWindowWithoutVerdict`, `test_onboardingTaskCannotReleaseWithoutVerdict`, `test_returnExpiredOnlyWithoutCommitmentAfterDeadline`, `test_closePlanRefundsRequesterOrTreasury`, `test_verdictNeedsCommitment`, `test_fundWithAuthorizationRejectsNonceNotBoundToPlan`, and a fuzz test `testFuzz_balanceConservation(uint96 a, uint96 b)` asserting `usdc.balanceOf(escrow) == sum(available) + sum(locked)` after random fund/lock/verdict sequences.
- [ ] **Step 2:** Run `forge test --match-contract Escrow`. Expected: FAIL.
- [ ] **Step 3:** Implement `Escrow.sol` with `SafeERC20`, `AccessControl`, `ReentrancyGuard`. Window is chain time (`block.timestamp`).
- [ ] **Step 4:** Run `forge test`. Expected: PASS, all contracts.
- [ ] **Step 5: Commit**

```bash
git add src/Escrow.sol test/Escrow.t.sol test/mocks/MockUSDC.sol
git commit -m "feat: Escrow with plan funding, per-task locks and verdict release"
```

### Task Y6: Deploy and seed on Base Sepolia

**Files (in `mergit-contracts`):**
- Create: `script/Deploy.s.sol`, `script/SeedAgents.s.sol`, `deployments/.gitkeep`, `.env.example`
- Create (in `mergit`): `deploy/agents.example.json`

**Interfaces:**
- Produces `deployments/base-sepolia.json`: `{ "chain_id": 84532, "deploy_block": n, "usdc", "identity", "escrow", "receipt_registry", "stake_vault": null, "challenge_manager": null, "reputation_anchor": null, "roles": { "gateway", "validator", "treasury", "adjudicator" } }`.
- Produces `deployments/agents.json`: `{ "agents": [ { "agent_id": "1", "name", "operator", "runtime_key", "metadata_uri" } ] }`. The orchestration team reads agent ids from here.

- [ ] **Step 1:** Write `Deploy.s.sol` reading `USDC`, `GATEWAY_ADDR`, `VALIDATOR_ADDR`, `TREASURY_ADDR`, `ADJUDICATOR_ADDR`, `WINDOW_SECONDS` (600) from env; deploys Identity, Escrow, ReceiptRegistry; wires `setRegistry` and `setEscrow`; grants roles; writes the JSON with `vm.writeJson`.
- [ ] **Step 2:** Write `SeedAgents.s.sol`: for each `OPERATOR_KEY_i` and `RUNTIME_ADDR_i` in env, the operator registers its agent; writes `agents.json`.
- [ ] **Step 3:** Dry run against Anvil: `anvil --fork-url $BASE_SEPOLIA_RPC` in one terminal; `forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast` then the seed script. Expected: both JSON files written, no revert.
- [ ] **Step 4:** Yash runs the real deployment with the deployer key from their own environment: `forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify`. Expected: three verified contracts on BaseScan. Then the seed script.
- [ ] **Step 5:** Fund operator, gateway, validator and treasury addresses from the Base Sepolia ETH faucet, and the treasury from Circle's USDC faucet. Record which faucets in `deploy/README.md`.
- [ ] **Step 6: Commit**

```bash
git add script deployments .env.example
git commit -m "chore: deploy scripts and Base Sepolia deployment"
```

### Task Y7: Receipt store

**Files:**
- Create: `evidence/store/Cargo.toml`, `evidence/store/src/main.rs`, `evidence/store/src/routes.rs`, `evidence/store/src/disk.rs`
- Test: `evidence/store/tests/api.rs`

**Interfaces:**
- `PUT /v0/bundles` (body: Bundle JSON) → `201 {"body_hash", "task_id"}`; `200` with the same body when the identical bundle already exists; `400` when `body_hash` or any blob digest does not match; `409` when the task already has a different bundle; `413` for a blob over 8 MiB or a body over 64 MiB.
- `GET /v0/bundles/{body_hash}` and `GET /v0/tasks/{task_id}/bundle` → Bundle JSON or `404`. GET responses allow any origin (CORS).
- Config env: `STORE_DATA_DIR`, `STORE_ADDR` (default `0.0.0.0:8081`).

- [ ] **Step 1: Write the failing tests** using `tower::ServiceExt::oneshot` against the router with a temp dir: `stores_and_serves_by_body_hash_and_task`, `same_bundle_twice_is_200`, `rejects_body_hash_mismatch`, `rejects_blob_digest_mismatch`, `rejects_blob_over_limit` (413), `conflicting_bundle_for_same_task_is_409`, `get_allows_any_origin`.
- [ ] **Step 2:** Run `cargo test -p mergit-store`. Expected: FAIL.
- [ ] **Step 3:** Implement with axum and `tower-http` (CORS, `RequestBodyLimitLayer` at 64 MiB). Write files atomically (temp file then rename) under `bundles/` and `by-task/`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add evidence/store Cargo.lock
git commit -m "feat(evidence): content-addressed receipt store"
```

### Task Y8: Chain client and chain gateway (events, commitments, payment path)

**Files:**
- Create: `chain/client/Cargo.toml`, `chain/client/src/lib.rs` (alloy `sol!` bindings from `chain/abi/*.json`, `Deployment` loaded from `deployments/base-sepolia.json`, `fn provider(rpc: &str, signer: PrivateKeySigner)`)
- Create: `chain/gateway/Cargo.toml`, `chain/gateway/src/main.rs`, `src/ingress.rs`, `src/watcher.rs`, `src/outbox.rs`, `src/payment.rs`, `src/db.rs`, `migrations/0001_init.sql`
- Test: `chain/gateway/tests/flow.rs`

**Interfaces:**
- Consumes: S3 events; Y5 Escrow and Y4 ReceiptRegistry functions; Y7 nothing.
- Produces: `POST /v0/events` (Python → gateway); outbound `POST {ORCHESTRATOR_URL}/v0/chain-events` and `POST {VALIDATOR_URL}/v0/audit {"task_id"}` on each `ReceiptCommitted`; `POST /v0/fund-with-authorization {plan_id, requester, amount_usdc_units, valid_after, valid_before, nonce, signature}` (Should) → `{tx}`.
- Tables: `processed_events(event_id uuid primary key, received_at)`, `outbox(id bigserial, target text, body jsonb, attempts int, next_at timestamptz, delivered_at timestamptz)`, `watcher_cursor(contract text primary key, block bigint)`.
- Env: `DATABASE_URL`, `RPC_URL`, `DEPLOYMENT_FILE`, `GATEWAY_KEY`, `ORCHESTRATOR_URL`, `VALIDATOR_URL`, `GATEWAY_ADDR`.

Handling: `task.dispatch_requested` → `escrow.lockTask` unless `taskOf(taskId).state != None` (then emit `task.escrowed` from the existing state); `receipt.sealed` → `registry.commit` unless already committed; `plan.closed` → `escrow.closePlan`; `plan.approved` with `funding = "credits"` → Y10. A keeper loop every 30 s calls `releaseExpired` for staked-tier tasks committed more than `window` ago without a verdict, `returnExpired` for locked tasks past their deadline without a commitment, and (after Y11) `finalize` for settled tasks past their window. The watcher polls logs every 2 s from the cursor, waits 2 confirmations, and maps `PlanFunded`, `TaskLocked`, `ReceiptCommitted`, `VerdictRecorded`, `TaskReleased`, `TaskReturned` to S3 events in the outbox.

- [ ] **Step 1: Write the failing tests** in `tests/flow.rs`, using `alloy::node_bindings::Anvil`, deploying the contracts with the Foundry artifacts, `sqlx::test` for a database, and `wiremock` as the orchestrator: `duplicate_dispatch_event_locks_once`, `sealed_receipt_is_committed_on_chain` (bundle from Y1's builder, signed by an Anvil key registered as the agent's runtime key), `watcher_emits_events_in_chain_order`, `outbox_retries_until_orchestrator_answers_200`, `rejects_event_failing_schema_with_400`, `keeper_releases_after_window_and_returns_after_deadline` (Anvil `evm_increaseTime`).
- [ ] **Step 2:** Run `cargo test -p mergit-gateway`. Expected: FAIL.
- [ ] **Step 3:** Implement `chain/client` and the gateway modules. Validate incoming events against `spec/schemas/event.json` with the `jsonschema` crate.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Implement `payment.rs` (Should): verifies the nonce equals `keccak256(abi.encode(planId, amount))`, then calls `fundPlanWithAuthorization`. Test `fund_with_authorization_rejects_unbound_nonce`.
- [ ] **Step 6: Commit**

```bash
git add chain Cargo.lock
git commit -m "feat(chain): chain client and gateway with outbox and watcher"
```

### Task Y9: Validator

**Files:**
- Create: `evidence/validator/Cargo.toml`, `src/main.rs`, `src/audit.rs`, `src/draw.rs`
- Test: `evidence/validator/tests/audit.rs`

**Interfaces:**
- Consumes: Y2 `verify`; Y8 `chain/client`; Y7 `GET /v0/tasks/{task_id}/bundle`.
- Produces: `POST /v0/audit {"task_id"}` → `202`; on-chain `escrow.recordVerdict`; `GET /v0/audits/{task_id}` → `{drawn, verdict, report}` for the UI.
- Env: `RPC_URL`, `DEPLOYMENT_FILE`, `VALIDATOR_KEY`, `STORE_URL`, `AUDIT_P` (default `1.0`).

Verdict mapping: `Report.status == Invalid` → `invalid`; else `phi_holds == Some(true)` → `pass`; else `fail`. Onboarding-tier tasks are always drawn. Each draw and each report is persisted to `audits.jsonl` under the data dir so the UI can show why.

- [ ] **Step 1: Write the failing tests** against Anvil plus a wiremock store: `honest_receipt_gets_pass`, `phi_false_gets_fail`, `forged_body_gets_invalid` (store serves a bundle forged with the fixture), `p_zero_draws_nothing_for_staked_but_audits_onboarding`, `catches_up_on_unverdicted_commitments_at_start`, `audit_request_is_idempotent`.
- [ ] **Step 2:** Run `cargo test -p mergit-validator`. Expected: FAIL.
- [ ] **Step 3:** Implement. On start, scan `ReceiptCommitted` logs since `deploy_block` whose `taskOf(..).verdict == None` and audit them.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add evidence/validator Cargo.lock
git commit -m "feat(evidence): validator with audit draw and verdicts"
```

### Task Y10: Free credits (tier service)

**Files:**
- Create: `chain/gateway/src/credits.rs`, `chain/gateway/migrations/0002_credits.sql`
- Test: `chain/gateway/tests/credits.rs`

**Interfaces:**
- `GET /v0/credits/{address}` → `{"granted_usdc_units", "spent_usdc_units", "remaining_usdc_units", "plans_today"}`.
- On `plan.approved` with `funding = "credits"`: grant `5000000` on an address's first request; deny with a `credits.denied` event when the plan exceeds `remaining`, exceeds `2000000`, or the address already funded `3` plans today; otherwise call `escrow.fundPlanFor` from the treasury key. On `PlanClosed` for an onboarding plan, add the refund back to `remaining`.
- Env: `TREASURY_KEY`, `FREE_CREDITS_USDC_UNITS`, `CREDIT_PLAN_CAP_USDC_UNITS`, `CREDIT_PLANS_PER_DAY`.

- [ ] **Step 1: Write the failing tests:** `grants_once_per_address`, `denies_over_remaining`, `denies_over_plan_cap`, `rate_limits_per_day`, `refund_on_close_restores_credits`, `credits_fund_plan_as_onboarding_tier` (on Anvil, `planOf(..).tier == Onboarding`).
- [ ] **Step 2:** Run `cargo test -p mergit-gateway credits`. Expected: FAIL.
- [ ] **Step 3:** Implement. The ledger update and the chain call are ordered so a failed transaction never leaves credits spent: reserve in a DB transaction, send, then commit or release the reservation.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add chain/gateway Cargo.lock
git commit -m "feat(chain): free credits for the onboarding tier"
```

### Task Y11 (Should): StakeVault, ChallengeManager, ReputationAnchor

**Files (in `mergit-contracts`):**
- Create: `src/StakeVault.sol`, `src/ChallengeManager.sol`, `src/ReputationAnchor.sol`; Modify: `src/Escrow.sol` (stake hooks), `script/Deploy.s.sol`
- Test: `test/StakeVault.t.sol`, `test/ChallengeManager.t.sol`, `test/ReputationAnchor.t.sol`
- Create (in `mergit`): `chain/gateway/src/bin/adjudicate.rs` (CLI `mergit-adjudicate resolve <challenge_id> --upheld|--rejected`); Modify: `evidence/validator/src/audit.rs` (record to the anchor), `chain/gateway/src/watcher.rs` (challenge events)

**Interfaces:**

```solidity
// StakeVault — roles ESCROW_ROLE, SLASHER_ROLE
function deposit(uint256 amount) external;  function withdraw(uint256 amount) external;   // free stake only
function freeOf(address operator) external view returns (uint256);
function encumber(address operator, bytes32 taskId, uint256 amount) external;          // ESCROW_ROLE; enforces maxOpenTasks = 5
function release(bytes32 taskId) external;                                             // ESCROW_ROLE
function slash(bytes32 taskId, address[] calldata to, uint256[] calldata amounts) external returns (uint256 slashed); // SLASHER_ROLE
// Escrow additions: lockTask encumbers amount × stakeRatioBps / 10000; Invalid slashes to the requester first;
function finalize(bytes32 taskId) external;    // anyone, after settledAt + window: releases stake
// ChallengeManager — ADJUDICATOR_ROLE
function open(bytes32 taskId) external returns (uint256 challengeId);  // bond = max(1e6, amount × 1000 / 10000), inside the window
function resolve(uint256 challengeId, bool upheld) external;
event ChallengeOpened(uint256 indexed challengeId, bytes32 indexed taskId, address challenger, uint256 bond);
event ChallengeResolved(uint256 indexed challengeId, bytes32 indexed taskId, bool upheld);
// ReputationAnchor — RECORDER_ROLE (validator, challenge manager)
function record(bytes32 taskId, uint256 agentId, bytes32 category, bool success, uint256 costMicros, uint8 tier, uint8 source) external; // source 0 audit, 1 ruling
event OutcomeRecorded(bytes32 indexed taskId, uint256 indexed agentId, bytes32 category, bool success, uint256 costMicros, uint8 tier, uint8 source);
```

Payout on an upheld challenge, in order (paper §10.3): requester made whole (an unreleased task returns through Escrow; a released one is paid from slashed stake), challenger gets the bond back plus `2000` bps of `V`, the remainder goes to the reserve address. Rejected: half the bond to the operator, half to the reserve.

- [ ] **Step 1: Write the failing tests:** `test_cannotWithdrawEncumberedStake`, `test_capOnOpenTasksPerOperator`, `test_invalidVerdictSlashesToRequesterFirst`, `test_upheldChallengePayoutOrder`, `test_rejectedChallengeSplitsBond`, `test_challengeOnlyInsideWindow`, `test_finalizeReleasesStakeAfterWindow`, `test_anchorRejectsNonRecorder`, `test_anchorRecordsTier`.
- [ ] **Step 2:** Run `forge test`. Expected: FAIL for the new tests.
- [ ] **Step 3:** Implement, redeploy (`Deploy.s.sol` now also deploys the three and fills their addresses), re-run `chain/abi/sync.sh`.
- [ ] **Step 4:** Run `forge test` and `cargo test --workspace`. Expected: PASS.
- [ ] **Step 5:** The validator records `success = (verdict == pass)` with the receipt's `costMicros` and the plan tier; `invalid` records a failure. The adjudicator CLI prints "Adjudicated by the platform (open decision D9)" before sending.
- [ ] **Step 6: Commit** (both repositories)

```bash
git add src test script && git commit -m "feat: StakeVault, ChallengeManager and ReputationAnchor"
cd ../mergit && git add chain evidence frontend/src/chain/abi.ts Cargo.lock && git commit -m "feat: challenge events, adjudication CLI and outcome anchoring"
```

### Task Y12: Web app — wallet sign-in, funding, credits, proofs

**Files (in `mergit/frontend`):**
- Create: `src/config/mode.ts`, `src/chain/config.ts`, `src/chain/useFundPlan.ts`, `src/chain/useCredits.ts`, `src/chain/proofs.ts`, `src/verifier/verify.ts` (loads the wasm-pack output from `src/verifier/pkg`)
- Modify: `src/auth/session.ts`, `src/auth/AuthProvider.tsx`, `src/auth/ConnectDialog.tsx`, `src/screens/Wallet.tsx`, `src/screens/proofs/ProofLedger.tsx`, `src/screens/ProofDetail.tsx`, `src/main.tsx` (WagmiProvider, QueryClientProvider), `package.json` (wagmi, viem, @tanstack/react-query)
- Test: `e2e/wallet.spec.ts`, `e2e/proofs.spec.ts`

**Interfaces:**
- `DATA_MODE: "mock" | "live"` from `VITE_DATA_MODE`; mock mode keeps every current screen unchanged.
- Env: `VITE_API_URL`, `VITE_GATEWAY_URL`, `VITE_STORE_URL`, `VITE_RPC_URL`, `VITE_WALLETCONNECT_PROJECT_ID` (optional), `VITE_E2E` (enables wagmi's `mock` connector).
- Sign-in calls the orchestration API: `GET /v0/auth/nonce → {nonce}`, `POST /v0/auth/verify {message, signature}` (sets cookie `mergit_session`), `GET /v0/auth/me → {address}`, `POST /v0/auth/logout`. The message is built with `viem/siwe` `createSiweMessage` for chain `84532`.
- Produces for O8: `useFundPlan(planId: Hex, amountUnits: bigint): { fund: () => Promise<Hash>; fundGasless: () => Promise<Hash>; status: "idle" | "approving" | "funding" | "confirmed" | "error"; error?: string }` and `useCredits(): { remaining: bigint; loading: boolean }`.

- [ ] **Step 1: Write the failing Playwright tests** (run with `VITE_DATA_MODE=live VITE_E2E=1` and request mocking via `page.route`): `signs in with a wallet and shows the address`, `signs out when the wallet account changes`, `blocks funding on the wrong chain` (expects the text "Switch to Base Sepolia"), `funds a plan with approve then fund`, `shows remaining free credits`, `proof detail shows unattested (development key) and the verifier result` (store mocked with `spec/vectors/valid_minimal.json`), `tampered proof shows invalid with reasons` (store mocked with `root_mismatch.json`), `mock mode still renders the current dashboard`.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: FAIL.
- [ ] **Step 3:** Build the WASM package: `wasm-pack build verifier/wasm --target web --out-dir ../../frontend/src/verifier/pkg`.
- [ ] **Step 4:** Implement the hooks and screens. The proofs list reads `ReceiptCommitted` logs from `deploy_block` with viem `getLogs`; the detail fetches the bundle from the store and verifies it in the browser with the registered runtime key as `signer`. The wallet screen shows ETH and USDC balances, remaining credits, and links to the Base Sepolia ETH faucet and Circle's USDC faucet.
- [ ] **Step 5:** Run `npm run typecheck && npm run lint && npm run test:e2e`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(web): wallet sign-in, plan funding, credits and in-browser receipt verification"
```

### Task Y13: Hosting

**Files:**
- Create: `deploy/docker/rust.Dockerfile` (multi-stage, `cargo-chef`, one image per binary selected by build arg `BIN`), `deploy/compose.yaml` (local full stack: postgres, store, gateway, validator, api, worker), `deploy/README.md`, `deploy/env/*.example`
- Modify: `render.yaml`

**Interfaces:**
- Render services: `mergit-web` (existing static site, unchanged, mock mode, `mergit.site`); `mergit-app` (static, `VITE_DATA_MODE=live`, `app.mergit.site`); `mergit-store` (Docker, persistent disk at `/data`); `mergit-gateway` (Docker); `mergit-validator` (Docker, persistent disk); `mergit-db` (Postgres). The API and workers are O10.
- Secrets per role as Render environment variables: `GATEWAY_KEY`, `VALIDATOR_KEY`, `TREASURY_KEY`. Agent runtime keys exist only on the worker VM.

- [ ] **Step 1:** Write the Dockerfile and `compose.yaml`; run `docker compose -f deploy/compose.yaml up --build` with `.env` pointing at Base Sepolia. Expected: every service healthy (`GET /healthz` 200 on store, gateway and validator; add those routes if missing).
- [ ] **Step 2:** Extend `render.yaml`; Yash applies the blueprint in the Render dashboard and sets the secrets.
- [ ] **Step 3:** Point `app.mergit.site` at `mergit-app` in the DNS manager.
- [ ] **Step 4:** Check from a browser: `app.mergit.site` loads, sign-in works, the wallet screen shows balances.
- [ ] **Step 5: Commit**

```bash
git add deploy render.yaml
git commit -m "chore(deploy): Docker images, local compose and Render services"
```

### Task Y14: End-to-end checks and the pre-event tag

**Files:**
- Create: `deploy/e2e/honest_run.md` (manual script with expected screens), `deploy/e2e/false_receipt.rs` as an example of `runtime/receipt` built with `forgery-fixture`
- Test: the two runs below, against the hosted stack

- [ ] **Step 1:** Honest run: sign in, use free credits, submit a goal against the demo repository, approve the plan with an agent, watch the run, see the receipt verify as "unattested (development key)", the verdict `pass`, and `TaskReleased` on BaseScan. Record the transaction hashes in `deploy/e2e/honest_run.md`.
- [ ] **Step 2:** False receipt: run `cargo run -p mergit-receipt --features forgery-fixture --example false_receipt -- --task <id>` against a locked task (it signs a `phi_result_contradicted` bundle with the agent's dev key, uploads it, sends `receipt.sealed`). Expected: verdict `invalid`, `TaskReturned` with reason `1`, and the proof page shows invalid with `PHI_RESULT_CONTRADICTED`.
- [ ] **Step 3:** If Y11 shipped: open a challenge on a released task from a second wallet, resolve it with `mergit-adjudicate`, and check the payout order on BaseScan.
- [ ] **Step 4:** Yash tags both repositories:

```bash
git tag -a pre-ethglobal -m "Mergit as it stood before ETHGlobal Mumbai" && git push origin main --tags
cd ../mergit-contracts && git tag -a pre-ethglobal -m "Mergit contracts before ETHGlobal Mumbai" && git push origin main --tags
```
