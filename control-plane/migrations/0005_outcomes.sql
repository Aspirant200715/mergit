-- Plan task O6: which finished jobs this service has already reacted to.
--
-- The worker reports a result by writing straight to `jobs` (status, phi_holds; see
-- control-plane/mergit_worker/jobs.py), never by calling back into this service. `outcome_processed_at`
-- is this service's own marker so a job is retried or escalated exactly once even though the processing
-- loop may see the same finished row again before it commits (two instances, or one instance's own next
-- poll racing a slow transaction).

ALTER TABLE jobs ADD COLUMN outcome_processed_at timestamptz;

CREATE INDEX jobs_unprocessed ON jobs (finished_at)
    WHERE status IN ('done', 'error') AND outcome_processed_at IS NULL;
