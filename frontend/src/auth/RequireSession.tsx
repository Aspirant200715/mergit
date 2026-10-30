import type { ReactNode } from "react";
import { useAuth } from "./context";
import { ConnectDialog } from "./ConnectDialog";
import { FundingChoice } from "./FundingChoice";

/**
 * Dashboard gate. Signed out, the dashboard renders behind a blur, inert and
 * hidden from assistive tech, with the Connect window on top. On live data the window waits until the server has
 * said whether this browser already holds a session (it does after GitHub or Google sends it back).
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  return (
    <div className={`app-gate${session ? " unlocked" : " locked"}`}>
      <div className="app-gate-content" inert={!session} aria-hidden={session ? undefined : true}>
        {children}
      </div>
      {!session && ready && <ConnectDialog />}
      {session && <FundingChoice />}
    </div>
  );
}
