//! Outgoing events, delivered in order per target with backoff, for up to 10 minutes each.

use crate::{AppState, Config};
use serde_json::{Value, json};
use sqlx::{PgExecutor, PgPool, Row};
use uuid::Uuid;

pub const GIVE_UP_AFTER_SECS: i64 = 600;

fn now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Queues an S3 event for the orchestrator.
pub async fn enqueue_orchestrator<'e>(
    db: impl PgExecutor<'e>,
    cfg: &Config,
    ty: &str,
    payload: Value,
) -> sqlx::Result<()> {
    let id = Uuid::new_v4();
    let body = json!({"event_id": id, "type": ty, "at": now(), "payload": payload});
    insert(
        db,
        "orchestrator",
        &format!("{}/v0/chain-events", cfg.orchestrator_url),
        id,
        body,
    )
    .await
}

/// Queues an audit request for the validator.
pub async fn enqueue_audit<'e>(
    db: impl PgExecutor<'e>,
    cfg: &Config,
    task_id: &str,
) -> sqlx::Result<()> {
    insert(
        db,
        "validator",
        &format!("{}/v0/audit", cfg.validator_url),
        Uuid::new_v4(),
        json!({"task_id": task_id}),
    )
    .await
}

async fn insert<'e>(
    db: impl PgExecutor<'e>,
    target: &str,
    url: &str,
    id: Uuid,
    body: Value,
) -> sqlx::Result<()> {
    sqlx::query("insert into outbox (target, url, event_id, body) values ($1, $2, $3, $4)")
        .bind(target)
        .bind(url)
        .bind(id)
        .bind(body)
        .execute(db)
        .await
        .map(|_| ())
}

/// Delivers rows strictly in order per target: the oldest undelivered row goes first, and nothing behind it
/// is sent while it waits out a backoff. A 2xx delivers; a 4xx is a permanent refusal (logged, skipped); a 5xx or
/// a transport error backs off. After 10 minutes a row is given up. Returns how many were delivered.
pub async fn deliver_due(s: &AppState, http: &reqwest::Client) -> anyhow::Result<usize> {
    let mut delivered = 0;
    for target in ["orchestrator", "validator"] {
        let rows = sqlx::query(
            "select id, url, event_id, body, next_at <= now() as due,
                    created_at < now() - make_interval(secs => $2) as expired
             from outbox where target = $1 and delivered_at is null and failed_at is null
             order by id limit 200",
        )
        .bind(target)
        .bind(GIVE_UP_AFTER_SECS as f64)
        .fetch_all(&s.db)
        .await?;
        for row in rows {
            if !row.get::<bool, _>("due") {
                break; // the head of the queue is backing off; later rows wait behind it
            }
            let id: i64 = row.get("id");
            let mut request = http.post(row.get::<String, _>("url")).header(
                "Idempotency-Key",
                row.get::<Uuid, _>("event_id").to_string(),
            );
            let token = match target {
                "validator" => &s.cfg.audit_token,
                _ => &s.cfg.chain_events_token,
            };
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            let status = request
                .json(&row.get::<Value, _>("body"))
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await
                .map(|r| r.status());
            match status {
                Ok(st) if st.is_success() => {
                    sqlx::query("update outbox set delivered_at = now() where id = $1")
                        .bind(id)
                        .execute(&s.db)
                        .await?;
                    delivered += 1;
                }
                Ok(st) if st.is_client_error() => {
                    tracing::error!(id, target, %st, "receiver refused an outbox event; it will not be retried");
                    sqlx::query("update outbox set failed_at = now() where id = $1")
                        .bind(id)
                        .execute(&s.db)
                        .await?;
                }
                _ if row.get::<bool, _>("expired") => {
                    tracing::error!(id, target, "giving up on outbox event after 10 minutes");
                    sqlx::query("update outbox set failed_at = now() where id = $1")
                        .bind(id)
                        .execute(&s.db)
                        .await?;
                }
                _ => {
                    sqlx::query(
                        "update outbox set attempts = attempts + 1,
                         next_at = now() + make_interval(secs => least(power(2, attempts + 1), 60)) where id = $1",
                    )
                    .bind(id)
                    .execute(&s.db)
                    .await?;
                    break;
                }
            }
        }
    }
    Ok(delivered)
}

/// Makes every pending row due now. For tests and for an operator nudging a stuck queue.
pub async fn make_all_due(s: &AppState) -> sqlx::Result<()> {
    make_due(&s.db).await
}

async fn make_due(db: &PgPool) -> sqlx::Result<()> {
    sqlx::query(
        "update outbox set next_at = now() where delivered_at is null and failed_at is null",
    )
    .execute(db)
    .await
    .map(|_| ())
}
