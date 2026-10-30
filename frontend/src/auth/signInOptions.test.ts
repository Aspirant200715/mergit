import { describe, expect, it } from "vitest";
import { signInErrorMessage, signInOptions } from "./signInOptions";

describe("signInOptions", () => {
  it("offers exactly the methods the server has set up, plus the wallet, on live data", () => {
    expect(signInOptions("live", { wallet: true, github: true, google: false, email: true })).toEqual({
      github: true,
      google: false,
      email: true,
      wallet: true,
      demo: false,
    });
  });

  it("offers only the wallet on live data until the server has said what it has: no button that cannot work", () => {
    expect(signInOptions("live", null)).toEqual({
      github: false,
      google: false,
      email: false,
      wallet: true,
      demo: false,
    });
  });

  it("never offers a method the server did not list, whatever else is in the answer", () => {
    const options = signInOptions("live", { wallet: true, github: false, google: false, email: false });
    expect(options).toMatchObject({ github: false, google: false, email: false });
  });

  it("keeps every account button on the demo site, where they sign in as the demo account", () => {
    expect(signInOptions("mock", null)).toEqual({ github: true, google: true, email: true, wallet: true, demo: true });
  });
});

describe("signInErrorMessage", () => {
  it("explains each failure the server redirects back with", () => {
    for (const code of ["oauth_state", "oauth_failed", "oauth_denied", "email_unverified", "identity_taken"]) {
      expect(signInErrorMessage(code)).toMatch(/\w+/);
    }
    expect(signInErrorMessage("email_unverified")).toContain("verified");
    expect(signInErrorMessage("identity_taken")).toContain("another");
  });

  it("is silent without an error, and does not echo a code it does not know (it is text from the address bar)", () => {
    expect(signInErrorMessage(null)).toBeNull();
    const unknown = signInErrorMessage("<script>alert(1)</script>");
    expect(unknown).not.toContain("script");
    expect(unknown).toMatch(/could not sign you in/i);
  });
});
