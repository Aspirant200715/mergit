import type { Report } from "./report";

type WasmModule = {
  default: (input?: unknown) => Promise<unknown>;
  verify_bundle: (bundle: string, chainId: bigint, registry: string, signer?: string, commitment?: string) => string;
};

// Built by `wasm-pack build verifier/wasm --target web --out-dir ../../frontend/src/verifier/pkg`. When the package
// has not been built, this glob is empty and verification reports itself unavailable instead of failing the build.
const builds = import.meta.glob<WasmModule>("./pkg/mergit_verifier_wasm.js");

let ready: Promise<WasmModule | null> | null = null;

function load(): Promise<WasmModule | null> {
  ready ??= (async () => {
    const importer = Object.values(builds)[0];
    if (!importer) return null;
    const mod = await importer();
    await mod.default();
    return mod;
  })();
  return ready;
}

/** What the chain holds for the receipt; the verifier reports COMMITMENT_MISMATCH if the bundle differs. */
export type ChainCommitment = { root: string; terminal_hash: string; body_hash: string; cost_micros: string };

/** Verifies a bundle in the browser with the same Rust code as the CLI. `null` if the verifier is not built. */
export async function verifyInBrowser(
  bundleJson: string,
  chainId: number,
  registry: string,
  signer?: string,
  commitment?: ChainCommitment,
): Promise<Report | null> {
  const mod = await load();
  if (!mod) return null;
  const c = commitment ? JSON.stringify(commitment) : undefined;
  return JSON.parse(mod.verify_bundle(bundleJson, BigInt(chainId), registry, signer, c)) as Report;
}
