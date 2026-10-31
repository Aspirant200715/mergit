import { currentEnvironment } from "../chain/environment";
import { useMetaMask } from "../chain/useMetaMask";
import { Icon } from "../components/Icon";
import { guideFor, rememberToReopen } from "./walletGuide";

/**
 * Setting MetaMask up without leaving Mergit: what to install and where from, how to create the wallet safely, and how
 * to come back. When the page notices MetaMask appear, the guide says so and offers Connect at once.
 */
export function MetaMaskGuide({
  onConnect,
  onBack,
  busy,
}: {
  onConnect: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const status = useMetaMask();
  const env = currentEnvironment();
  const guide = guideFor(env, window.location.host);
  const phone = env.device !== "desktop";

  const reload = () => {
    rememberToReopen();
    window.location.reload();
  };

  return (
    <div className="col g12 wg">
      <div className="col g4">
        <h3 className="title">{guide.title}</h3>
        <p className="small c2">Mergit works with MetaMask for now. It takes a few minutes and costs nothing.</p>
      </div>

      {status === "detected" && (
        <div className="wg-found" role="status">
          <Icon name="tick" size={16} stroke={2.4} />
          <span className="grow">MetaMask is installed and ready.</span>
          <button type="button" className="btn primary compact" disabled={busy} onClick={onConnect}>
            {busy ? "Waiting for MetaMask…" : "Connect MetaMask"}
          </button>
        </div>
      )}

      <ol className="wg-steps">
        {guide.steps.map((step, i) => (
          <li key={step.id} className="wg-step">
            <span className="wg-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="col g6 grow">
              <span className="strong">{step.title}</span>
              <p className="small c2">{step.body}</p>
              {step.action && (
                <a
                  className="btn secondary compact wg-action"
                  href={step.action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {step.action.label}
                  <Icon name="external" size={13} />
                </a>
              )}
              {step.id === "return" && status !== "detected" && !phone && (
                <button type="button" className="btn secondary compact wg-action" onClick={reload}>
                  I have installed it: reload this page
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="small c3">{guide.alternative}</p>
      <button type="button" className="link small" onClick={onBack}>
        Back to wallets
      </button>
    </div>
  );
}
