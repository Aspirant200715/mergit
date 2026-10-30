import { useEffect, useState } from "react";
import { errorMessage, listPlans } from "./client";
import type { PlanSummary } from "./types";

/** The signed-in requester's plans, newest first. */
export function usePlans() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    listPlans().then(
      (list) => {
        if (!active) return;
        // Anything but a list means this is not the plans service (a wrong address answering with a web page).
        if (Array.isArray(list)) setPlans(list);
        else setError("Mergit's API did not answer like the plans service. Check its address.");
      },
      (e: unknown) => {
        if (active) setError(errorMessage(e));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return { plans, error };
}
