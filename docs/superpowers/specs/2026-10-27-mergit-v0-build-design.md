# Mergit v0 build: design

**Date:** 2026-10-27
**Deadline:** 2026-10-30
**Status:** Approved in conversation; implementation plan follows
**Upstream:** [HLD](../../HLD.md), [PRD](../../PRD.md), the paper (`mergit-research/paper/draft-v1.md`). Where this
document and the paper disagree, the paper wins and this document is the defect.

---

## 1. Intent

Build the first working Mergit, end to end, by 30 October 2026, as large as four people can make it in four days.
It is the founder's long-term project, not a throwaway demo. It is also the pre-existing base that the team extends
at ETHGlobal Mumbai (5 to 7 November 2026, Continuity Track). Planning for the event itself is deliberately
deferred to its first day.

**The one moment that must work:** a requester funds a task, an agent does the work, the receipt is verified,
and payment releases on chain. Every other feature ranks below that loop.

## 2. Goals, non-goals, anti-goals

**Goals, in priority order**

| Tier | What works |
| --- | --- |
| **Must** | Goal → plan → requester approves → agent runs in a sandbox → Rust-built receipt (hash chain, Merkle root, signed, marked unattested) → root committed on chain → validator checks the receipt and the `Φ` result → Escrow releases test USDC to the operator, all visible live in the web app |
| **Should** | Stake in StakeVault; a bonded challenge; adjudication by the platform (labelled D9); slash and refund in the paper's order; ReputationAnchor records audited outcomes; a browser verifier built from the same Rust code; gasless funding through a signed USDC authorization (x402-style) |
| **Must, deployment** | The whole system runs hosted on the internet by 30 October, on testnet money only (§6.11) |
| **Should, freemium** | Free credits for new requesters: the onboarding tier, funded by the platform (§6.10) |
| **Could** | Reputation posteriors (Beta × Gamma) and Thompson-sampling routing; the subsidy ledger; paid plans; an indexer service instead of direct chain reads |

**Non-goals for v0:** real money of any kind (testnet faucet funds only); subscriptions or card payments; real TEE attestation (receipts say "unattested", as HLD P0 requires); mainnet; any token;
permissionless validators; on-chain audit randomness; batching of commitments.

**Anti-goals, which make the build a failure even if it runs:**

- A number shown as measured that was not measured. Every UI figure is either live data or labelled.
- An unattested receipt displayed or verified as attested.
- An agent able to mark its own task done, or to write its own `Φ` result.
- Reputation updated by anything other than an audit or a ruled challenge (invariant 4).
- Two implementations of receipt hashing or signing. There is one, in Rust.
- One giant commit. History matters for the Continuity Track and for review.

## 3. Constraints

- Four days, four people: Yash, Abhinav, Soham, and Claude assisting Yash.
- The repository invariants in `mergit/CLAUDE.md` hold. The seven in particular are not negotiable.
- Testnet only. Base Sepolia with Circle's test USDC (my call; D1 stays open for production).
- Licences: code GPL-3.0 in `mergit`, contracts MIT in `mergit-contracts`, docs CC BY 4.0.
- Superseded v0.2 designs (Monad, AgentPassport, LangGraph checkpointing) must not come back.

## 4. Who builds what (decided)

| Owner | Scope | Language |
| --- | --- | --- |
| **Abhinav and Soham** | Orchestration and everything on the AI and agent side: planner (C27), orchestrator and task graph (C28), approvals, router in requester-picks mode (C7), agent workers in a sandbox, model gateway, tool broker with GitHub, task service, their API, SIWE check and live status; hosting of the Python API and the worker VM | Python |
| **Yash, with Claude** | Receipt core and verifier; validator; receipt store; chain gateway, payment path and tier service (free credits); contracts; wallet and chain screens of the web app; hosting of the Rust services, contracts and web app | Rust, Solidity, TypeScript |
| **Yash** | Reviews every orchestration change before it merges | |

## 5. Stack (decided where stated, otherwise my call)

| Part | Choice | Why |
| --- | --- | --- |
| Contracts | Solidity, Foundry, OpenZeppelin | Decided. Standard tooling, fast tests, fuzzing |
| Receipt core, verifier | Rust | Decided. Speed, memory safety, one implementation for three targets |
| Python access to the receipt core | PyO3 bindings built with maturin, imported as `mergit_receipt` | One implementation, so receipts cannot drift between languages |
| Browser verifier | The Rust verifier compiled to WebAssembly (wasm-bindgen) | A requester checks a receipt without trusting Mergit |
| Chain gateway, payment path, validator, receipt store | Rust: axum for HTTP, alloy for the chain, tokio | My call. Same language as the receipt core, which they all use |
| Orchestration | Python; FastAPI and the rest of the stack are Abhinav and Soham's choice | Decided |
| Web app | The existing React 19, Vite and TypeScript app, adding wagmi and viem | It exists. Its mock data is replaced screen by screen |
| Local run | Docker Compose for every service; contracts on Base Sepolia; Anvil for contract tests | My call |

## 6. Architecture of v0

```
                         React web app (wagmi, viem, WASM verifier)
                          │ REST + SSE                 │ wallet txs, chain reads
                          ▼                            ▼
  Python orchestration ──events──▶ Rust chain gateway ──txs──▶ Contracts (Base Sepolia)
  planner, graph, router ◀─events──  + payment path              Identity, StakeVault, Escrow,
  workers ──PyO3──▶ Rust receipt core                           ReceiptRegistry, ChallengeManager,
       │                                                         ReputationAnchor
       └── receipt body ──▶ Rust receipt store ◀── Rust validator ──verdict──▶ chain gateway
```

### 6.1 The four contracts between the teams (written on day one, before product code)

Both teams build against these. A change to any of them is a reviewed change to `spec/`.

1. **Receipt format** (`spec/receipt-v0.md` plus test vectors in `spec/vectors/`).
2. **Task event schema** (`spec/events-v0.md` plus JSON Schema files). The events that cross between Python and
   Rust, including the "plan funded" and "task escrowed" events Python waits on before dispatch.
3. **Predicate schema** (`spec/predicate-v0.md`). The planner drafts `Φ`, the harness runs it, the validator
   checks it, so all three sides need the same definition (see §6.2).
4. **Contract ABIs**, generated from `mergit-contracts`, never hand-copied (HLD Pr7).

### 6.2 Receipt format v0 (decided here)

- **Encoding:** canonical JSON (RFC 8785, JCS) for every hashed object, so any reader can reproduce a digest.
- **Hash:** keccak-256 throughout, so the chain can verify Merkle proofs later without a second hash function.
- **Header:** format version, task id, requester address, agent id, `Φ` as submitted plus its hash, budget,
  category, runtime image identifier, attestation object, start and end time.
- **Attestation object in v0:** `{"kind": "unattested", "dev_key": <address>}`. The verifier must return
  "unattested", never "attested", for it.
- **Step:** monotonic gapless `seq` from 1, `type` (`model_call`, `tool_call`, `command`, `artifact_write`,
  `phi_eval`), digest of inputs, digest of outputs, exit status where it applies, metered cost
  (model, input and output tokens, tool calls, wall-clock milliseconds, cost in micro-USD), timestamp.
- **Chain:** `h_0 = keccak(JCS(header))`; `h_i = keccak(h_{i-1} ‖ keccak(JCS(step_i)))`.
- **Merkle root:** over `keccak(JCS(step_i))` leaves, compatible with OpenZeppelin `MerkleProof`
  (sorted-pair hashing), so on-chain proof checks are possible later.
- **Evidence set:** the list of `seq` numbers that bear on `Φ`. Every `phi_eval` step is in it, together with
  the command it ran.
- **Meter:** totals reconcilable against the per-step costs.
- **Signature:** secp256k1 ECDSA by the runtime key (K1, a development key in v0) over an EIP-712 typed digest
  of (task id, root, terminal hash, meter total). EIP-712 lets ReceiptRegistry check the signer with
  `ecrecover`.
- **`Φ` in v0 (my call, HLD D3's proposed start):** an executable check: a command, the expected exit code,
  optional path constraints (files the agent may change) and optional expected artifact hashes. The planner
  drafts it, the requester approves it, its hash goes in the header.
- **Bodies:** the receipt store holds the full body, including each step's inputs and outputs (test output,
  diffs), content-addressed; steps carry digests of them. The validator can then check the evidence itself, not
  only hashes.
- **Where `Φ` is run:** the harness runs an executable `Φ` after the agent stops and records it as a
  `phi_eval` step. Agent code must not be able to append a `phi_eval` step. The Python binding enforces this:
  the agent-facing step API rejects the `phi_eval` type.

### 6.3 Receipt core API (Rust, exposed to Python)

`ReceiptBuilder(header)` → `add_step(step) → seq` (append only, rejects `phi_eval`) → `mark_evidence(seq)` →
`seal_with_phi(phi_result, signer) → SealedReceipt {body_bytes, root, terminal_hash, signature}`. Sealing appends
the `phi_eval` step as the last step and marks it as evidence, so it can only ever come from the harness. The verifier library exposes
`verify(receipt, commitment?) → {status: valid | invalid | unattested_valid, reasons[]}` and an evidence check
over a subset with Merkle paths. The exact names are for the builder; the append-only and harness-only rules
are not.

### 6.4 Contracts v0 (`mergit-contracts`)

| Contract | v0 behaviour | Tier |
| --- | --- | --- |
| **Identity** | Registers an agent: operator, runtime signing key, metadata URI. ERC-8004-compatible shape; if a usable ERC-8004 reference IdentityRegistry is deployed on Base Sepolia, integrate it instead of writing our own (builder checks) | Must |
| **Escrow** | The requester funds a **plan** once, up to the approved total budget (my call: one wallet signature per plan). At dispatch, each task's `V` is locked out of that balance for the routed agent, so payment is still escrowed per task before execution. Releases to the operator on `pass`, or after the window `W` when no audit was drawn. On `fail`, `invalid` or a missed deadline, `V` returns to the plan balance, so a retry on another agent draws from it again with no new signature. Unspent balance returns to the requester when the plan closes. Window measured in chain time | Must |
| **ReceiptRegistry** | Stores root, terminal hash and body hash per task. Rejects a commitment whose EIP-712 signature does not recover to the agent's registered key | Must |
| **StakeVault** | Operator deposits USDC stake. A task encumbers stake until its window ends. Per-operator cap on concurrent unresolved tasks | Should |
| **ChallengeManager** | Anyone posts a bond inside the window. The adjudicator role rules. Upheld: requester made whole, challenger rewarded, remainder to the reserve, stake slashed in that order (paper §10.3). Rejected: bond forfeit | Should |
| **ReputationAnchor** | Validator role records (agent, category, outcome, metered cost) for audited or ruled outcomes only | Should |

Roles: `VALIDATOR` and `ADJUDICATOR`, both held by platform keys in v0. The latter is labelled D9 everywhere it
shows. No upgradeable proxies: v0 redeploys (D12 stays open). Audit verdicts are recorded through
ChallengeManager or Escrow, whichever the contract design finds cleaner; the HLD left this to the P3 spec.

### 6.5 Verification and release in v0

- The validator (Rust) runs the verifier on the receipt, checks the commitment on chain, reads the evidence set
  and the `phi_eval` result, and posts a signed verdict through the chain gateway.
- **Audit probability `p` is a configuration value, default 1.0 on testnet.** That is honest for a demo with no
  calibrated stake. It is not the paper's mechanism, which derives `p` per agent (§7.2), and the UI says so.
- **The verdict has three values (paper §4.2, §7.2, §8):** `pass` (release; outcome recorded as a success);
  `fail` (the receipt is genuine but `Φ` did not hold: refund, no slash, outcome recorded as a failure);
  `invalid` (the receipt is false: refund and slash). `invalid` covers a body that does not match the committed
  root, a broken chain or gap, a missing `phi_eval` step, a `phi_eval` that ran something other than the approved
  `Φ`, and a recorded result that the evidence contradicts.
- The orchestrator moves the task graph on the `phi_eval` result (HLD §7.7). Only the verdict moves money or
  reputation.
- **Testing a false receipt:** the guard tests build forged receipts through a test-only Rust fixture that is not
  compiled into the Python binding or any service, so no bypass of the harness-only rule ships.
- `W` is configurable and short on testnet (minutes), so expiry is visible in a demo.

### 6.6 Payment path

- **Must:** the requester connects a wallet in the web app, approves USDC and funds the plan in Escrow directly.
- **Should:** gasless funding. The requester signs a USDC `transferWithAuthorization` (EIP-3009, the mechanism
  the x402 "exact" scheme uses on EVM), and the Rust payment path submits it to Escrow. Requesters then need no
  ETH for gas. The relayer key pays gas (K5) and holds no authority over funds.
- **All money is testnet money.** Requesters and operators get Base Sepolia ETH and test USDC from public
  faucets; the web app links to them from the wallet screen. Nothing in v0 touches real funds.

### 6.7 Agents, operators and keys (my call)

- **An agent in v0 is a platform-written worker configuration** (model, prompt, tool set), built by Abhinav and
  Soham. Operator-supplied agent code is out of scope; it needs the agent in its own process or container,
  separate from the receipt builder, and is P1 work.
- **Each agent has its own development signing key**, held by the runtime from a key file per agent and
  registered in Identity, so ReceiptRegistry can tell agents apart.
- **Each agent has an operator wallet** that receives payouts and posts stake. For v0, a seed script registers
  the agents, funds the operator wallets with test USDC and stakes them. A register-and-stake screen is
  Should tier.
- The LLM loop runs in the harness process, which owns the receipt builder. **Everything the model causes to
  execute (commands, file writes, tests) runs inside the sandbox container**, which cannot reach the builder, the
  keys or the network except through the tool broker. The `phi_eval` step is appended only by sealing, after the
  agent has stopped (§6.3).

### 6.8 Sign-in (my call)

- **The requester signs in with their wallet (Sign-In with Ethereum, EIP-4361).** The Python API verifies the
  SIWE message and issues a session, so the wallet that approves a plan is the wallet that funds it, and nobody can
  approve another requester's plan. Yash owns the wallet side in the web app; Abhinav and Soham own the API check.
- GitHub, Google and email sign-in stay as screens in mock mode only. In live mode the wallet is the only way in.

### 6.9 What the web app shows

The existing screens move from mock data to live data. Abhinav and Soham wire the run, new-run and approval
screens to their API. Yash wires wallet, proofs and ledger screens to the chain and the verifier. The app gets a build-time switch
between mock data and live data, so the public site can stay on mock data until the backend is hosted. Every receipt
view shows "unattested (development key)" until P1. Every number is live or labelled as an example.

### 6.10 Freemium: free credits (decided: freemium, not subscriptions)

- A new requester who signs in gets a platform-funded credit allowance. This is the paper's onboarding tier
  (§4.5, §10.5), not a new mechanism.
- **Credits go through the same Escrow.** The platform's treasury wallet funds the plan on the requester's
  behalf, and the tier service (C6, Rust, owned by Yash) keeps the credit ledger, rate limits and value caps.
  One payment path, so no second settlement logic.
- **Credit-funded tasks are audited at `p = 1` and accrue no transferable reputation** (invariant 6).
  ReputationAnchor records the tier with every outcome, and nothing that reads reputation may count onboarding
  outcomes toward routing in the staked tier.
- When credits run out, the requester connects a wallet and funds plans with faucet test USDC.

### 6.11 Hosting (decided: hosted by 30 October; providers are my call)

- **Web app:** Render static site, as today (`render.yaml`), switched to live data once the backend is up.
- **APIs and services:** Python orchestration API, Rust chain gateway with payment path and tier service, Rust
  validator, Rust receipt store, and Postgres, as Render services.
- **Agent workers need a host that can run sandbox containers,** which a Render web service cannot. Workers run on
  one Linux VM with Docker (provider is the team's choice and budget) and pull work from the orchestrator.
- **Keys:** development signing keys, the validator key, the adjudicator key, the relayer key and the treasury
  key live as host secrets, one per role, never in the repository. All are testnet keys, and that is stated
  in the UI.
- **Receipt bodies** are served publicly by the receipt store's HTTP API so the browser verifier can fetch them.
  Access tiers (HLD §6.3) beyond public settlement data are Should tier.

## 7. Repository layout (decided by HLD §12.1)

```
mergit/
  spec/            receipt-v0, events-v0, test vectors           (Yash, reviewed by all)
  runtime/         Rust receipt core + PyO3 bindings             (Yash)
  verifier/        Rust verifier lib, CLI, WASM build; imports spec/, never runtime/   (Yash)
  control-plane/   Python orchestration                          (Abhinav, Soham)
  evidence/        Rust validator and receipt store              (Yash)
  chain/           Rust chain gateway and payment path; ABIs generated from mergit-contracts (Yash)
  frontend/        existing React app                            (both, per screen)
  deploy/          Docker Compose, env templates
mergit-contracts/  Solidity, Foundry                             (Yash)
```

The format types and hashing live in a crate under `spec/` that both `runtime/` and `verifier/` depend on, so
the verifier never imports the runtime. The `mergit-contracts` README, which still describes the Monad design,
is replaced.

## 8. Testing (decided by the repository rule)

A test that asserts a guard fires is worth more than one that asserts the happy path works.

- **Receipt:** omitted step detected; reordered steps detected; edited step changes the root; agent-written
  `phi_eval` rejected; unattested receipt never reported as attested; test vectors pass in Rust, Python and WASM.
- **Contracts (Foundry, with fuzzing):** no release before its conditions; no release twice; wrong signer
  rejected; encumbered stake cannot be withdrawn; challenge payout order; concurrency cap holds.
- **End to end:** one scripted run of the must-tier loop against Base Sepolia, and one deliberately false
  receipt that the validator fails and Escrow refunds.

## 9. Ways of working

- **Day one starts with `spec/`:** receipt format, events, contract interfaces. Nobody writes product code
  against an unwritten contract.
- Small, frequent commits by every person. No squash merges of a whole feature.
- Yash reviews orchestration changes; Claude may draft reviews but Yash approves.
- Yash runs every git write command; agents print the commands, never run them.
- On 30 October the repository is tagged (for example `pre-ethglobal`) so pre-existing work is provable.

## 10. Left to the builder

- Internal module structure of each crate and of the Python services.
- The Python web framework, database and queue (Abhinav and Soham).
- How task events are transported (HTTP webhooks with idempotency keys is the default; a queue is acceptable)
  as long as the schema in `spec/events-v0.md` is the contract.
- Receipt store backend: content-addressed files on disk behind an HTTP API is enough for v0 (D5 stays open).
- Which model provider the agents use, through the model gateway.

## 11. Open decisions this build does not close

D1 (which L2 for production), D2 (which TEE), D9 (who adjudicates; the platform does in v0, labelled), D12
(upgradeability), D18 (the planner's own LLM), D19 (pre-P3 history and posteriors). The build must not quietly
decide any of them.
