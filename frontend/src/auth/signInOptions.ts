/** Which sign-in methods the Sign in page offers. `mock` is the public demo site, `live` is the real app. */
export function signInOptions(mode: "mock" | "live"): { accounts: boolean; wallet: boolean } {
  // GitHub, Google and email have no backend behind them: on the demo site they enter the demo account, and on live
  // data that would be a fake sign-in, so only the wallet (a real signed message) is offered there.
  return { accounts: mode !== "live", wallet: true };
}
