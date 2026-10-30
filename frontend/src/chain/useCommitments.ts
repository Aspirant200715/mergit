import { useEffect, useState } from "react";
import { listCommitments, type Commitment } from "./proofs";

/** Every receipt committed on chain, newest first, read from the ReceiptRegistry contract. */
export function useCommitments() {
  const [rows, setRows] = useState<Commitment[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    listCommitments().then(
      (list) => {
        if (active) setRows(list);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return { rows, error };
}
