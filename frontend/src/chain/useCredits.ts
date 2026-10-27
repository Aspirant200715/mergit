import { useEffect, useState } from "react";
import type { Address } from "viem";
import { LIVE } from "../config/live";

export type Credits = { granted: bigint; spent: bigint; remaining: bigint; plansToday: number };

/** Free credits for an address, from the gateway. */
export function useCredits(address: Address | null) {
  const [credits, setCredits] = useState<Credits | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!address) return;
    let live = true;
    fetch(`${LIVE.gatewayUrl}/v0/credits/${address}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Free credits are unavailable right now.");
        const c = (await r.json()) as {
          granted_usdc_units: string;
          spent_usdc_units: string;
          remaining_usdc_units: string;
          plans_today: number;
        };
        if (live)
          setCredits({
            granted: BigInt(c.granted_usdc_units),
            spent: BigInt(c.spent_usdc_units),
            remaining: BigInt(c.remaining_usdc_units),
            plansToday: c.plans_today,
          });
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [address]);
  return { credits, loading: !credits && !error, error };
}
