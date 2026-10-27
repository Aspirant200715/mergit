import type { Address } from "viem";

/**
 * `mock` (the default) renders the design over mock data, as the public site does.
 * `live` talks to the Mergit services and the chain. Set VITE_DATA_MODE=live and the VITE_* values below.
 */
export const DATA_MODE: "mock" | "live" = import.meta.env.VITE_DATA_MODE === "live" ? "live" : "mock";

const env = import.meta.env as Record<string, string | undefined>;

export const LIVE = {
  apiUrl: env.VITE_API_URL ?? "",
  gatewayUrl: env.VITE_GATEWAY_URL ?? "",
  storeUrl: env.VITE_STORE_URL ?? "",
  rpcUrl: env.VITE_RPC_URL ?? "https://sepolia.base.org",
  chainId: Number(env.VITE_CHAIN_ID ?? 84532),
  chainName: env.VITE_CHAIN_NAME ?? "Base Sepolia",
  deployBlock: BigInt(env.VITE_DEPLOY_BLOCK ?? 0),
  contracts: {
    usdc: (env.VITE_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address,
    escrow: (env.VITE_ESCROW ?? "0x0000000000000000000000000000000000000000") as Address,
    registry: (env.VITE_RECEIPT_REGISTRY ?? "0x0000000000000000000000000000000000000000") as Address,
    identity: (env.VITE_IDENTITY ?? "0x0000000000000000000000000000000000000000") as Address,
  },
  faucets: {
    eth: "https://portal.cdp.coinbase.com/products/faucet",
    usdc: "https://faucet.circle.com",
  },
} as const;
