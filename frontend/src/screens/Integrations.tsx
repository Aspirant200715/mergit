import { useState } from "react";
import { Icon } from "../components/Icon";
import { AppTile, Badge, Button, PageHeader } from "../components/ui";
import { useToast } from "../components/Toast";
import { githubPermissions, integrations, toolCalls } from "../mock/data";
import "../styles/screens/integrations.css";

export function Integrations() {
  const [apps, setApps] = useState(integrations);
  const toast = useToast();

  const connect = (name: string) => {
    setApps((list) => list.map((a) => (a.name === name ? { ...a, connected: true, calls: "0 calls this month" } : a)));
    toast(`${name} connected`);
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect the apps your agents work in. Credentials are sealed per user and never reach a model."
        actions={<Button icon="plus">Request an app</Button>}
      />

      <section className="in-apps">
        {apps.map((a, i) => (
          <article key={a.name} className="card pad24 col g16 rise in-app" style={{ "--i": i } as React.CSSProperties}>
            <div className="row between">
              <AppTile mark={a.mark} github={a.github} />
              {a.connected ? <Badge status="Completed" label="Connected" /> : <span className="small c3">{a.tools}</span>}
            </div>
            <div className="col g4">
              <h2 className="title">{a.name}</h2>
              <p className="c2">{a.description}</p>
            </div>
            <div className="row between" style={{ marginTop: "auto" }}>
              <span className="small c3">{a.calls}</span>
              {a.connected ? (
                <Button small>Manage</Button>
              ) : (
                <Button variant="p" small onClick={() => connect(a.name)}>
                  Connect
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="in-bottom fill">
        <div className="card col" style={{ minHeight: 0 }}>
          <div className="hd">
            <h2 className="title">GitHub permissions</h2>
            <span className="small c3">Installation 48201, acme</span>
          </div>
          <div className="scroll">
            {githubPermissions.map(([scope, what, level]) => (
              <div key={scope} className="tr" style={{ minHeight: 50 }}>
                <span className="mono" style={{ width: 140 }}>{scope}</span>
                <span className="c2 grow">{what}</span>
                {level === "None" ? (
                  <Badge status="Neutral" label="Not granted" />
                ) : (
                  <span className={`chip${level === "Write" ? " warn" : ""}`}>{level}</span>
                )}
              </div>
            ))}
          </div>
          <div className="row g8 in-repos">
            <span className="small c3">Repositories</span>
            {["acme/web", "acme/billing"].map((r) => (
              <span key={r} className="chip raised">
                <Icon name="repo" size={12} />
                {r}
              </span>
            ))}
            <span className="grow" />
            <a className="link small" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">
              Change on GitHub <Icon name="external" size={13} />
            </a>
          </div>
        </div>

        <div className="card col" style={{ minHeight: 0 }}>
          <div className="hd">
            <h2 className="title">Recent tool calls</h2>
            <span className="link small">View all</span>
          </div>
          <div className="scroll">
            {toolCalls.map((c, i) => (
              <div key={i} className="tr rise" style={{ minHeight: 54, "--i": i } as React.CSSProperties}>
                <AppTile mark={c.mark} github={c.mark === "GH"} size={32} />
                <div className="col grow">
                  <span className="mono">{c.tool}</span>
                  <span className="small c3">{c.ref}</span>
                </div>
                <span className="row" aria-label={c.ok ? "Succeeded" : "Refused"}>
                  <Icon name={c.ok ? "check" : "fail"} size={16} color={c.ok ? "var(--mint)" : "var(--red)"} stroke={2} />
                </span>
                <span className="small c3" style={{ width: 46, textAlign: "right" }}>{c.when} ago</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
