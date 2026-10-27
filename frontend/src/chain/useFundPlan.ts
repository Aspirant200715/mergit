import { useCallback, useState } from "react";
import type { Address, Hash, Hex } from "viem";
import { escrowAbi } from "./abi";
import { LIVE } from "../config/live";
import { publicClient, walletChainId, walletClient } from "./client";
import { planFunding } from "./funding";
import { erc20Abi } from "./erc20";

export type FundStatus = "idle" | "approving" | "funding" | "confirmed" | "error";

/** Funds a plan in Escrow from the connected wallet: approve when needed, then fund. */
export function useFundPlan(account: Address | null, planId: Hex, amountUnits: bigint) {
  const [status, setStatus] = useState<FundStatus>("idle");
  const [error, setError] = useState<string>();

  const fund = useCallback(async (): Promise<Hash | undefined> => {
    setError(undefined);
    try {
      if (!account) throw new Error("Sign in with a wallet first.");
      const [chainId, allowance, balance] = await Promise.all([
        walletChainId(),
        publicClient.readContract({
          address: LIVE.contracts.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, LIVE.contracts.escrow],
        }),
        publicClient.readContract({
          address: LIVE.contracts.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
      ]);
      const plan = planFunding({ chainId, allowance, balance }, amountUnits, {
        id: LIVE.chainId,
        name: LIVE.chainName,
      });
      if (!plan.ok) throw new Error(plan.error);
      const wallet = walletClient(account);
      if (plan.steps.includes("approve")) {
        setStatus("approving");
        const h = await wallet.writeContract({
          address: LIVE.contracts.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [LIVE.contracts.escrow, amountUnits],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      setStatus("funding");
      const hash = await wallet.writeContract({
        address: LIVE.contracts.escrow,
        abi: escrowAbi,
        functionName: "fundPlan",
        args: [planId, amountUnits],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The funding transaction failed on chain.");
      setStatus("confirmed");
      return hash;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, [account, planId, amountUnits]);

  return { fund, status, error };
}
