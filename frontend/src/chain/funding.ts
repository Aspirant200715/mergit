import { formatUnits, parseUnits } from "viem";

/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;

export function formatUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const cents = (units % 1_000_000n) / 10_000n;
  return `${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

/** Every digit of an amount, for a field the user edits: `formatUsdc` rounds to cents, this never does. */
export function usdcText(units: bigint): string {
  return formatUnits(units, USDC_DECIMALS);
}

const USDC_AMOUNT = /^\d+(\.\d{1,6})?$/;

/** Base units for an amount typed as USDC ("2.5"), or null when it is not one. Never rounds. */
export function parseUsdc(text: string): bigint | null {
  const trimmed = text.trim();
  return USDC_AMOUNT.test(trimmed) ? parseUnits(trimmed, USDC_DECIMALS) : null;
}

export type FundingState = { chainId: number; allowance: bigint; balance: bigint };
export type FundingPlan = { ok: true; steps: Array<"approve" | "fund"> } | { ok: false; error: string };

/** What it takes to fund a plan from this wallet: the transactions to send, or why it cannot. */
export function planFunding(state: FundingState, amount: bigint, chain: { id: number; name: string }): FundingPlan {
  if (amount <= 0n) return { ok: false, error: "There is nothing to fund." };
  if (state.chainId !== chain.id) return { ok: false, error: `Switch to ${chain.name} to fund this plan.` };
  if (state.balance < amount) {
    return {
      ok: false,
      error: `This plan needs ${formatUsdc(amount)} test USDC and the wallet holds ${formatUsdc(state.balance)}. Get more from the faucet on the Wallet page.`,
    };
  }
  return { ok: true, steps: state.allowance >= amount ? ["fund"] : ["approve", "fund"] };
}
