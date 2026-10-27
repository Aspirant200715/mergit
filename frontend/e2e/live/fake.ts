/**
 * A fake browser wallet and fake Mergit backends for live-mode tests. The wallet is injected as
 * window.ethereum; the API, gateway, store and RPC hosts from LIVE_ENV are intercepted.
 */
import type { BrowserContext, Page, Route } from "@playwright/test";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, toFunctionSelector, type Hex } from "viem";
import { LIVE_ENV } from "../../playwright.config";

const receiptRegistryAbi = parseAbi([
  "event ReceiptCommitted(bytes32 indexed taskId, uint256 indexed agentId, bytes32 root, bytes32 terminalHash, bytes32 bodyHash, uint256 costMicros)",
]);

export const ME = getAddress("0x6e2d4a9c51b07f3e9d28c4a16b0e7f2c3d119a0b");
export const OTHER = getAddress("0x1111111111111111111111111111111111111111");
export const RUNTIME_KEY = getAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

export type Backend = {
  ethWei?: bigint;
  usdcUnits?: bigint;
  credits?: { granted: string; spent: string; remaining: string; plans_today: number };
  commitments?: Array<{ taskId: Hex; agentId: bigint; root: Hex; bodyHash: Hex; costMicros: bigint; block: number }>;
  /** Bundles the store serves, keyed by body hash (the only way the app may fetch them). */
  bundles?: Record<string, string>;
  /** On-chain commitment per task, as `commitmentOf` returns it. */
  committed?: Record<
    string,
    { agentId: bigint; root: Hex; terminalHash: Hex; bodyHash: Hex; costMicros: bigint; phiHash: Hex }
  >;
};

const SELECTOR = {
  commitmentOf: toFunctionSelector("commitmentOf(bytes32)"),
  runtimeKeyOf: toFunctionSelector("runtimeKeyOf(uint256)"),
  phiHashOf: toFunctionSelector("phiHashOf(bytes32)"),
};

/** Installs the fake wallet before any page script runs. `chainId` is what the wallet starts on. */
export async function installWallet(context: BrowserContext, opts: { chainId?: number } = {}) {
  await context.addInitScript(
    ({ me, chainId }) => {
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      const state = { accounts: [me] as string[], chainId, signed: [] as string[] };
      const emit = (event: string, ...args: unknown[]) => {
        (listeners[event] ?? []).forEach((l) => {
          l(...args);
        });
      };
      const w = window as unknown as Record<string, unknown>;
      w.__fakeWallet = {
        state,
        switchAccount: (a: string) => {
          state.accounts = [a];
          emit("accountsChanged", state.accounts);
        },
      };
      w.ethereum = {
        on: (e: string, l: (...a: unknown[]) => void) => (listeners[e] ??= []).push(l),
        removeListener: (e: string, l: (...a: unknown[]) => void) => {
          listeners[e] = (listeners[e] ?? []).filter((x) => x !== l);
        },
        request: ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
          const answer = (): unknown => {
            switch (method) {
              case "eth_requestAccounts":
              case "eth_accounts":
                return state.accounts;
              case "eth_chainId":
                return `0x${state.chainId.toString(16)}`;
              case "wallet_switchEthereumChain":
                state.chainId = parseInt((params?.[0] as { chainId: string }).chainId, 16);
                emit("chainChanged", `0x${state.chainId.toString(16)}`);
                return null;
              case "personal_sign":
                state.signed.push(typeof params?.[0] === "string" ? params[0] : "");
                return `0x${"11".repeat(65)}`;
              default:
                throw new Error(`fake wallet: unsupported ${method}`);
            }
          };
          try {
            return Promise.resolve(answer());
          } catch (e) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
      };
    },
    { me: ME, chainId: opts.chainId ?? 84532 },
  );
}

const CORS = (route: Route) => ({
  "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
});

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { ...CORS(route), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const hex = (n: bigint | number) => `0x${n.toString(16)}`;
const ZERO: Hex = `0x${"00".repeat(32)}`;
const word = (n: bigint) => encodeAbiParameters([{ type: "uint256" }], [n]);

/** Answers JSON-RPC like a tiny Base Sepolia node. */
function rpc(b: Backend) {
  return async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(route) });
    const req = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    const result = (() => {
      switch (req.method) {
        case "eth_chainId":
          return hex(84532);
        case "eth_blockNumber":
          return hex(100);
        case "eth_getBalance":
          return hex(b.ethWei ?? 0n);
        case "eth_call": {
          const data = (req.params[0] as { data: string }).data;
          if (data.startsWith("0x70a08231")) return word(b.usdcUnits ?? 0n); // balanceOf
          if (data.startsWith("0xdd62ed3e")) return word(0n); // allowance
          if (data.startsWith(SELECTOR.runtimeKeyOf)) return encodeAbiParameters([{ type: "address" }], [RUNTIME_KEY]);
          if (data.startsWith(SELECTOR.commitmentOf)) {
            const task = `0x${data.slice(10, 74)}`;
            const c = b.committed?.[task];
            return encodeAbiParameters(
              [
                {
                  type: "tuple",
                  components: [
                    { type: "uint256" },
                    { type: "bytes32" },
                    { type: "bytes32" },
                    { type: "bytes32" },
                    { type: "uint256" },
                    { type: "uint64" },
                  ],
                },
              ],
              [c ? [c.agentId, c.root, c.terminalHash, c.bodyHash, c.costMicros, 1n] : [0n, ZERO, ZERO, ZERO, 0n, 0n]],
            );
          }
          if (data.startsWith(SELECTOR.phiHashOf)) return b.committed?.[`0x${data.slice(10, 74)}`]?.phiHash ?? ZERO;
          return word(0n);
        }
        case "eth_getLogs":
          return (b.commitments ?? []).map((c, i) => ({
            address: LIVE_ENV.VITE_RECEIPT_REGISTRY,
            topics: encodeEventTopics({
              abi: receiptRegistryAbi,
              eventName: "ReceiptCommitted",
              args: { taskId: c.taskId, agentId: c.agentId },
            }),
            data: encodeAbiParameters(
              [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
              [c.root, `0x${"ab".repeat(32)}`, c.bodyHash, c.costMicros],
            ),
            blockNumber: hex(c.block),
            blockHash: `0x${"cd".repeat(32)}`,
            transactionHash: `0x${(i + 1).toString(16).padStart(64, "0")}`,
            transactionIndex: "0x0",
            logIndex: hex(i),
            removed: false,
          }));
        default:
          return null;
      }
    })();
    return json(route, { jsonrpc: "2.0", id: req.id, result });
  };
}

/** Paths the store was asked for in the current test. */
export const storeCalls: string[] = [];

/** Intercepts every backend host. Returns the requests the API received, for assertions. */
export async function mockBackend(page: Page, b: Backend = {}) {
  const apiCalls: Array<{ path: string; body: unknown }> = [];
  storeCalls.length = 0;
  await page.route(`${LIVE_ENV.VITE_RPC_URL}/**`, rpc(b));
  await page.route(`${LIVE_ENV.VITE_API_URL}/**`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS(route) });
    const path = new URL(route.request().url()).pathname;
    apiCalls.push({ path, body: route.request().postDataJSON() as unknown });
    if (path === "/v0/auth/nonce") return json(route, { nonce: "a1b2c3d4e5f6a7b8" });
    if (path === "/v0/auth/verify") return json(route, { address: ME });
    return json(route, {});
  });
  await page.route(`${LIVE_ENV.VITE_GATEWAY_URL}/**`, (route) =>
    json(route, {
      granted_usdc_units: b.credits?.granted ?? "5000000",
      spent_usdc_units: b.credits?.spent ?? "0",
      remaining_usdc_units: b.credits?.remaining ?? "5000000",
      plans_today: b.credits?.plans_today ?? 0,
    }),
  );
  await page.route(`${LIVE_ENV.VITE_STORE_URL}/**`, (route) => {
    storeCalls.push(new URL(route.request().url()).pathname);
    const parts = new URL(route.request().url()).pathname.split("/");
    // Only /v0/bundles/{bodyHash} serves bundles; the squattable /v0/tasks/{id}/bundle route serves nothing here.
    const body = parts[2] === "bundles" ? b.bundles?.[parts[3] ?? ""] : undefined;
    return body
      ? route.fulfill({ status: 200, headers: { ...CORS(route), "content-type": "application/json" }, body })
      : json(route, { error: "NOT_FOUND" }, 404);
  });
  return apiCalls;
}
