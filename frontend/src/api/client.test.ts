import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, listPlans, onSessionEnded } from "./client";

const answer = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => {
  onSessionEnded(null);
  vi.unstubAllGlobals();
});

describe("a 401 from the API", () => {
  it("tells the app the session ended, and still throws so the caller stops", async () => {
    vi.stubGlobal("fetch", () => answer(401, { detail: "session expired or revoked" }));
    const ended = vi.fn();
    onSessionEnded(ended);
    await expect(listPlans()).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledOnce();
  });

  it("is not reported for other failures or for success", async () => {
    const ended = vi.fn();
    onSessionEnded(ended);
    vi.stubGlobal("fetch", () => answer(403, { detail: "no" }));
    await expect(listPlans()).rejects.toBeInstanceOf(ApiError);
    vi.stubGlobal("fetch", () => answer(200, []));
    await expect(listPlans()).resolves.toEqual([]);
    expect(ended).not.toHaveBeenCalled();
  });

  it("is harmless when nobody is listening", async () => {
    vi.stubGlobal("fetch", () => answer(401, {}));
    await expect(listPlans()).rejects.toMatchObject({ status: 401 });
  });
});
