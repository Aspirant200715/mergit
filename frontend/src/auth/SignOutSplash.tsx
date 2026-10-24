import { MergitLogo } from "../components/MergitLogo";
import { CHAIN_LABEL } from "../mock/data";

/** Full-screen brand card shown while signing out, as at the end of the landing design video. */
export function SignOutSplash({ leaving }: { leaving: boolean }) {
  return (
    <div className={`signout${leaving ? " leaving" : ""}`} role="status" aria-label="Signing out">
      <div className="signout-card">
        <MergitLogo height={56} title="" className="signout-brand" />
        <p className="signout-tag">Real work. Verifiable proof.</p>
        <p className="signout-chain">Proof settlement on an {CHAIN_LABEL}</p>
      </div>
    </div>
  );
}
