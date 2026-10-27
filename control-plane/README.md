# control-plane

Python side of Mergit v0: planner, task graph, API and the agent worker. This directory currently holds the
**agent worker** (`mergit_worker/`, plan task O5). The API, planner and graph (O1 to O4, O6, O7) arrive in
their own pull requests and add `mergit_cp/` next to it.

## The worker

`python -m mergit_worker` claims one `queued` job at a time (`SELECT … FOR UPDATE SKIP LOCKED`), runs the
model loop against a fresh sandbox, then:

1. runs the approved predicate Φ in the sandbox after the agent has stopped (a `command` step, in the evidence set),
2. calls `seal_with_phi`, which appends the `phi_eval` step last,
3. uploads the bundle with `PUT {STORE_URL}/v0/bundles`,
4. sends `receipt.sealed` to `{GATEWAY_URL}/v0/events`,
5. writes the Φ result to the job row (`phi_holds`: `true`, `false`, or `NULL` when Φ could not run).

| Module | Role |
| --- | --- |
| `harness.py` | Owns the `ReceiptBuilder`. Agent loop, Φ, seal, publish. Stop reasons: `finished`, `no_tool_calls`, `step_budget`, `cost_budget`, `time_budget`, `llm_error`, `refusal`, `max_tokens` |
| `sandbox.py` | Docker container per job: no network, no secrets, one volume, CPU/memory/pid limits, read-only root, no capabilities, optional gVisor (`SANDBOX_RUNTIME=runsc`). A timeout kills every process in the container |
| `workspace.py` | The checkout on the host and the only code that touches it (see Security) |
| `tools.py` | `list_files`, `read_file`, `write_file`, `run_command`, `finish`. Each call is one step |
| `phi.py` | Runs Φ and builds the `PhiResult`; `holds` comes from `mergit_receipt.phi_holds` |
| `meter.py` | Cost per step: provider token counts times `prices.toml` (list prices, not measurements) |
| `publish.py` | Bundle upload then event, bearer tokens, `Idempotency-Key`, backoff for 10 minutes |
| `jobs.py` | All worker SQL |
| `llm.py` | `LLM` protocol and the Anthropic adapter |

### What the agent cannot do

- Append or influence `phi_eval`: the tool layer only has a `record` callback that refuses the type, the tool list has no such tool, and the Rust binding refuses it too.
- Decide that a task is done: `finish` ends its turn. The graph moves on the Φ result.
- Reach a credential: the model's tools take no secrets, the container environment is a fixed, non-secret list, and signing keys live in the worker process (`MERGIT_AGENT_KEY_<agent_id>`).

### Security notes

The container can write anything to the mounted checkout, so the host never trusts it:

- the git directory lives **outside** the mount; every host git call passes `--git-dir` and `--work-tree`, so a planted `.git` file or config (for example `core.fsmonitor`) is never read;
- host reads and writes walk paths with `O_NOFOLLOW` per component, so a symlink made by the agent cannot redirect them;
- repository URLs are limited to `SANDBOX_ALLOWED_URL_SCHEMES` (default `https`), refs and paths are validated, and git runs with a scrubbed environment and no hooks.

Only the checkout is mounted. Test runners are told not to write caches or bytecode into it (`SANDBOX_ENV` in `sandbox.py`), so they do not show up as changed paths and fail an `allowed_paths` check.

### Configuration

Typed, from the environment (`mergit_worker/config.py`). Required: `DATABASE_URL`, `GATEWAY_URL`, `STORE_URL`,
`EVENTS_TOKEN`, `STORE_WRITE_TOKEN`, `RECEIPT_REGISTRY`, `AGENTS_FILE`, and `MERGIT_AGENT_KEY_<id>` per agent,
plus the model provider key (`ANTHROPIC_API_KEY`). Everything else has a default, including `CHAIN_ID`
(84532), `SANDBOX_IMAGE`, `SANDBOX_RUNTIME`, `SANDBOX_MEMORY` (2g), `SANDBOX_NANO_CPUS` (2 CPUs),
`MAX_STEPS` (60), `MAX_OUTPUT_BYTES` (1 MiB), `COMMAND_TIMEOUT_S`, `JOB_DEADLINE_S`.

Model and system prompt per agent: `agents.toml`, keyed by `name` in `deploy/agents.example.json`.
Prices: `prices.toml`.

If the worker itself runs in a container, `SANDBOX_WORKSPACE_ROOT` must be the same path on the host and in
the worker container, because sandboxes are started through the host Docker socket.

### Database contract

`jobs.py` reads `jobs`, `tasks` and `plans` and writes `status`, `claimed_by`, `claimed_at`, `phi_holds`,
`receipt_root`, `notes`, `finished_at` on `jobs`. The exact columns are in `tests/jobs_schema.sql`. O4 owns the
real migration and should either match those names or change `jobs.py` and that file in the same pull request.

## Develop

```bash
cd control-plane
uv sync --python 3.13                          # builds mergit_receipt with maturin (needs Rust)
uv run ruff check . && uv run ruff format --check . && uv run pyright
uv run pytest                                  # unit tests, no Docker
docker build -t mergit-sandbox:dev sandbox
uv run pytest -m "docker or postgres"          # real sandbox and real Postgres (testcontainers)
```

## Not done here

Tracked by other plan tasks and issue #12 bullets: credential broker and GitHub App (O9), outcomes and retries
(O6, which reads `jobs.phi_holds`), API and SSE (O7), egress allowlist, receipt body encryption (K4), data
availability checks, additional agents, evals, failure injection, and hosting (O10). gVisor is wired through
`SANDBOX_RUNTIME` but has not been exercised in CI.
