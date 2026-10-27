//! The validator: decides `pass`, `fail` or `invalid` for a committed receipt and records it on chain.
//!
//! Audits are drawn with probability `p` (onboarding-tier tasks always). A drawn audit reads the bundle from
//! the receipt store, verifies it against the on-chain commitment and the agent's registered runtime key, and
//! maps the report to a verdict: invalid receipt → `invalid`; Φ holds → `pass`; otherwise `fail`. A body the
//! store does not have is `fail` (data availability); a store that cannot be reached gives no verdict yet.

use alloy::primitives::{Address, B256, U256, keccak256};
use alloy::providers::Provider;
use alloy::rpc::types::Filter;
use alloy::sol_types::SolEvent;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use mergit_chain_client::abi::ReceiptRegistry;
use mergit_chain_client::{Contracts, Deployment};
use mergit_spec::{Bundle, receipt_domain};
use mergit_verifier::{Commitment, Reason, Status, verify};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const PASS: u8 = 1;
const FAIL: u8 = 2;
const INVALID: u8 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// A verdict was recorded on chain.
    Recorded(&'static str),
    /// The audit was not drawn; the task settles when its window ends.
    NotDrawn,
    /// The task already has a verdict or is no longer locked.
    AlreadySettled,
}

#[derive(Clone)]
pub struct AppState {
    pub contracts: Arc<Contracts>,
    pub deployment: Deployment,
    pub store_url: String,
    pub audit_p: f64,
    pub data_dir: PathBuf,
    /// Shared secret the gateway sends on /v0/audit. With `None`, audit requests are refused.
    pub audit_token: Option<String>,
    http: reqwest::Client,
    records: Arc<Mutex<HashMap<B256, Value>>>,
    tx_lock: Arc<tokio::sync::Mutex<()>>,
}

impl AppState {
    pub fn new(
        contracts: Contracts,
        deployment: Deployment,
        store_url: String,
        audit_p: f64,
        data_dir: PathBuf,
    ) -> Self {
        let records = load_records(&data_dir);
        Self {
            contracts: Arc::new(contracts),
            deployment,
            store_url,
            audit_p,
            data_dir,
            audit_token: None,
            http: reqwest::Client::new(),
            records: Arc::new(Mutex::new(records)),
            tx_lock: Default::default(),
        }
    }

    pub fn with_token(mut self, token: &str) -> Self {
        self.audit_token = Some(token.into());
        self
    }

    /// The latest audit record for a task: `{task_id, drawn, verdict, report, tx}`.
    pub fn record(&self, task: B256) -> Option<Value> {
        self.records.lock().unwrap().get(&task).cloned()
    }

    fn save(&self, task: B256, record: Value) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.data_dir)?;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.data_dir.join("audits.jsonl"))?;
        writeln!(f, "{record}")?;
        self.records.lock().unwrap().insert(task, record);
        Ok(())
    }
}

fn load_records(dir: &std::path::Path) -> HashMap<B256, Value> {
    let Ok(text) = std::fs::read_to_string(dir.join("audits.jsonl")) else {
        return HashMap::new();
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|v| Some((v["task_id"].as_str()?.parse().ok()?, v)))
        .collect()
}

enum Body {
    Found(Box<Bundle>),
    Unreadable,
    Missing,
}

/// Fetches the bundle by the body hash committed on chain. Content-addressed, so nobody can occupy the slot
/// with another bundle. A transport error (including a body cut off halfway) is an error, never a verdict.
async fn fetch(s: &AppState, body_hash: B256) -> anyhow::Result<Body> {
    let res = s
        .http
        .get(format!("{}/v0/bundles/{body_hash}", s.store_url))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await?;
    match res.status() {
        reqwest::StatusCode::NOT_FOUND => Ok(Body::Missing),
        st if st.is_success() => {
            let bytes = res.bytes().await?;
            Ok(serde_json::from_slice::<Bundle>(&bytes)
                .map(|b| Body::Found(Box::new(b)))
                .unwrap_or(Body::Unreadable))
        }
        st => anyhow::bail!("receipt store answered {st}"),
    }
}

/// Whether the receipt itself says Φ failed. Cheap to audit, so such receipts are always audited.
fn self_reports_failure(b: &Bundle) -> bool {
    use base64::Engine;
    let Some(last) = b.receipt.steps.last() else {
        return true;
    };
    b.blobs
        .get(&last.output_digest)
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .and_then(|bytes| serde_json::from_slice::<mergit_spec::PhiResult>(&bytes).ok())
        .is_none_or(|r| !r.holds)
}

/// Audits one task. Errors (no verdict) only when the chain or the store cannot be reached.
pub async fn audit_task(s: &AppState, task: B256) -> anyhow::Result<Outcome> {
    let escrow = &s.contracts.escrow;
    let t = escrow.taskOf(task).call().await?;
    if t.state != 1 || t.verdict != 0 {
        return Ok(Outcome::AlreadySettled);
    }
    let c = s.contracts.registry.commitmentOf(task).call().await?;
    if c.committedAt == 0 {
        anyhow::bail!("task {task} has no commitment yet");
    }
    if s.record(task).is_some_and(|r| r["drawn"] == false) {
        return Ok(Outcome::NotDrawn);
    }
    let plan = escrow.planOf(t.planId).call().await?;
    let onboarding = plan.tier == 1;
    let body = fetch(s, c.bodyHash).await?;
    let failing = !matches!(&body, Body::Found(b) if !self_reports_failure(b));
    let drawn = onboarding || failing || s.audit_p >= 1.0 || rand::random::<f64>() < s.audit_p;
    if !drawn {
        // Marked on chain: only a task the validator chose not to audit may release when its window ends.
        let _one_at_a_time = s.tx_lock.lock().await;
        escrow
            .markNotDrawn(task)
            .send()
            .await?
            .get_receipt()
            .await?;
        s.save(task, json!({"task_id": task, "drawn": false}))?;
        return Ok(Outcome::NotDrawn);
    }

    // The category is only known from the receipt header; without a readable body it is recorded as zero.
    let mut category = B256::ZERO;
    let (verdict, report) = match body {
        Body::Missing => (
            FAIL,
            json!({"status": "unavailable", "reasons": ["BODY_UNAVAILABLE"]}),
        ),
        Body::Unreadable => (
            INVALID,
            json!({"status": "invalid", "reasons": ["MALFORMED_BUNDLE"]}),
        ),
        Body::Found(bundle) => {
            category = keccak256(bundle.receipt.header.category.as_bytes());
            let key = s.contracts.identity.runtimeKeyOf(t.agentId).call().await?;
            let commitment = Commitment {
                root: c.root,
                terminal_hash: c.terminalHash,
                body_hash: c.bodyHash,
                cost_micros: c.costMicros,
            };
            let domain = receipt_domain(s.deployment.chain_id, s.deployment.receipt_registry);
            let mut report = verify(&bundle, &domain, Some(key), Some(&commitment));
            // The receipt must be for this task as the chain records it: the approved Φ, plan, agent, requester.
            let h = &bundle.receipt.header;
            if h.phi_hash != escrow.phiHashOf(task).call().await? {
                report.reasons.push(Reason::PhiHashMismatch);
            }
            if h.plan_id != t.planId
                || h.agent_id != t.agentId.to_string()
                || h.requester != plan.requester
            {
                report.reasons.push(Reason::CommitmentMismatch);
            }
            report.reasons.sort();
            report.reasons.dedup();
            if report.reasons.iter().any(|r| *r != Reason::Unattested) {
                report.status = Status::Invalid;
            }
            let v = match (report.status, report.phi_holds) {
                (Status::Invalid, _) => INVALID,
                (_, Some(true)) => PASS,
                _ => FAIL,
            };
            (v, serde_json::to_value(&report)?)
        }
    };

    let tx = {
        let _one_at_a_time = s.tx_lock.lock().await;
        if escrow.taskOf(task).call().await?.verdict != 0 {
            return Ok(Outcome::AlreadySettled);
        }
        escrow
            .recordVerdict(task, verdict)
            .send()
            .await?
            .get_receipt()
            .await?
            .transaction_hash
    };
    let name = match verdict {
        PASS => "pass",
        FAIL => "fail",
        _ => "invalid",
    };
    let anchored = anchor(
        s,
        task,
        t.agentId,
        category,
        verdict == PASS,
        c.costMicros,
        onboarding,
    )
    .await;
    s.save(
        task,
        json!({"task_id": task, "drawn": true, "verdict": name, "report": report, "tx": tx, "anchored": anchored}),
    )?;
    tracing::info!(%task, verdict = name, "verdict recorded");
    Ok(Outcome::Recorded(name))
}

/// Records the audited outcome in ReputationAnchor (source 0: an audit). Only audited outcomes are ever
/// recorded (invariant 4); the tier is recorded so onboarding history can be kept out of staked routing.
async fn anchor(
    s: &AppState,
    task: B256,
    agent: U256,
    category: B256,
    success: bool,
    cost: U256,
    onboarding: bool,
) -> bool {
    if s.deployment.reputation_anchor == Address::ZERO {
        return false;
    }
    let call = s.contracts.anchor.record(
        task,
        agent,
        category,
        success,
        cost,
        u8::from(onboarding),
        0,
    );
    match call.send().await {
        Ok(pending) => pending.get_receipt().await.is_ok_and(|r| r.status()),
        Err(e) => {
            tracing::warn!(%task, error = %e, "could not anchor the outcome");
            false
        }
    }
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct CatchUp {
    next_block: Option<u64>,
    pending: BTreeSet<B256>,
}

/// Audits committed tasks that still have no verdict. Logs are scanned once, from a cursor kept in the data
/// directory; tasks whose audit could not run (store or chain unreachable) stay pending and are retried every
/// round. A failed log read stops the scan for this round without losing the cursor. Returns verdicts recorded.
pub async fn catch_up(s: &AppState) -> anyhow::Result<usize> {
    let path = s.data_dir.join("catchup.json");
    let mut state: CatchUp = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let p = &s.contracts.provider;
    let mut from = state.next_block.unwrap_or(s.deployment.deploy_block);
    if let Ok(latest) = p.get_block_number().await {
        while from <= latest {
            let to = latest.min(from + 1999);
            let filter = Filter::new()
                .address(s.deployment.receipt_registry)
                .event_signature(ReceiptRegistry::ReceiptCommitted::SIGNATURE_HASH)
                .from_block(from)
                .to_block(to);
            let Ok(logs) = p.get_logs(&filter).await else {
                break;
            };
            for log in logs {
                if let Ok(l) = log.log_decode::<ReceiptRegistry::ReceiptCommitted>() {
                    state.pending.insert(l.inner.data.taskId);
                }
            }
            from = to + 1;
        }
    }
    state.next_block = Some(from);

    let mut recorded = 0;
    for task in state.pending.clone() {
        match audit_task(s, task).await {
            Ok(outcome) => {
                if matches!(outcome, Outcome::Recorded(_)) {
                    recorded += 1;
                }
                state.pending.remove(&task);
            }
            Err(e) => tracing::warn!(%task, error = %e, "audit deferred"),
        }
    }
    std::fs::create_dir_all(&s.data_dir)?;
    std::fs::write(&path, serde_json::to_vec(&state)?)?;
    Ok(recorded)
}

/// Refuses `/v0/audit` without the shared token; with no token configured every request is refused.
async fn require_token(
    State(s): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let presented = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    match (&s.audit_token, presented) {
        (Some(t), Some(p))
            if t.len() == p.len()
                && t.bytes().zip(p.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 =>
        {
            next.run(req).await
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "UNAUTHORIZED"})),
        )
            .into_response(),
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route(
            "/v0/audit",
            post(request_audit).route_layer(axum::middleware::from_fn_with_state(
                state.clone(),
                require_token,
            )),
        )
        .route("/v0/audits/{task_id}", get(read_audit))
        .with_state(state)
}

#[derive(serde::Deserialize)]
struct AuditRequest {
    task_id: B256,
}

async fn request_audit(State(s): State<AppState>, Json(r): Json<AuditRequest>) -> Response {
    tokio::spawn(async move {
        if let Err(e) = audit_task(&s, r.task_id).await {
            tracing::warn!(task = %r.task_id, error = %e, "audit deferred; catch-up will retry");
        }
    });
    StatusCode::ACCEPTED.into_response()
}

async fn read_audit(State(s): State<AppState>, Path(task): Path<String>) -> Response {
    let Ok(task) = task.parse::<B256>() else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "BAD_HASH"}))).into_response();
    };
    match s.record(task) {
        Some(r) => Json(r).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "NOT_FOUND"}))).into_response(),
    }
}
