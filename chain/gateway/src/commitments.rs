//! `GET /v0/commitments`: the receipts the watcher has seen committed, newest first. See migrations/0004.

use crate::AppState;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;

const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 1000;

#[derive(Deserialize)]
pub struct Params {
    limit: Option<String>,
}

fn bad(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": "BAD_LIMIT", "message": message})),
    )
        .into_response()
}

pub async fn list(State(s): State<AppState>, Query(q): Query<Params>) -> Response {
    let limit = match q.limit.as_deref() {
        None => DEFAULT_LIMIT,
        Some(text) => match text.parse::<i64>() {
            Ok(n) if n >= 1 => n.min(MAX_LIMIT),
            _ => return bad("limit is a whole number of at least 1"),
        },
    };
    let rows = sqlx::query(
        "select task_id, agent_id, root, body_hash, cost_micros, block, tx from commitments
         order by block desc, log_index desc limit $1",
    )
    .bind(limit)
    .fetch_all(&s.db)
    .await;
    match rows {
        Ok(rows) => Json(
            rows.iter()
                .map(|r| {
                    json!({
                        "task_id": r.get::<String, _>("task_id"),
                        "agent_id": r.get::<String, _>("agent_id"),
                        "root": r.get::<String, _>("root"),
                        "body_hash": r.get::<String, _>("body_hash"),
                        // Strings, like every amount here: a JavaScript number cannot hold every value safely.
                        "cost_micros": r.get::<i64, _>("cost_micros").to_string(),
                        "block": r.get::<i64, _>("block"),
                        "tx": r.get::<String, _>("tx"),
                    })
                })
                .collect::<Vec<Value>>(),
        )
        .into_response(),
        Err(e) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "DB", "message": e.to_string()})),
        )
            .into_response(),
    }
}
