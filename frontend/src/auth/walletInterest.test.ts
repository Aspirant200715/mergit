import { beforeEach, describe, expect, it } from "vitest";
import { WALLET_CHOICES, anonymousToken, sendWalletInterest } from "./walletInterest";

const reply = (status: number) => Promise.resolve(new Response(null, { status }));

// vitest runs in node: give it the one browser API the token needs.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

describe("WALLET_CHOICES", () => {
  it("offers exactly the wallets the server accepts, with names a person recognises", () => {
    expect(WALLET_CHOICES.map((w) => w.id)).toEqual(["coinbase", "coindcx", "trust", "phantom", "rabby", "other"]);
    expect(WALLET_CHOICES.find((w) => w.id === "coindcx")?.label).toBe("CoinDCX");
    expect(WALLET_CHOICES.find((w) => w.id === "other")?.label).toBe("Another");
  });
});

describe("anonymousToken", () => {
  it("is a random id the server accepts, kept so the same browser is one vote", () => {
    const first = anonymousToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(anonymousToken()).toBe(first);
  });

  it("is made again when what was stored is not a usable id", () => {
    store.set("mergit-interest-token", "not valid!!");
    expect(anonymousToken()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it("still works when storage is blocked: a vote from a private window is fine", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    expect(anonymousToken()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe("sendWalletInterest", () => {
  it("posts the chosen wallets and this browser's token, with the session cookie", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await sendWalletInterest(["coindcx", "trust"], "https://app.test", (url, init) => {
      seen = { url, init };
      return reply(204);
    });
    expect(seen).not.toBeNull();
    const call = seen as unknown as { url: string; init: RequestInit };
    expect(call.url).toBe("https://app.test/v0/wallet-interest");
    expect(call.init.method).toBe("POST");
    expect(call.init.credentials).toBe("include");
    const body = JSON.parse(call.init.body as string) as { wallets: string[]; token: string };
    expect(body.wallets).toEqual(["coindcx", "trust"]);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it("asks for at least one wallet before calling the server", async () => {
    await expect(sendWalletInterest([], "https://app.test", () => reply(204))).rejects.toThrow(/pick/i);
  });

  it("says so when the server is rate limiting, and when it cannot be reached", async () => {
    await expect(sendWalletInterest(["trust"], "https://app.test", () => reply(429))).rejects.toThrow(/minute/i);
    await expect(sendWalletInterest(["trust"], "https://app.test", () => reply(500))).rejects.toThrow(/could not/i);
    await expect(
      sendWalletInterest(["trust"], "https://app.test", () => Promise.reject(new TypeError("Failed to fetch"))),
    ).rejects.toThrow(/unreachable/i);
  });
});
