//! Settles what nobody else will, on chain time:
//! - a staked-tier task committed without a verdict once the window is over (release payment and stake);
//! - a task never committed once its deadline has passed (return);
//! - a task paid on a passing verdict once its window has run (finalize: release the stake).

use crate::{AppState, send_tx};
use alloy::eips::BlockNumberOrTag;
use alloy::primitives::{Address, B256};
use alloy::providers::Provider;
use sqlx::Row;

const LOCKED: u8 = 1;
const RELEASED: u8 = 2;
const PASS: u8 = 1;

pub async fn tick(s: &AppState) -> anyhow::Result<()> {
    let now = s
        .contracts
        .provider
        .get_block_by_number(BlockNumberOrTag::Latest)
        .await?
        .map(|b| b.header.timestamp)
        .unwrap_or_default();
    let rows = sqlx::query(
        "select t.task_id, t.deadline, coalesce(p.tier, 'staked') as tier
         from tasks t left join plans p using (plan_id) where not t.settled or not t.finalized",
    )
    .fetch_all(&s.db)
    .await?;
    for row in rows {
        let id: B256 = row.get::<String, _>("task_id").parse()?;
        let task = s.contracts.escrow.taskOf(id).call().await?;
        if task.state == LOCKED {
            settle_locked(
                s,
                id,
                now,
                row.get::<i64, _>("deadline") as u64,
                &row.get::<String, _>("tier"),
                task.verdict,
            )
            .await?;
        } else {
            mark(s, id, "settled").await?;
            finalize(s, id, now, task.state, task.verdict, task.settledAt).await?;
        }
    }
    Ok(())
}

async fn settle_locked(
    s: &AppState,
    id: B256,
    now: u64,
    deadline: u64,
    tier: &str,
    verdict: u8,
) -> anyhow::Result<()> {
    let committed_at = s
        .contracts
        .registry
        .commitmentOf(id)
        .call()
        .await?
        .committedAt;
    let _one_at_a_time = s.tx_lock.lock().await;
    let result = if committed_at != 0 {
        let not_drawn = s.contracts.escrow.notDrawn(id).call().await?;
        if tier == "staked"
            && verdict == 0
            && not_drawn
            && now >= committed_at + s.deployment.window_seconds
        {
            Some(send_tx!(s.contracts.escrow.releaseExpired(id)))
        } else {
            None
        }
    } else if now > deadline + s.cfg.deadline_slack_secs {
        Some(send_tx!(s.contracts.escrow.returnExpired(id)))
    } else {
        None
    };
    if let Some(Err(e)) = result {
        tracing::warn!(task = %id, error = %e, "keeper could not settle task");
    }
    Ok(())
}

async fn finalize(
    s: &AppState,
    id: B256,
    now: u64,
    state: u8,
    verdict: u8,
    settled_at: u64,
) -> anyhow::Result<()> {
    if s.deployment.stake_vault == Address::ZERO {
        return mark(s, id, "finalized").await;
    }
    let stake = s.contracts.vault.taskStake(id).call().await?;
    if stake.operator == Address::ZERO {
        return mark(s, id, "finalized").await; // released with the payment, or slashed
    }
    if stake.held
        || state != RELEASED
        || verdict != PASS
        || now < settled_at + s.deployment.window_seconds
    {
        return Ok(()); // a challenge is open, or the window is still running
    }
    let _one_at_a_time = s.tx_lock.lock().await;
    match send_tx!(s.contracts.escrow.finalize(id)) {
        Ok(_) => mark(s, id, "finalized").await,
        Err(e) => {
            tracing::warn!(task = %id, error = %e, "keeper could not finalize task");
            Ok(())
        }
    }
}

async fn mark(s: &AppState, id: B256, column: &'static str) -> anyhow::Result<()> {
    let sql = match column {
        "settled" => "update tasks set settled = true where task_id = $1",
        _ => "update tasks set finalized = true where task_id = $1",
    };
    sqlx::query(sql).bind(id.to_string()).execute(&s.db).await?;
    Ok(())
}
