import { useState } from "react";
import { useNavigate } from "react-router-dom";
import FeedCard from "../components/FeedCard";
import { useFeed, type FeedModel } from "../lib/hf";

const TABS = ["All", "Video", "Image"] as const;

export default function Explore() {
  const nav = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const type = tab === "All" ? undefined : tab.toLowerCase();
  const { items, state, retry } = useFeed(1, 24, type);

  const open = (m: FeedModel) => nav(m.type === "image" ? "/image" : "/video");

  return (
    <div className="app-scroll">
      <div className="page wide">
        <h1 className="page-title">Explore</h1>
        <p className="page-sub">Live from the Higgsfield catalog. Pick a model and start from there.</p>

        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {state === "loading" && (
          <div className="gallery">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}
          </div>
        )}
        {state === "error" && (
          <div className="explore-state">
            <span>Couldn't reach the catalog.<br /><button className="chip" onClick={retry}>Try again</button></span>
          </div>
        )}
        {state === "ready" && (
          <div className="gallery">
            {items.map((m) => (
              <FeedCard key={m.mode} m={m} onOpen={() => open(m)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
