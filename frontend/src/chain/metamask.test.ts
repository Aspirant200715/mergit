import { describe, expect, it } from "vitest";
import type { EIP1193Provider } from "viem";
import { findMetaMask, legacyMetaMask, parseAnnouncement, type Announcement } from "./metamask";

const provider = (flags: Record<string, unknown> = {}) =>
  ({ request: () => Promise.resolve(null), ...flags }) as unknown as EIP1193Provider;
const announce = (rdns: string, p: EIP1193Provider = provider()): Announcement => ({
  info: { uuid: rdns, name: rdns, icon: "data:,", rdns },
  provider: p,
});

describe("parseAnnouncement", () => {
  it("reads an EIP-6963 announcement", () => {
    const p = provider();
    const a = parseAnnouncement({
      info: { uuid: "1", name: "MetaMask", icon: "data:,", rdns: "io.metamask" },
      provider: p,
    });
    expect(a?.info.rdns).toBe("io.metamask");
    expect(a?.provider).toBe(p);
  });

  it("ignores anything that is not one: another page script can dispatch any event", () => {
    expect(parseAnnouncement(null)).toBeNull();
    expect(parseAnnouncement({})).toBeNull();
    expect(parseAnnouncement({ info: { rdns: 5 }, provider: provider() })).toBeNull();
    expect(
      parseAnnouncement({ info: { uuid: "1", name: "x", icon: "", rdns: "io.metamask" }, provider: {} }),
    ).toBeNull();
  });
});

describe("findMetaMask", () => {
  it("picks MetaMask by its name from whoever announced, not the first wallet that did", () => {
    const mm = provider({ isMetaMask: true });
    const found = findMetaMask(
      [announce("com.coinbase.wallet"), announce("io.metamask", mm), announce("app.phantom")],
      undefined,
    );
    expect(found).toBe(mm);
  });

  it("does not take another wallet's announcement for MetaMask's", () => {
    expect(findMetaMask([announce("com.coinbase.wallet"), announce("io.metamask.flask")], undefined)).toBeNull();
  });

  it("prefers the announced provider over window.ethereum, which any extension may own", () => {
    const announced = provider({ isMetaMask: true, who: "announced" });
    const other = provider({ isMetaMask: true, who: "legacy" });
    expect(findMetaMask([announce("io.metamask", announced)], other)).toBe(announced);
  });

  it("falls back to window.ethereum for a MetaMask old enough not to announce", () => {
    const old = provider({ isMetaMask: true });
    expect(findMetaMask([], old)).toBe(old);
  });

  it("is null when there is no MetaMask at all", () => {
    expect(findMetaMask([], undefined)).toBeNull();
    expect(findMetaMask([], provider())).toBeNull();
  });
});

describe("legacyMetaMask", () => {
  it("does not mistake wallets that pretend to be MetaMask for it", () => {
    for (const flag of ["isBraveWallet", "isCoinbaseWallet", "isRabby", "isPhantom", "isTrust", "isOkxWallet"]) {
      expect(legacyMetaMask(provider({ isMetaMask: true, [flag]: true }))).toBeNull();
    }
  });

  it("finds MetaMask among several wallets injected into window.ethereum.providers", () => {
    const mm = provider({ isMetaMask: true });
    const coinbase = provider({ isMetaMask: true, isCoinbaseWallet: true });
    expect(legacyMetaMask(provider({ providers: [coinbase, mm] }))).toBe(mm);
  });

  it("is null for a wallet that is not MetaMask", () => {
    expect(legacyMetaMask(provider({ isCoinbaseWallet: true }))).toBeNull();
    expect(legacyMetaMask(undefined)).toBeNull();
  });
});
