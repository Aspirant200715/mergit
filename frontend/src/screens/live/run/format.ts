import type { Phi } from "../../../api/types";

/** Metered cost, in dollars to the hundredth of a cent: step costs are fractions of a cent. */
export const usdFromMicros = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

export const shortHex = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;

/** A check's command as it would be typed, or its JSON when it is not a plain argv. */
export function phiCommand(phi: Phi): string {
  const { command } = phi;
  return Array.isArray(command) && command.every((a) => typeof a === "string")
    ? command.join(" ")
    : JSON.stringify(phi);
}
