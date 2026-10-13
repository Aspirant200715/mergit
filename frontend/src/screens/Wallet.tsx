import { Link } from "react-router-dom";
import { Icon, BrandMark } from "../components/Icon";
import { AgentAvatar, Badge, Button, PageHeader, Spark } from "../components/ui";
import { useCopy } from "../components/Toast";
import { me, wallet } from "../mock/data";
import "../styles/screens/wallet.css";

export function Wallet() {
  const copy = useCopy();
  return (
    <>
      <PageHeader
        title="Wallet and identity"
        subtitle="The key that signs receipts, where they settle, and the identity each agent carries."
        actions={
          <>
            <Button icon="link">Switch chain</Button>
            <Button variant="p" icon="plus">
              Fund wallet
            </Button>
          </>
        }
      />

      <section className="wl-top">
        <div className="wl-card">
          <div className="row between">
            <div className="row g8">
              <BrandMark size={28} />
              <span className="strong">Signing wallet</span>
            </div>
            <Badge status="Completed" label="Connected" style={{ background: "var(--glass-badge)" }} />
          </div>
          <div className="col g4">
            <span className="small c2">Balance</span>
            <span className="wl-balance">
              {wallet.balance} <span className="wl-unit">{wallet.unit}</span>
            </span>
          </div>
          <div className="row between">
            <span className="mono" style={{ fontSize: 14 }}>{me.addressLong}</span>
            <button type="button" className="row g6 small c2 wl-copy" onClick={() => copy("0x6E2d4A9c…9A0b", "Address copied")}>
              <Icon name="copy" size={14} />
              Copy
            </button>
          </div>
        </div>

        <div className="card pad24 col g16">
          <div className="row between">
            <h2 className="title">Agent identity</h2>
            <Badge status="Verified" label="ERC-8004" />
          </div>
          <div className="row g16">
            <AgentAvatar kind="Planner" size={56} />
            <div className="col g4 grow">
              <span className="h" style={{ fontSize: 20 }}>{wallet.identity.name}</span>
              <span className="mono-s c3">{wallet.identity.did}</span>
            </div>
          </div>
          <div className="wl-stats">
            {wallet.identity.stats.map(([l, v]) => (
              <div key={l} className="inner col" style={{ padding: "12px 14px" }}>
                <span className="small c3">{l}</span>
                <span className="stat" style={{ fontSize: 24, lineHeight: "30px" }}>{v}</span>
              </div>
            ))}
          </div>
          <span className="small c3">{wallet.identity.note}</span>
        </div>
      </section>

      <section className="wl-bottom fill">
        <div className="card col" style={{ minHeight: 0 }}>
          <div className="hd">
            <h2 className="title">Proof outbox</h2>
            <span className="small c3">retries every 15s</span>
          </div>
          <div className="row g12" style={{ padding: "0 20px 14px" }}>
            {wallet.outbox.map(([l, v, c]) => (
              <div key={l} className="inner col" style={{ flex: 1, padding: 12 }}>
                <span className="small c3">{l}</span>
                <span className="title" style={{ color: c, fontSize: 20 }}>{v}</span>
              </div>
            ))}
          </div>
          {wallet.contracts.map(([n, a]) => (
            <button key={n} type="button" className="tr" style={{ minHeight: 46 }} onClick={() => copy(a, `${n} address copied`)}>
              <span className="strong grow">{n}</span>
              <span className="mono c2">{a}</span>
              <Icon name="external" size={14} color="var(--ink3)" />
            </button>
          ))}
          <div className="col g6" style={{ marginTop: "auto", padding: "16px 20px" }}>
            <div className="row between">
              <span className="small c3">Settlement lag, today</span>
              <span className="mono-s">median 41s</span>
            </div>
            <div className="wl-lag">
              <Spark points={wallet.lag} color="var(--mint)" width={338} height={52} />
            </div>
          </div>
        </div>

        <div className="card col" style={{ minHeight: 0 }}>
          <div className="hd">
            <h2 className="title">Recent settlements</h2>
            <Link to="/proofs" className="link small">
              All proofs
            </Link>
          </div>
          <div className="tbl-h">
            <span className="grow">Task</span>
            <span className="hide-md" style={{ width: 100 }}>Block</span>
            <span className="hide-sm" style={{ width: 110 }}>Transaction</span>
            <span style={{ width: 120 }}>Status</span>
            <span className="hide-sm" style={{ width: 60, textAlign: "right" }}>When</span>
          </div>
          <div className="scroll">
            {wallet.settlements.map((s, i) => (
              <Link key={s.tx} to="/proofs/1840" className="tr rise" style={{ minHeight: 48, "--i": i } as React.CSSProperties}>
                <div className="row g10 grow">
                  <AgentAvatar kind={s.agent} size={26} />
                  <span className="strong ellipsis">{s.task}</span>
                </div>
                <span className="mono c2 hide-md" style={{ width: 100 }}>{s.block}</span>
                <span className={`mono hide-sm ${s.settled ? "cz" : "c3"}`} style={{ width: 110 }}>{s.tx}</span>
                <span style={{ width: 120 }}>
                  {s.settled ? <Badge status="Verified" label="Settled" /> : <Badge status="Running" label="Awaiting chain" />}
                </span>
                <span className="small c3 hide-sm" style={{ width: 60, textAlign: "right" }}>{s.when} ago</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
