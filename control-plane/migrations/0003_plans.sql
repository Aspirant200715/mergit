-- Plans and their tasks (plan task O3), and the outbox of events to the chain gateway.
-- Column names match what the worker reads (tests/jobs_schema.sql); everything else is added here.
-- This database belongs to the control plane only: the gateway keeps its own (spec/events-v0.md).

CREATE TABLE plans (
    plan_uuid               uuid PRIMARY KEY,
    plan_id                 text NOT NULL UNIQUE CHECK (plan_id ~ '^0x[0-9a-f]{64}$'),   -- mergit_receipt.plan_id
    requester               text NOT NULL CHECK (requester ~ '^0x[0-9a-f]{40}$'),
    goal                    text NOT NULL,
    repo_url                text NOT NULL,
    ref                     text NOT NULL,
    category                text NOT NULL,
    budget_usdc_units       bigint NOT NULL CHECK (budget_usdc_units > 0),   -- what the requester offered
    state                   text NOT NULL DEFAULT 'draft'
                            CHECK (state IN ('draft', 'approved', 'funded', 'running', 'done', 'failed', 'closed')),
    funding                 text CHECK (funding IN ('wallet', 'credits')),
    total_budget_usdc_units bigint CHECK (total_budget_usdc_units > 0),      -- sum of task budgets, fixed at approval
    planner_model           text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    approved_at             timestamptz,
    CHECK (state = 'draft' OR state = 'closed' OR (approved_at IS NOT NULL AND funding IS NOT NULL
                                                    AND total_budget_usdc_units IS NOT NULL))
);

CREATE INDEX plans_requester ON plans (requester, created_at DESC);

CREATE TABLE tasks (
    plan_uuid           uuid NOT NULL REFERENCES plans ON DELETE CASCADE,
    "index"             integer NOT NULL CHECK ("index" >= 0),
    title               text NOT NULL,
    instructions        text NOT NULL,
    phi                 jsonb NOT NULL,
    phi_hash            text CHECK (phi_hash ~ '^0x[0-9a-f]{64}$'),   -- mergit_receipt.phi_hash, set at approval
    budget_usdc_units   bigint NOT NULL CHECK (budget_usdc_units > 0),
    depends_on          integer[] NOT NULL DEFAULT '{}',
    agents              text[],   -- the requester's picks: first is the agent, the rest are retries in order
    PRIMARY KEY (plan_uuid, "index")
);

-- One row per call that may spend on the planner model, for the per-requester rate limit.
CREATE TABLE planning_attempts (
    requester   text NOT NULL,
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planning_attempts_requester ON planning_attempts (requester, at DESC);

-- Transactional outbox: an event is written in the same transaction as the state change it reports,
-- then delivered by EventDeliverer with retries. Events of one plan are delivered in order.
CREATE TABLE outbox (
    id              bigserial PRIMARY KEY,
    event_id        uuid NOT NULL UNIQUE,
    type            text NOT NULL,
    plan_id         text,
    body            jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    next_at         timestamptz NOT NULL DEFAULT now(),
    give_up_at      timestamptz NOT NULL,
    attempts        integer NOT NULL DEFAULT 0,
    delivered_at    timestamptz,
    failed_at       timestamptz,
    last_error      text
);

CREATE INDEX outbox_pending ON outbox (next_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
