use alloy_primitives::{Address, B256, U256};
use mergit_spec::{Bundle, receipt_domain};
use mergit_verifier::{Commitment, Status, verify};
use serde_json::Value;

fn vectors() -> Vec<Value> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../spec/vectors");
    let mut out: Vec<Value> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_name().unwrap() != "ids.json")
        .map(|p| serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap())
        .collect();
    out.sort_by_key(|v| v["name"].as_str().unwrap().to_string());
    out
}

fn commitment(v: &Value) -> Option<Commitment> {
    if v.is_null() {
        return None;
    }
    let h = |k: &str| v[k].as_str().unwrap().parse::<B256>().unwrap();
    Some(Commitment {
        root: h("root"),
        terminal_hash: h("terminal_hash"),
        body_hash: h("body_hash"),
        cost_micros: v["cost_micros"].as_str().unwrap().parse::<U256>().unwrap(),
    })
}

#[test]
fn every_vector_verifies_as_expected() {
    let all = vectors();
    assert!(
        all.len() >= 19,
        "expected at least 19 vectors, found {}",
        all.len()
    );
    for v in all {
        let name = v["name"].as_str().unwrap();
        let bundle: Bundle = serde_json::from_value(v["bundle"].clone()).unwrap();
        let domain = receipt_domain(
            v["domain"]["chain_id"].as_u64().unwrap(),
            v["domain"]["registry"].as_str().unwrap().parse().unwrap(),
        );
        let signer: Address = v["signer"].as_str().unwrap().parse().unwrap();
        let report = verify(
            &bundle,
            &domain,
            Some(signer),
            commitment(&v["commitment"]).as_ref(),
        );
        let got = serde_json::to_value(&report).unwrap();
        assert_eq!(got["status"], v["expect"]["status"], "{name}: {got}");
        let reasons: Vec<&str> = got["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap())
            .collect();
        let want: Vec<&str> = v["expect"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap())
            .collect();
        for w in &want {
            assert!(reasons.contains(w), "{name}: missing {w} in {reasons:?}");
        }
        if v["expect"]["status"] == "invalid" {
            // A forged vector breaks one rule; any other reason means the vector or the verifier is wrong.
            let extra: Vec<_> = reasons
                .iter()
                .filter(|r| !want.contains(r) && **r != "UNATTESTED")
                .collect();
            assert!(extra.is_empty(), "{name}: unexpected reasons {extra:?}");
        }
    }
}

#[test]
fn unattested_receipt_is_never_reported_valid_attested() {
    for v in vectors() {
        let bundle: Bundle = serde_json::from_value(v["bundle"].clone()).unwrap();
        let domain = receipt_domain(84532, Address::with_last_byte(1));
        let report = verify(&bundle, &domain, None, None);
        assert!(matches!(
            report.status,
            Status::UnattestedValid | Status::Invalid
        ));
    }
}

#[test]
fn honest_vector_reports_phi_holds() {
    let v = vectors()
        .into_iter()
        .find(|v| v["name"] == "valid_three_steps")
        .unwrap();
    let bundle: Bundle = serde_json::from_value(v["bundle"].clone()).unwrap();
    let report = verify(
        &bundle,
        &receipt_domain(84532, Address::with_last_byte(1)),
        None,
        None,
    );
    assert_eq!(report.phi_holds, Some(true));
}
