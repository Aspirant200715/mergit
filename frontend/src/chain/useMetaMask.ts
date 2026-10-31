import { useEffect, useState } from "react";
import { metaMask, onWalletsChanged, requestAnnouncements, startWalletDiscovery } from "./metamask";

/** `checking` for a moment after the page opens: extensions answer the first request a beat later. */
export type MetaMaskStatus = "checking" | "detected" | "missing";

const GRACE_MS = 600;

export function useMetaMask(): MetaMaskStatus {
  const [found, setFound] = useState(() => {
    startWalletDiscovery();
    return metaMask() !== null;
  });
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const check = () => {
      setFound(metaMask() !== null);
    };
    const timer = window.setTimeout(() => {
      setWaited(true);
    }, GRACE_MS);
    // After installing MetaMask in another tab, coming back should turn "Install" into "Connect".
    const ask = () => {
      requestAnnouncements();
      check();
    };
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("focus", ask);
    const off = onWalletsChanged(check);
    check();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("focus", ask);
      off();
    };
  }, []);

  if (found) return "detected";
  return waited ? "missing" : "checking";
}
