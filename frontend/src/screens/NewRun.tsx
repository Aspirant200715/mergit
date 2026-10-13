import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AgentAvatar, Badge, Switch } from "../components/ui";
import { useToast } from "../components/Toast";
import { askBefore, defaultPrompt, draftPlan, templates } from "../mock/data";
import "../styles/screens/newrun.css";

const LIMIT = 2000;

export function NewRun() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [asks, setAsks] = useState(askBefore);
  const navigate = useNavigate();
  const toast = useToast();

  const start = () => {
    if (!prompt.trim()) return;
    toast("Run started");
    navigate("/runs/RUN-2048");
  };

  return (
    <div className="nr-wrap">
      <div className="col g20 nr-col">
        <div className="col g6 nr-head">
          <span className="chip">
            <Icon name="sparkle" size={12} />
            New run
          </span>
          <h1 className="display">Describe the outcome, not the steps</h1>
          <p className="c2">Mergit plans the work, picks the agents, asks before risky writes, and settles every finished task as a proof.</p>
        </div>

        <div className="card nr-composer">
          <textarea
            className="nr-input"
            value={prompt}
            maxLength={LIMIT}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
            aria-label="Describe the outcome"
            placeholder="Describe what should be true when the run is done"
          />
          <div className="row g8 nr-bar">
            <button type="button" className="chipo">
              <Icon name="attach" size={14} />
              Attach
            </button>
            <button type="button" className="chipo">
              <Icon name="repo" size={14} />
              acme/billing
            </button>
            <button type="button" className="chipo hide-sm">
              <Icon name="link" size={14} />
              #backend thread
            </button>
            <span className="grow" />
            <span className="mono-s c3">
              {prompt.length.toLocaleString()} / {LIMIT.toLocaleString()}
            </span>
            <button type="button" className="btn p nr-send" onClick={start} aria-label="Start run" disabled={!prompt.trim()}>
              <Icon name="arrowUp" size={16} stroke={2} />
            </button>
          </div>
        </div>

        <div className="nr-grid">
          <div className="card col">
            <div className="hd" style={{ paddingBottom: 8 }}>
              <h2 className="title">Draft plan</h2>
              <span className="small c3">6 tasks, 4 apps, planned in 3s</span>
            </div>
            {draftPlan.map((p, i) => (
              <div key={p.task} className="row g12 nr-step rise" style={{ "--i": i } as React.CSSProperties}>
                <span className="mono-s c3" style={{ width: 16 }}>t{i + 1}</span>
                <AgentAvatar kind={p.agent} size={26} />
                <div className="col grow">
                  <span className="strong">{p.task}</span>
                  <span className="mono-s c3">{p.tools}</span>
                </div>
                {p.gate && <Badge status="Waiting" label="Asks you" />}
              </div>
            ))}
          </div>
          <div className="col g16">
            <div className="card pad col g12">
              <h2 className="title">Ask me before</h2>
              {asks.map((a, i) => (
                <div key={a.label} className="row between">
                  <span className="c2">{a.label}</span>
                  <Switch
                    checked={a.on}
                    label={a.label}
                    onChange={(on) => setAsks((list) => list.map((x, j) => (j === i ? { ...x, on } : x)))}
                  />
                </div>
              ))}
              <span className="small c3">Unanswered asks expire in 10s and the task stops instead of guessing.</span>
            </div>
            <div className="card pad col g10">
              <h2 className="title">Start from</h2>
              {templates.map((t) => (
                <button key={t} type="button" className="row between nr-template" onClick={() => setPrompt(`${t}: `)}>
                  <span className="c2">{t}</span>
                  <Icon name="chevronRight" size={14} color="var(--ink3)" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
