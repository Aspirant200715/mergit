import { describe, expect, it } from "vitest";
import type { Account } from "./account";
import { identityOf } from "./identity";

const session = {
  address: "0x1725a458a3Fc8BB3d7460d262c7F94766FEF585D",
  addressShort: "0x1725…585D",
  method: "browser" as const,
  since: 0,
};

const TRIAL = "0x9999999999999999999999999999999999999999";
const trialSession = { address: TRIAL, addressShort: "0x9999…9999", method: "github" as const, since: 0 };
const github: Account = {
  userId: "u1",
  address: TRIAL,
  name: "Octo Cat",
  email: "octo@example.com",
  avatarUrl: null,
  identities: [{ provider: "github", label: "octo" }],
  wallets: [],
  trialAddress: TRIAL,
  trialStartedAt: "2026-10-30T10:00:00+00:00",
};

describe("identityOf", () => {
  it("is the signed-in wallet on live data: no invented name, no sample repository", () => {
    expect(identityOf("live", session)).toEqual({
      name: null,
      initials: "17",
      address: session.address,
      addressShort: "0x1725…585D",
      detail: session.address,
      repo: null,
      trial: false,
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

  it("is the person who signed in with GitHub: their name and email, not the trial address as if it were a wallet", () => {
    const id = identityOf("live", trialSession, github);
    expect(id).toMatchObject({
      name: "Octo Cat",
      initials: "OC",
      addressShort: "Free trial",
      detail: "octo@example.com",
      trial: true,
    });
    expect(id.address).toBe("");
  });

  it("shows the connected wallet, and the name, once a wallet is the acting address", () => {
    const account = { ...github, address: session.address, wallets: [session.address] };
    expect(identityOf("live", session, account)).toMatchObject({
      name: "Octo Cat",
      initials: "OC",
      address: session.address,
      addressShort: "0x1725…585D",
      detail: "octo@example.com",
      trial: false,
    });
  });

  it("uses the email's letters when the account has no name", () => {
    const id = identityOf("live", trialSession, { ...github, name: null });
    expect(id).toMatchObject({ name: null, initials: "OC" });
  });

  it("ignores an account on the demo site", () => {
    expect(identityOf("mock", null, github)).toMatchObject({ name: "Alex" });
  });
});
