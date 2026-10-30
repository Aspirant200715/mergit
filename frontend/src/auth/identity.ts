import { me } from "../mock/data";
import type { Session } from "./session";

/** Who the app says is signed in. On live data that is only what the wallet signed: never a sample name or repository. */
export type Identity = {
  name: string | null;
  initials: string;
  address: string;
  addressShort: string;
  repo: string | null;
};

export function identityOf(mode: "mock" | "live", session: Session | null): Identity {
  if (mode === "mock") {
    return { name: me.name, initials: me.initials, address: me.addressFull, addressShort: me.address, repo: me.repo };
  }
  if (!session) return { name: null, initials: "··", address: "", addressShort: "Not signed in", repo: null };
  // The first two hex digits after 0x: a stable mark for the wallet, not an invented person's initials.
  return {
    name: null,
    initials: session.address.slice(2, 4).toUpperCase(),
    address: session.address,
    addressShort: session.addressShort,
    repo: null,
  };
}
