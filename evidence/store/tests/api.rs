use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use base64::{Engine, engine::general_purpose::STANDARD};
use http_body_util::BodyExt;
use mergit_store::router;
use serde_json::Value;
use tower::ServiceExt;

fn vector_bundle(name: &str) -> Value {
    let p = format!(
        "{}/../../spec/vectors/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    v["bundle"].clone()
}

async fn send(
    app: &axum::Router,
    req: Request<Body>,
) -> (StatusCode, Value, axum::http::HeaderMap) {
    let res = app.clone().oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        headers,
    )
}

fn put(bundle: &Value) -> Request<Body> {
    Request::put("/v0/bundles")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bundle.to_string()))
        .unwrap()
}

fn get(path: &str) -> Request<Body> {
    Request::get(path)
        .header(header::ORIGIN, "https://app.mergit.site")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn stores_and_serves_by_body_hash_and_task() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let b = vector_bundle("valid_three_steps");
    let (status, body, _) = send(&app, put(&b)).await;
    assert_eq!(status, StatusCode::CREATED);
    let bh = b["receipt"]["body_hash"].as_str().unwrap();
    let task = b["receipt"]["header"]["task_id"].as_str().unwrap();
    assert_eq!(body["body_hash"], bh);
    assert_eq!(body["task_id"], task);
    assert_eq!(send(&app, get(&format!("/v0/bundles/{bh}"))).await.1, b);
    assert_eq!(
        send(&app, get(&format!("/v0/tasks/{task}/bundle"))).await.1,
        b
    );
}

#[tokio::test]
async fn unknown_bundle_is_404() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let missing = format!("0x{}", "0".repeat(64));
    assert_eq!(
        send(&app, get(&format!("/v0/bundles/{missing}"))).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, get(&format!("/v0/tasks/{missing}/bundle")))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, get("/v0/bundles/not-a-hash")).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn same_bundle_twice_is_200() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let b = vector_bundle("valid_three_steps");
    assert_eq!(send(&app, put(&b)).await.0, StatusCode::CREATED);
    assert_eq!(send(&app, put(&b)).await.0, StatusCode::OK);
}

#[tokio::test]
async fn rejects_body_hash_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let (status, body, _) = send(&app, put(&vector_bundle("body_hash_mismatch"))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "BODY_HASH_MISMATCH");
}

#[tokio::test]
async fn rejects_blob_digest_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let (status, body, _) = send(&app, put(&vector_bundle("blob_digest_mismatch"))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "BLOB_DIGEST_MISMATCH");
}

#[tokio::test]
async fn rejects_blob_over_limit() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let mut b = vector_bundle("valid_three_steps");
    let big = vec![b'x'; 8 * 1024 * 1024 + 1];
    let digest = alloy_primitives::keccak256(&big).to_string();
    b["blobs"][digest] = Value::String(STANDARD.encode(&big));
    let (status, body, _) = send(&app, put(&b)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body["error"], "BLOB_TOO_LARGE");
}

#[tokio::test]
async fn rejects_malformed_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let req = Request::put("/v0/bundles")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{\"receipt\":1}"))
        .unwrap();
    assert_eq!(send(&app, req).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn conflicting_bundle_for_same_task_is_409() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    assert_eq!(
        send(&app, put(&vector_bundle("valid_three_steps"))).await.0,
        StatusCode::CREATED
    );
    // Same task id, different (self-consistent) body: a second receipt for one task is refused.
    let (status, body, _) = send(&app, put(&vector_bundle("root_mismatch"))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "TASK_HAS_ANOTHER_BUNDLE");
}

#[tokio::test]
async fn get_allows_any_origin() {
    let dir = tempfile::tempdir().unwrap();
    let app = router(dir.path().into());
    let b = vector_bundle("valid_three_steps");
    send(&app, put(&b)).await;
    let (_, _, headers) = send(
        &app,
        get(&format!(
            "/v0/bundles/{}",
            b["receipt"]["body_hash"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(
        headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
        "*"
    );
}

#[tokio::test]
async fn healthz_is_ok() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        send(&router(dir.path().into()), get("/healthz")).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn put_requires_the_write_token_when_configured() {
    let dir = tempfile::tempdir().unwrap();
    let app = mergit_store::router_with_token(dir.path().into(), Some("store-secret".into()));
    let b = vector_bundle("valid_three_steps");
    assert_eq!(
        send(&app, put(&b)).await.0,
        StatusCode::UNAUTHORIZED,
        "anyone else is refused"
    );
    let authed = Request::put("/v0/bundles")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, "Bearer store-secret")
        .body(Body::from(b.to_string()))
        .unwrap();
    assert_eq!(send(&app, authed).await.0, StatusCode::CREATED);
    let bh = b["receipt"]["body_hash"].as_str().unwrap();
    assert_eq!(
        send(&app, get(&format!("/v0/bundles/{bh}"))).await.0,
        StatusCode::OK,
        "reads stay public"
    );
}
