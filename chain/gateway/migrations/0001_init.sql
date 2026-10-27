-- Events from the orchestrator already handled (idempotency on event_id).
create table processed_events (
    event_id uuid primary key,
    received_at timestamptz not null default now()
);

-- Events to deliver, in order, per target. A row is retried with backoff for 10 minutes.
create table outbox (
    id bigserial primary key,
    target text not null,             -- 'orchestrator' | 'validator'
    url text not null,
    event_id uuid not null,
    body jsonb not null,
    attempts int not null default 0,
    next_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    delivered_at timestamptz,
    failed_at timestamptz
);
create index outbox_due on outbox (target, id) where delivered_at is null and failed_at is null;

-- Next block the watcher reads.
create table watcher_cursor (
    id int primary key default 1 check (id = 1),
    block bigint not null
);

-- What the keeper needs to settle expired tasks.
create table plans (
    plan_id text primary key,
    tier text not null                -- 'staked' | 'onboarding'
);
create table tasks (
    task_id text primary key,
    plan_id text not null,
    deadline bigint not null,
    settled boolean not null default false
);
