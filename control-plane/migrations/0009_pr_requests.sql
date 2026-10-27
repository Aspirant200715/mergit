-- Plan task O9: the requester's approval to open the pull request, and what happened to it.
-- One row per plan. The API inserts it when the requester approves; the worker (the only process with a
-- GitHub token) claims it, opens the PR and records the branch, commit SHA and PR number.
CREATE TABLE pr_requests (
    plan_uuid     uuid PRIMARY KEY REFERENCES plans,
    requested_by  text NOT NULL,                              -- the approving requester's address
    requested_at  timestamptz NOT NULL DEFAULT now(),
    status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'error')),
    claimed_by    text,
    branch        text,
    commit_sha    text,
    pr_number     integer,
    pr_url        text,
    error         text,
    finished_at   timestamptz
);

CREATE INDEX pr_requests_queue ON pr_requests (requested_at) WHERE status = 'queued';
