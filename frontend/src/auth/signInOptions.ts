/** What `GET /v0/auth/providers` says the server has set up. */
export type Providers = { wallet: boolean; github: boolean; google: boolean; email: boolean };

export type SignInOptions = Providers & {
  /** True on the demo site: the account buttons sign in as the demo account, and the page says so. */
  demo: boolean;
};

/**
 * Which sign-in methods the Sign in page offers. `mock` is the public demo site, where every button enters the demo
 * account. `live` offers a method only when the server says it is set up: until it has answered, or if it cannot be
 * reached, only the wallet, which needs no account service.
 */
export function signInOptions(mode: "mock" | "live", providers: Providers | null): SignInOptions {
  if (mode === "mock") return { github: true, google: true, email: true, wallet: true, demo: true };
  return {
    github: providers?.github === true,
    google: providers?.google === true,
    email: providers?.email === true,
    wallet: true,
    demo: false,
  };
}

const ERRORS: Record<string, string> = {
  oauth_state: "That sign-in link was not valid or had expired. Start again from this page.",
  oauth_failed: "The provider did not complete the sign-in. Try again in a moment.",
  oauth_denied: "You cancelled the sign-in at the provider. Nothing was changed.",
  email_unverified: "That Google account has no verified email address, so Mergit cannot use it.",
  identity_taken: "That account is already linked to another Mergit user. Sign in with it directly instead.",
};

/** The sentence for a `?error=` code the server redirected back with, never the code itself. */
export function signInErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERRORS[code] ?? "Mergit could not sign you in. Try again.";
}
