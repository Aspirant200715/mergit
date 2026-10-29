import { useCallback, useEffect, useReducer, useState } from "react";
import { errorMessage, getPlan, planEventsUrl } from "./client";
import { initialPlanStream, PLAN_EVENT_NAMES, planReducer, type PlanStreamEvent } from "./planStream";

export type StreamStatus = "connecting" | "open" | "closed";

/**
 * One plan, live: the detail from the API, kept current over Server-Sent Events. `reload` fetches the
 * detail again, for after a change this client made itself (an edit, an approval).
 */
export function usePlan(planUuid: string) {
  const [state, dispatch] = useReducer(planReducer, initialPlanStream);
  const [stream, setStream] = useState<StreamStatus>("connecting");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    let active = true;
    getPlan(planUuid).then(
      (detail) => {
        if (active) dispatch({ type: "loaded", detail });
      },
      (error: unknown) => {
        if (active) dispatch({ type: "failed", error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [planUuid, version]);

  useEffect(() => {
    const source = new EventSource(planEventsUrl(planUuid), { withCredentials: true });
    const listeners = PLAN_EVENT_NAMES.map((name) => {
      const listener = (message: MessageEvent<string>) => {
        try {
          const event = { name, data: JSON.parse(message.data) as unknown } as PlanStreamEvent;
          dispatch({ type: "event", event });
        } catch {
          // A malformed frame is skipped; the next poll on the server sends the state again.
        }
      };
      source.addEventListener(name, listener);
      return [name, listener] as const;
    });
    source.onopen = () => {
      setStream("open");
    };
    // The browser reconnects on its own; CLOSED means it gave up (the session ended, or the plan is gone).
    source.onerror = () => {
      setStream(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };
    return () => {
      for (const [name, listener] of listeners) source.removeEventListener(name, listener);
      source.close();
    };
  }, [planUuid]);

  return { ...state, stream, reload };
}
