# CLAUDE.md

Guidance for AI coding agents working in this repository.

## What this repository is

The Mergit monorepo — the runtime, and the product documentation under `docs/`. Mergit is a trust
and settlement layer for autonomous agent work: identity, verification, settlement and routing are
properties of the runtime rather than services layered above it.

**The design is upstream.** The source of truth is
[`mergit-research`](https://github.com/mergit-io/mergit-research):

- `paper/draft-v1.md` — the full treatment
- `paper/whitepaper.md` — the condensed argument
- `docs/superpowers/specs/2026-10-09-mergit-research-paper-design.md` — 17 locked decisions

Then [`docs/PRD.md`](docs/PRD.md) for requirements. **Where code, PRD and paper disagree, the paper
wins.** Do not resolve a conflict by editing the paper from here — raise it on `mergit-research`.

## The system

| Component | |
|---|---|
| **Verifiable Execution Receipts** | Hash-chained, sequence-numbered steps signed in a TEE and bound to a measured runtime image. Merkle root on chain, body off chain. The commitment covers the **complete** trajectory; disclosure is tiered — totals at settlement, evidence subset at audit, full trajectory under bonded challenge |
| **Verification economics** | Stake, per-agent audit rates from a posterior over capability, permissionless bonded challenge, per-operator concurrency cap |
| **Cost-adjusted reputation** | `D = E[verified success] / E[metered cost]`, Beta × Gamma posteriors, geometric decay `γ = 0.95`, per task category |
| **Routing** | Thompson sampling over value density under budget; the platform absorbs validated failures on exploratory draws |
| **Settlement** | Escrow before execution, release on passing audit or window expiry, refund + challenger reward + slash on successful challenge |

**Chain:** Ethereum L2, EVM-compatible, ERC-8004-compatible identity. Specific L2 not yet chosen.
**Runtime trust anchor:** TEE attestation (SGX/TDX, SEV, Nitro class).

## Invariants — do not break these

These are not style preferences. Each one is load-bearing for a claim in the paper:

1. **A receipt commits to the complete trajectory.** Committing only to what gets disclosed would
   let an operator suppress inconvenient steps. Disclosure is selective; commitment is not.
2. **Steps are append-only.** Nothing edits or reorders a step after emission. The hash chain is
   what makes omission detectable.
3. **Metering happens inside the attested runtime.** A self-reported cost is worthless — cost is a
   trust signal here, so it is the cheapest thing in the system to falsify if it leaves the enclave.
4. **Only validated outcomes update reputation.** A completed-but-unaudited task is not evidence.
5. **Audit cost scales with evidence volume, not trajectory length.** A change that makes a routine
   audit read the whole trajectory breaks the §5.3 cost bound.
6. **Faucet-tier work accrues no transferable reputation.** Free credits mean zero effective stake;
   letting that history influence routing is a Sybil hole, not a growth feature.
7. **No credential reachable from a model-populated tool argument.** Secrets resolve through the
   broker, never through anything a prompt can reach.

## Writing about the system

- **No number may be presented as measured** until it has been. Every figure in the docs today is
  arithmetic on the model.
- **Do not soften the limitations.** PRD §13 and paper §13 exist because over-claiming is the
  specific failure this project is about.
- A test that asserts a guard fires is worth more than one that asserts the happy path works.

## Superseded — do not reintroduce

v0.2 (June 2026) specified a different system. If you find any of this, it is stale:

| Stale | Current |
|---|---|
| Monad (chain ID 10143) | Ethereum L2, EVM-compatible |
| Rust service mesh — `api-gateway`, `identity`, `blockchain-indexer`, `reputation` | Technology not fixed; belongs to the first implementation spec |
| LangGraph orchestration, `AsyncPostgresSaver` | Not specified at this level |
| `AgentPassport.sol`, `ProofOfWork.sol`, `ReputationRegistry.sol`, `AuditTrail.sol` | Identity (ERC-8004-compatible), ReceiptRegistry, StakeVault, Escrow, ChallengeManager, ReputationAnchor |
| Proof-of-work minting as the trust mechanism | Receipt audit — commitments on chain, evidence off chain |
| Reputation as a composite quality score + badges | Value density: verified quality per unit cost |

Everything in [`docs/legacy/`](docs/legacy/) is from that era. Read it as evidence, never as
instruction, and do not open pull requests updating it.

## Conventions

- **One concern per PR.** Use the org template and fill in "What I verified / Not verified" honestly.
- **Claim an issue before working on it** — see
  [CONTRIBUTING.md](https://github.com/mergit-io/.github/blob/main/CONTRIBUTING.md#before-you-start-work).
- Cross-references to the paper cite section numbers (`§7`), not line numbers.
- **Licensing:** code GPL-3.0, `docs/` CC BY 4.0, contracts MIT in `mergit-contracts`.
- **Never commit secrets, and never commit a database file.** A sqlite file created by a tool run
  from the wrong directory is how one got committed before.
