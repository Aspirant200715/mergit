import { useEffect, useState, type SubmitEvent } from "react";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { MergitLoader } from "../components/MergitLoader";
import { connectAndSignIn } from "../chain/wallet";
import { fetchProviders, oauthStartUrl, requestEmailCode, submitEmailCode } from "./accountApi";
import { modeCopy, type AuthMode } from "./authMode";
import { useAuth } from "./context";
import { NoAccountError } from "./intent";
import type { Session } from "./session";
import { signInOptions, type Providers } from "./signInOptions";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TABS = ["Sign in", "Create account"] as const;
const TAB_OF: Record<AuthMode, (typeof TABS)[number]> = { login: "Sign in", register: "Create account" };

/**
 * The real ways in, on live data: GitHub and Google (the browser leaves for the provider and comes back signed in),
 * an emailed six-digit code, and the browser wallet. Only methods the server says it has set up are shown.
 * Signing in with an account creates the account; a wallet is optional and can be connected afterwards.
 */
export function SignInMethods({
  mode,
  onModeChange,
  onSignedIn,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSignedIn: (session: Session | null) => void;
}) {
  const { signIn, refreshAccount } = useAuth();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"wallet" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const options = signInOptions("live", providers);
  const copy = modeCopy(mode);

  // "Sign in" for something nobody registered: say so and move to the tab that fixes it.
  const failed = (e: unknown) => {
    setBusy(null);
    setError(message(e));
    if (e instanceof NoAccountError) onModeChange("register");
  };

  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then((p) => {
      if (!cancelled) setProviders(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const wallet = () => {
    setError(null);
    setBusy("wallet");
    connectAndSignIn(undefined, mode).then((session) => {
      signIn(session);
      onSignedIn(session);
    }, failed);
  };

  const sendCode = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setBusy("email");
    requestEmailCode(email.trim()).then(
      () => {
        setBusy(null);
        setSent(true);
      },
      (e: unknown) => {
        setBusy(null);
        setError(message(e));
      },
    );
  };

  const checkCode = (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setBusy("email");
    submitEmailCode(email.trim(), code.trim(), mode)
      .then(refreshAccount)
      .then(() => {
        setBusy(null);
        onSignedIn(null);
      }, failed);
  };

  return (
    <div className="col g16">
      <Segmented
        options={TABS}
        value={TAB_OF[mode]}
        onChange={(tab) => {
          setError(null);
          setSent(false);
          setCode("");
          onModeChange(tab === "Sign in" ? "login" : "register");
        }}
        label="Sign in or create an account"
        className="si-tabs"
      />
      {error && (
        <p className="small cr" role="alert">
          {error}
        </p>
      )}
      {options.github && (
        <a className="si-provider" href={oauthStartUrl("github", mode)}>
          <Icon name="github" size={18} />
          {copy.provider("GitHub")}
        </a>
      )}
      {options.google && (
        <a className="si-provider" href={oauthStartUrl("google", mode)}>
          <span className="si-google">G</span>
          {copy.provider("Google")}
        </a>
      )}
      <button type="button" className="si-provider" disabled={busy === "wallet"} onClick={wallet}>
        <Icon name="wallet" size={18} />
        {copy.wallet}
      </button>
      {busy === "wallet" && (
        <span className="row g8 small c2" role="status">
          <MergitLoader size={22} decorative />
          Waiting for your wallet…
        </span>
      )}
      {options.email && (
        <>
          <div className="row g12 small c3" aria-hidden="true">
            <i className="si-rule" />
            or
            <i className="si-rule" />
          </div>
          {sent ? (
            <form className="col g12" onSubmit={checkCode}>
              <p className="small c2">
                We sent a six-digit code to <b className="strong ink">{email.trim().toLowerCase()}</b>. It works once
                and expires in ten minutes.
              </p>
              <label className="col g6">
                <span className="small c2 strong">Code</span>
                <span className="input">
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                    }}
                  />
                </span>
              </label>
              <button type="submit" className="btn primary block" disabled={busy === "email"}>
                {busy === "email" ? "Checking…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="link small"
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setError(null);
                }}
              >
                Use another email
              </button>
            </form>
          ) : (
            <form className="col g12" onSubmit={sendCode}>
              <label className="col g6">
                <span className="small c2 strong">Email</span>
                <span className="input">
                  <Icon name="mail" size={16} />
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                  />
                </span>
              </label>
              <button type="submit" className="btn primary block" disabled={busy === "email"}>
                {busy === "email" ? "Sending…" : copy.emailButton}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
