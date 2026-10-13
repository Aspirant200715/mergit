import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { AgentAvatar, Badge, Button, PageHeader, Segmented } from "../components/ui";
import { agents } from "../mock/data";
import "../styles/screens/agents.css";

const CATEGORIES = ["All", "Coding", "Research", "Testing", "Writing"] as const;
const SORTS = ["success", "tasks", "name"] as const;

export function Agents() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<(typeof SORTS)[number] | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = agents.filter(
      (a) =>
        (category === "All" || a.category === category) &&
        (!verifiedOnly || a.proofs > 0) &&
        (!q || `${a.name} ${a.description} ${a.tags.join(" ")}`.toLowerCase().includes(q)),
    );
    if (sort === "success") return [...filtered].sort((a, b) => b.success - a.success);
    if (sort === "tasks") return [...filtered].sort((a, b) => b.tasks - a.tasks);
    if (sort === "name") return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [query, category, verifiedOnly, sort]);

  const nextSort = () => setSort((s) => SORTS[(SORTS.indexOf(s ?? "name") + 1) % SORTS.length]);

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Six specialists, each with a model you choose and an ERC-8004 identity on chain."
        actions={
          <Button variant="p" icon="plus">
            Create agent
          </Button>
        }
      />
      <div className="row g12 ag-tools">
        <label className="input ag-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents" aria-label="Search agents" />
        </label>
        <Segmented options={CATEGORIES} value={category} onChange={setCategory} label="Category" />
        <span className="grow" />
        <button type="button" className={`chipo${verifiedOnly ? " on" : ""}`} aria-pressed={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>
          <Icon name="proofs" size={14} color="var(--mint)" stroke={2} />
          Verified only
        </button>
        <button type="button" className="chipo" onClick={nextSort}>
          Sort by {sort ?? "success"}
          <Icon name="chevronDown" size={14} />
        </button>
      </div>

      <section className="ag-grid fill">
        {list.map((a, i) => (
          <article key={a.name} className="card pad24 col g16 rise ag-card" style={{ "--i": i } as React.CSSProperties}>
            <div className="row g12">
              <AgentAvatar kind={a.kind} size={48} />
              <div className="col grow">
                <h2 className="title">{a.name}</h2>
                <span className="small c3">{a.tasks} tasks settled</span>
              </div>
              <Badge status="Verified" />
            </div>
            <p className="c2">{a.description}</p>
            <div className="row g6">
              {a.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <div className="inner row" style={{ marginTop: "auto" }}>
              {(
                [
                  ["Success", `${a.success}%`],
                  ["Median", a.median],
                  ["Model", a.model],
                ] as const
              ).map(([l, v], j) => (
                <div
                  key={l}
                  className="col"
                  style={{ padding: "10px 14px", borderLeft: j ? "1px solid var(--border)" : undefined, flex: j === 2 ? 1.6 : 1, minWidth: 0 }}
                >
                  <span className="small c3">{l}</span>
                  <span className="strong ellipsis">{v}</span>
                </div>
              ))}
            </div>
            <div className="row between">
              <span className="mono-s c3">{a.address}</span>
              <Link to="/wallet" className="link small">
                View identity <Icon name="arrowRight" size={13} />
              </Link>
            </div>
          </article>
        ))}
        {list.length === 0 && <p className="c3">No agents match “{query}”.</p>}
      </section>
    </>
  );
}
