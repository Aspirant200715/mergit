-- A task whose payment has settled may still hold stake until its window runs out (after a passing verdict).
alter table tasks add column finalized boolean not null default false;
