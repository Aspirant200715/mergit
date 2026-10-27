/** The verifier's report, as `spec/receipt-v0.md` defines it. */
export type Report = { status: "unattested_valid" | "invalid"; reasons: string[]; phi_holds: boolean | null };

const REASONS: Record<string, string> = {
  SEQ_GAP: "Step numbers skip or name a step that is not there",
  SEQ_ORDER: "Steps are out of order",
  CHAIN_MISMATCH: "The hash chain does not match the steps",
  ROOT_MISMATCH: "The Merkle root does not match the steps",
  BODY_HASH_MISMATCH: "The receipt body hash does not match its contents",
  BAD_SIGNATURE: "The signature is not from the agent's registered key",
  PHI_HASH_MISMATCH: "The check that ran is not the check that was approved",
  NO_PHI_EVAL: "The task's check was never run",
  PHI_EVAL_NOT_LAST: "The task's check is not the last step",
  PHI_EVAL_NOT_EVIDENCE: "The task's check is not in the evidence set",
  METER_MISMATCH: "The cost totals do not add up",
  BLOB_MISSING: "Evidence the receipt names is missing",
  BLOB_DIGEST_MISMATCH: "Evidence has been altered",
  PHI_RESULT_CONTRADICTED: "The recorded result contradicts the evidence",
  COMMITMENT_MISMATCH: "The receipt differs from what was committed on chain",
  ATTESTATION_UNSUPPORTED: "The receipt claims an attestation this verifier cannot check",
};

export type Described = { tone: "ok" | "bad"; label: string; reasons: string[]; phi: string };

/** Plain-language summary of a report. A v0 receipt is never shown as attested. */
export function describeReport(r: Report): Described {
  const reasons = r.reasons.filter((c) => c !== "UNATTESTED").map((c) => (REASONS[c] ? `${REASONS[c]} (${c})` : c));
  const phi =
    r.phi_holds === true
      ? "The task's check passed"
      : r.phi_holds === false
        ? "The task's check failed"
        : "The task's check result could not be read";
  return r.status === "unattested_valid"
    ? { tone: "ok", label: "Verified, unattested (development key)", reasons, phi }
    : { tone: "bad", label: "Invalid receipt", reasons, phi };
}
