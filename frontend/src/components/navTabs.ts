import { paths } from "../app/paths";
import type { IconName } from "./Icon";

export type NavTab = { label: string; icon: IconName; to: string };

const ALL: NavTab[] = [
  { label: "Overview", icon: "overview", to: paths.app },
  { label: "Runs", icon: "runs", to: paths.runs },
  { label: "Agents", icon: "agents", to: paths.agents },
  { label: "Proofs", icon: "proofs", to: paths.proofs },
  { label: "Leaderboard", icon: "trophy", to: paths.leaderboard },
  { label: "Integrations", icon: "plug", to: paths.integrations },
];

/** Reputation is not computed yet and no integration is wired, so live data has no Leaderboard or Integrations page. */
const NO_LIVE_DATA = new Set<string>([paths.leaderboard, paths.integrations]);

export function navTabs(mode: "mock" | "live"): NavTab[] {
  return mode === "live" ? ALL.filter((t) => !NO_LIVE_DATA.has(t.to)) : ALL;
}
