import { describe, expect, it } from "vitest";
import { summarizePlans } from "./overview";

const plan = (state: string) => ({ state }) as { state: never };

describe("summarizePlans", () => {
  it("counts a requester's plans by what they need", () => {
    const s = summarizePlans([
      plan("draft"),
      plan("approved"),
      plan("funded"),
      plan("running"),
      plan("done"),
      plan("done"),
      plan("failed"),
      plan("closed"),
    ]);
    expect(s).toEqual({ total: 8, drafts: 1, active: 3, done: 2, failed: 1, closed: 1 });
  });

  it("is all zeros for no plans", () => {
    expect(summarizePlans([])).toEqual({ total: 0, drafts: 0, active: 0, done: 0, failed: 0, closed: 0 });
  });
});
