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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
