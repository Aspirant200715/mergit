import type { EIP1193Provider } from "viem";

/**
 * Finding MetaMask the way MetaMask recommends (EIP-6963): every wallet extension announces itself with a name, so the
 * app asks MetaMask, whichever extension happens to own `window.ethereum`. The old `window.ethereum` route stays only
 * as a fallback for a MetaMask too old to announce, and it refuses wallets that pretend to be MetaMask.
 */
export const METAMASK_RDNS = "io.metamask";
export const METAMASK_INSTALL_URL = "https://metamask.io/download/";

export type Announcement = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
};

/** The event detail of `eip6963:announceProvider`, or null when it is not one (any page script can dispatch events). */
export function parseAnnouncement(detail: unknown): Announcement | null {
  if (!detail || typeof detail !== "object") return null;
  const { info, provider } = detail as { info?: Record<string, unknown>; provider?: { request?: unknown } };
  if (!info || typeof info.rdns !== "string" || typeof info.uuid !== "string") return null;
  if (!provider || typeof provider.request !== "function") return null;
  return {
    info: {
      uuid: info.uuid,
      name: typeof info.name === "string" ? info.name : info.rdns,
      icon: typeof info.icon === "string" ? info.icon : "",
      rdns: info.rdns,
    },
    provider: provider as unknown as EIP1193Provider,
  };
}

/** Wallets that set `isMetaMask` so that sites written for MetaMask accept them. */
const IMPERSONATORS = [
  "isBraveWallet",
  "isCoinbaseWallet",
  "isRabby",
  "isPhantom",
  "isTrust",
  "isTrustWallet",
  "isOkxWallet",
];

type Flagged = EIP1193Provider & Record<string, unknown> & { providers?: Flagged[] };

const isRealMetaMask = (p: Flagged) => p.isMetaMask === true && !IMPERSONATORS.some((flag) => p[flag] === true);

/** MetaMask from `window.ethereum`, for a MetaMask that does not announce itself. */
export function legacyMetaMask(ethereum: unknown): EIP1193Provider | null {
  const e = ethereum as Flagged | undefined;
  if (!e) return null;
  // With several wallets installed, extensions that share window.ethereum list themselves in `providers`.
  const candidates = Array.isArray(e.providers) ? e.providers : [e];
  return candidates.find(isRealMetaMask) ?? null;
}

export function findMetaMask(announced: Announcement[], ethereum: unknown): EIP1193Provider | null {
  return announced.find((a) => a.info.rdns === METAMASK_RDNS)?.provider ?? legacyMetaMask(ethereum);
}

const announcements: Announcement[] = [];
const listeners = new Set<() => void>();
let started = false;

/** Starts listening for wallets and asks the ones already there to announce. Safe to call any number of times. */
export function startWalletDiscovery(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const found = parseAnnouncement((event as CustomEvent).detail);
    if (!found || announcements.some((a) => a.info.uuid === found.info.uuid)) return;
    announcements.push(found);
    listeners.forEach((l) => {
      l();
    });
  });
  requestAnnouncements();
}

/** Wallets installed after the page loaded announce on request: ask again when the person returns to the tab. */
export function requestAnnouncements(): void {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** MetaMask's own provider right now, or null when MetaMask is not installed in this browser. */
export function metaMask(): EIP1193Provider | null {
  return findMetaMask(announcements, (window as unknown as { ethereum?: unknown }).ethereum);
}

export function onWalletsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
