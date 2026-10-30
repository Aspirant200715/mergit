import type { Address } from "viem";
import type { PlanDetail } from "../../../api/types";
import { isTrialSession } from "../../../auth/account";
import { useAuth } from "../../../auth/context";
import { formatUsdc } from "../../../chain/funding";
import { useFundPlan, type FundStatus } from "../../../chain/useFundPlan";
import { Icon } from "../../../components/Icon";
import { LIVE } from "../../../config/live";
import { ClosePlan } from "./ClosePlan";
import { creditsDenial } from "./progress";

const FUND_STATUS: Record<Exclude<FundStatus, "idle" | "error">, string> = {
  approving: "Approve the USDC spend in your wallet…",
  funding: "Confirm the funding in your wallet…",
  confirmed: `Funded on ${LIVE.chainName}. The run starts as soon as the gateway sees it.`,
};

/**
 * An approved plan waiting for its money. Paid from a wallet, the requester funds Escrow here; paid
 * with free credits, the gateway funds it, and if it refuses, the requester can pay from a wallet
 * instead or close the plan (issue #23).
 */
export function FundingStep({ detail, onClosed }: { detail: PlanDetail; onClosed: () => void }) {
  const { session, account } = useAuth();
  // A free-trial account has no wallet to fall back on when the gateway refuses its credits.
  const trial = isTrialSession(account, session?.address);
  const total = BigInt(detail.total_budget_usdc_units ?? "0");
  const { fund, status, error } = useFundPlan((session?.address ?? null) as Address | null, detail.plan_id, total);
  const denial = creditsDenial(detail.money_events);
  const fromWallet = !trial && (detail.funding === "wallet" || denial !== null);
  const amount = `${formatUsdc(total)} USDC`;

  return (
    <section className="card pad24 col g16 lr-funding">
      <h2 className="title">{fromWallet ? `Fund ${amount}` : "Paying with free credits"}</h2>
      {denial && (
        <p className="ca strong" role="alert">
          Free credits were refused: {denial}{" "}
          {trial
            ? "Close the plan, or connect a wallet on the Wallet page and start a new one."
            : "You can pay from your wallet instead, or close the plan."}
        </p>
      )}
      {!fromWallet && denial === null && (
        <p className="c2 row g8" role="status">
          <Icon name="running" size={14} className="spin" color="var(--azure)" />
          Waiting for the gateway to fund {amount} from your free credits.
        </p>
      )}
      {fromWallet && (
        <>
          <p className="c2">
            The plan&apos;s total is locked in Escrow on {LIVE.chainName}. Each task&apos;s share is paid out only after
            its work is checked.
          </p>
          <button
            type="button"
            className="btn primary self-start"
            disabled={status === "approving" || status === "funding" || status === "confirmed"}
            onClick={() => {
              void fund();
            }}
          >
            <Icon name="wallet" size={16} />
            Fund {amount}
          </button>
          {status !== "idle" && status !== "error" && (
            <p className="small c2" role="status">
              {FUND_STATUS[status]}
            </p>
          )}
          {error && (
            <p className="small cr" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <ClosePlan planUuid={detail.plan_uuid} onClosed={onClosed} />
    </section>
  );
}
