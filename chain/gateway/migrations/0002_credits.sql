-- Free credits for the onboarding tier. Amounts in USDC base units.
create table credits (
    address text primary key,            -- lowercase 0x address
    granted bigint not null,
    spent bigint not null default 0,
    plans_day date not null default current_date,
    plans_today int not null default 0
);

-- Plans funded from credits, so a refund on close goes back to the right ledger.
create table credit_plans (
    plan_id text primary key,
    address text not null,
    amount bigint not null
);
