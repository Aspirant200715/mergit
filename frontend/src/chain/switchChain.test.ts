import { describe, expect, it } from "vitest";
import type { EIP1193Provider } from "viem";
import { switchChain } from "./client";

type Call = { method: string; params?: unknown };

/** A wallet that records requests; `known` says whether it already has the chain. */
function wallet(known: boolean, switched = { value: false }) {
  const calls: Call[] = [];
  const provider = {
    request: ({ method, params }: Call) => {
      calls.push({ method, params });
      if (method === "wallet_switchEthereumChain") {
        if (!known && !switched.value)
          return Promise.reject(Object.assign(new Error("Unrecognized chain ID"), { code: 4902 }));
        switched.value = true;
        return Promise.resolve(null);
      }
      if (method === "wallet_addEthereumChain") {
        known = true;
        return Promise.resolve(null);
      }
      if (method === "eth_chainId") return Promise.resolve(switched.value ? "0x14a34" : "0x1");
      return Promise.reject(new Error(`unexpected ${method}`));
    },
  } as unknown as EIP1193Provider;
  return { provider, calls };
}

describe("switchChain", () => {
  it("switches when the wallet already knows the chain, without adding it", async () => {
    const { provider, calls } = wallet(true);
    expect(await switchChain(provider)).toBe(true);
    expect(calls.map((c) => c.method)).not.toContain("wallet_addEthereumChain");
  });

  it("offers to add the chain when the wallet does not have it (error 4902), then switches", async () => {
    const { provider, calls } = wallet(false);
    expect(await switchChain(provider)).toBe(true);
    const add = calls.find((c) => c.method === "wallet_addEthereumChain");
    expect(add).toBeDefined();
    const [param] = add?.params as [
      { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { symbol: string } },
    ];
    expect(param.chainId).toBe("0x14a34");
    expect(param.chainName).toBe("Base Sepolia");
    expect(param.rpcUrls.length).toBeGreaterThan(0);
    expect(param.nativeCurrency.symbol).toBe("ETH");
  });

  it("returns false when the user rejects the request", async () => {
    const provider = {
      request: () => Promise.reject(Object.assign(new Error("User rejected"), { code: 4001 })),
    } as unknown as EIP1193Provider;
    expect(await switchChain(provider)).toBe(false);
  });
});
