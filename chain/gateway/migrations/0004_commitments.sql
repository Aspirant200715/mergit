-- Receipts committed on chain, as the watcher saw them. A browser cannot scan the chain itself (public RPCs allow a few
-- hundred blocks per getLogs, and the chain has moved hundreds of thousands since deploy), so the gateway lists them.
-- The list is a convenience: the web app still reads each commitment from the ReceiptRegistry before trusting it.
create table commitments (
    task_id     text primary key,
    agent_id    text not null,
    root        text not null,
    body_hash   text not null,
    cost_micros bigint not null,
    block       bigint not null,
    log_index   bigint not null,
    tx          text not null
);
create index commitments_newest on commitments (block desc, log_index desc);
