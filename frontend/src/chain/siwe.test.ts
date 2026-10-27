import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { buildSignIn } from "./siwe";

describe("buildSignIn", () => {
  const message = buildSignIn({
    address: "0x6E2d4A9c51b07f3e9d28c4a16b0e7f2c3d119A0b",
    nonce: "a1b2c3d4e5f6a7b8",
    domain: "app.mergit.site",
    uri: "https://app.mergit.site",
    chainId: 84532,
    issuedAt: new Date("2026-10-27T10:00:00.000Z"),
  });

  it("is an EIP-4361 message for the app's domain and chain", () => {
    // EIP-4361 requires the EIP-55 checksummed address.
    const checksummed = getAddress("0x6e2d4a9c51b07f3e9d28c4a16b0e7f2c3d119a0b");
    expect(message.startsWith(`app.mergit.site wants you to sign in with your Ethereum account:\n${checksummed}`)).toBe(
      true,
    );
    expect(message).toContain("Chain ID: 84532");
    expect(message).toContain("Nonce: a1b2c3d4e5f6a7b8");
    expect(message).toContain("Issued At: 2026-10-27T10:00:00.000Z");
  });

  it("tells the user that signing in costs nothing", () => {
    expect(message).toContain("Sign in to Mergit. This costs nothing and sends no transaction.");
  });
});
