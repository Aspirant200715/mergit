# control-plane

Python side of Mergit v0: planner, task graph, API and the agent worker. This directory currently holds the
**agent worker** (`mergit_worker/`, plan task O5). The API, planner and graph (O1 to O4, O6, O7) arrive in
their own pull requests and add `mergit_cp/` next to it.

## The worker

`python -m mergit_worker` claims one `queued` job at a time (`SELECT … FOR UPDATE SKIP LOCKED`), runs the
model loop against a fresh sandbox, then:

1. runs the approved predicate Φ in the sandbox after the agent has stopped (a `command` step, in the evidence set),
2. calls `seal_with_phi`, which appends the `phi_eval` step last,
3. uploads the bundle, merged with the full trajectory (every step's blobs, kept for a bonded challenge, not only the evidence steps), with `PUT {STORE_URL}/v0/bundles`,
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
| `progress.py` | `ProgressReporter`: reports a step to the control plane's live stream (O7) the instant it is recorded |

### What the agent cannot do

- Append or influence `phi_eval`: the tool layer only has a `record` callback that refuses the type, the tool list has no such tool, and the Rust binding refuses it too.
- Decide that a task is done: `finish` ends its turn. The graph moves on the Φ result.
- Reach a credential: the model's tools take no secrets, the container environment is a fixed, non-secret list, and signing keys live in the worker process (`MERGIT_AGENT_KEY_<agent_id>`).

### Security notes

The container can write anything to the mounted checkout, so the host never trusts it:

- the git directory lives **outside** the mount; every host git call passes `--git-dir` and `--work-tree`, so a planted top-level `.git` file or config (for example `core.fsmonitor`) is never read;
- a `.git` **anywhere inside** the checkout is refused outright before `changed_paths`/`diff_from_head` run any git command over the tree, rather than trusted to be handled by the right flags everywhere: git recurses into a gitlink (a nested `.git`, real submodule or not) using *that* repository's own config, and a `core.fsmonitor` entry there runs a command on the host the moment something walks over it;
- `changed_paths` also reports paths a `.gitignore` would otherwise hide (`--ignored=matching`), so an agent cannot satisfy `allowed_paths` by writing outside it and hiding the result;
- host reads and writes walk paths with `O_NOFOLLOW` per component, so a symlink made by the agent cannot redirect them, and the open is non-blocking, so a named pipe the agent created cannot hang the worker;
- repository URLs are limited to `SANDBOX_ALLOWED_URL_SCHEMES` (default `https`), refs and paths are validated, and git runs with a scrubbed environment and no hooks.

Only the checkout is mounted. Test runners are told not to write caches or bytecode into it (`SANDBOX_ENV` in `sandbox.py`), so they do not show up as changed paths and fail an `allowed_paths` check.

If the checkout is refused (the nested-`.git` case above), Φ is inconclusive (`holds = NULL`) the same way a
timed-out command is: not a guess at whether the real change would have passed.

### Live step reporting (plan task O7)

Every agent-loop step (not the Φ `command` step, not `phi_eval`) is reported to the control plane's
`POST /v0/internal/progress` the instant `harness.py`'s recorder gives it a `seq`, so a viewer's SSE stream
shows it with no polling delay. This is purely observational: `ProgressReporter.report` never raises, a
refusal or a transport error is only logged, and nothing about the task, the receipt or the job outcome
depends on it. `NullProgressReporter` (the default) sends nothing, for a worker started without
`CONTROL_PLANE_URL`/`WORKER_TOKEN`.

### Configuration

Typed, from the environment (`mergit_worker/config.py`). Required: `DATABASE_URL`, `GATEWAY_URL`, `STORE_URL`,
`EVENTS_TOKEN`, `STORE_WRITE_TOKEN`, `RECEIPT_REGISTRY`, `AGENTS_FILE`, and `MERGIT_AGENT_KEY_<id>` per agent,
plus the model provider key (`ANTHROPIC_API_KEY`). Everything else has a default, including `CHAIN_ID`
(84532), `SANDBOX_IMAGE`, `SANDBOX_RUNTIME`, `SANDBOX_MEMORY` (2g), `SANDBOX_NANO_CPUS` (2 CPUs),
`MAX_STEPS` (60), `MAX_OUTPUT_BYTES` (1 MiB), `COMMAND_TIMEOUT_S`, `JOB_DEADLINE_S`, `MODEL_MAX_TOKENS`
(16000; Opus 5.5's thinking tokens count against it, so this is also a per-call ceiling the harness clamps
*down* from when the remaining budget cannot cover it), `JOB_LEASE_S` (3600; a `running` job claimed longer
ago than this, by any worker, is reclaimed at start-up as `error` rather than left stuck forever).
`CONTROL_PLANE_URL` and `WORKER_TOKEN` are optional and only meaningful together (see above); with only one
set, the worker logs a warning at start and runs with live reporting off, same as with neither set.

Model and system prompt per agent: `agents.toml`, keyed by `name` in `deploy/agents.example.json`.
Prices: `prices.toml`.

If the worker itself runs in a container, `SANDBOX_WORKSPACE_ROOT` must be the same path on the host and in
the worker container, because sandboxes are started through the host Docker socket.

### Database contract

`jobs.py` reads `jobs`, `tasks` and `plans` and writes `status`, `claimed_by`, `claimed_at`, `phi_holds`,
`receipt_root`, `notes`, `finished_at` on `jobs`. The exact columns are in `tests/jobs_schema.sql`. O4 owns the
real migration and should either match those names or change `jobs.py` and that file in the same pull request.

A crashed or killed worker never resumes a job under its old `task_id`: `fail_own_running` (this worker's own
jobs, checked at start-up) and `reclaim_stale` (anyone's, past `JOB_LEASE_S`) both mark the row `error` instead
of putting it back on the queue. Resuming would mean paying the model again for the same attempt and
re-sealing a bundle the store may already hold under that `task_id`, which it then refuses as a second bundle
for one task. A fresh attempt is a new `task_id`, decided by plan task O6, not a retry of this one.

`PgJobStore` also reconnects once and retries on a dropped connection (`claim`, `report`, `fail` and the two
start-up sweeps above): a worker process runs for a long time, and losing its one connection must not be
fatal to it.

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
