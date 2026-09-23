import { useEffect, useMemo, useState } from "react";
import { Spark, ImageIc, VideoIc, X } from "./Icons";
import { type FeedModel, fetchFeed, generate, hasKeys } from "../lib/hf";

type Tab = "all" | "image" | "video";
type Phase = "idle" | "working" | "done" | "error";
type Param = { key: string; label: string; options: string[] };

function paramsFor(m: FeedModel): Param[] {
  if (m.type === "video") {
    if (m.mode.includes("seedance")) return [];
    return [{ key: "duration", label: "Duration", options: ["5s", "10s"] }, { key: "ratio", label: "Ratio", options: ["16:9", "9:16", "1:1"] }];
  }
  if (m.mode.includes("soul")) return [{ key: "resolution", label: "Resolution", options: ["720p", "1080p"] }, { key: "ratio", label: "Ratio", options: ["1:1", "16:9", "9:16"] }];
  return [{ key: "resolution", label: "Resolution", options: ["1k", "2k", "4k"] }, { key: "ratio", label: "Ratio", options: ["1:1", "16:9", "9:16"] }];
}

function bodyFor(m: FeedModel, prompt: string, opts: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt };
  if (m.type === "video") {
    if (m.mode.includes("seedance")) return body;
    body.duration = Number(opts.duration?.replace("s", "")) || 5;
    if (opts.ratio) body.aspect_ratio = opts.ratio;
    return body;
  }
  body.resolution = opts.resolution || (m.mode.includes("soul") ? "1080p" : "2k");
  if (m.mode.includes("soul")) {
    body.enhance_prompt = true;
    body.batch_size = 1;
  } else {
    body.quality = "medium";
  }
  if (opts.ratio) body.aspect_ratio = opts.ratio;
  return body;
}

export type Generated = { url: string; kind: "image" | "video"; name: string; model: string };

type Props = { open: boolean; onClose: () => void; onAdd: (g: Generated) => void; onLib: (g: Generated) => void };

function optionValues(model: FeedModel | null): Record<string, string> {
  return Object.fromEntries((model ? paramsFor(model) : []).map((param) => [param.key, param.options[0]]));
}

function demoResult(model: FeedModel, prompt: string): Generated | null {
  const url = model.type === "video" ? model.video : model.thumb;
  if (!url) return null;
  return { url, kind: model.type === "video" ? "video" : "image", name: prompt.slice(0, 40) || model.title, model: model.title };
}

export default function GenerateModal({ open, onClose, onAdd, onLib }: Props) {
  const [models, setModels] = useState<FeedModel[]>([]);
  const [mState, setMState] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("all");
  const [sel, setSel] = useState<FeedModel | null>(null);
  const [prompt, setPrompt] = useState("");
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Generated | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setMState("loading");
    fetchFeed(1, 12).then((items) => {
      if (!alive) return;
      const first = items[0] ?? null;
      setModels(items);
      setSel(first);
      setOpts(optionValues(first));
      setMState("ready");
    }).catch(() => alive && setMState("error"));
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const list = useMemo(() => tab === "all" ? models : models.filter((model) => model.type === tab), [models, tab]);
  if (!open) return null;

  const pick = (model: FeedModel) => {
    setSel(model);
    setOpts(optionValues(model));
    setPhase("idle");
    setResult(null);
    setErr("");
  };

  const run = async () => {
    if (!sel || !prompt.trim() || phase === "working") return;
    setPhase("working");
    setErr("");
    setResult(null);
    setStatus(hasKeys ? "Queued" : "Preview");
    try {
      let out: Generated | null = null;
      if (hasKeys) {
        const generated = await generate(sel.mode, bodyFor(sel, prompt.trim(), opts), (next) => setStatus(next === "in_progress" ? "Rendering" : next));
        out = { url: generated.url, kind: generated.kind === "audio" ? "image" : generated.kind, name: prompt.trim().slice(0, 40) || sel.title, model: sel.title };
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        out = demoResult(sel, prompt.trim());
      }
      if (!out) throw new Error("This model has no preview available yet.");
      setResult(out);
      setPhase("done");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Generation failed");
      setPhase("error");
    }
  };

  return (
    <div className="gen-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="gen gen-focused" role="dialog" aria-label="Create asset">
        <header className="gen-head">
          <div><span className="gen-kicker">Create</span><strong className="gen-title">New asset</strong></div>
          <button className="gen-close" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </header>
        <div className="gen-focused-body">
          <div className="gen-model-head"><div><span className="gen-section-label">Model</span><p>Choose the instrument. The prompt does the rest.</p></div><span className="gen-live">{models.length ? `${models.length} available` : "Loading models"}</span></div>
          <div className="gen-tabs gen-tabs-focused">
            {(["all", "image", "video"] as Tab[]).map((item) => <button key={item} className={tab === item ? "on" : ""} onClick={() => setTab(item)}>{item === "all" ? "All" : item === "image" ? "Images" : "Video"}</button>)}
          </div>
          <div className="gen-model-grid">
            {mState === "loading" && <div className="gen-empty">Loading available models…</div>}
            {mState === "error" && <div className="gen-empty">Models are unavailable right now.</div>}
            {mState === "ready" && list.map((model) => <button key={model.mode + model.title} className={`gen-model-card${sel?.mode === model.mode ? " on" : ""}`} onClick={() => pick(model)}><span className="gen-model-type">{model.type === "video" ? <VideoIc size={12} /> : <ImageIc size={12} />}</span><span className="gen-model-copy"><strong>{model.title}</strong><small>{model.company}</small></span><span className="gen-model-price">{model.price ? `$${model.price}/${model.priceUnit ?? ""}` : "—"}</span></button>)}
          </div>
          <label className="gen-prompt-focused"><span className="gen-section-label">Direction</span><textarea rows={4} maxLength={500} placeholder={sel ? `Describe what ${sel.title} should make…` : "Choose a model first"} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
          {sel && paramsFor(sel).length > 0 && <div className="gen-params gen-params-focused">{paramsFor(sel).map((param) => <div className="gen-param" key={param.key}><span>{param.label}</span><div className="gen-seg">{param.options.map((option) => <button key={option} className={`gen-btn-s${(opts[param.key] ?? param.options[0]) === option ? " on" : ""}`} onClick={() => setOpts((current) => ({ ...current, [param.key]: option }))}>{option}</button>)}</div></div>)}</div>}
          {!hasKeys && <div className="gen-preview-note">Preview mode is on. Add your Higgsfield key when you want live generation.</div>}
          {phase === "working" && <div className="gen-status"><span className="ring small" />{status} — preparing your asset</div>}
          {phase === "error" && <div className="gen-status err">{err}</div>}
          <footer className="gen-foot gen-foot-focused"><span className="gen-price">{sel?.price ? `Estimated $${sel.price}/${sel.priceUnit ?? ""}` : "Price shown before live generation"}</span><button className="gen-go" onClick={() => void run()} disabled={!sel || !prompt.trim() || phase === "working"}>{phase === "working" ? "Working…" : hasKeys ? "Generate" : "Preview"}</button></footer>
          {result && <div className="gen-result gen-result-focused"><div className="gen-result-media">{result.kind === "video" ? <video src={result.url} controls muted loop playsInline /> : <img src={result.url} alt={result.name} />}</div><div className="gen-result-actions"><span className="gen-result-name">{result.name} · {result.model}</span><div className="gen-result-btns"><button className="chip" onClick={() => onLib(result)}>Save</button><button className="gen-go" onClick={() => { onAdd(result); onClose(); }}>Add to timeline</button></div></div></div>}
        </div>
      </div>
    </div>
  );
}
