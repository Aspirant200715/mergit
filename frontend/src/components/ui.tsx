import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import type { AgentKind, Status } from "../mock/data";

/* ---------- Agent avatar ---------- */

const AGENT_ICON: Record<AgentKind, IconName> = {
  Planner: "overview",
  Research: "search",
  Coder: "agents",
  Tester: "tick",
  Reviewer: "proofs",
  Proof: "cube",
};

export function AgentAvatar({ kind, size = 32 }: { kind: AgentKind; size?: number }) {
  const key = kind.toLowerCase();
  return (
    <span
      className="av"
      title={kind}
      style={{ width: size, height: size, background: `var(--${key}-w)` }}
    >
      <Icon name={AGENT_ICON[kind]} size={Math.round(size / 2)} color={`var(--${key})`} />
    </span>
  );
}

export function AvatarStack({ agents, size = 26 }: { agents: AgentKind[]; size?: number }) {
  return (
    <span className="stack">
      {agents.map((a) => (
        <AgentAvatar key={a} kind={a} size={size} />
      ))}
    </span>
  );
}

/* ---------- Status badge: icon plus word ---------- */

const BADGE: Record<Status, [string, IconName, string]> = {
  Completed: ["b-ok", "check", "Completed"],
  Verified: ["b-ok", "proofs", "Verified"],
  Running: ["b-run", "running", "Running"],
  Waiting: ["b-wait", "hand", "Needs approval"],
  Failed: ["b-fail", "fail", "Failed"],
  Neutral: ["b-n", "clock", "Queued"],
};

export function Badge({ status, label, style }: { status: Status; label?: string; style?: React.CSSProperties }) {
  const [cls, icon, fallback] = BADGE[status];
  return (
    <span className={`badge ${cls}`} style={style}>
      <Icon name={icon} size={13} stroke={2} className={status === "Running" ? "spin" : undefined} />
      {label ?? fallback}
    </span>
  );
}

/* ---------- Buttons ---------- */

type ButtonProps = {
  children: ReactNode;
  variant?: "p" | "s" | "soft" | "a";
  icon?: IconName;
  small?: boolean;
  to?: string;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
};

export function Button({ children, variant = "s", icon, small, to, onClick, className = "", ariaLabel }: ButtonProps) {
  const cls = `btn ${variant}${small ? " sm" : ""} ${className}`.trim();
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel}>
      {content}
    </button>
  );
}

/* ---------- Segmented control with a sliding thumb ---------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>('[aria-checked="true"]');
      if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Fonts load after first layout, which changes button widths.
    const ro = new ResizeObserver(measure);
    root.querySelectorAll("button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [value]);

  return (
    <div ref={ref} className={`seg ${className ?? ""}`} role="radiogroup" aria-label={label}>
      {thumb && <span className="thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={o === value ? "on" : ""}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------- Sparkline ---------- */

export function Spark({
  points,
  color = "var(--azure)",
  width = 96,
  height = 36,
  fill = true,
}: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * width,
    height - 3 - ((p - min) / (max - min || 1)) * (height - 8),
  ]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" style={{ flex: "none" }}>
      {fill && <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} fillOpacity={0.08} />}
      <path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="spark-line" />
      <circle cx={last[0] - 2} cy={last[1]} r={3} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

/* ---------- Page header ---------- */

export function PageHeader({
  title,
  subtitle,
  crumb,
  badge,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  crumb?: { label: string; to: string; id: string };
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className={`col ${crumb ? "g6" : "g4"}`}>
        {crumb && (
          <Link to={crumb.to} className="row g6 small c3 crumb">
            <Icon name="chevronLeft" size={14} />
            {crumb.label}
            <span className="mono-s">/ {crumb.id}</span>
          </Link>
        )}
        {crumb ? (
          <div className="row g12">
            <h1 className="h">{title}</h1>
            {badge}
          </div>
        ) : (
          <h1 className="display">{title}</h1>
        )}
        <p className="c2">{subtitle}</p>
      </div>
      {actions && <div className="row g10 page-actions">{actions}</div>}
    </div>
  );
}

/* ---------- App tile (integration logos) ---------- */

export function AppTile({ mark, github, size = 48 }: { mark: string; github?: boolean; size?: number }) {
  return (
    <span className="tile" style={{ width: size, height: size, borderRadius: size >= 40 ? 14 : 10 }}>
      {github ? (
        <Icon name="github" size={Math.round(size / 2)} />
      ) : (
        <span style={{ fontWeight: 600, fontSize: size / 3 }}>{mark}</span>
      )}
    </span>
  );
}
