import { describe, expect, it } from "vitest";
import { checkSession } from "./liveSession";

const ADDRESS = "0x6E2d4A9c51b07f3e9d28c4a16b0e7f2c3d119A0b";
const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("checkSession", () => {
  it("is valid when the server's session is for the same wallet, whatever the letter case", async () => {
    expect(await checkSession(ADDRESS, () => reply(200, { address: ADDRESS.toLowerCase() }))).toBe("valid");
  });

  it("is expired when the server has no live session (cookie expired or the API restarted)", async () => {
    expect(await checkSession(ADDRESS, () => reply(401, { detail: "session expired or revoked" }))).toBe("expired");
  });

  it("is expired when the server's session belongs to a different wallet", async () => {
    expect(
      await checkSession(ADDRESS, () => reply(200, { address: "0x0000000000000000000000000000000000000001" })),
    ).toBe("expired");
  });

  it("keeps the session when the API cannot be reached: an outage must not sign people out", async () => {
    expect(await checkSession(ADDRESS, () => Promise.reject(new TypeError("Failed to fetch")))).toBe("unknown");
    expect(await checkSession(ADDRESS, () => reply(503))).toBe("unknown");
  });

  it("keeps the session when the answer is not the JSON the API sends (a wrong URL returning a web page)", async () => {
    expect(await checkSession(ADDRESS, () => Promise.resolve(new Response("<html>", { status: 200 })))).toBe("unknown");
  });
});
