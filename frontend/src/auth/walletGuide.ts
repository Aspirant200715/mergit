import { METAMASK_INSTALL_URL } from "../chain/metamask";
import type { Browser, Environment } from "../chain/environment";

export type GuideStep = {
  id: "install" | "create" | "return" | "open";
  title: string;
  body: string;
  action?: { label: string; href: string };
};

export type Guide = { title: string; steps: GuideStep[]; alternative: string };

const IOS_APP = "https://apps.apple.com/us/app/metamask-blockchain-wallet/id1438144202";

const BROWSER_NAME: Record<Browser, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  brave: "Brave",
  opera: "Opera",
  safari: "Safari",
  other: "your browser",
};

const RECOVERY =
  "MetaMask shows you a Secret Recovery Phrase of 12 words. Write it on paper and keep it offline. Anyone who has it " +
  "controls your wallet. Mergit and MetaMask will never ask you for it.";

/**
 * The MetaMask setup walk-through. Every install link is MetaMask's own (its download page sends each browser to the
 * right store), never a store listing written down here: scam copies of wallets are common in stores.
 */
export function guideFor(env: Environment, host: string): Guide {
  const alternative = "Not ready for a wallet? You can start free with GitHub, Google or email, and connect one later.";

  if (env.device !== "desktop") {
    return {
      title: "Set up MetaMask on your phone",
      alternative,
      steps: [
        {
          id: "install",
          title: "Install the MetaMask app",
          body: "Use the official listing from MetaMask and avoid copies: the real one has millions of downloads.",
          action:
            env.device === "ios"
              ? { label: "Open MetaMask in the App Store", href: IOS_APP }
              : { label: "Open MetaMask's download page", href: METAMASK_INSTALL_URL },
        },
        { id: "create", title: "Create your wallet in the app", body: RECOVERY },
        {
          id: "open",
          title: "Open Mergit inside MetaMask",
          body: "Mergit connects from MetaMask's own browser. This link opens this site there.",
          action: { label: "Open Mergit in MetaMask", href: `https://link.metamask.io/dapp/${host}` },
        },
      ],
    };
  }

  const browser = BROWSER_NAME[env.browser];
  const unsure =
    env.browser === "safari" || env.browser === "other"
      ? " If it does not offer an extension for your browser, open Mergit in Chrome, Firefox, Edge or Brave and start there."
      : "";
  return {
    title: "Set up MetaMask in a few minutes",
    alternative,
    steps: [
      {
        id: "install",
        title: `Add MetaMask to ${browser}`,
        body:
          "MetaMask's download page sends you to the right store for your browser. Install the one published by MetaMask: " +
          "the real listing has millions of users and tens of thousands of ratings." +
          unsure,
        action: { label: "Open MetaMask's download page", href: METAMASK_INSTALL_URL },
      },
      {
        id: "create",
        title: "Create your wallet",
        body: `Open MetaMask from your browser's extensions menu, choose Create a new wallet and set a password. ${RECOVERY}`,
      },
      {
        id: "return",
        title: "Come back here",
        body: "Mergit notices MetaMask on its own. If it does not, reload this page with the button below and your wallet list will reopen.",
      },
    ],
  };
}

const KEY = "mergit-reopen-wallets";

/** Called just before reloading, so the wallet list is open again when the page comes back. */
export function rememberToReopen(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Private window: the person reopens the list themselves.
  }
}

/**
 * True when the page was reloaded by the guide and should show the wallet list again. A plain read, not a take: React
 * may run a state initializer twice, and the second run must see the same answer. Call `clearReopenRequest` once
 * mounted.
 */
export function reopenRequested(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearReopenRequest(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}
