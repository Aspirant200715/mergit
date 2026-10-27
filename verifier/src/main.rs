//! mergit-verify <bundle.json> --chain-id <id> --registry <address> [--signer <address>]
//! Prints the report as JSON. Exit 0: unattested_valid. Exit 1: invalid. Exit 2: unreadable input or usage.

use mergit_spec::{Bundle, receipt_domain};
use mergit_verifier::{Status, verify};
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("mergit-verify: {e}");
            eprintln!(
                "usage: mergit-verify <bundle.json> --chain-id <id> --registry <address> [--signer <address>]"
            );
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<bool, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let path = args
        .first()
        .filter(|a| !a.starts_with("--"))
        .ok_or("missing bundle path")?;
    let chain_id: u64 = flag("--chain-id")
        .ok_or("missing --chain-id")?
        .parse()
        .map_err(|_| "bad --chain-id")?;
    let registry = flag("--registry")
        .ok_or("missing --registry")?
        .parse()
        .map_err(|_| "bad --registry")?;
    let signer = flag("--signer")
        .map(|s| s.parse())
        .transpose()
        .map_err(|_| "bad --signer")?;

    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    // Accept a bare bundle or a test vector that wraps one under "bundle".
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    let bundle: Bundle = serde_json::from_value(value.get("bundle").cloned().unwrap_or(value))
        .map_err(|e| format!("{path}: {e}"))?;

    let report = verify(&bundle, &receipt_domain(chain_id, registry), signer, None);
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("report serialises")
    );
    Ok(report.status == Status::UnattestedValid)
}
