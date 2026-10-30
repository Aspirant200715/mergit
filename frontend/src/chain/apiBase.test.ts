import { describe, expect, it } from "vitest";
import { apiBase } from "./wallet";

describe("apiBase", () => {
  it("returns the configured API address without a trailing slash", () => {
    expect(apiBase("https://api.mergit.site/")).toBe("https://api.mergit.site");
  });

  it("explains a missing address instead of letting the request go to the page's own origin", () => {
    expect(() => apiBase("")).toThrow(/API address is not configured/);
  });
});
