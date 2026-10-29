import { useState } from "react";
import { abandonPlan } from "../../../api/client";
import { Problems } from "./Problems";
import { useSubmit } from "./useSubmit";

/**
 * Closes the plan (plan task O6's abandon). Asks once more in place rather than through a browser
 * dialog, since closing cannot be undone.
 */
export function ClosePlan({ planUuid, onClosed }: { planUuid: string; onClosed: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, problems, submit } = useSubmit();

  const close = () => {
    void submit(async () => {
      await abandonPlan(planUuid);
      onClosed();
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn secondary compact self-start"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Close plan
      </button>
    );
  }
  return (
    <div className="col g8">
      <span className="small c2">Close this plan? Its unspent funds go back to you, and it cannot be reopened.</span>
      <div className="row g8">
        <button type="button" className="btn primary compact" disabled={busy} onClick={close}>
          {busy ? "Closing…" : "Yes, close it"}
        </button>
        <button
          type="button"
          className="btn secondary compact"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
          }}
        >
          Keep it
        </button>
      </div>
      <Problems items={problems} />
    </div>
  );
}
