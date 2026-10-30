import type { Hash, Hex } from "viem";
import { LIVE } from "../config/live";

export type Commitment = {
  taskId: Hex;
  agentId: bigint;
  root: Hex;
  bodyHash: Hex;
  costMicros: bigint;
  blockNumber: bigint;
  tx: Hash;
};

const HASH = /^0x[0-9a-f]{64}$/;
const UINT = /^[0-9]{1,30}$/;

function field(row: Record<string, unknown>, key: string, ok: (v: unknown) => boolean): unknown {
  const value = row[key];
  if (!ok(value)) throw new Error(`The receipt list has a bad ${key}.`);
  return value;
}

const isHash = (v: unknown) => typeof v === "string" && HASH.test(v);
const isUint = (v: unknown) => typeof v === "string" && UINT.test(v);

/**
 * The gateway's `GET /v0/commitments`, newest first. Every field is checked, and one bad row fails the whole list: a
 * ledger that quietly drops rows would look complete. Each receipt is still read back from the ReceiptRegistry before
 * anything is trusted (see proofs.ts); this list only says where to look.
 */
export function parseCommitments(body: unknown): Commitment[] {
  if (!Array.isArray(body)) throw new Error("The receipt list is not a list.");
  return body.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("The receipt list has a row that is not an object.");
    const row = raw as Record<string, unknown>;
    const block = field(row, "block", (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) as number;
    return {
      taskId: field(row, "task_id", isHash) as Hex,
      agentId: BigInt(field(row, "agent_id", isUint) as string),
      root: field(row, "root", isHash) as Hex,
      bodyHash: field(row, "body_hash", isHash) as Hex,
      costMicros: BigInt(field(row, "cost_micros", isUint) as string),
      blockNumber: BigInt(block),
      tx: field(row, "tx", isHash) as Hash,
    };
  });
}

/** Every receipt committed on chain that the gateway's watcher has seen, newest first. */
export async function fetchCommitments(
  gatewayUrl: string = LIVE.gatewayUrl,
  fetchJson: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<Commitment[]> {
  let response: Response;
  try {
    response = await fetchJson(`${gatewayUrl.replace(/\/+$/, "")}/v0/commitments`);
  } catch {
    throw new Error("The gateway cannot be reached.");
  }
  if (!response.ok) throw new Error(`The gateway could not list receipts (${String(response.status)}).`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The gateway did not answer with a receipt list.");
  }
  return parseCommitments(body);
}
