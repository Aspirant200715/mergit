import { getAddress } from "viem";
import { apiBase } from "../chain/wallet";

/** What the server says about a session this browser remembers. */
export type SessionCheck = "valid" | "expired" | "unknown";

const askServer = () => fetch(`${apiBase()}/v0/auth/me`, { credentials: "include" });

/**
 * The browser remembers a signed-in wallet in localStorage, but the real session is a cookie that expires (12 hours)
 * and does not survive the API losing its database. This asks the server which it is:
 * `expired` when there is no session for this wallet, `unknown` when the server cannot be asked, and then the
 * remembered session stays, because an outage must not sign people out.
 */
export async function checkSession(
  address: string,
  fetchMe: () => Promise<Response> = askServer,
): Promise<SessionCheck> {
  try {
    const response = await fetchMe();
    if (response.status === 401) return "expired";
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { address?: unknown };
    if (typeof body.address !== "string") return "unknown";
    return getAddress(body.address) === getAddress(address) ? "valid" : "expired";
  } catch {
    return "unknown";
  }
}
