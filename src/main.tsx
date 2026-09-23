import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const requestedTheme = new URLSearchParams(window.location.search).get("theme");
const storedTheme = localStorage.getItem("field-theme");
const validThemes = new Set(["light", "dark"]);
const savedTheme = requestedTheme && validThemes.has(requestedTheme)
  ? requestedTheme
  : storedTheme;

document.documentElement.dataset.theme = savedTheme && validThemes.has(savedTheme) ? savedTheme : "light";
const mockupRestoreKey = "field-mockup-restore";
if (!window.location.pathname.endsWith("-mockup")) {
  const serialized = sessionStorage.getItem(mockupRestoreKey);
  if (serialized) {
    try {
      const snapshot = JSON.parse(serialized) as Record<string, string | null>;
      Object.entries(snapshot).forEach(([key, value]) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
    } catch {
      // Ignore a malformed disposable mockup snapshot.
    }
    sessionStorage.removeItem(mockupRestoreKey);
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
