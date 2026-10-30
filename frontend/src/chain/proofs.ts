import type { Hex } from "viem";
import { escrowAbi, receiptRegistryAbi } from "./abi";
import { LIVE } from "../config/live";
import { publicClient } from "./client";
import { fetchCommitments } from "./commitments";

export type { Commitment } from "./commitments";

/**
 * Every receipt committed on chain, newest first. The gateway lists them: a browser cannot scan the chain itself,
 * because public RPCs allow only a few hundred blocks per getLogs and the chain has moved by far more since deploy.
 */
export const listCommitments = () => fetchCommitments();

export type OnChain = {
  agentId: bigint;
  root: Hex;
  terminalHash: Hex;
  bodyHash: Hex;
  costMicros: bigint;
  phiHash: Hex;
};

/** What the chain says about a task's receipt, or null if nothing is committed. */
export async function readCommitment(taskId: Hex): Promise<OnChain | null> {
  const [c, phiHash] = await Promise.all([
    publicClient.readContract({
      address: LIVE.contracts.registry,
      abi: receiptRegistryAbi,
      functionName: "commitmentOf",
      args: [taskId],
    }),
    publicClient.readContract({
      address: LIVE.contracts.escrow,
      abi: escrowAbi,
      functionName: "phiHashOf",
      args: [taskId],
    }),
  ]);
  if (c.committedAt === 0n) return null;
  return {
    agentId: c.agentId,
    root: c.root,
    terminalHash: c.terminalHash,
    bodyHash: c.bodyHash,
    costMicros: c.costMicros,
    phiHash,
  };
}

/** The bundle with this body hash, as JSON text. By hash, so nobody can serve another bundle in its place. */
export async function fetchBundle(bodyHash: Hex): Promise<string | null> {
  const res = await fetch(`${LIVE.storeUrl}/v0/bundles/${bodyHash}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("The receipt store did not answer. Try again in a moment.");
  return res.text();
}
