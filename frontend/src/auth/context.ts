import { createContext, useContext } from "react";
import type { Account } from "./account";
import type { Session } from "./session";

type AuthValue = {
  session: Session | null;
  /** The account behind the session on live data; null on the demo site or until the server has answered. */
  account: Account | null;
  /** False on live data until the server has been asked whether this browser already holds a session cookie. */
  ready: boolean;
  /** Asks the server again who is signed in (after choosing a trial or connecting a wallet). */
  refreshAccount: () => Promise<void>;
  /** Open the Connect window. After connecting, go to `next` (defaults to the dashboard). */
  openConnect: (next?: string) => void;
  signIn: (session: Session) => void;
  signOut: () => void;
};

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
