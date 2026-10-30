import type { PlanState } from "../../api/types";

export type PlanSummaryCounts = {
  total: number;
  drafts: number;
  active: number;
  done: number;
  failed: number;
  closed: number;
};

/** A requester's plans counted by what they need: drafts to finish, work in flight, finished, failed, closed. */
export function summarizePlans(plans: { state: PlanState }[]): PlanSummaryCounts {
  const count = (...states: PlanState[]) => plans.filter((p) => states.includes(p.state)).length;
  return {
    total: plans.length,
    drafts: count("draft"),
    active: count("approved", "funded", "running"),
    done: count("done"),
    failed: count("failed"),
    closed: count("closed"),
  };
}
