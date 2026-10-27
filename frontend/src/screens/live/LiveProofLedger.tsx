import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { listCommitments, type Commitment } from "../../chain/proofs";
import { LIVE } from "../../config/live";

const usd = (micros: bigint) => `$${(Number(micros) / 1_000_000).toFixed(4)}`;

/** Every receipt committed on chain, read straight from the ReceiptRegistry contract. */
export function LiveProofLedger() {
  const [rows, setRows] = useState<Commitment[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    listCommitments().then(setRows, () => {
      setError(`Could not read receipts from ${LIVE.chainName}. Try again in a moment.`);
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Proofs"
        subtitle={`Receipts committed on ${LIVE.chainName}. Open one to verify it in your browser.`}
      />
      <section className="card pad24">
        {error && <p className="c2">{error}</p>}
        {!error && rows === null && <p className="c2">Reading the chain…</p>}
        {rows?.length === 0 && <p className="c2">No receipts committed yet. Run a task to see its receipt here.</p>}
        {rows && rows.length > 0 && (
          <table className="ledger-table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Agent</th>
                <th scope="col">Metered cost</th>
                <th scope="col">Block</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.taskId}>
                  <td>
                    <Link className="mono" to={`/app/proofs/${c.taskId}`}>
                      {c.taskId.slice(0, 10)}…{c.taskId.slice(-6)}
                    </Link>
                  </td>
                  <td>Agent {c.agentId.toString()}</td>
                  <td>{usd(c.costMicros)}</td>
                  <td className="mono">{c.blockNumber.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
