import { me } from "../mock/data";
import { initialsOf, isTrialSession, type Account } from "./account";
import type { Session } from "./session";

/** Who the app says is signed in. On live data that is only what the sign-in proved: never a sample name or repository. */
export type Identity = {
  name: string | null;
  initials: string;
  /** The wallet the session acts as; empty while the account has no wallet. */
  address: string;
  /** The nav pill: the wallet's short address, or "Free trial" while there is no wallet. */
  addressShort: string;
  /** The line under the name in the account menu: the wallet address, or the email while there is no wallet. */
  detail: string;
  repo: string | null;
  /** True while the session acts as the free-trial address. */
  trial: boolean;
};

export function identityOf(mode: "mock" | "live", session: Session | null, account: Account | null = null): Identity {
  if (mode === "mock") {
    return {
      name: me.name,
      initials: me.initials,
      address: me.addressFull,
      addressShort: me.address,
      detail: me.addressFull,
      repo: me.repo,
      trial: false,
    };
  }
  if (!session) {
    return {
      name: null,
      initials: "··",
      address: "",
      addressShort: "Not signed in",
      detail: "",
      repo: null,
      trial: false,
    };
  }
  const trial = isTrialSession(account, session.address);
  const name = account?.name ?? null;
  // Without a name or email: the first two hex digits after 0x, a stable mark for the wallet and not an invented
  // person's initials.
  const initials = initialsOf(name, account?.email ?? null) ?? session.address.slice(2, 4).toUpperCase();
  return {
    name,
    initials,
    address: trial ? "" : session.address,
    addressShort: trial ? "Free trial" : session.addressShort,
    detail: trial ? (account?.email ?? "No wallet connected") : (account?.email ?? session.address),
    repo: null,
    trial,
  };
}
