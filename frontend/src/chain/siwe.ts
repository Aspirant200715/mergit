import { createSiweMessage } from "viem/siwe";
import type { Address } from "viem";

export type SignInRequest = {
  address: Address;
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt?: Date;
};

/** The Sign-In with Ethereum (EIP-4361) message the wallet signs. Signing sends no transaction. */
export function buildSignIn(r: SignInRequest): string {
  return createSiweMessage({
    address: r.address,
    chainId: r.chainId,
    domain: r.domain,
    nonce: r.nonce,
    uri: r.uri,
    version: "1",
    statement: "Sign in to Mergit. This costs nothing and sends no transaction.",
    issuedAt: r.issuedAt ?? new Date(),
  });
}
