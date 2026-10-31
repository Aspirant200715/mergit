import { beforeEach, describe, expect, it } from "vitest";
import { METAMASK_INSTALL_URL } from "../chain/metamask";
import { clearReopenRequest, guideFor, rememberToReopen, reopenRequested } from "./walletGuide";

const desktop = { device: "desktop", browser: "firefox" } as const;

describe("guideFor", () => {
  it("walks a computer through installing, creating a wallet and coming back", () => {
    const g = guideFor(desktop, "app.mergit.site");
    expect(g.steps.map((s) => s.id)).toEqual(["install", "create", "return"]);
  });

  it("sends the install step to MetaMask's own download page, which picks the right store, and nowhere else", () => {
    const install = guideFor(desktop, "app.mergit.site").steps[0];
    expect(install?.action).toEqual({ label: "Open MetaMask's download page", href: METAMASK_INSTALL_URL });
    const everyLink = JSON.stringify(guideFor(desktop, "app.mergit.site"));
    // Store listings are copied by scammers: never hard-code one from memory.
    expect(everyLink).not.toMatch(/chromewebstore|addons\.mozilla|microsoftedge\.microsoft|play\.google/);
  });

  it("names the person's browser in the install step, and says how to spot the real listing", () => {
    const text = JSON.stringify(guideFor(desktop, "app.mergit.site").steps[0]);
    expect(text).toContain("Firefox");
    expect(text).toMatch(/publisher|users|ratings/i);
  });

  it("tells them to keep the recovery phrase offline and that no one will ask for it", () => {
    const create = JSON.stringify(guideFor(desktop, "app.mergit.site").steps[1]);
    expect(create).toMatch(/Secret Recovery Phrase/);
    expect(create).toMatch(/never ask/i);
    expect(create).toMatch(/offline|paper/i);
  });

  it("on a phone: install the app, create a wallet, and open Mergit inside the MetaMask app", () => {
    for (const device of ["ios", "android"] as const) {
      const g = guideFor({ device, browser: "chrome" }, "app.mergit.site");
      expect(g.steps.map((s) => s.id)).toEqual(["install", "create", "open"]);
      expect(g.steps[2]?.action?.href).toBe("https://link.metamask.io/dapp/app.mergit.site");
    }
  });

  it("links the iPhone app listing MetaMask publishes, and leaves Android to the official page", () => {
    const ios = guideFor({ device: "ios", browser: "safari" }, "app.mergit.site").steps[0];
    expect(ios?.action?.href).toBe("https://apps.apple.com/us/app/metamask-blockchain-wallet/id1438144202");
    const android = guideFor({ device: "android", browser: "chrome" }, "app.mergit.site").steps[0];
    expect(android?.action?.href).toBe(METAMASK_INSTALL_URL);
  });

  it("does not claim a browser is unsupported: it asks Safari and unknown browsers to try another one", () => {
    const text = JSON.stringify(guideFor({ device: "desktop", browser: "safari" }, "app.mergit.site"));
    expect(text).toMatch(/another browser|Chrome, Firefox, Edge or Brave/i);
  });

  it("offers a way forward that needs no wallet at all", () => {
    expect(guideFor(desktop, "app.mergit.site").alternative).toMatch(/GitHub, Google or email/);
  });

  it("builds the phone link from the host it is served on, so it works on any domain", () => {
    expect(guideFor({ device: "ios", browser: "safari" }, "mergit.example").steps[2]?.action?.href).toBe(
      "https://link.metamask.io/dapp/mergit.example",
    );
  });
});

describe("reopen after reload", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  it("remembers across the reload, and reads the same however many times it is asked", () => {
    expect(reopenRequested()).toBe(false);
    rememberToReopen();
    expect(reopenRequested()).toBe(true);
    expect(reopenRequested()).toBe(true); // React runs initialisers twice in development
  });

  it("is cleared once the page has used it, so a later visit starts closed", () => {
    rememberToReopen();
    clearReopenRequest();
    expect(reopenRequested()).toBe(false);
  });

  it("is simply false when storage is blocked", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    expect(reopenRequested()).toBe(false);
    expect(() => {
      rememberToReopen();
      clearReopenRequest();
    }).not.toThrow();
  });
});
