import { useState } from "react";
import foxUrl from "../assets/wallets/metamask-fox.svg";
import { METAMASK_INSTALL_URL } from "../chain/metamask";
import { useMetaMask } from "../chain/useMetaMask";
import { Icon } from "../components/Icon";
import { sendWalletInterest, WALLET_CHOICES, type WalletChoice } from "./walletInterest";

/**
 * Which wallet? MetaMask is the one that works. Installed, it connects; missing, it sends the person to MetaMask to
 * install it. Any other wallet is "soon", with a Notify me that counts how many people want it.
 */
export function WalletPicker({ onMetaMask, busy }: { onMetaMask: () => void; busy: boolean }) {
  const status = useMetaMask();
  const [view, setView] = useState<"wallets" | "soon">("wallets");

  if (view === "soon")
    return (
      <NotifyMe
        onBack={() => {
          setView("wallets");
        }}
      />
    );

  return (
    <div className="col g8 wp" role="group" aria-label="Choose a wallet">
      {status === "missing" ? (
        <a className="wp-row" href={METAMASK_INSTALL_URL} target="_blank" rel="noopener noreferrer">
          <MetaMaskRow hint="Not found in this browser" tag={<span className="wp-tag go">Install</span>} />
        </a>
      ) : (
        <button type="button" className="wp-row" disabled={busy || status === "checking"} onClick={onMetaMask}>
          <MetaMaskRow
            hint={
              busy
                ? "Waiting for MetaMask…"
                : status === "checking"
                  ? "Looking for MetaMask…"
                  : "Opens MetaMask to connect"
            }
            tag={status === "detected" ? <span className="wp-tag ok">Detected</span> : null}
          />
        </button>
      )}
      <button
        type="button"
        className="wp-row soon"
        onClick={() => {
          setView("soon");
        }}
      >
        <span className="wp-ico plus" aria-hidden="true">
          <Icon name="plus" size={16} />
        </span>
        <span className="col grow">
          <span className="strong">Other wallets</span>
          <span className="small c3">Coinbase, CoinDCX, Trust and more</span>
        </span>
        <span className="wp-tag">Soon</span>
      </button>
      {status === "missing" && (
        <p className="small c3">After installing MetaMask, reload this page, then choose it here.</p>
      )}
    </div>
  );
}

function MetaMaskRow({ hint, tag }: { hint: string; tag: React.ReactNode }) {
  return (
    <>
      <img className="wp-ico" src={foxUrl} width={30} height={30} alt="" />
      <span className="col grow">
        <span className="strong">MetaMask</span>
        <span className="small c3">{hint}</span>
      </span>
      {tag}
    </>
  );
}

function NotifyMe({ onBack }: { onBack: () => void }) {
  const [picked, setPicked] = useState<WalletChoice[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: WalletChoice) => {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const send = () => {
    setError(null);
    setState("sending");
    sendWalletInterest(picked).then(
      () => {
        setState("sent");
      },
      (e: unknown) => {
        setState("idle");
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };

  return (
    <div className="col g12 wp">
      <div className="col g4">
        <h3 className="title">More wallets are coming soon</h3>
        <p className="small c2">
          For now Mergit works with MetaMask. Tell us which wallet you want and we will let you know.
        </p>
      </div>
      <div className="wp-chips" role="group" aria-label="Wallets you want">
        {WALLET_CHOICES.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`wp-chip${picked.includes(w.id) ? " on" : ""}`}
            aria-pressed={picked.includes(w.id)}
            disabled={state === "sent"}
            onClick={() => {
              toggle(w.id);
            }}
          >
            {w.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="small cr" role="alert">
          {error}
        </p>
      )}
      {state === "sent" ? (
        <p className="small cm strong" role="status">
          Thanks. We will tell you when it is ready.
        </p>
      ) : (
        <button type="button" className="btn primary block" disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Saving…" : "Notify me"}
        </button>
      )}
      <button type="button" className="link small" onClick={onBack}>
        Back to wallets
      </button>
    </div>
  );
}
