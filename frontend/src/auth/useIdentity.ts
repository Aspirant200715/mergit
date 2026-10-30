import { DATA_MODE } from "../config/live";
import { useAuth } from "./context";
import { identityOf, type Identity } from "./identity";

export function useIdentity(): Identity {
  const { session } = useAuth();
  return identityOf(DATA_MODE, session);
}
