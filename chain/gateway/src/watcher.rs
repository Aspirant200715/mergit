//! Reads contract logs in block order and turns them into outgoing events, recording what the keeper needs.

use crate::AppState;
use crate::outbox::{enqueue_audit, enqueue_orchestrator};
use alloy::primitives::Address;
use alloy::providers::Provider;
use alloy::rpc::types::{Filter, Log};
use alloy::sol_types::SolEvent;
use mergit_chain_client::abi::{ChallengeManager, Escrow, ReceiptRegistry};
use serde_json::{Value, json};

/// Default for `Config::max_log_range` (public RPCs cap getLogs ranges).
pub const MAX_RANGE: u64 = 2000;

const VERDICTS: [&str; 4] = ["none", "pass", "fail", "invalid"];
const REASONS: [&str; 4] = ["fail", "invalid", "deadline", "challenge"];
const TIERS: [&str; 2] = ["staked", "onboarding"];

/// One round: reads confirmed logs since the cursor, queues events, advances the cursor. Returns the number
/// of logs handled.
pub async fn tick(s: &AppState) -> anyhow::Result<usize> {
    let p = &s.contracts.provider;
    let latest = p.get_block_number().await?;
    let Some(safe) = latest.checked_sub(s.cfg.confirmations) else {
        return Ok(0);
    };
    let from: u64 = sqlx::query_scalar::<_, i64>("select block from watcher_cursor where id = 1")
        .fetch_optional(&s.db)
        .await?
        .map(|b| b as u64)
        .unwrap_or(s.cfg.start_block.unwrap_or(s.deployment.deploy_block));
    if from > safe {
        return Ok(0);
    }
    let to = safe.min(from + s.cfg.max_log_range.max(1) - 1);
    let mut addresses: Vec<Address> = vec![s.deployment.escrow, s.deployment.receipt_registry];
    if s.deployment.challenge_manager != Address::ZERO {
        addresses.push(s.deployment.challenge_manager);
    }
    let logs = p
        .get_logs(
            &Filter::new()
                .address(addresses)
                .from_block(from)
                .to_block(to),
        )
        .await?;

    let mut db = s.db.begin().await?;
    for log in &logs {
        handle(&mut db, s, log).await?;
    }
    sqlx::query("insert into watcher_cursor (id, block) values (1, $1) on conflict (id) do update set block = $1")
        .bind((to + 1) as i64)
        .execute(&mut *db)
        .await?;
    db.commit().await?;
    Ok(logs.len())
}

async fn handle(db: &mut sqlx::PgConnection, s: &AppState, log: &Log) -> anyhow::Result<()> {
    let tx = log.transaction_hash.unwrap_or_default();
    let Some(topic) = log.topic0() else {
        return Ok(());
    };
    let emit = |ty: &'static str, payload: Value| (ty, payload);
    let out = match *topic {
        Escrow::PlanFunded::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::PlanFunded>()?.inner.data;
            let tier = TIERS.get(e.tier as usize).copied().unwrap_or("staked");
            sqlx::query("insert into plans (plan_id, tier) values ($1, $2) on conflict (plan_id) do nothing")
                .bind(e.planId.to_string())
                .bind(tier)
                .execute(&mut *db)
                .await?;
            emit(
                "plan.funded",
                json!({"plan_id": e.planId, "requester": e.requester, "amount_usdc_units": e.amount.to_string(), "tier": tier, "tx": tx}),
            )
        }
        Escrow::TaskLocked::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::TaskLocked>()?.inner.data;
            sqlx::query("insert into tasks (task_id, plan_id, deadline) values ($1, $2, $3) on conflict (task_id) do nothing")
                .bind(e.taskId.to_string())
                .bind(e.planId.to_string())
                .bind(e.deadline as i64)
                .execute(&mut *db)
                .await?;
            emit("task.escrowed", json!({"task_id": e.taskId, "tx": tx}))
        }
        ReceiptRegistry::ReceiptCommitted::SIGNATURE_HASH => {
            let e = log
                .log_decode::<ReceiptRegistry::ReceiptCommitted>()?
                .inner
                .data;
            // A re-read of the same logs must not list a receipt twice, and a task commits once, so the first wins.
            sqlx::query(
                "insert into commitments (task_id, agent_id, root, body_hash, cost_micros, block, log_index, tx)
                 values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (task_id) do nothing",
            )
            .bind(e.taskId.to_string())
            .bind(e.agentId.to_string())
            .bind(e.root.to_string())
            .bind(e.bodyHash.to_string())
            .bind(i64::try_from(e.costMicros).unwrap_or(i64::MAX))
            .bind(log.block_number.unwrap_or_default() as i64)
            .bind(log.log_index.unwrap_or_default() as i64)
            .bind(tx.to_string())
            .execute(&mut *db)
            .await?;
            enqueue_audit(&mut *db, &s.cfg, &e.taskId.to_string()).await?;
            emit("receipt.committed", json!({"task_id": e.taskId, "tx": tx}))
        }
        Escrow::VerdictRecorded::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::VerdictRecorded>()?.inner.data;
            emit(
                "verdict.recorded",
                json!({"task_id": e.taskId, "verdict": VERDICTS.get(e.verdict as usize).copied().unwrap_or("none"), "tx": tx}),
            )
        }
        Escrow::TaskReleased::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::TaskReleased>()?.inner.data;
            settle(db, &e.taskId.to_string()).await?;
            emit(
                "task.released",
                json!({"task_id": e.taskId, "to": e.payee, "amount_usdc_units": e.amount.to_string(), "tx": tx}),
            )
        }
        Escrow::TaskReturned::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::TaskReturned>()?.inner.data;
            settle(db, &e.taskId.to_string()).await?;
            emit(
                "task.returned",
                json!({"task_id": e.taskId, "amount_usdc_units": e.amount.to_string(), "reason": REASONS.get(e.reason as usize).copied().unwrap_or("fail"), "tx": tx}),
            )
        }
        ChallengeManager::ChallengeOpened::SIGNATURE_HASH => {
            let e = log
                .log_decode::<ChallengeManager::ChallengeOpened>()?
                .inner
                .data;
            emit(
                "challenge.opened",
                json!({"task_id": e.taskId, "challenge_id": e.challengeId.to_string(), "challenger": e.challenger, "bond_usdc_units": e.bond.to_string(), "tx": tx}),
            )
        }
        ChallengeManager::ChallengeResolved::SIGNATURE_HASH => {
            let e = log
                .log_decode::<ChallengeManager::ChallengeResolved>()?
                .inner
                .data;
            emit(
                "challenge.resolved",
                json!({"task_id": e.taskId, "challenge_id": e.challengeId.to_string(), "upheld": e.upheld, "tx": tx}),
            )
        }
        Escrow::PlanClosed::SIGNATURE_HASH => {
            let e = log.log_decode::<Escrow::PlanClosed>()?.inner.data;
            crate::credits::restore(
                &mut *db,
                &e.planId.to_string(),
                e.refund.saturating_to::<u64>(),
            )
            .await?;
            return Ok(());
        }
        _ => return Ok(()),
    };
    enqueue_orchestrator(&mut *db, &s.cfg, out.0, out.1).await?;
    Ok(())
}

async fn settle(db: &mut sqlx::PgConnection, task_id: &str) -> sqlx::Result<()> {
    sqlx::query("update tasks set settled = true where task_id = $1")
        .bind(task_id)
        .execute(db)
        .await
        .map(|_| ())
}
