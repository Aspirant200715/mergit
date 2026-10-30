import { describe, expect, it } from "vitest";
import { modeCopy, modeFromParams } from "./authMode";
import { signInErrorMessage } from "./signInOptions";

describe("modeFromParams", () => {
  it("opens on Sign in unless the address asks to create an account", () => {
    expect(modeFromParams(new URLSearchParams(""))).toBe("login");
    expect(modeFromParams(new URLSearchParams("mode=register"))).toBe("register");
    expect(modeFromParams(new URLSearchParams("mode=login"))).toBe("login");
  });

  it("falls back to Sign in for anything else, because the value comes from the address bar", () => {
    expect(modeFromParams(new URLSearchParams("mode=admin"))).toBe("login");
  });

  it("opens on Create account when the provider says there is no account to sign in to", () => {
    expect(modeFromParams(new URLSearchParams("error=no_account"))).toBe("register");
  });
});

describe("modeCopy", () => {
  it("words each button for what it does: signing in to an account versus creating one", () => {
    expect(modeCopy("login").provider("GitHub")).toBe("Sign in with GitHub");
    expect(modeCopy("register").provider("GitHub")).toBe("Sign up with GitHub");
    expect(modeCopy("login").heading).not.toBe(modeCopy("register").heading);
  });

  it("the email button asks for a code in both modes, since the code proves the address either way", () => {
    expect(modeCopy("login").emailButton).toBe("Email me a code");
    expect(modeCopy("register").emailButton).toBe("Email me a code");
  });
});

describe("no account", () => {
  it("tells the person to create one, in words", () => {
    expect(signInErrorMessage("no_account")).toMatch(/create an account/i);
  });
});
