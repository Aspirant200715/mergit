import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { LIVE } from "../config/live";
import { metaMask, startWalletDiscovery } from "./metamask";

export const chain: Chain = defineChain({
  id: LIVE.chainId,
  name: LIVE.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [LIVE.rpcUrl] } },
});

/** Reads go to the configured RPC, never through the wallet. */
export const publicClient: PublicClient<Transport, Chain> = createPublicClient({ chain, transport: http(LIVE.rpcUrl) });

/**
 * The wallet Mergit talks to: MetaMask's own provider, found by name (EIP-6963), not whichever extension happens to
 * own `window.ethereum`. Null when MetaMask is not installed. See metamask.ts.
 */
export function injected(): EIP1193Provider | null {
  startWalletDiscovery();
  return metaMask();
}

export function walletClient(account: Address): WalletClient<Transport, Chain, Account> {
  const provider = injected();
  if (!provider) throw new Error("No browser wallet found.");
  return createWalletClient({ account, chain, transport: custom(provider) });
}

export async function walletChainId(provider: EIP1193Provider | null = injected()): Promise<number> {
  if (!provider) return 0;
  return Number(await provider.request({ method: "eth_chainId" }));
}

const EXPLORERS: Record<number, string> = { 84532: "https://sepolia.basescan.org" };

/** A wallet that has never seen the chain answers a switch with 4902 (some wallets only say so in the message). */
function isUnknownChain(error: unknown): boolean {
  const e = error as { code?: number; message?: string } | null;
  return e?.code === 4902 || /unrecognized chain/i.test(e?.message ?? "");
}

/**
 * Asks the wallet to switch to the configured chain, and to add it first when the wallet does not know it.
 * Returns whether the wallet ended up on that chain.
 */
export async function switchChain(provider: EIP1193Provider | null = injected()): Promise<boolean> {
  if (!provider) return false;
  const chainId = `0x${LIVE.chainId.toString(16)}` as const;
  const switchTo = () => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  try {
    try {
      await switchTo();
    } catch (error) {
      if (!isUnknownChain(error)) throw error;
      const explorer = EXPLORERS[LIVE.chainId];
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: LIVE.chainName,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [LIVE.rpcUrl],
            ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
          },
        ],
      });
      await switchTo();
    }
    return (await walletChainId(provider)) === LIVE.chainId;
  } catch {
    return false;
  }
}
