import { useState } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AgentAvatar, Badge, Button, PageHeader, Segmented } from "../components/ui";
import { useCopy } from "../components/Toast";
import { proof } from "../mock/data";
import "../styles/screens/proof.css";

const TABS = ["Diff", "Canonical output", "Tool results"] as const;

function DiffLine({ n, kind, text }: { n: number; kind: " " | "+" | "-"; text: string }) {
  const cls = kind === "+" ? "add" : kind === "-" ? "rem" : "";
  const sign = kind === "+" ? "var(--mint)" : kind === "-" ? "var(--red)" : "var(--ink3)";
  return (
    <div className={`l ${cls}`}>
      <span className="n">{n}</span>
      <span style={{ width: 10, color: sign }}>{kind}</span>
      <pre style={{ color: kind === " " ? "var(--ink2)" : "var(--ink)" }}>{text}</pre>
    </div>
  );
}

function FileHeader({ name, add, note }: { name: string; add: string; note: React.ReactNode }) {
  return (
    <div className="row g8 pf-file">
      <Icon name="file" size={14} color="var(--ink3)" />
      <span className="mono grow">{name}</span>
      <span className="mono-s cm">{add}</span>
      {note}
    </div>
  );
}

export function ProofDetail() {
  const { proofId = "1840" } = useParams();
  const copy = useCopy();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Diff");

  return (
    <>
      <PageHeader
        title="Work proof"
        crumb={{ label: "Proofs", to: "/proofs", id: `#${proofId}` }}
        badge={<Badge status="Verified" />}
        subtitle="A public receipt anyone can check against the chain."
        actions={
          <>
            <Button icon="link" onClick={() => copy(window.location.href, "Proof link copied")}>
              Copy link
            </Button>
            <Button variant="p" icon="external">
              View on explorer
            </Button>
          </>
        }
      />

      <section className="pf-grid fill">
        <div className="card col" style={{ overflow: "hidden", minHeight: 0 }}>
          <div className="mesh col g16 pf-hero">
            <div className="row g12">
              <span className="ring pf-ring">
                <Icon name="tick" size={22} color="var(--mint)" stroke={2.4} />
              </span>
              <div className="col">
                <h2 className="title">Hashes match</h2>
                <span className="small c2">Recomputed from the canonical output just now</span>
              </div>
            </div>
            <div className="col g6">
              <span className="cap c3">Artifact hash, SHA-256</span>
              <button type="button" className="row between pf-hash" onClick={() => copy(proof.artifactHashFull, "Hash copied")} aria-label="Copy artifact hash">
                <span className="mono">{proof.artifactHash}</span>
                <Icon name="copy" size={15} color="var(--ink3)" />
              </button>
            </div>
          </div>
          <div className="pad24 col scroll" style={{ paddingTop: 12 }}>
            {proof.facts.map(([k, v, kind]) => (
              <div key={k} className="kv">
                <span className="c3">{k}</span>
                <span className={kind === "tx" ? "mono cz" : kind === "mono" ? "mono" : undefined}>{v}</span>
              </div>
            ))}
            <div className="col g8" style={{ marginTop: 18 }}>
              <span className="cap c3">Agent identity</span>
              <div className="inner row g12" style={{ padding: "12px 14px" }}>
                <AgentAvatar kind="Coder" size={36} />
                <div className="col grow">
                  <span className="strong">Code agent</span>
                  <span className="mono-s c3">0x12ab…89cd</span>
                </div>
                <Badge status="Verified" label="ERC-8004" />
              </div>
            </div>
            <div className="col g8" style={{ marginTop: 18 }}>
              <span className="cap c3">Settlement</span>
              <div className="row" style={{ alignItems: "flex-start" }}>
                {proof.timeline.map(([label, t], i) => (
                  <div key={label} className="col g4" style={{ flex: 1 }}>
                    <div className="row">
                      <span className="pf-dot" style={{ animationDelay: `${i * 140}ms` }} />
                      {i < proof.timeline.length - 1 && <i className="pf-line" style={{ animationDelay: `${i * 140 + 70}ms` }} />}
                    </div>
                    <span className="small strong">{label}</span>
                    <span className="mono-s c3">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col g16" style={{ minHeight: 0 }}>
          <div className="card row g16 pad">
            <span className="tile" style={{ width: 48, height: 48, borderRadius: 14 }}>
              <Icon name="github" size={24} />
            </span>
            <div className="col grow">
              <h2 className="title">PR #134, fix authentication bug</h2>
              <span className="small c2">acme/web, commit c41e9d2, generated by Code agent 2h ago</span>
            </div>
            <Badge status="Completed" label="Merged" />
          </div>

          <div className="card col" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div className="hd">
              <h2 className="title">Artifact</h2>
              <Segmented options={TABS} value={tab} onChange={setTab} label="Artifact view" />
            </div>
            <div className="scroll page-enter" key={tab}>
              {tab === "Diff" && (
                <>
                  <FileHeader name="src/auth/session.ts" add="+5" note={<span className="mono-s cr">−2</span>} />
                  <div className="code" style={{ padding: "8px 0" }}>
                    {proof.diff.map(([n, k, t], i) => (
                      <DiffLine key={i} n={n} kind={k} text={t} />
                    ))}
                  </div>
                  <FileHeader name="tests/session.test.ts" add="+4" note={<span className="mono-s c3">new test</span>} />
                  <div className="code" style={{ padding: "8px 0" }}>
                    {proof.testDiff.map(([n, k, t]) => (
                      <DiffLine key={n} n={n} kind={k} text={t} />
                    ))}
                  </div>
                </>
              )}
              {tab === "Canonical output" && (
                <div className="code" style={{ padding: "12px 0" }}>
                  {proof.canonical.map((line, i) => (
                    <DiffLine key={i} n={i + 1} kind=" " text={line} />
                  ))}
                </div>
              )}
              {tab === "Tool results" &&
                proof.toolResults.map(([tool, ref]) => (
                  <div key={tool} className="tr" style={{ minHeight: 50 }}>
                    <span className="mono" style={{ width: 200 }}>{tool}</span>
                    <span className="small c2 grow">{ref}</span>
                    <Icon name="check" size={16} color="var(--mint)" stroke={2} />
                  </div>
                ))}
            </div>
            <div className="row g16 pf-checks">
              {proof.checks.map((c) => (
                <span key={c} className="row g6 small c2">
                  <Icon name="check" size={14} color="var(--mint)" stroke={2} />
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
