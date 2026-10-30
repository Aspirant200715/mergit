import { useState } from "react";
import { Icon } from "../components/Icon";
import { MergitSymbol } from "../components/MergitLogo";
import { startTrial } from "./accountApi";
import { fundingChoiceNeeded } from "./account";
import { useAuth } from "./context";
import { useConnectWallet } from "./useConnectWallet";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Shown over the dashboard to an account that has neither started the free trial nor connected a wallet: how will
 * its work be paid for? A trial runs on the treasury's free credits (audited on every task, no reputation earned).
 * A wallet pays from its own USDC and is where proofs settle. "Look around first" leaves the choice for later.
 */
export function FundingChoice() {
  const { account, refreshAccount } = useAuth();
  const wallet = useConnectWallet();
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const busy = starting || wallet.busy;
  const error = trialError ?? wallet.error;
  if (!fundingChoiceNeeded(account) || dismissed) return null;

  const trial = () => {
    setTrialError(null);
    setStarting(true);
    startTrial()
      .then(refreshAccount)
      .catch((e: unknown) => {
        setTrialError(message(e));
      })
      .finally(() => {
        setStarting(false);
      });
  };

  return (
    <div className="connect-backdrop">
      <div
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-title"
        aria-describedby="choice-desc"
      >
        <div className="row g12">
          <MergitSymbol size={34} />
          <h2 id="choice-title" className="connect-title">
            How do you want to run work?
          </h2>
        </div>
        <p id="choice-desc" className="c2 connect-desc">
          {account?.name ? `Welcome, ${account.name}. ` : "Welcome. "}
          Start with the free trial, or connect a wallet to pay with your own test USDC.
        </p>
        {error && (
          <p className="small cr" role="alert">
            {error}
          </p>
        )}
        <ul className="connect-options">
          <li>
            <button type="button" className="connect-option" disabled={busy} onClick={trial}>
              <Icon name="check" size={16} />
              <span className="col grow">
                <span className="strong">{starting ? "Starting…" : "Start the free trial"}</span>
                <span className="small c3">Free test credits. Every task is audited; no reputation is earned.</span>
              </span>
            </button>
          </li>
          <li>
            <button type="button" className="connect-option" disabled={busy} onClick={wallet.connect}>
              <Icon name="wallet" size={16} />
              <span className="col grow">
                <span className="strong">{wallet.busy ? "Waiting for your wallet…" : "Connect a wallet"}</span>
                <span className="small c3">
                  MetaMask or another browser wallet. You sign one message; it costs nothing.
                </span>
              </span>
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="link small"
          onClick={() => {
            setDismissed(true);
          }}
        >
          Look around first
        </button>
      </div>
    </div>
  );
}
