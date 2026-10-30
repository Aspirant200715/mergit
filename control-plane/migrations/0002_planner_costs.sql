-- The planner's own model spend (HLD D18). It runs on the platform side, before any task exists, so no
-- receipt covers it. One row per model call, recorded even when planning fails. No foreign key to plans:
-- a goal that never becomes a plan still cost money.

CREATE TABLE planner_costs (
    id                  bigserial PRIMARY KEY,
    plan_uuid           uuid NOT NULL,
    model               text NOT NULL,
    input_tokens        integer NOT NULL CHECK (input_tokens >= 0),
    output_tokens       integer NOT NULL CHECK (output_tokens >= 0),
    cache_read_tokens   integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens  integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    usd_micros          bigint NOT NULL CHECK (usd_micros >= 0),
    at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planner_costs_plan ON planner_costs (plan_uuid);
