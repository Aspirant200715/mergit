import { useCallback, useState } from "react";
import { connectAndLinkWallet } from "../chain/wallet";
import { useAuth } from "./context";

/** Connects a wallet to the signed-in account: the wallet signs one message, then the session acts as it. */
export function useConnectWallet() {
  const { signIn, refreshAccount } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = useCallback(() => {
    setError(null);
    setBusy(true);
    connectAndLinkWallet()
      .then((session) => {
        signIn(session);
        return refreshAccount();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [signIn, refreshAccount]);
  return { connect, busy, error };
}
