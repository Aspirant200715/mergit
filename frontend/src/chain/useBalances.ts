import { useEffect, useState } from "react";
import type { Address } from "viem";
import { LIVE } from "../config/live";
import { publicClient } from "./client";
import { erc20Abi } from "./erc20";

/** An address's test ETH (gas) and test USDC on the configured chain, read from the RPC. */
export function useBalances(address: Address | null) {
  const [b, setB] = useState<{ eth: bigint; usdc: bigint } | null>(null);
  useEffect(() => {
    if (!address) return;
    void Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: LIVE.contracts.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]).then(([eth, usdc]) => {
      setB({ eth, usdc });
    });
  }, [address]);
  return b;
}
