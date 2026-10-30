import type { Intent } from "./intent";

export type AuthMode = Intent;

/** Which tab the sign-in page opens on. The value comes from the address bar, so anything unknown means Sign in. */
export function modeFromParams(params: URLSearchParams): AuthMode {
  if (params.get("error") === "no_account") return "register";
  return params.get("mode") === "register" ? "register" : "login";
}

export function modeCopy(mode: AuthMode) {
  return mode === "login"
    ? {
        heading: "Welcome back",
        lede: "Sign in to your Mergit account.",
        provider: (name: string) => `Sign in with ${name}`,
        wallet: "Sign in with wallet",
        emailButton: "Email me a code",
        switchPrompt: "New to Mergit?",
        switchAction: "Create an account",
      }
    : {
        heading: "Create your account",
        lede: "Start with GitHub, Google or your email, then use the free trial or connect a wallet. Nothing to pay.",
        provider: (name: string) => `Sign up with ${name}`,
        wallet: "Sign up with wallet",
        emailButton: "Email me a code",
        switchPrompt: "Already have an account?",
        switchAction: "Sign in",
      };
}
