import { useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BrandMark, Icon, type IconName } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { me } from "../mock/data";

const TABS: [string, IconName, string][] = [
  ["Overview", "overview", "/"],
  ["Runs", "runs", "/runs"],
  ["Agents", "agents", "/agents"],
  ["Proofs", "proofs", "/proofs"],
  ["Leaderboard", "trophy", "/leaderboard"],
  ["Integrations", "plug", "/integrations"],
];

function activeTab(pathname: string) {
  if (pathname === "/") return "/";
  return TABS.find(([, , to]) => to !== "/" && pathname.startsWith(to))?.[2] ?? null;
}

export function TopNav() {
  const { pathname } = useLocation();
  const active = activeTab(pathname);
  const tabsRef = useRef<HTMLElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(".tab.on");
      setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [active]);

  return (
    <header className="nav">
      <div className="brand">
        <Link to="/" className="row g10" aria-label="Mergit home">
          <BrandMark />
          Mergit
        </Link>
        <span className="chip repo-chip">{me.repo}</span>
      </div>

      <nav className="tabs" ref={tabsRef} aria-label="Primary">
        {thumb && <span className="tab-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
        {TABS.map(([label, icon, to]) => (
          <NavLink key={to} to={to} className={`tab${active === to ? " on" : ""}`} aria-current={active === to ? "page" : undefined}>
            <Icon name={icon} size={15} />
            <span className="tab-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="navr">
        <button type="button" className="iconbtn" aria-label="Search">
          <Icon name="search" size={16} />
        </button>
        <button type="button" className="iconbtn" aria-label="Notifications, 2 waiting">
          <Icon name="bell" size={16} />
          <span className="dotn">2</span>
        </button>
        <ThemeToggle />
        <NavLink to="/wallet" className={({ isActive }) => `pill wallet-pill${isActive ? " on" : ""}`} aria-label="Wallet and identity">
          <span className="orb" />
          <span className="mono">{me.address}</span>
        </NavLink>
        <span className="avatarme" aria-label="Signed in as Alex">
          {me.initials}
        </span>
      </div>
    </header>
  );
}
