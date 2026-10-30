-- Plan task O6, money half: the gateway's verdict and payment events as structured records.
--
-- `chain_events_seen` (0004) is the raw, idempotent log of everything the gateway sends. This table is the
-- ledger built from the events that concern money: one row per event, with typed columns, the transaction
-- hash, and the plan and task the event belongs to. The run API (O7) reads this table, not the raw log.
--
-- Nothing here is a foreign key into the task graph's state, and nothing in the service updates the graph
-- from a row of this table: `verdict.recorded`, `task.released` and `task.returned` move money and
-- reputation only (spec/events-v0.md). The table is append-only; a ledger row is never edited.

CREATE TABLE money_events (
    id                bigserial PRIMARY KEY,
    event_id          uuid NOT NULL UNIQUE REFERENCES chain_events_seen (event_id),
    kind              text NOT NULL CHECK (kind IN (
                          'receipt.committed', 'verdict.recorded', 'task.released', 'task.returned',
                          'challenge.opened', 'challenge.resolved', 'credits.denied')),
    plan_uuid         uuid NOT NULL REFERENCES plans,
    task_id           text REFERENCES task_dispatches (task_id),   -- NULL only for credits.denied
    tx                text CHECK (tx ~ '^0x[0-9a-f]{64}$'),         -- NULL only for credits.denied
    verdict           text CHECK (verdict IN ('pass', 'fail', 'invalid')),
    payee             text CHECK (payee ~ '^0x[0-9a-f]{40}$'),
    amount_usdc_units numeric(78, 0) CHECK (amount_usdc_units >= 0),   -- uint256, USDC base units
    reason            text,
    challenge_id      numeric(78, 0) CHECK (challenge_id >= 0),
    challenger        text CHECK (challenger ~ '^0x[0-9a-f]{40}$'),
    bond_usdc_units   numeric(78, 0) CHECK (bond_usdc_units >= 0),
    upheld            boolean,
    received_at       timestamptz NOT NULL DEFAULT now(),
    -- Each kind carries exactly its own fields and no others.
    CONSTRAINT money_events_shape CHECK (CASE kind
        WHEN 'receipt.committed' THEN
            task_id IS NOT NULL AND tx IS NOT NULL
            AND num_nonnulls(verdict, payee, amount_usdc_units, reason, challenge_id, challenger,
                             bond_usdc_units, upheld) = 0
        WHEN 'verdict.recorded' THEN
            task_id IS NOT NULL AND tx IS NOT NULL AND verdict IS NOT NULL
            AND num_nonnulls(payee, amount_usdc_units, reason, challenge_id, challenger,
                             bond_usdc_units, upheld) = 0
        WHEN 'task.released' THEN
            task_id IS NOT NULL AND tx IS NOT NULL AND payee IS NOT NULL AND amount_usdc_units IS NOT NULL
            AND num_nonnulls(verdict, reason, challenge_id, challenger, bond_usdc_units, upheld) = 0
        WHEN 'task.returned' THEN
            task_id IS NOT NULL AND tx IS NOT NULL AND amount_usdc_units IS NOT NULL
            AND reason IN ('fail', 'invalid', 'deadline', 'challenge')
            AND num_nonnulls(verdict, payee, challenge_id, challenger, bond_usdc_units, upheld) = 0
        WHEN 'challenge.opened' THEN
            task_id IS NOT NULL AND tx IS NOT NULL AND challenge_id IS NOT NULL
            AND challenger IS NOT NULL AND bond_usdc_units IS NOT NULL
            AND num_nonnulls(verdict, payee, amount_usdc_units, reason, upheld) = 0
        WHEN 'challenge.resolved' THEN
            task_id IS NOT NULL AND tx IS NOT NULL AND challenge_id IS NOT NULL AND upheld IS NOT NULL
            AND num_nonnulls(verdict, payee, amount_usdc_units, reason, challenger, bond_usdc_units) = 0
        WHEN 'credits.denied' THEN
            task_id IS NULL AND tx IS NULL AND reason IN ('no_credits', 'rate_limited', 'over_value_cap')
            AND num_nonnulls(verdict, payee, amount_usdc_units, challenge_id, challenger,
                             bond_usdc_units, upheld) = 0
        ELSE false
    END)
);

-- The same on-chain event reaching us under a different event_id (the gateway re-reading logs after losing
-- its cursor builds a new envelope) is still one ledger row. Keyed on the transaction, not the envelope.
CREATE UNIQUE INDEX money_events_on_chain
    ON money_events (kind, task_id, tx, (COALESCE(challenge_id, -1)))
    WHERE tx IS NOT NULL;

CREATE INDEX money_events_plan ON money_events (plan_uuid, id);

CREATE FUNCTION money_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'money_events is append-only';
END
$$;

CREATE TRIGGER money_events_append_only BEFORE UPDATE OR DELETE ON money_events
    FOR EACH ROW EXECUTE FUNCTION money_events_append_only();
-- Deliberately not also BEFORE TRUNCATE: this fires for every row-level UPDATE/DELETE an application
-- role could issue, which is the real risk. TRUNCATE needs table-owner privilege the application role
-- isn't granted, and the test suite's own global per-test reset (conftest.py's `client` fixture)
-- legitimately truncates every public table, including this one, between tests.

-- Backfill: events already in the raw log become ledger rows, oldest first, so a deployment that upgrades
-- keeps its history in the run API. Events that name a task or plan this service never knew stay raw-only,
-- as does any number too large for the column (the raw log never limited the digits).
INSERT INTO money_events (event_id, kind, plan_uuid, task_id, tx, verdict, payee, amount_usdc_units, reason,
                          challenge_id, challenger, bond_usdc_units, upheld, received_at)
SELECT e.event_id,
       e.type,
       COALESCE(d.plan_uuid, p.plan_uuid),
       d.task_id,
       e.payload ->> 'tx',
       CASE WHEN e.type = 'verdict.recorded' THEN e.payload ->> 'verdict' END,
       CASE WHEN e.type = 'task.released' THEN lower(e.payload ->> 'to') END,
       CASE WHEN e.type IN ('task.released', 'task.returned')
            THEN (e.payload ->> 'amount_usdc_units')::numeric END,
       CASE WHEN e.type IN ('task.returned', 'credits.denied') THEN e.payload ->> 'reason' END,
       CASE WHEN e.type IN ('challenge.opened', 'challenge.resolved')
            THEN (e.payload ->> 'challenge_id')::numeric END,
       CASE WHEN e.type = 'challenge.opened' THEN lower(e.payload ->> 'challenger') END,
       CASE WHEN e.type = 'challenge.opened' THEN (e.payload ->> 'bond_usdc_units')::numeric END,
       CASE WHEN e.type = 'challenge.resolved' THEN (e.payload ->> 'upheld')::boolean END,
       e.received_at
FROM chain_events_seen e
LEFT JOIN task_dispatches d ON e.type <> 'credits.denied' AND d.task_id = e.payload ->> 'task_id'
LEFT JOIN plans p ON e.type = 'credits.denied' AND p.plan_id = e.payload ->> 'plan_id'
WHERE e.type IN ('receipt.committed', 'verdict.recorded', 'task.released', 'task.returned',
                 'challenge.opened', 'challenge.resolved', 'credits.denied')
  AND COALESCE(d.plan_uuid, p.plan_uuid) IS NOT NULL
  -- "Too large for the column" means too large for a real uint256, not just >78 digits: the column's
  -- own numeric(78,0) capacity (up to 10^78 - 1) is wider than uint256's actual range (up to 2^256 - 1,
  -- also 78 digits), so digit count alone would still let a 78-digit value bigger than any real uint256
  -- through. The regex runs first so a non-numeric payload never reaches the cast beside it.
  AND COALESCE(e.payload ->> 'amount_usdc_units', '0') ~ '^[0-9]{1,78}$'
  AND COALESCE(e.payload ->> 'amount_usdc_units', '0')::numeric
      <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
  AND COALESCE(e.payload ->> 'bond_usdc_units', '0') ~ '^[0-9]{1,78}$'
  AND COALESCE(e.payload ->> 'bond_usdc_units', '0')::numeric
      <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
  AND COALESCE(e.payload ->> 'challenge_id', '0') ~ '^[0-9]{1,78}$'
  AND COALESCE(e.payload ->> 'challenge_id', '0')::numeric
      <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
ORDER BY e.received_at, e.event_id
ON CONFLICT DO NOTHING;
