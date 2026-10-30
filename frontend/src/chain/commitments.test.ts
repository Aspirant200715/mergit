import { describe, expect, it } from "vitest";
import { fetchCommitments, parseCommitments } from "./commitments";

const hex = (c: string) => `0x${c.repeat(64)}`;
const row = (over: Record<string, unknown> = {}) => ({
  task_id: hex("a"),
  agent_id: "1",
  root: hex("b"),
  body_hash: hex("c"),
  cost_micros: "2400",
  block: 51_800_000,
  tx: hex("d"),
  ...over,
});
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("parseCommitments", () => {
  it("reads what the gateway lists, with amounts as bigints", () => {
    expect(parseCommitments([row()])).toEqual([
      {
        taskId: hex("a"),
        agentId: 1n,
        root: hex("b"),
        bodyHash: hex("c"),
        costMicros: 2400n,
        blockNumber: 51_800_000n,
        tx: hex("d"),
      },
    ]);
  });

  it("keeps the gateway's order, newest first", () => {
    const rows = parseCommitments([row({ task_id: hex("2") }), row({ task_id: hex("1") })]);
    expect(rows.map((r) => r.taskId)).toEqual([hex("2"), hex("1")]);
  });

  it("refuses an answer that is not a list of receipts, instead of showing half of one", () => {
    expect(() => parseCommitments({})).toThrow();
    expect(() => parseCommitments([row({ root: "0x12" })])).toThrow();
    expect(() => parseCommitments([row({ cost_micros: "12.5" })])).toThrow();
    expect(() => parseCommitments([row({ block: "soon" })])).toThrow();
    expect(() => parseCommitments([null])).toThrow();
  });
});

describe("fetchCommitments", () => {
  it("asks the gateway for the list", async () => {
    let asked = "";
    const rows = await fetchCommitments("http://gateway.test", (url) => {
      asked = url;
      return reply(200, [row()]);
    });
    expect(asked).toBe("http://gateway.test/v0/commitments");
    expect(rows).toHaveLength(1);
  });

  it("fails loudly when the gateway cannot answer, so the page says so and does not show an empty ledger", async () => {
    await expect(fetchCommitments("http://g", () => reply(503, { error: "DB" }))).rejects.toThrow();
    await expect(
      fetchCommitments("http://g", () => Promise.reject(new TypeError("Failed to fetch"))),
    ).rejects.toThrow();
    await expect(
      fetchCommitments("http://g", () => Promise.resolve(new Response("<html>", { status: 200 }))),
    ).rejects.toThrow();
  });
});
