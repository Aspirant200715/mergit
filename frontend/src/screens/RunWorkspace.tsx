import { useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AgentAvatar, Badge, Button, Segmented } from "../components/ui";
import { useCopy } from "../components/Toast";
import { nodeDetail, runDetail } from "../mock/data";
import "../styles/screens/run.css";

const NODE_W = 232;
const NODE_H = 58;
const VIEWS = ["Flow", "Timeline", "Files", "Proofs"] as const;
const PANES = ["Details", "Input", "Output", "Logs"] as const;

/* Same geometry as the design: planner on top, three workers, reviewer, proof. */
function layout(width: number) {
  const cx = (width - NODE_W) / 2;
  return {
    p: [cx, 22],
    r: [cx - NODE_W - 40, 114],
    c: [cx, 114],
    t: [cx + NODE_W + 40, 114],
    v: [cx, 206],
    g: [cx, 298],
  } as Record<string, [number, number]>;
}

function edgePath(pos: Record<string, [number, number]>, a: string, b: string) {
  const x1 = pos[a][0] + NODE_W / 2;
  const y1 = pos[a][1] + NODE_H;
  const x2 = pos[b][0] + NODE_W / 2;
  const y2 = pos[b][1];
  const my = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

export function RunWorkspace() {
  const { runId = runDetail.id } = useParams();
  const copy = useCopy();
  const [view, setView] = useState<(typeof VIEWS)[number]>("Flow");
  const [pane, setPane] = useState<(typeof PANES)[number]>("Details");
  const [selected, setSelected] = useState("r");
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(942);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.max(entry.contentRect.width, 3 * NODE_W + 100);
      setWidth(next);
      // On a narrow screen the graph is wider than the card: start centred on it.
      el.scrollLeft = (next - entry.contentRect.width) / 2;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const pos = layout(width);
  const node = runDetail.nodes.find((n) => n.key === selected)!;
  const detail = nodeDetail[selected];

  return (
    <>
      <div className="page-head">
        <div className="col g6">
          <span className="row g6 small c3">
            <Icon name="chevronLeft" size={14} />
            Runs<span className="mono-s">/ {runId}</span>
          </span>
          <div className="row g12">
            <h1 className="h">{runDetail.title}</h1>
            <Badge status="Completed" />
          </div>
          <p className="c2">{runDetail.summary}</p>
        </div>
        <div className="row g10 page-actions">
          <Button icon="share" onClick={() => copy(window.location.href, "Run link copied")}>
            Share
          </Button>
          <Button icon="external">Open PR #134</Button>
          <Button variant="p" icon="rerun" to="/runs/new">
            Rerun
          </Button>
        </div>
      </div>

      <section className="rw-grid fill">
        <div className="col g16" style={{ minHeight: 0 }}>
          <div className="card rw-canvas">
            <div className="rw-canvas-top">
              <Segmented options={VIEWS} value={view} onChange={setView} label="Run view" />
              <div className="row g8 hide-sm">
                <span className="chip">
                  <Icon name="sparkle" size={12} />
                  Planned in 3s
                </span>
                <span className="chip">6 of 6 proofs settled</span>
              </div>
            </div>

            {view === "Flow" && (
              <>
                <div className="dots rw-stage" ref={canvasRef}>
                  <div className="rw-zoom" style={{ transform: `scale(${zoom})`, width }}>
                    <svg width={width} height={420} className="rw-edges" aria-hidden="true">
                      {runDetail.edges.map(([a, b], i) => (
                        <path
                          key={`${a}${b}`}
                          d={edgePath(pos, a, b)}
                          pathLength={1}
                          style={{ animationDelay: `${i * 60}ms` }}
                        />
                      ))}
                    </svg>
                    {runDetail.nodes.map((n, i) => (
                      <button
                        key={n.key}
                        type="button"
                        className={`dnode rise${n.key === selected ? " sel" : ""}`}
                        style={{ left: pos[n.key][0], top: pos[n.key][1], "--i": i } as React.CSSProperties}
                        onClick={() => setSelected(n.key)}
                        aria-pressed={n.key === selected}
                      >
                        <AgentAvatar kind={n.agent} size={32} />
                        <span className="col grow">
                          <span className="strong">{n.name}</span>
                          <span className="small c3 ellipsis">{n.sub}</span>
                        </span>
                        <span className="col" style={{ alignItems: "flex-end", gap: 2 }}>
                          <Icon name="check" size={16} color="var(--mint)" stroke={2} />
                          <span className="mono-s c3">{n.duration}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rw-zoom-ctl">
                  <button type="button" className="small c2" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}>
                    −
                  </button>
                  <button type="button" className="small c2" onClick={() => setZoom(1)} aria-label="Reset zoom">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button type="button" className="small c2" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(1)))}>
                    +
                  </button>
                </div>
              </>
            )}

            {view === "Timeline" && (
              <div className="rw-alt col">
                {runDetail.nodes.map((n, i) => (
                  <button key={n.key} type="button" className="tr rise" style={{ "--i": i, minHeight: 52 } as React.CSSProperties} onClick={() => setSelected(n.key)}>
                    <AgentAvatar kind={n.agent} size={26} />
                    <span className="strong" style={{ width: 110 }}>{n.name}</span>
                    <span className="bar grow" style={{ maxWidth: 420 }}>
                      <i style={{ width: `${[8, 32, 66, 29, 9, 5][i]}%`, marginLeft: `${[0, 7, 7, 7, 73, 82][i]}%` }} />
                    </span>
                    <span className="mono-s c3" style={{ width: 56, textAlign: "right" }}>{n.duration}</span>
                  </button>
                ))}
              </div>
            )}

            {view === "Files" && (
              <div className="rw-alt col">
                {[["src/auth/session.ts", "+5 −2"], ["tests/session.test.ts", "+4, new test"]].map(([f, d], i) => (
                  <div key={f} className="tr rise" style={{ "--i": i, minHeight: 52 } as React.CSSProperties}>
                    <Icon name="file" size={16} color="var(--ink3)" />
                    <span className="mono grow">{f}</span>
                    <span className="mono-s c3">{d}</span>
                  </div>
                ))}
              </div>
            )}

            {view === "Proofs" && (
              <div className="rw-alt col">
                {runDetail.nodes.map((n, i) => (
                  <div key={n.key} className="tr rise" style={{ "--i": i, minHeight: 52 } as React.CSSProperties}>
                    <AgentAvatar kind={n.agent} size={26} />
                    <span className="strong grow">{n.name} receipt</span>
                    <Badge status="Verified" label="Settled" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card col rw-log">
            <div className="hd" style={{ paddingBottom: 8 }}>
              <h2 className="title">Live log</h2>
              <span className="small c3">16 events, streamed</span>
            </div>
            <div className="scroll">
              {runDetail.log.map((l, i) => (
                <div key={l.t} className="row g12 rise" style={{ padding: "6px 20px", "--i": i } as React.CSSProperties}>
                  <span className="mono-s c3" style={{ width: 36 }}>{l.t}</span>
                  <AgentAvatar kind={l.agent} size={20} />
                  <span className="mono" style={{ width: 150 }}>{l.tool}</span>
                  <span className="small c2">{l.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="card pad col g16 rw-panel" key={selected}>
          <div className="row g12 page-enter">
            <AgentAvatar kind={node.agent} size={44} />
            <div className="col g4">
              <h2 className="title">{detail.title}</h2>
              <div className="row g8">
                <Badge status="Completed" />
                <span className="mono-s c3">{detail.time}</span>
              </div>
            </div>
          </div>
          <Segmented options={PANES} value={pane} onChange={setPane} label="Task detail" className="self-start" />
          {pane === "Details" ? (
            <>
              <div className="col g6">
                <span className="cap c3">Summary</span>
                <p className="c2">{detail.summary}</p>
              </div>
              <div className="col g10">
                <span className="cap c3">Tools used</span>
                {detail.tools.map((t) => (
                  <div key={t.name} className="row g12">
                    <span className="tile" style={{ width: 34, height: 34, borderRadius: 10 }}>
                      <Icon name={t.icon} size={16} />
                    </span>
                    <div className="col">
                      <span className="strong">{t.name}</span>
                      <span className="small c3">{t.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rw-meta">
                {detail.meta.map(([k, v]) => (
                  <div key={k} className="inner col" style={{ padding: "8px 12px" }}>
                    <span className="small c3">{k}</span>
                    <span className="strong small">{v}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <pre className="inner code rw-pre">
              {pane === "Input"
                ? `task: ${node.sub}\nrun: ${runId}\ncontext:\n  - slack #backend thread\n  - repo acme/web`
                : pane === "Output"
                  ? `result: ${detail.result}\nduration: ${detail.time}\nstatus: completed`
                  : runDetail.log.filter((l) => l.agent === node.agent).map((l) => `${l.t}  ${l.tool}  ${l.detail}`).join("\n") || "No tool calls for this task."}
            </pre>
          )}
          <div className="inner col g8" style={{ padding: 14, marginTop: "auto" }}>
            <span className="cap c3">Result</span>
            <div className="row g8">
              <Icon name="check" size={16} color="var(--mint)" stroke={2} />
              <span className="strong">{detail.result}</span>
            </div>
            <button type="button" className="link" onClick={() => setPane("Output")} style={{ alignSelf: "flex-start" }}>
              View output <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}
