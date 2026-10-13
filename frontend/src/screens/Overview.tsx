import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AgentAvatar, AvatarStack, Badge, Button, Segmented, Spark } from "../components/ui";
import { useToast } from "../components/Toast";
import { CHAIN_LABEL, activity, approvals as initialApprovals, me, overviewStats, runs } from "../mock/data";
import "../styles/screens/overview.css";

const FILTERS = ["All", "Running", "Needs you", "Failed"] as const;
type Filter = (typeof FILTERS)[number];

const MATCH: Record<Filter, (s: string) => boolean> = {
  All: () => true,
  Running: (s) => s === "Running",
  "Needs you": (s) => s === "Waiting",
  Failed: (s) => s === "Failed",
};

export function Overview() {
  const [filter, setFilter] = useState<Filter>("All");
  const [pending, setPending] = useState(initialApprovals);
  const toast = useToast();
  const visible = runs.filter((r) => MATCH[filter](r.status));

  const resolve = (id: string, approved: boolean) => {
    setPending((p) => p.filter((a) => a.id !== id));
    toast(approved ? "Approved, the agent will continue" : "Denied, the task will stop");
  };

  return (
    <>
      <div className="page-head">
        <div className="col g4">
          <h1 className="display">Good morning, {me.name}</h1>
          <p className="c2">Your agents settled 16 proofs this week. Two actions are waiting on you.</p>
        </div>
        <div className="row g10 page-actions">
          <Button icon="clock">Last 7 days</Button>
          <Button variant="p" icon="plus" to="/runs/new">
            New run
          </Button>
        </div>
      </div>

      <section className="ov-stats">
        <div className="card pad24 col between mesh ov-stat">
          <div className="row between">
            <Badge status="Verified" label="Verified receipts" />
            <Link to="/wallet" className="link">
              Open ledger <Icon name="arrowUp" size={14} />
            </Link>
          </div>
          <div className="col g4">
            <div className="row g10" style={{ alignItems: "baseline" }}>
              <span className="ov-big">16</span>
              <span className="title c2" style={{ fontWeight: 500 }}>
                proofs settled on {CHAIN_LABEL}
              </span>
            </div>
            <div className="row g8 c2 small ov-latest">
              Latest <span className="mono" style={{ color: "var(--ink)" }}>0x7b2d…4e91</span> at block{" "}
              <span className="mono" style={{ color: "var(--ink)" }}>18,431,207</span>, 17m ago
            </div>
          </div>
          <div className="row g8">
            <AvatarStack agents={["Planner", "Research", "Coder", "Tester", "Reviewer"]} />
            <span className="small c2">5 agents contributed, 0 silent failures</span>
          </div>
        </div>
        {overviewStats.map((s) => (
          <div key={s.label} className="card pad24 col between ov-stat">
            <div className="row between">
              <span className="c2 strong">{s.label}</span>
              <Icon name="arrowUp" size={16} color="var(--ink3)" />
            </div>
            <div className="row between" style={{ alignItems: "flex-end" }}>
              <div className="col g4">
                <span className="stat">{s.value}</span>
                <span className={`small ${s.sub.startsWith("+") ? "cm" : "c3"}`}>{s.sub}</span>
              </div>
              <Spark points={s.trend} />
            </div>
          </div>
        ))}
      </section>

      <section className="ov-bottom fill">
        <div className="card col" style={{ minHeight: 0 }}>
          <div className="hd">
            <h2 className="title">Recent runs</h2>
            <div className="row g12">
              <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Filter runs" />
              <Link to="/runs/RUN-2048" className="link">
                View all
              </Link>
            </div>
          </div>
          <div className="tbl-h">
            <span className="grow">Run</span>
            <span className="hide-md" style={{ width: 130 }}>Agents</span>
            <span className="hide-md" style={{ width: 90 }}>Apps</span>
            <span className="hide-sm" style={{ width: 84 }}>Started</span>
            <span style={{ width: 130 }}>Status</span>
          </div>
          <div className="scroll">
            {visible.map((r, i) => (
              <Link key={`${filter}-${r.id}`} to="/runs/RUN-2048" className="tr rise" style={{ "--i": i } as React.CSSProperties}>
                <div className="col grow">
                  <span className="strong ellipsis">{r.title}</span>
                  <span className="small c3">
                    <span className="mono-s">{r.id}</span>&nbsp;&nbsp;{r.source}
                  </span>
                </div>
                <span className="hide-md" style={{ width: 130 }}>
                  <AvatarStack agents={r.agents} />
                </span>
                <div className="row g4 hide-md" style={{ width: 90 }}>
                  {r.apps.map((a) => (
                    <span key={a} className="app-tag">
                      {a}
                    </span>
                  ))}
                </div>
                <span className="small c2 hide-sm" style={{ width: 84 }}>
                  {r.started}
                </span>
                <span style={{ width: 130 }}>
                  <Badge status={r.status} />
                </span>
              </Link>
            ))}
            {visible.length === 0 && <p className="small c3" style={{ padding: "20px" }}>No runs match this filter.</p>}
          </div>
        </div>

        <div className="col g16" style={{ minHeight: 0 }}>
          <div className="card pad col g12">
            <div className="row between">
              <h2 className="title">Needs you</h2>
              {pending.length > 0 ? (
                <span className="badge b-wait">
                  <Icon name="hand" size={13} stroke={2} />
                  {pending.length} waiting
                </span>
              ) : (
                <Badge status="Completed" label="All clear" />
              )}
            </div>
            {pending.map((a) => (
              <div key={a.id} className="inner col g8 rise" style={{ padding: "12px 14px" }}>
                <div className="row between">
                  <span className="mono">{a.tool}</span>
                  <span className="mono-s ca">expires {a.expires}s</span>
                </div>
                <span className="small c2">{a.summary}</span>
                <div className="row g8">
                  <Button variant="p" small onClick={() => resolve(a.id, true)}>
                    Approve
                  </Button>
                  <Button small onClick={() => resolve(a.id, false)}>
                    Deny
                  </Button>
                  <span className="grow" />
                  <AgentAvatar kind="Reviewer" size={20} />
                </div>
              </div>
            ))}
            {pending.length === 0 && <p className="small c3">Nothing is waiting on you. New asks show up here.</p>}
          </div>

          <div className="card pad col g12" style={{ flex: 1, minHeight: 170 }}>
            <div className="row between">
              <h2 className="title">Task activity</h2>
              <div className="row g12 small c2">
                <span className="row g6">
                  <i className="legend" style={{ background: "var(--ink)" }} />
                  Completed
                </span>
                <span className="row g6">
                  <i className="legend" style={{ background: "var(--fail-bar)" }} />
                  Failed
                </span>
              </div>
            </div>
            <div className="ov-chart">
              {activity.map((d, i) => (
                <div key={d.day} className="ov-bar-group" title={`${d.day}: ${d.completed} completed, ${d.failed} failed`}>
                  <i className="ov-bar" style={{ height: d.completed * 4, background: "var(--ink)", "--i": i } as React.CSSProperties} />
                  {d.failed > 0 && (
                    <i className="ov-bar" style={{ height: Math.max(d.failed * 4, 5), background: "var(--fail-bar)", "--i": i } as React.CSSProperties} />
                  )}
                </div>
              ))}
            </div>
            <div className="row between small c3" style={{ padding: "0 6px" }}>
              {activity.map((d) => (
                <span key={d.day}>{d.day}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
