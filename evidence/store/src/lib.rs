//! Content-addressed receipt store. Accepts a bundle only when its body hash and every blob digest check
//! out, serves bundles by body hash and by task, and keeps at most one bundle per task. It does not judge
//! whether a receipt is valid; the validator does.

mod disk;

use alloy_primitives::{B256, keccak256};
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, put};
use axum::{Json, Router};
use base64::{Engine, engine::general_purpose::STANDARD};
use disk::{Disk, Stored};
use mergit_spec::{Bundle, body_hash};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

/// Largest single blob accepted (spec: 8 MiB).
pub const MAX_BLOB_BYTES: usize = 8 * 1024 * 1024;
/// Largest request body accepted (spec: 64 MiB).
pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// The store with no write protection, for tests and local runs. Hosts use `router_with_token`.
pub fn router(data_dir: PathBuf) -> Router {
    build(data_dir, None)
}

/// The store where uploads need `Authorization: Bearer <token>` (the workers' shared secret). Reads stay public,
/// and the validator reads by body hash, so an upload slot cannot be used to swap a receipt.
pub fn router_with_token(data_dir: PathBuf, token: Option<String>) -> Router {
    build(data_dir, token)
}

fn build(data_dir: PathBuf, token: Option<String>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET]);
    let writes = Router::new()
        .route("/v0/bundles", put(put_bundle))
        .route_layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let token = token.clone();
                async move {
                    let presented = req
                        .headers()
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.strip_prefix("Bearer "));
                    match (&token, presented) {
                        (None, _) => next.run(req).await,
                        (Some(t), Some(p))
                            if t.len() == p.len()
                                && t.bytes().zip(p.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y))
                                    == 0 =>
                        {
                            next.run(req).await
                        }
                        _ => error(StatusCode::UNAUTHORIZED, "UNAUTHORIZED"),
                    }
                }
            },
        ));
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .merge(writes)
        .route("/v0/bundles/{body_hash}", get(get_by_body_hash))
        .route("/v0/tasks/{task_id}/bundle", get(get_by_task))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(cors)
        .with_state(Arc::new(Disk::new(data_dir)))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

async fn put_bundle(State(disk): State<Arc<Disk>>, body: axum::body::Bytes) -> Response {
    let Ok(bundle) = serde_json::from_slice::<Bundle>(&body) else {
        return error(StatusCode::BAD_REQUEST, "MALFORMED_BUNDLE");
    };
    for (digest, b64) in &bundle.blobs {
        match STANDARD.decode(b64) {
            Ok(bytes) if bytes.len() > MAX_BLOB_BYTES => {
                return error(StatusCode::PAYLOAD_TOO_LARGE, "BLOB_TOO_LARGE");
            }
            Ok(bytes) if keccak256(&bytes) == *digest => {}
            _ => return error(StatusCode::BAD_REQUEST, "BLOB_DIGEST_MISMATCH"),
        }
    }
    if body_hash(&bundle.receipt) != bundle.receipt.body_hash {
        return error(StatusCode::BAD_REQUEST, "BODY_HASH_MISMATCH");
    }
    let (bh, task) = (bundle.receipt.body_hash, bundle.receipt.header.task_id);
    let json = serde_json::to_vec(&bundle).expect("bundle serialises");
    let reply = Json(json!({ "body_hash": bh, "task_id": task }));
    match disk.store(task, bh, &json).await {
        Ok(Stored::New) => (StatusCode::CREATED, reply).into_response(),
        Ok(Stored::Same) => (StatusCode::OK, reply).into_response(),
        Ok(Stored::Conflict) => error(StatusCode::CONFLICT, "TASK_HAS_ANOTHER_BUNDLE"),
        Err(e) => {
            tracing::error!(error = %e, "store write failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "STORE_WRITE_FAILED")
        }
    }
}

async fn get_by_body_hash(State(disk): State<Arc<Disk>>, Path(h): Path<String>) -> Response {
    let Ok(h) = h.parse::<B256>() else {
        return error(StatusCode::BAD_REQUEST, "BAD_HASH");
    };
    serve(disk.bundle(h).await)
}

async fn get_by_task(State(disk): State<Arc<Disk>>, Path(t): Path<String>) -> Response {
    let Ok(t) = t.parse::<B256>() else {
        return error(StatusCode::BAD_REQUEST, "BAD_HASH");
    };
    serve(disk.bundle_for_task(t).await)
}

fn serve(found: std::io::Result<Option<Vec<u8>>>) -> Response {
    match found {
        Ok(Some(bytes)) => (
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            bytes,
        )
            .into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "NOT_FOUND"),
        Err(e) => {
            tracing::error!(error = %e, "store read failed");
            error(StatusCode::INTERNAL_SERVER_ERROR, "STORE_READ_FAILED")
        }
    }
}
