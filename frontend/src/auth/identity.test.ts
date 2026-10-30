import { describe, expect, it } from "vitest";
import { identityOf } from "./identity";

const session = {
  address: "0x1725a458a3Fc8BB3d7460d262c7F94766FEF585D",
  addressShort: "0x1725…585D",
  method: "browser" as const,
  since: 0,
};

describe("identityOf", () => {
  it("is the signed-in wallet on live data: no invented name, no sample repository", () => {
    expect(identityOf("live", session)).toEqual({
      name: null,
      initials: "17",
      address: session.address,
      addressShort: "0x1725…585D",
      repo: null,
    });
  });

  it("is never the demo account on live data, even with no session yet", () => {
    const id = identityOf("live", null);
    expect(id.name).toBeNull();
    expect(id.repo).toBeNull();
    expect(id.addressShort).not.toContain("6E2d");
  });

  it("is the labelled demo account on the demo site", () => {
    expect(identityOf("mock", null)).toMatchObject({ name: "Alex", initials: "AC", repo: "acme/billing" });
  });
});
