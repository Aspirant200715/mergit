import { useCallback, useState } from "react";
import { ApiError, errorMessage } from "../../../api/client";

/**
 * One form action at a time: `busy` while it runs, and every problem it ended with. API errors carry
 * all of the API's reasons; anything else becomes one line.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const submit = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setProblems([]);
    try {
      await action();
    } catch (e) {
      setProblems(e instanceof ApiError ? e.problems : [errorMessage(e)]);
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, problems, setProblems, submit };
}
