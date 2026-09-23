import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Spark } from "./Icons";
const LINKS = [
  { to: "/", label: "Create" },
  { to: "/workspace", label: "Workspace" },
  { to: "/editor", label: "Editor" },
  { to: "/chat", label: "Chat" },
];

export default function TopNav() {
  const location = useLocation();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const theme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("field-theme", theme);
  }, [dark]);
  return (
    <header className="topnav">
      <NavLink to="/" className="brand">
        <span className="brand-mark">
          <Spark size={14} />
        </span>
        <span className="brand-name">Field</span>
      </NavLink>
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === "/"}
          className={({ isActive }) => `navlink${isActive || (l.to === "/launch" && location.pathname === "/launchframe") ? " active" : ""}`}
        >
          {l.label}
        </NavLink>
      ))}
      <div className="topnav-right">
        <button className="theme-toggle" onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} mode`}>
          <span aria-hidden="true">◐</span>
          <span>{dark ? "Dark" : "Light"}</span>
        </button>
        <NavLink to="/pricing" className="navlink">
          Pricing
        </NavLink>
      </div>
    </header>
  );
}
