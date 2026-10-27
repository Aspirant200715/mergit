import { describe, expect, it } from "vitest";
import { planFunding } from "./funding";

const CHAIN = { id: 84532, name: "Base Sepolia" };

describe("planFunding", () => {
  it("approves then funds when the allowance is short", () => {
    expect(planFunding({ chainId: 84532, allowance: 0n, balance: 5_000_000n }, 2_000_000n, CHAIN)).toEqual({
      ok: true,
      steps: ["approve", "fund"],
    });
  });

  it("skips the approval when the allowance already covers the plan", () => {
    expect(planFunding({ chainId: 84532, allowance: 2_000_000n, balance: 5_000_000n }, 2_000_000n, CHAIN)).toEqual({
      ok: true,
      steps: ["fund"],
    });
  });

  it("blocks funding on the wrong chain and says which chain to use", () => {
    const plan = planFunding({ chainId: 1, allowance: 0n, balance: 5_000_000n }, 2_000_000n, CHAIN);
    expect(plan).toEqual({ ok: false, error: "Switch to Base Sepolia to fund this plan." });
  });

  it("refuses when the wallet holds too little test USDC, naming both amounts", () => {
    const plan = planFunding({ chainId: 84532, allowance: 0n, balance: 1_500_000n }, 2_000_000n, CHAIN);
    expect(plan.ok).toBe(false);
    if (!plan.ok)
      expect(plan.error).toBe(
        "This plan needs 2.00 test USDC and the wallet holds 1.50. Get more from the faucet on the Wallet page.",
      );
  });

  it("refuses a zero amount", () => {
    expect(planFunding({ chainId: 84532, allowance: 0n, balance: 1n }, 0n, CHAIN)).toEqual({
      ok: false,
      error: "There is nothing to fund.",
    });
  });
});
