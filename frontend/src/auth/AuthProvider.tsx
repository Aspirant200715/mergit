import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { paths } from "../app/paths";
import { prefersReducedMotion } from "../lib/motion";
import { AuthContext } from "./context";
import type { Address } from "viem";
import { signOutLive, watchAccount } from "../chain/wallet";
import { DATA_MODE } from "../config/live";
import { checkSession } from "./liveSession";
import { readSession, writeSession, type Session } from "./session";
import { SignOutSplash } from "./SignOutSplash";

/** Sign-out splash timing, from the landing design video: fade in, hold, then hand over to the landing page. */
const SPLASH = { holdMs: 1700, reducedHoldMs: 500, fadeOutMs: 450 };

type SplashPhase = "hidden" | "in" | "out";

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(readSession);
  const [splash, setSplash] = useState<SplashPhase>("hidden");
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => {
        window.clearTimeout(t);
      });
    },
    [],
  );

  const signIn = useCallback((next: Session) => {
    writeSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    if (DATA_MODE === "live") void signOutLive();
    // The splash covers the dashboard; the session ends behind it, then the
    // splash fades away over the landing page.
    setSplash("in");
    const reduced = prefersReducedMotion();
    const hold = reduced ? SPLASH.reducedHoldMs : SPLASH.holdMs;
    timers.current.push(
      window.setTimeout(() => {
        void navigate(paths.landing);
        writeSession(null);
        setSession(null);
        setSplash("out");
      }, hold),
      window.setTimeout(
        () => {
          setSplash("hidden");
        },
        hold + (reduced ? 0 : SPLASH.fadeOutMs),
      ),
    );
  }, [navigate]);

  // On live data the remembered session must still exist on the server: its cookie expires after 12 hours and
  // does not survive the API losing its database. A server that cannot be reached leaves the session alone.
  useEffect(() => {
    if (DATA_MODE !== "live" || !session) return;
    let cancelled = false;
    void checkSession(session.address).then((result) => {
      if (cancelled || result !== "expired") return;
      writeSession(null);
      setSession(null);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // On live data, a different wallet account ends the session: the signed-in address must be the one that funds.
  useEffect(() => {
    if (DATA_MODE !== "live" || !session) return;
    return watchAccount(session.address as Address, signOut);
  }, [session, signOut]);

  // The dashboard routes show the Connect window themselves while signed out,
  // so opening it is just a navigation.
  const openConnect = useCallback(
    (next: string = paths.app) => {
      void navigate(next);
    },
    [navigate],
  );

  const value = useMemo(() => ({ session, signIn, signOut, openConnect }), [session, signIn, signOut, openConnect]);
  return (
    <AuthContext.Provider value={value}>
      {children}
      {splash !== "hidden" && <SignOutSplash leaving={splash === "out"} />}
    </AuthContext.Provider>
  );
}
