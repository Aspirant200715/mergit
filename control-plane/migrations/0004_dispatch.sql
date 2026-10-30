-- Plan task O4: the chain gateway's events back to this service, and what they trigger.
--
-- `chain_events_seen` makes POST /v0/chain-events idempotent on event_id (spec/events-v0.md transport).
-- `task_dispatches` remembers what a `task.dispatch_requested` event asked for, since the matching
-- `task.escrowed` event carries only a task_id; phi_hash and budget are not copied here, they are read
-- from `tasks` by (plan_uuid, index), so there is exactly one place either can be edited.
-- `jobs` is the worker's queue (plan task O5): column names and types are the worker's read contract
-- (control-plane/tests/jobs_schema.sql), plus `patch`, added for the requester-approved PR (plan task O9).

CREATE TABLE chain_events_seen (
    event_id    uuid PRIMARY KEY,
    type        text NOT NULL,
    payload     jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_dispatches (
    task_id       text PRIMARY KEY CHECK (task_id ~ '^0x[0-9a-f]{64}$'),
    plan_uuid     uuid NOT NULL REFERENCES plans,
    "index"       integer NOT NULL CHECK ("index" >= 0),
    attempt       integer NOT NULL CHECK (attempt >= 1),
    agent_id      text NOT NULL,
    dispatched_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_uuid, "index", attempt)
);

CREATE TABLE jobs (
    task_id      text PRIMARY KEY,
    plan_uuid    uuid NOT NULL REFERENCES plans,
    "index"      integer NOT NULL,
    attempt      integer NOT NULL,
    agent_id     text NOT NULL,
    status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    claimed_by   text,        -- worker
    claimed_at   timestamptz, -- worker
    phi_holds    boolean,     -- worker; NULL while unfinished, and when Φ was inconclusive
    receipt_root text,        -- worker
    notes        text,        -- worker
    patch        text,        -- worker; the change of a task that passed Φ, NULL otherwise (plan task O9)
    finished_at  timestamptz  -- worker
);

CREATE INDEX jobs_queue ON jobs (created_at, task_id) WHERE status = 'queued';
CREATE INDEX jobs_plan_index ON jobs (plan_uuid, "index");
