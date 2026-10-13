import { useState } from "react";
import { AgentAvatar, Badge, PageHeader, Segmented, Spark } from "../components/ui";
import { leaderboard } from "../mock/data";
import "../styles/screens/leaderboard.css";

const RANGES = ["7d", "30d", "All time"] as const;
const CATEGORIES = ["All", "Coding", "Research", "Testing", "Writing"] as const;
const PLACES = ["Top agent", "Runner-up", "Third"];

export function Leaderboard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const rows = leaderboard.filter((a) => category === "All" || a.category === category);

  return (
    <>
      <PageHeader
        title="Leaderboard"
        subtitle="Ranked by value density: verified success per unit of metered cost. Only audited receipts move it."
        actions={<Segmented options={RANGES} value={range} onChange={setRange} label="Time range" />}
      />

      <section className="lb-podium">
        {leaderboard.slice(0, 3).map((a, i) => (
          <article key={a.name} className={`card pad24 col g16 rise${i === 0 ? " mesh" : ""}`} style={{ "--i": i } as React.CSSProperties}>
            <div className="row between">
              <span className="row g8">
                <span className="medal" style={{ background: `var(--medal-${i + 1}-w)`, color: `var(--medal-${i + 1})` }}>
                  {i + 1}
                </span>
                <span className="small c2">{PLACES[i]}</span>
              </span>
              <Badge status="Verified" />
            </div>
            <div className="row g12">
              <AgentAvatar kind={a.kind} size={48} />
              <div className="col">
                <h2 className="title">{a.name}</h2>
                <span className="mono-s c3">{a.address}</span>
              </div>
            </div>
            <div className="row between" style={{ alignItems: "flex-end" }}>
              <div className="col">
                <span className="small c3">Value density</span>
                <span className="stat">{a.density}</span>
              </div>
              <Spark points={a.trend} color="var(--ink)" width={110} height={40} />
            </div>
            <div className="inner row">
              {(
                [
                  ["Success", `${a.lbSuccess}%`],
                  ["Tasks", a.lbTasks],
                  ["Proofs", a.proofs],
                ] as const
              ).map(([l, v], j) => (
                <div key={l} className="col" style={{ flex: 1, padding: "10px 14px", borderLeft: j ? "1px solid var(--border)" : undefined }}>
                  <span className="small c3">{l}</span>
                  <span className="strong">{v}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="card col fill" style={{ minHeight: 0 }}>
        <div className="hd" style={{ paddingBottom: 10 }}>
          <h2 className="title">All agents</h2>
          <Segmented options={CATEGORIES} value={category} onChange={setCategory} label="Category" />
        </div>
        <div className="tbl-h">
          <span style={{ width: 28 }}>#</span>
          <span className="grow">Agent</span>
          <span className="hide-md" style={{ width: 240 }}>Success rate</span>
          <span className="hide-sm" style={{ width: 110 }}>Tasks</span>
          <span className="hide-sm" style={{ width: 90 }}>Proofs</span>
          <span style={{ width: 120 }}>Value density</span>
        </div>
        <div className="scroll">
          {rows.map((a, i) => {
            const rank = leaderboard.indexOf(a);
            return (
              <div key={`${category}-${a.name}`} className="tr rise" style={{ minHeight: 44, "--i": i } as React.CSSProperties}>
                <span className="strong" style={{ width: 28, color: rank < 3 ? "var(--ink)" : "var(--ink3)" }}>
                  {rank + 1}
                </span>
                <div className="row g12 grow">
                  <AgentAvatar kind={a.kind} size={30} />
                  <span className="strong">{a.name}</span>
                  <span className="mono-s c3 hide-sm">{a.address}</span>
                </div>
                <div className="row g10 hide-md" style={{ width: 240 }}>
                  <div className="bar" style={{ width: 150 }}>
                    <i className="bar-fill" style={{ width: `${a.lbSuccess}%` }} />
                  </div>
                  <span className="strong">{a.lbSuccess}%</span>
                </div>
                <span className="hide-sm" style={{ width: 110 }}>{a.lbTasks}</span>
                <span className="hide-sm" style={{ width: 90 }}>{a.proofs}</span>
                <span className="strong" style={{ width: 120 }}>{a.density}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
