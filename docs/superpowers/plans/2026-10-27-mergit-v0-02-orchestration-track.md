# Mergit v0: Orchestration Track (Abhinav and Soham) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python side of Mergit v0: wallet sign-in sessions, the planner, plan approval, the task graph and dispatch, the agent worker with its sandbox, verdict and retry handling, the API and live stream, the run screens, the pull-request gate, and their hosting.

**Architecture:** One Python service (`control-plane/`) exposes the API and owns plans and tasks in Postgres; one or more worker processes on a Docker-capable VM pull jobs, run the LLM loop in the harness process and every model-caused command inside a sandbox container, build the receipt through the Rust `mergit_receipt` binding, upload it to the receipt store and report it to the chain gateway.

**Tech Stack:** Python 3.12+, uv, pytest. The web framework, database layer and job queue are your choice (design §10). This plan assumes FastAPI, SQLAlchemy or plain SQL on Postgres, and a Postgres-backed job table; if you choose differently, keep every HTTP interface and test name below. Docker SDK for Python for sandboxes. `mergit_receipt` (Yash Task Y3) for every hash, id and receipt.

**Spec:** [`docs/superpowers/specs/2026-10-27-mergit-v0-build-design.md`](../specs/2026-10-27-mergit-v0-build-design.md). Shared definitions: [`00-overview-and-spec`](2026-10-27-mergit-v0-00-overview-and-spec.md) Tasks S2 and S3 are normative.

**Suggested split (yours to change):** Abhinav O1–O4 and O7; Soham O5, O6 and O9; O8 and O10 together. Yash reviews every pull request.

## Global Constraints

- All of the overview's Global Constraints apply.
- Never compute a keccak hash, plan id, task id, `phi_hash` or receipt field in Python. Call `mergit_receipt`.
- The agent never decides that a task is done. The harness runs `Φ` after the agent stops, through `seal_with_phi`; the graph moves on that `phi_eval` result; only `verdict.recorded` moves money.
- Model-caused commands run only inside the sandbox container: no network, no mounted secrets, the repository checkout as its only volume, CPU and memory limits set.
- Credentials (model API keys, GitHub token, agent runtime keys) live in the worker's environment and are never passed into the sandbox or into a model prompt.
- The planner's own model cost is recorded in the `planner_costs` table, not in any receipt (D18).
- Each agent's signing key comes from `MERGIT_AGENT_KEY_<agent_id>`; agent ids come from `deployments/agents.json` (Yash Task Y6).
- Captured tool output is capped at 1 MiB per step; when truncated, the stored bytes end with the line `\n[mergit: output truncated at 1048576 bytes]\n`, and the digest is over the stored bytes.
- Retries: at most 3 attempts per task index; each attempt has its own task id and must use an agent the requester picked for that task.

## Review Focus

See the overview. Items 1, 2 and 4 have their tests in O6, O4 and O5 below.

---

### Task O1: Service skeleton, configuration and wallet sign-in

**Files:**
- Create: `control-plane/pyproject.toml` (fill), `control-plane/mergit_cp/app.py`, `mergit_cp/config.py`, `mergit_cp/db.py`, `mergit_cp/auth.py`, `mergit_cp/agents.py`, `migrations/0001_init.sql`
- Test: `control-plane/tests/test_auth.py`, `tests/test_agents.py`

**Interfaces:**
- `GET /v0/auth/nonce → {"nonce"}`; `POST /v0/auth/verify {"message", "signature"}` → 200 and an httpOnly, `SameSite=Lax`, `Secure` cookie `mergit_session` (signed, 12 h); `GET /v0/auth/me → {"address"}`; `POST /v0/auth/logout`. Use the `siwe` package; accept chain id `84532` and the domain from `APP_DOMAIN` only.
- `load_agents(path: str) -> list[Agent]` where `Agent(agent_id: str, name: str, operator: str, runtime_key: str, model: str, system_prompt: str)`; the model and prompt per agent come from `control-plane/agents.toml` keyed by `name`.
- Env: `DATABASE_URL`, `APP_DOMAIN`, `SESSION_SECRET`, `GATEWAY_URL`, `STORE_URL`, `AGENTS_FILE`, `CORS_ORIGINS`.

- [ ] **Step 1: Write the failing tests:** `test_verify_accepts_valid_siwe_and_sets_cookie` (sign with `eth_account` using a throwaway key), `test_verify_rejects_reused_nonce`, `test_verify_rejects_wrong_chain_id`, `test_verify_rejects_wrong_domain`, `test_me_requires_session`, `test_load_agents_joins_chain_ids_with_model_config`.
- [ ] **Step 2:** Run `cd control-plane && uv run pytest tests/test_auth.py tests/test_agents.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement. Nonces are single use and expire after 10 minutes.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): service skeleton and Sign-In with Ethereum"
```

### Task O2: Planner

**Files:**
- Create: `mergit_cp/planner.py`, `mergit_cp/llm.py` (model gateway client), `mergit_cp/predicates.py`
- Test: `tests/test_planner.py`, `tests/test_predicates.py`

**Interfaces:**
- `plan_goal(goal: str, repo_url: str, budget_usdc_units: int, category: str, llm: LLM) -> PlanDraft`
- `PlanDraft(plan_uuid: str, tasks: list[TaskDraft])`, `TaskDraft(index: int, title: str, instructions: str, phi: dict, budget_usdc_units: int, depends_on: list[int])`
- `check_predicate(phi: dict) -> list[str]` returns problems: schema errors against `spec/schemas/predicate.json`, an empty `command`, a command that is trivially true (`true`, `:`, `exit 0`, `echo …` alone), `timeout_s` outside 1–3600.
- `LLM` protocol: `complete(messages: list[dict], tools: list[dict] | None, model: str) -> LLMResult(text, tool_calls, input_tokens, output_tokens, model)`; the planner records each call's usage in `planner_costs(plan_uuid, model, input_tokens, output_tokens, usd_micros)`.

- [ ] **Step 1: Write the failing tests** with a fake `LLM` returning fixed JSON: `test_plan_tasks_have_schema_valid_phi`, `test_planner_retries_once_then_fails_on_invalid_phi`, `test_plan_rejects_cycle_in_dependencies`, `test_task_budgets_sum_within_requested_budget`, `test_planner_cost_recorded_outside_receipts`; and `test_rejects_trivial_predicate` (parametrised over `["true"]`, `["sh","-c","exit 0"]`, `["echo","ok"]`), `test_accepts_pytest_predicate`.
- [ ] **Step 2:** Run `uv run pytest tests/test_planner.py tests/test_predicates.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement. The prompt asks for JSON matching `PlanDraft`, with every `phi` of kind `exec/0`; validate, and on failure re-ask once with the validation errors.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): LLM planner with predicate checks"
```

### Task O3: Plans, editing and requester approval

**Files:**
- Create: `mergit_cp/plans.py`, `mergit_cp/routes_plans.py`, `migrations/0002_plans.sql`
- Test: `tests/test_plans.py`

**Interfaces:**
- `POST /v0/plans {"goal", "repo_url", "budget_usdc_units", "category"}` → draft plan (requester = session address).
- `PATCH /v0/plans/{plan_uuid}` edits titles, instructions, `phi`, budgets and dependencies while the plan is a draft.
- `POST /v0/plans/{plan_uuid}/approve {"agents": {"<index>": ["<agent_id>", ...]}, "funding": "wallet" | "credits"}` → `{plan_id, total_budget_usdc_units}`; the first agent per index is the pick, the rest are the requester's allowed retries in order. Sends `plan.approved` to the gateway.
- Plan states: `draft → approved → funded → running → done | failed | closed`.

- [ ] **Step 1: Write the failing tests:** `test_only_requester_can_edit_or_approve`, `test_approve_requires_agent_for_every_task`, `test_approve_rejects_unknown_agent_id`, `test_approved_plan_is_immutable`, `test_approve_sends_plan_approved_with_spec_plan_id` (asserts `plan_id == mergit_receipt.plan_id(plan_uuid)` and the payload validates against `spec/schemas/event.json`), `test_approve_rejects_plan_with_failing_predicate_check`.
- [ ] **Step 2:** Run `uv run pytest tests/test_plans.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement, with an `EventSender` that writes to an outbox table and delivers to `GATEWAY_URL/v0/events` with the `Idempotency-Key` header and retries (S3 transport rules).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): plan editing and requester approval"
```

### Task O4: Chain events and dispatch

**Files:**
- Create: `mergit_cp/chain_events.py` (`POST /v0/chain-events`), `mergit_cp/graph.py`, `mergit_cp/dispatch.py`, `migrations/0003_tasks.sql`
- Test: `tests/test_chain_events.py`, `tests/test_graph.py`

**Interfaces:**
- `POST /v0/chain-events` accepts every gateway → Python event in S3; idempotent on `event_id`.
- `ready_tasks(plan) -> list[int]`: indexes whose dependencies all have a passing `phi_eval` result and that have no running attempt.
- On `plan.funded`: for each ready index, send `task.dispatch_requested` with `task_id = mergit_receipt.task_id(plan_id, index, attempt)`, the picked agent, its budget, `phi_hash = mergit_receipt.phi_hash(json.dumps(phi))`, and `deadline_unix = now + 1800`.
- On `task.escrowed`: insert a job row `jobs(task_id, plan_uuid, index, attempt, agent_id, status = "queued")` for workers.

- [ ] **Step 1: Write the failing tests:** `test_duplicate_chain_event_is_ignored`, `test_no_dispatch_before_plan_funded`, `test_task_dispatched_only_after_dependencies_pass`, `test_independent_tasks_dispatch_in_parallel`, `test_job_queued_only_after_task_escrowed`, `test_task_id_matches_spec_vector` (uses `spec/vectors/ids.json`).
- [ ] **Step 2:** Run `uv run pytest tests/test_chain_events.py tests/test_graph.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): chain events, task graph and dispatch"
```

### Task O5: Worker harness and sandbox

**Files:**
- Create: `control-plane/mergit_worker/__main__.py`, `mergit_worker/harness.py`, `mergit_worker/sandbox.py`, `mergit_worker/tools.py`, `mergit_worker/phi.py`, `mergit_worker/meter.py`, `control-plane/sandbox/Dockerfile` (the sandbox image: git, Python, Node, common test runners)
- Test: `tests/test_harness.py`, `tests/test_sandbox.py` (marked `docker`, run where Docker exists)

**Interfaces:**
- Worker loop: claim a `queued` job (`SELECT … FOR UPDATE SKIP LOCKED`), run it, report.
- `Sandbox.create(repo_url: str, ref: str) -> Sandbox` (clones on the host, mounts into a container with `network_mode="none"`, `mem_limit="2g"`, `nano_cpus=2_000_000_000`, no environment variables passed); `run(argv: list[str], workdir: str, timeout_s: int) -> CommandResult(exit_code, stdout: bytes, stderr: bytes, wall_ms)`; `read_file`, `write_file`, `changed_paths() -> list[str]` (`git status --porcelain`), `file_hash(path) -> str` (via `mergit_receipt`-compatible keccak: compute in the binding, do not reimplement; add `mergit_receipt.keccak_hex(bytes)` to Y3 if missing); `destroy()`.
- Agent tools offered to the model: `list_files`, `read_file`, `write_file`, `run_command`, `finish`. Each executed tool call becomes one `add_step` (`tool_call`, `command` or `artifact_write`); each model call becomes one `model_call` step with provider usage as its cost; prices per model come from `control-plane/prices.toml` (labelled as list prices, not measurements).
- After `finish`, a step budget of 60, or the task budget is spent: run `Φ` in the sandbox, build `PhiResult` (`exit_code`, `changed_paths`, `observed_artifact_hashes` for each path in `phi.artifact_hashes`, `stdout_digest`, `holds = mergit_receipt.phi_holds(...)`), call `seal_with_phi`, `PUT {STORE_URL}/v0/bundles`, send `receipt.sealed`, then report `phi_result(task_id, holds)` to the control plane (O6) by updating the job row; `holds = None` when `Φ` timed out or could not start.

- [ ] **Step 1: Write the failing tests** with a fake LLM and, for the `docker` ones, a tiny Python repository fixture with one failing test: `test_agent_cannot_append_phi_eval` (the tool layer has no path to `phi_eval`, and the binding raises if called directly), `test_phi_runs_after_agent_stops_and_is_last_step`, `test_tool_output_truncated_with_marker`, `test_step_cost_recorded_from_provider_usage`, `test_budget_exhausted_still_seals_with_phi`, `test_bundle_uploaded_before_receipt_sealed_event`; docker-marked: `test_container_has_no_network`, `test_no_secrets_in_container_env`, `test_fake_agent_fixes_fixture_and_phi_holds`.
- [ ] **Step 2:** Run `uv run pytest tests/test_harness.py -v` and `uv run pytest -m docker tests/test_sandbox.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement. The harness holds the `ReceiptBuilder`; the model and tool layer only see a `record(step_type, input, output, exit_status, cost)` callback that refuses `phi_eval`.
- [ ] **Step 4:** Run both test sets. Expected: PASS.
- [ ] **Step 5:** Integration with Yash's services (Tuesday evening): run one job against the local store and gateway from `deploy/compose.yaml`; the gateway commits the receipt on Base Sepolia. Expected: `ReceiptCommitted` visible on BaseScan.
- [ ] **Step 6: Commit**

```bash
git add control-plane
git commit -m "feat(worker): harness, sandbox, metering and sealed receipts"
```

### Task O6: Outcomes, retries and escalation

**Files:**
- Create: `mergit_cp/outcomes.py`
- Modify: `mergit_cp/graph.py`, `mergit_cp/chain_events.py`
- Test: `tests/test_outcomes.py`

**Interfaces:**
- Worker reports `phi_result(task_id, holds: bool | None)` to the control plane (`None` when `Φ` could not run: timeout or missing command).
- `holds = True` → mark the index passed, dispatch newly ready indexes. `holds = False` → if the requester listed another agent for this index and fewer than 3 attempts were made, dispatch `attempt + 1` with that agent; otherwise mark the index `needs_requester`. `holds = None` → `needs_requester` (inconclusive: a human decides, no guess).
- `verdict.recorded` and `task.released` / `task.returned` update money state only; they never move the graph.
- All indexes passed → plan `done` (O9 gates the PR); any index `needs_requester` that the requester abandons → `plan.closed`.

- [ ] **Step 1: Write the failing tests:** `test_retry_uses_new_task_id_and_new_agent`, `test_no_retry_without_another_requester_picked_agent`, `test_max_three_attempts_then_needs_requester`, `test_inconclusive_escalates_without_retry`, `test_verdict_does_not_move_graph`, `test_agent_finish_alone_does_not_complete_task`, `test_abandon_sends_plan_closed`.
- [ ] **Step 2:** Run `uv run pytest tests/test_outcomes.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): outcomes, retries and escalation"
```

### Task O7: API for the web app and the live stream

**Files:**
- Create: `mergit_cp/routes_runs.py`, `mergit_cp/stream.py`
- Test: `tests/test_api.py`

**Interfaces:**
- `GET /v0/plans` (the session's plans), `GET /v0/plans/{plan_uuid}` (plan, tasks, attempts, `phi` results, verdicts, money state, transaction hashes), `GET /v0/agents` (from `agents.json` plus model names), `GET /v0/plans/{plan_uuid}/events` (Server-Sent Events: `plan.state`, `task.state`, `step.recorded {task_id, seq, type, cost}`, `verdict`, `money`). Steps stream as the worker records them (the worker posts progress to `POST /v0/internal/progress`, authenticated with `WORKER_TOKEN`).
- CORS for `app.mergit.site` and `localhost:5173`, credentials allowed.

- [ ] **Step 1: Write the failing tests:** `test_plans_list_only_shows_own_plans`, `test_plan_detail_includes_attempts_and_tx_hashes`, `test_sse_streams_state_changes_in_order`, `test_internal_progress_requires_worker_token`.
- [ ] **Step 2:** Run `uv run pytest tests/test_api.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(control-plane): run API and live event stream"
```

### Task O8: Run screens in the web app

**Files (in `mergit/frontend`):**
- Create: `src/api/client.ts`, `src/api/usePlan.ts` (SSE)
- Modify: `src/screens/NewRun.tsx`, `src/screens/run/*`, `src/state/ApprovalsProvider.tsx`, `src/screens/agents/*`
- Test: `e2e/run.spec.ts`

**Interfaces:**
- Consumes: O3 and O7 endpoints; Yash Task Y12 `useFundPlan(planId, amountUnits)` and `useCredits()`, `DATA_MODE`.
- In mock mode every screen behaves as today.

- [ ] **Step 1: Write the failing Playwright tests** (live mode, API mocked with `page.route`): `new run creates a draft plan`, `requester edits a predicate and approves with an agent per task`, `approve with credits shows remaining credits and funds without a wallet prompt`, `approve with wallet calls fund and waits for confirmation`, `run view shows steps live and the verdict`, `failed task shows the retry on the next agent`, `inconclusive task asks the requester`.
- [ ] **Step 2:** Run `npm run test:e2e -- e2e/run.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Every receipt reference links to the proofs page (Y12).
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(web): live run, plan approval and agent pick screens"
```

### Task O9: Pull-request gate

**Files:**
- Create: `mergit_worker/github.py`, `mergit_cp/routes_pr.py`
- Test: `tests/test_pr.py`

**Interfaces:**
- When a plan is `done`, the requester sees the final diff and `POST /v0/plans/{plan_uuid}/open-pr` opens a pull request on `repo_url` with the combined changes, using `GITHUB_TOKEN` from the worker environment (fine-grained token for the demo repository). The PR body links each task's receipt on `app.mergit.site`.

- [ ] **Step 1: Write the failing tests** (GitHub API mocked with `respx`): `test_pr_requires_requester_approval`, `test_pr_only_when_all_tasks_passed`, `test_pr_body_links_every_receipt`, `test_token_not_in_sandbox_env`.
- [ ] **Step 2:** Run `uv run pytest tests/test_pr.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add control-plane
git commit -m "feat(worker): requester-approved pull request"
```

### Task O10: Hosting the API and the worker

**Files:**
- Create: `control-plane/Dockerfile` (API), `control-plane/worker.Dockerfile`, `deploy/worker-vm/compose.yaml`, `deploy/worker-vm/README.md`
- Modify: `render.yaml` (service `mergit-api`, Docker, `api.mergit.site`), `deploy/compose.yaml` (api and worker services)

**Interfaces:**
- `mergit-api` on Render with `DATABASE_URL` from `mergit-db`, `SESSION_SECRET`, `GATEWAY_URL`, `STORE_URL`, `APP_DOMAIN=app.mergit.site`, `WORKER_TOKEN`, model keys.
- The worker VM runs `deploy/worker-vm/compose.yaml`: the worker image with access to the host Docker socket for sandboxes, `MERGIT_AGENT_KEY_<id>` for each agent, model keys, `GITHUB_TOKEN`, `WORKER_TOKEN`, `DATABASE_URL` (Render Postgres external URL).

- [ ] **Step 1:** Build both images locally and run the whole stack with `deploy/compose.yaml`. Expected: the honest run from Y14 Step 1 passes locally.
- [ ] **Step 2:** Provision the VM, install Docker, copy the env file (never commit it), `docker compose up -d`. Expected: the worker claims a job from the hosted API.
- [ ] **Step 3:** Apply the Render blueprint for `mergit-api`; point `api.mergit.site` at it.
- [ ] **Step 4:** Run Y14 Step 1 against the hosted stack together with Yash.
- [ ] **Step 5: Commit**

```bash
git add control-plane/Dockerfile control-plane/worker.Dockerfile deploy render.yaml
git commit -m "chore(deploy): host the control plane and the worker VM"
```
