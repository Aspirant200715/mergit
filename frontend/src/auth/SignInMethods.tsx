import { useEffect, useState, type SubmitEvent } from "react";
import { Icon } from "../components/Icon";
import { MergitLoader } from "../components/MergitLoader";
import { connectAndSignIn } from "../chain/wallet";
import { fetchProviders, oauthStartUrl, requestEmailCode, submitEmailCode } from "./accountApi";
import { useAuth } from "./context";
import type { Session } from "./session";
import { signInOptions, type Providers } from "./signInOptions";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The real ways in, on live data: GitHub and Google (the browser leaves for the provider and comes back signed in),
 * an emailed six-digit code, and the browser wallet. Only methods the server says it has set up are shown.
 * Signing in with an account creates the account; a wallet is optional and can be connected afterwards.
 */
export function SignInMethods({ onSignedIn }: { onSignedIn: (session: Session | null) => void }) {
  const { signIn, refreshAccount } = useAuth();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"wallet" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const options = signInOptions("live", providers);

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
    connectAndSignIn().then(
      (session) => {
        signIn(session);
        onSignedIn(session);
      },
      (e: unknown) => {
        setBusy(null);
        setError(message(e));
      },
    );
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
    submitEmailCode(email.trim(), code.trim())
      .then(refreshAccount)
      .then(
        () => {
          setBusy(null);
          onSignedIn(null);
        },
        (e: unknown) => {
          setBusy(null);
          setError(message(e));
        },
      );
  };

  return (
    <div className="col g16">
      {error && (
        <p className="small cr" role="alert">
          {error}
        </p>
      )}
      {options.github && (
        <a className="si-provider" href={oauthStartUrl("github")}>
          <Icon name="github" size={18} />
          Continue with GitHub
        </a>
      )}
      {options.google && (
        <a className="si-provider" href={oauthStartUrl("google")}>
          <span className="si-google">G</span>
          Continue with Google
        </a>
      )}
      <button type="button" className="si-provider" disabled={busy === "wallet"} onClick={wallet}>
        <Icon name="wallet" size={18} />
        Continue with wallet
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
                {busy === "email" ? "Checking…" : "Sign in"}
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
                {busy === "email" ? "Sending…" : "Email me a code"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
