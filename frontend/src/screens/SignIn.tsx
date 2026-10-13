import { useNavigate } from "react-router-dom";
import { BrandMark, Icon } from "../components/Icon";
import { AgentAvatar, Badge } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import "../styles/screens/signin.css";

export function SignIn() {
  const navigate = useNavigate();
  const enter = () => navigate("/");
  return (
    <div className="si">
      <section className="si-hero mesh">
        <div className="row g10">
          <BrandMark />
          <span className="title" style={{ fontSize: 18 }}>Mergit</span>
        </div>
        <div className="col g20 page-enter">
          <h1 className="si-title">
            AI agents that do real work.
            <br />
            <span className="c2">Proof you can verify.</span>
          </h1>
          <p className="c2 si-lede">
            One sentence becomes a fix in GitHub, a ticket in Linear and a reply in the thread that asked. Every finished task settles on chain.
          </p>
          <div className="card si-float">
            <div className="row g12">
              <AgentAvatar kind="Coder" size={36} />
              <div className="col grow">
                <span className="strong">PR #134, fix auth flow</span>
                <span className="mono-s c3">0x30af…1c77, block 18,431,201</span>
              </div>
              <Badge status="Verified" label="Settled" />
            </div>
          </div>
        </div>
        <div className="row g24 small c2">
          <span>
            <b className="strong" style={{ color: "var(--ink)" }}>0%</b> silent failures
          </span>
          <span>
            <b className="strong" style={{ color: "var(--ink)" }}>42</b> tools, 4 apps
          </span>
          <span>
            <b className="strong" style={{ color: "var(--ink)" }}>859</b> tests
          </span>
        </div>
      </section>

      <section className="si-form-wrap">
        <div className="si-toggle">
          <ThemeToggle />
        </div>
        <form
          className="col g16 si-form page-enter"
          onSubmit={(e) => {
            e.preventDefault();
            enter();
          }}
        >
          <div className="col g6">
            <h2 className="h">Sign in to Mergit</h2>
            <p className="c2">Use your work account or connect a wallet.</p>
          </div>
          <button type="button" className="si-provider" onClick={enter}>
            <Icon name="github" size={18} />
            Continue with GitHub
          </button>
          <button type="button" className="si-provider" onClick={enter}>
            <span style={{ fontWeight: 700, color: "#4285F4" }}>G</span>
            Continue with Google
          </button>
          <button type="button" className="si-provider" onClick={enter}>
            <Icon name="wallet" size={18} />
            Continue with wallet
          </button>
          <div className="row g12 small c3">
            <i className="si-rule" />
            or
            <i className="si-rule" />
          </div>
          <label className="col g6">
            <span className="small c2 strong">Work email</span>
            <span className="input">
              <Icon name="mail" size={16} />
              <input type="email" placeholder="you@company.com" autoComplete="email" />
            </span>
          </label>
          <button type="submit" className="btn p block">
            Continue
          </button>
          <span className="small c3" style={{ textAlign: "center" }}>
            New here? <span className="link">Create an account</span>
          </span>
        </form>
      </section>
    </div>
  );
}
