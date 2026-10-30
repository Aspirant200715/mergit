import { describe, expect, it } from "vitest";
import { signInOptions } from "./signInOptions";

describe("signInOptions", () => {
  it("offers only the wallet on live data, because there is no GitHub, Google or email sign-in behind the buttons", () => {
    expect(signInOptions("live")).toEqual({ accounts: false, wallet: true });
  });

  it("keeps the account buttons on the demo site, where they sign in as the demo account", () => {
    expect(signInOptions("mock")).toEqual({ accounts: true, wallet: true });
  });
});
