import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Spark } from "./Icons";

type Theme = "light" | "dark";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const LINKS = [
  { to: "/", label: "Create" },
  { to: "/workspace", label: "Workspace" },
  { to: "/editor", label: "Editor" },
  { to: "/chat", label: "Chat" },
  { to: "/assets", label: "Library" },
];

export default function TopNav() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = document.documentElement.dataset.theme;
    return current === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("field-theme", theme);
  }, [theme]);

  return (
    <header className="topnav">
      <NavLink to="/" className="brand">
        <span className="brand-mark"><Spark size={14} /></span>
        <span className="brand-name">Field</span>
      </NavLink>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.to === "/"}
          className={({ isActive }) => `navlink${isActive ? " active" : ""}`}
        >
          {link.label}
        </NavLink>
      ))}
      <div className="topnav-right">
        <select
          className="theme-toggle"
          aria-label="Visual theme"
          value={theme}
          onChange={(event) => setTheme(event.target.value as Theme)}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
