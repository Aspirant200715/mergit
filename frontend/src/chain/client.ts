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

export const chain: Chain = defineChain({
  id: LIVE.chainId,
  name: LIVE.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [LIVE.rpcUrl] } },
});

/** Reads go to the configured RPC, never through the wallet. */
export const publicClient: PublicClient<Transport, Chain> = createPublicClient({ chain, transport: http(LIVE.rpcUrl) });

/** The browser wallet (window.ethereum), if there is one. */
export function injected(): EIP1193Provider | null {
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null;
}

export function walletClient(account: Address): WalletClient<Transport, Chain, Account> {
  const provider = injected();
  if (!provider) throw new Error("No browser wallet found.");
  return createWalletClient({ account, chain, transport: custom(provider) });
}

export async function walletChainId(): Promise<number> {
  const provider = injected();
  if (!provider) return 0;
  return Number(await provider.request({ method: "eth_chainId" }));
}

/** Asks the wallet to switch to the configured chain. Returns whether it did. */
export async function switchChain(): Promise<boolean> {
  const provider = injected();
  if (!provider) return false;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${LIVE.chainId.toString(16)}` }],
    });
    return (await walletChainId()) === LIVE.chainId;
  } catch {
    return false;
  }
}
