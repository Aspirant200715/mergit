# Legacy documents

**Nothing in this directory describes the current system.** These were written against Mergit v0.2
(June 2026) — a Rust service mesh with LangGraph orchestration on Monad, settling proof-of-work
NFTs. That design was replaced. The current design is
[the paper](https://github.com/mergit-io/mergit-research/blob/main/paper/draft-v1.md) and
[PRD.md](../PRD.md).

They are kept because some of the underlying work is still good and was going to be deleted along
with the `mergit-docs` repository. Treat every one of them as evidence, not instruction.

| File | Status | What survives |
| --- | --- | --- |
| [`llm-caching-guide.md`](llm-caching-guide.md) | Stale stack, useful strategy | Four-layer caching design (exact-match, semantic, prompt, tool-output), eligibility rules, invalidation, cost/quality metrics. Cost is now the headline contribution — this feeds paper §11. **Pricing figures are from May 2026 and are out of date.** Redis/pgvector are no longer a specified stack |
| [`free-tier-cost-management.md`](free-tier-cost-management.md) | Stale stack, useful mechanics | Tier limits, the four-state free-tier pattern, per-role model routing, and a shared prompt-cache prefix across free accounts. Maps onto PRD §12 access tiers and bears directly on open question Q6, faucet abuse bounds |
| [`architect.md`](architect.md) | Superseded | The licensing rationale — code GPL, contracts MIT so auditors and integrators can use them, docs CC BY 4.0 so documentation contributions do not carry code obligations. The repo topology and service layout are dead |
| [`ci-cd.md`](ci-cd.md) | Superseded | Pipeline shapes for a Foundry/Solidity project. The hosting plan targets Oracle Cloud ARM, which cannot build the `solc` toolchain — do not repeat that |
| [`web3-monad-implementation.md`](web3-monad-implementation.md) | Superseded | Little. Monad is not the chain, and every contract it describes was replaced |

Do not open a pull request that "updates" a file in here. If something in one of them should be
true of the current system, move that substance into `PRD.md` or the paper and leave the legacy
copy untouched.
