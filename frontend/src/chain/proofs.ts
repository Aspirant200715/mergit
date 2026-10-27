import type { Hash, Hex } from "viem";
import { escrowAbi, receiptRegistryAbi } from "./abi";
import { LIVE } from "../config/live";
import { publicClient } from "./client";
import { blockRanges } from "./ranges";

/** Largest block range per getLogs call; public Base RPCs refuse larger ones. */
const PAGE = 2000n;

export type Commitment = {
  taskId: Hex;
  agentId: bigint;
  root: Hex;
  bodyHash: Hex;
  costMicros: bigint;
  blockNumber: bigint;
  tx: Hash;
};

/** Every receipt committed on chain, newest first, read in pages. */
export async function listCommitments(): Promise<Commitment[]> {
  const latest = await publicClient.getBlockNumber();
  const out: Commitment[] = [];
  for (const [fromBlock, toBlock] of blockRanges(LIVE.deployBlock, latest, PAGE)) {
    const logs = await publicClient.getContractEvents({
      address: LIVE.contracts.registry,
      abi: receiptRegistryAbi,
      eventName: "ReceiptCommitted",
      fromBlock,
      toBlock,
    });
    for (const l of logs) {
      out.push({
        taskId: l.args.taskId as Hex,
        agentId: l.args.agentId as bigint,
        root: l.args.root as Hex,
        bodyHash: l.args.bodyHash as Hex,
        costMicros: l.args.costMicros as bigint,
        blockNumber: l.blockNumber,
        tx: l.transactionHash,
      });
    }
  }
  return out.reverse();
}

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
