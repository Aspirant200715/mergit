import { describe, expect, it } from "vitest";
import { blockRanges } from "./ranges";

describe("blockRanges", () => {
  it("splits a long span into pages the public RPC accepts", () => {
    expect(blockRanges(0n, 4500n, 2000n)).toEqual([
      [0n, 1999n],
      [2000n, 3999n],
      [4000n, 4500n],
    ]);
  });

  it("returns one page for a short span and none for an empty one", () => {
    expect(blockRanges(10n, 10n, 2000n)).toEqual([[10n, 10n]]);
    expect(blockRanges(11n, 10n, 2000n)).toEqual([]);
  });
});
