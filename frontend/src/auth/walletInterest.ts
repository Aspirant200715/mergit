import { apiBase } from "../chain/wallet";

/** Wallets people can ask for. The ids are the ones the server accepts; nothing else is stored. */
export const WALLET_CHOICES = [
  { id: "coinbase", label: "Coinbase Wallet" },
  { id: "coindcx", label: "CoinDCX" },
  { id: "trust", label: "Trust Wallet" },
  { id: "phantom", label: "Phantom" },
  { id: "rabby", label: "Rabby" },
  { id: "other", label: "Another" },
] as const;

export type WalletChoice = (typeof WALLET_CHOICES)[number]["id"];

const TOKEN_KEY = "mergit-interest-token";
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

const newToken = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * A random id this browser keeps, so asking twice is one vote and not two. It says nothing about who the person is;
 * signed-in people are counted by account instead and the server ignores the token for them.
 */
export function anonymousToken(): string {
  try {
    const kept = localStorage.getItem(TOKEN_KEY);
    if (kept && TOKEN.test(kept)) return kept;
    const made = newToken();
    localStorage.setItem(TOKEN_KEY, made);
    return made;
  } catch {
    return newToken(); // storage blocked (a private window): this visit still counts
  }
}

/** Tells the server which unsupported wallets this person wants. Throws a sentence for the person on failure. */
export async function sendWalletInterest(
  wallets: WalletChoice[],
  base: string = apiBase(),
  post: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): Promise<void> {
  if (wallets.length === 0) throw new Error("Pick at least one wallet so we know what to build.");
  let response: Response;
  try {
    response = await post(`${base}/v0/wallet-interest`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallets, token: anonymousToken() }),
    });
  } catch {
    throw new Error("Mergit's API is unreachable. Check your connection and try again.");
  }
  if (response.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
  if (!response.ok) throw new Error("Mergit could not save that. Try again in a moment.");
}
