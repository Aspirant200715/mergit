# Mergit v0: Overview, Schedule and Shared Spec — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four cross-team contracts (receipt format, predicate, events, ABIs) on day one, then run two tracks in parallel so the must-tier loop works hosted on 30 October 2026.

**Architecture:** Python orchestration (Abhinav, Soham) calls a Rust receipt core through PyO3 and talks to Rust web3 services (Yash) over HTTP events; Rust services drive six Solidity contracts on Base Sepolia; the React app reads chain state with viem and verifies receipts with the Rust verifier compiled to WebAssembly.

**Tech Stack:** Rust 1.98 (axum, tokio, alloy, pyo3, maturin, wasm-bindgen, serde_jcs), Solidity with Foundry 1.7 and OpenZeppelin, Python 3.12+ with uv, React 19 + Vite + wagmi + viem, Postgres, Docker, Render.

**Spec:** [`docs/superpowers/specs/2026-10-27-mergit-v0-build-design.md`](../specs/2026-10-27-mergit-v0-build-design.md)

**Track plans:**
- [`01-yash-track`](2026-10-27-mergit-v0-01-yash-track.md): receipt core, verifier, store, validator, contracts, gateway, payment, credits, wallet screens, hosting.
- [`02-orchestration-track`](2026-10-27-mergit-v0-02-orchestration-track.md): Abhinav and Soham.

## Global Constraints

- Chain: Base Sepolia, chain id `84532`. Test USDC: Circle's Base Sepolia USDC, 6 decimals (verify the address on Circle's docs before deploying; at the time of writing it is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- All amounts cross every boundary as integer strings of USDC base units (`"2000000"` = 2 USDC). Never floats.
- All hashes are keccak-256, written as `0x`-prefixed lowercase hex, 32 bytes.
- Every hashed object is canonical JSON per RFC 8785 (JCS). Rust uses `serde_jcs`; nobody re-implements canonicalisation.
- There is exactly one implementation of receipt hashing, Merkle, signing and verification: the Rust crates. Python and the browser call it.
- Every receipt in v0 carries `"attestation": {"kind": "unattested", ...}` and is shown and verified as unattested.
- No number is shown as measured unless it is live data; examples are labelled as examples.
- Only an audit verdict or a challenge ruling moves money or reputation. An agent never writes its own `phi_eval` step.
- Agents never run git write commands; each step's commit command is run by the person who owns the task.
- Commit small and often. No squash of a whole feature. Commit messages: `type(scope): summary`.
- Secrets (all private keys, API keys) live in environment variables or host secrets, never in the repository.

## Review Focus

1. **Retrying a failed task on another agent:** the retry gets a new task id (`attempt + 1`), and the first attempt's `V` is back in the plan balance before the second lock. Tests: Yash Task Y5 `test_retryAfterFailLocksFromReturnedBalance`, orchestration Task O6 `test_retry_uses_new_task_id_and_new_agent`.
2. **A webhook delivered twice:** every event endpoint is idempotent on `event_id`, so a retried `task.dispatch_requested` never locks escrow twice. Tests: Y8 `duplicate_dispatch_event_locks_once`, O4 `test_duplicate_chain_event_is_ignored`.
3. **The validator is down when a window expires:** a credit-funded task can never release without a verdict, and the validator catches up on start. Tests: Y5 `test_onboardingTaskCannotReleaseWithoutVerdict`, Y9 `catches_up_on_unverdicted_commitments_at_start`.
4. **A huge tool output:** the harness caps each captured output at 1 MiB with an explicit truncation marker inside the bytes that are hashed, and the store rejects any blob over 8 MiB with HTTP 413. Tests: Y7 `rejects_blob_over_limit`, O5 `test_tool_output_truncated_with_marker`.
5. **The requester switches wallet or chain mid-session:** the app signs out on account change and refuses to fund on any chain but `84532`, with a message that says which chain to switch to. Test: Y12 `signs out when the wallet account changes` and `blocks funding on the wrong chain`.

---

## Schedule

Times are targets, not commitments. Each day ends with an integration check against the previous day's work.

| Day | Yash, with Claude | Abhinav and Soham | Integration check at day end |
| --- | --- | --- | --- |
| **Mon 27** | S1–S4 with everyone (morning). Y1 receipt core, Y2 test vectors, Y4 contracts Identity, ReceiptRegistry, Escrow | S1–S4 (morning). O1 skeleton and SIWE, O2 planner, O3 approval and plan store | Vectors pass in Rust; `forge test` green; planner returns a schema-valid plan |
| **Tue 28** | Y3 Python binding and WASM, Y6 deploy and seed to Base Sepolia, Y7 receipt store, Y8 chain gateway | O4 events and dispatch, O5 worker harness and sandbox | A worker seals a real receipt with the binding, uploads it to the store, and the gateway commits it on testnet |
| **Wed 29** | Y9 validator, Y10 credits, Y11 StakeVault and ChallengeManager (Should), Y12 web app wallet and proofs | O6 verdict handling and retries, O7 API and live stream, O8 run screens in the web app | **Must-tier loop end to end on testnet, locally** |
| **Thu 30** | Y13 hosting, Y14 end-to-end scripts (honest run and false receipt) | O9 PR gate, O10 hosting of API and worker VM | Must-tier loop hosted; tag `pre-ethglobal` |

**Could tier** (posteriors, Thompson routing, subsidy ledger, paid plans, an indexer) has no tasks here on purpose. Pick from it only after Thursday's hosted check passes.

**Cut order if a day slips:** drop Could tier first, then Y11 (stake and challenge), then gasless funding in Y8, then the indexer-free proofs list detail in Y12. Never cut S1–S4, Y1–Y9, Y12's funding flow, O1–O7 or hosting.

---

## Shared Spec Tasks (all four, Monday morning)

Each spec document is short and normative. The JSON Schemas are the machine-checkable part. These tasks finish before anybody writes product code.

### Task S1: Repository skeleton and the `spec/` folder

**Files:**
- Create: `Cargo.toml` (workspace root), `rust-toolchain.toml`, `.gitignore` additions, `spec/README.md`
- Create: `control-plane/pyproject.toml` (empty uv project, owned by Abhinav and Soham afterwards)
- Modify: `README.md` (add a "Repository layout" section mirroring design §7)

**Interfaces:**
- Produces: workspace members `spec`, `runtime/receipt`, `runtime/py`, `verifier`, `verifier/wasm`, `evidence/store`, `evidence/validator`, `chain/client`, `chain/gateway`. Members may be empty crates today; later tasks fill them.

- [ ] **Step 1:** Create the workspace `Cargo.toml` listing the nine members above, `resolver = "3"`, `edition = "2024"` in `[workspace.package]`, licence `GPL-3.0-only`. Pin `rust-toolchain.toml` to `1.98`.
- [ ] **Step 2:** Create each member as a minimal crate (`cargo new --lib` or `--bin` as named in the track plan).
- [ ] **Step 3:** Run `cargo build --workspace`. Expected: builds with no errors.
- [ ] **Step 4:** Add `target/`, `**/__pycache__/`, `.venv/`, `*.sqlite`, `*.db`, `.env`, `deploy/secrets/` to `.gitignore`.
- [ ] **Step 5: Commit** (Yash runs)

```bash
git add Cargo.toml rust-toolchain.toml .gitignore spec/README.md control-plane/pyproject.toml README.md runtime verifier evidence chain
git commit -m "chore: add workspace skeleton for the v0 build"
```

### Task S2: Receipt format and predicate (`spec/receipt-v0.md`, `spec/predicate-v0.md`)

**Files:**
- Create: `spec/receipt-v0.md`, `spec/predicate-v0.md`
- Create: `spec/schemas/predicate.json`, `spec/schemas/header.json`, `spec/schemas/step.json`, `spec/schemas/phi-result.json`, `spec/schemas/sealed-receipt.json`, `spec/schemas/bundle.json` (JSON Schema 2020-12)
- Create: `spec/examples/` with one valid instance per schema
- Test: `spec/check.sh`

**Interfaces (normative; every later task uses these names):**

```text
Predicate  { kind: "exec/0", command: [string, ...] (argv, no shell), expected_exit: int,
             workdir: string (repo-relative), allowed_paths: [glob] | null,
             artifact_hashes: {path: hash} | null, timeout_s: int (1..3600) }
phi_hash   = keccak(JCS(Predicate))

Header     { version: "mergit-receipt/0", task_id: hash, plan_id: hash, requester: address,
             agent_id: decimal string, category: string, phi: Predicate, phi_hash: hash,
             budget_usdc_units: decimal string, runtime_image: string,
             attestation: {kind: "unattested", dev_key: address}, started_at: RFC 3339 UTC }

Step       { seq: int >= 1, type: "model_call"|"tool_call"|"command"|"artifact_write"|"phi_eval",
             input_digest: hash, output_digest: hash, exit_status: int | null,
             cost: {model: string|null, input_tokens: int, output_tokens: int, tool_calls: int,
                    wall_ms: int, usd_micros: int}, at: RFC 3339 UTC }
input_digest / output_digest = keccak(raw bytes); the raw bytes travel as blobs.

PhiResult  { exit_code: int, changed_paths: [string], observed_artifact_hashes: {path: hash},
             stdout_digest: hash, holds: bool }        -- the phi_eval step's output bytes = JCS(PhiResult)
                                                          its input bytes = JCS(Predicate)
holds      = exit_code == phi.expected_exit
             AND every changed path matches some allowed_paths glob (or allowed_paths is null)
             AND every artifact_hashes entry equals observed_artifact_hashes[path] (or artifact_hashes is null)

leaf_i     = keccak(JCS(Step_i))
h_0        = keccak(JCS(Header));   h_i = keccak(h_{i-1} || leaf_i)   (64 bytes in, 32 out)
root       = Merkle over leaves: pairwise keccak(min(a,b) || max(a,b)); an odd last node moves up unchanged;
             one leaf => root = leaf. Compatible with OpenZeppelin MerkleProof.verify.

SealedReceipt { header, steps: [Step], evidence: [seq], meter: {totals as in cost, summed},
                ended_at, root, terminal_hash (= h_n), body_hash, signature }
body_hash  = keccak(JCS(SealedReceipt without body_hash and signature))
signature  = EIP-712, 65 bytes hex, by the runtime key over
             Receipt(bytes32 taskId, bytes32 root, bytes32 terminalHash, bytes32 bodyHash, uint256 costMicros)
             domain {name: "Mergit", version: "0", chainId, verifyingContract: ReceiptRegistry}
             costMicros = meter.usd_micros

Bundle     { receipt: SealedReceipt, blobs: {hash: base64 bytes} }   -- what the store accepts and serves

Rules      exactly one phi_eval step; it is the last step; it is in evidence; seq is 1..n gapless;
           every digest named by an evidence step has its blob in the bundle.
```

- [ ] **Step 1:** Write `spec/receipt-v0.md` and `spec/predicate-v0.md` stating the block above in prose, plus the verification reason codes: `SEQ_GAP`, `SEQ_ORDER`, `CHAIN_MISMATCH`, `ROOT_MISMATCH`, `BODY_HASH_MISMATCH`, `BAD_SIGNATURE`, `PHI_HASH_MISMATCH`, `NO_PHI_EVAL`, `PHI_EVAL_NOT_LAST`, `PHI_EVAL_NOT_EVIDENCE`, `METER_MISMATCH`, `BLOB_MISSING`, `BLOB_DIGEST_MISMATCH`, `PHI_RESULT_CONTRADICTED`, `COMMITMENT_MISMATCH`, `UNATTESTED`.
- [ ] **Step 2:** Write the six JSON Schemas and one example each in `spec/examples/`.
- [ ] **Step 3:** Write `spec/check.sh`: `uvx check-jsonschema --schemafile spec/schemas/$n.json spec/examples/$n.json` for each name, and one deliberately invalid example per schema in `spec/examples/invalid/` that must fail.
- [ ] **Step 4:** Run `bash spec/check.sh`. Expected: every valid example passes, every invalid one fails, exit 0.
- [ ] **Step 5:** All four people read both documents and agree. Changes after today go through review.
- [ ] **Step 6: Commit** (Yash runs)

```bash
git add spec/
git commit -m "spec: receipt format and predicate v0 with schemas"
```

### Task S3: Event schema (`spec/events-v0.md`)

**Files:**
- Create: `spec/events-v0.md`, `spec/schemas/event.json` (envelope plus one `$defs` entry per type), examples in `spec/examples/events/`
- Modify: `spec/check.sh` (validate event examples)

**Interfaces (normative):**

```text
Envelope   { event_id: uuid v4, type: string, at: RFC 3339 UTC, payload: object }
Transport  HTTP POST, JSON body = envelope, header Idempotency-Key = event_id.
           Receiver answers 200 for new and already-seen events alike, 4xx for schema errors. Sender retries
           5xx and timeouts with backoff for 10 minutes.
Ids        plan_id = keccak(utf8(plan_uuid));  task_id = keccak(abi.encodePacked(plan_id, uint32 index, uint32 attempt))
           index starts at 0, attempt starts at 1; a retry increments attempt

Python -> gateway   POST {GATEWAY_URL}/v0/events
  plan.approved         {plan_id, plan_uuid, requester, total_budget_usdc_units, funding: "wallet"|"credits"}
  task.dispatch_requested {task_id, plan_id, index, attempt, agent_id, amount_usdc_units, category, phi_hash,
                         deadline_unix}
  receipt.sealed        {task_id, agent_id, root, terminal_hash, body_hash, cost_micros, signature}
  plan.closed           {plan_id}

Gateway -> Python   POST {ORCHESTRATOR_URL}/v0/chain-events
  plan.funded           {plan_id, requester, amount_usdc_units, tier: "staked"|"onboarding", tx}
  task.escrowed         {task_id, tx}
  receipt.committed     {task_id, tx}
  verdict.recorded      {task_id, verdict: "pass"|"fail"|"invalid", tx}
  task.released         {task_id, to, amount_usdc_units, tx}
  task.returned         {task_id, amount_usdc_units, reason: "fail"|"invalid"|"deadline"|"challenge", tx}
  challenge.opened      {task_id, challenge_id, challenger, bond_usdc_units, tx}       (Should)
  challenge.resolved    {task_id, challenge_id, upheld: bool, tx}                      (Should)
  credits.denied        {plan_id, reason: "no_credits"|"rate_limited"|"over_value_cap"}
  error                 {ref_event_id, code, message}
```

- [ ] **Step 1:** Write `spec/events-v0.md` with the block above, the sequence for one must-tier task (approved → funded → dispatch → escrowed → sealed → committed → verdict → released/returned), and the rule that the receipt body is uploaded to the store before `receipt.sealed` is sent.
- [ ] **Step 2:** Write `spec/schemas/event.json` and one example per type; extend `spec/check.sh`.
- [ ] **Step 3:** Run `bash spec/check.sh`. Expected: exit 0.
- [ ] **Step 4: Commit** (Yash runs)

```bash
git add spec/
git commit -m "spec: event schema v0 between orchestration and web3 services"
```

### Task S4: Contract interfaces and the ABI pipeline

**Files:**
- Create (in `mergit-contracts`): `src/interfaces/IIdentity.sol`, `IEscrow.sol`, `IReceiptRegistry.sol`, `IStakeVault.sol`, `IChallengeManager.sol`, `IReputationAnchor.sol`
- Create (in `mergit`): `chain/abi/sync.sh`, `chain/abi/README.md`

**Interfaces:** exactly the external functions and events listed in Yash track Tasks Y4, Y5 and Y11. Interfaces only, no bodies.

- [ ] **Step 1:** Yash clones the contracts repository next to `mergit` (`git clone https://github.com/mergit-io/mergit-contracts`), then runs `forge init --force` and `forge install OpenZeppelin/openzeppelin-contracts`. Yash runs these, because `forge install` writes a git submodule.
- [ ] **Step 2:** Write the six interface files from the signatures in Y4, Y5 and Y11.
- [ ] **Step 3:** Write `chain/abi/sync.sh`: runs `forge build` in `../mergit-contracts`, copies `out/<Name>.sol/<Name>.json` `.abi` fields to `chain/abi/<Name>.json`, and writes `frontend/src/chain/abi.ts` exporting each ABI `as const`.
- [ ] **Step 4:** Run `bash chain/abi/sync.sh`. Expected: six JSON files and `abi.ts` written; `cd frontend && npm run typecheck` passes.
- [ ] **Step 5:** Replace the `mergit-contracts` README (it still describes Monad) with the six-contract description from the HLD.
- [ ] **Step 6: Commit** (Yash runs, in each repository)

```bash
cd ../mergit-contracts && git add foundry.toml .gitmodules lib src/interfaces README.md && git commit -m "feat: contract interfaces for v0; replace superseded README"
cd ../mergit && git add chain/abi frontend/src/chain/abi.ts && git commit -m "chore(chain): ABI sync pipeline"
```
