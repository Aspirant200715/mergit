# Documentation

| Document | What it answers |
| --- | --- |
| [**PRD.md**](PRD.md) | What we are building, for whom, with which components and in what order |
| [**HLD.md**](HLD.md) | How it is put together: components, trust boundaries and keys, data and state, interfaces, deployment by phase, and the decisions still open |
| [legacy/](legacy/) | Superseded documents, kept for reference. Read the notice there before using any of it |

## The paper is upstream of all of this

The source of truth is [`mergit-research`](https://github.com/mergit-io/mergit-research):

- [The argument in 15 minutes](https://github.com/mergit-io/mergit-research/blob/main/paper/whitepaper.md)
- [The full paper](https://github.com/mergit-io/mergit-research/blob/main/paper/draft-v1.md) — threat model, economics, security analysis, limitations
- [The 17 locked decisions](https://github.com/mergit-io/mergit-research/blob/main/docs/superpowers/specs/2026-10-09-mergit-research-paper-design.md)

**Where this directory and the paper disagree, the paper is right and the document here is a
defect.** Fix the document; do not reconcile by editing the paper.

## Licence

Everything under `docs/` is **CC BY 4.0** ([LICENSE](LICENSE)), not the GPL-3.0 that covers the
rest of this repository. The split is deliberate: it lets people contribute to the documentation
without that contribution carrying obligations over the code.
