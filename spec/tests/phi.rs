use alloy_primitives::keccak256;
use mergit_spec::{PhiResult, Predicate, phi_holds};
use std::collections::BTreeMap;

fn phi(allowed: Option<Vec<&str>>) -> Predicate {
    Predicate {
        kind: "exec/0".into(),
        command: vec!["pytest".into()],
        expected_exit: 0,
        workdir: ".".into(),
        allowed_paths: allowed.map(|v| v.into_iter().map(String::from).collect()),
        artifact_hashes: None,
        timeout_s: 60,
    }
}

fn result(exit: i32, changed: &[&str]) -> PhiResult {
    PhiResult {
        exit_code: exit,
        changed_paths: changed.iter().map(|s| s.to_string()).collect(),
        observed_artifact_hashes: BTreeMap::new(),
        stdout_digest: keccak256(b""),
        holds: true,
    }
}

#[test]
fn holds_when_exit_matches_and_paths_allowed() {
    assert!(phi_holds(
        &phi(Some(vec!["payments/**"])),
        &result(0, &["payments/a/refund.py"])
    ));
}

#[test]
fn fails_on_wrong_exit_code() {
    assert!(!phi_holds(&phi(None), &result(1, &[])));
}

#[test]
fn fails_when_a_changed_path_is_outside_allowed() {
    assert!(!phi_holds(
        &phi(Some(vec!["payments/**"])),
        &result(0, &["payments/x.py", "tests/test_x.py"])
    ));
}

#[test]
fn single_star_does_not_cross_a_slash() {
    assert!(!phi_holds(
        &phi(Some(vec!["payments/*"])),
        &result(0, &["payments/deep/x.py"])
    ));
    assert!(phi_holds(
        &phi(Some(vec!["payments/*"])),
        &result(0, &["payments/x.py"])
    ));
}

#[test]
fn null_allowed_paths_allows_any_path() {
    assert!(phi_holds(&phi(None), &result(0, &["anything/at/all.rs"])));
}

#[test]
fn ignores_the_recorded_holds_field() {
    let mut r = result(1, &[]);
    r.holds = true;
    assert!(!phi_holds(&phi(None), &r));
}

#[test]
fn fails_on_artifact_hash_mismatch_or_missing_artifact() {
    let mut p = phi(None);
    p.artifact_hashes = Some(BTreeMap::from([(
        "out.bin".to_string(),
        keccak256(b"want"),
    )]));
    let mut r = result(0, &[]);
    assert!(!phi_holds(&p, &r), "missing artifact must fail");
    r.observed_artifact_hashes
        .insert("out.bin".into(), keccak256(b"got"));
    assert!(!phi_holds(&p, &r));
    r.observed_artifact_hashes
        .insert("out.bin".into(), keccak256(b"want"));
    assert!(phi_holds(&p, &r));
}

#[test]
fn unparseable_glob_makes_phi_not_hold() {
    assert!(!phi_holds(
        &phi(Some(vec!["payments/[unclosed"])),
        &result(0, &["payments/x"])
    ));
}
