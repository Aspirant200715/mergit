import type { Attempt, StepEvent } from "../../../api/types";
import { shortHex, usdFromMicros } from "./format";

/** Every agent step as the worker records it, streamed live; nothing here is stored or replayed. */
export function StepLog({ steps, attempts }: { steps: StepEvent[]; attempts: Attempt[] }) {
  const taskOf = new Map(attempts.map((a) => [a.task_id, a]));

  return (
    <section className="card col rw-log" aria-labelledby="step-log-title">
      <div className="hd rw-log-head">
        <h2 id="step-log-title" className="title">
          Live log
        </h2>
        <span className="small c3">{steps.length} steps, streamed</span>
      </div>
      {steps.length === 0 ? (
        <p className="small c3 empty">Agent steps appear here the moment the worker records them.</p>
      ) : (
        <ol className="scroll rw-log-list" aria-live="polite">
          {steps.map((s) => {
            const attempt = taskOf.get(s.task_id);
            return (
              <li key={`${s.task_id}-${String(s.seq)}`} className="row g12 rw-log-in">
                <span className="mono-s c3 w-84 ellipsis" title={s.task_id}>
                  {/* A step can arrive before its attempt's row does; the task id still says whose it is. */}
                  {attempt ? `Task ${String(attempt.index + 1)}.${String(attempt.attempt)}` : shortHex(s.task_id)}
                </span>
                <span className="mono-s c3 w-28">#{s.seq}</span>
                <span className="mono grow">{s.type}</span>
                {typeof s.cost.usd_micros === "number" && (
                  <span className="mono-s c2">{usdFromMicros(s.cost.usd_micros)}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
