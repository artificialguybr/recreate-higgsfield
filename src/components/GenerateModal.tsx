import { useEffect, useState } from "react";
import { X } from "./Icons";
import { type FeedModel, fetchFeed, generate, hasKeys } from "../lib/hf";
import { bodyForModel, defaultsForModel, isSupportedModel, isUnsupportedLegacyModel, modelSchema, type ModelField } from "../lib/hfModels";

type Phase = "idle" | "working" | "done" | "error";

function paramsFor(model: FeedModel): ModelField[] {
  return [...(modelSchema(model)?.fields ?? [])];
}

export type Generated = { url: string; kind: "image" | "video"; name: string; model: string };

type Props = { open: boolean; initialPrompt?: string; variant?: "modal" | "panel"; onClose: () => void; onAdd: (g: Generated) => void; onLib: (g: Generated) => void };

function optionValues(model: FeedModel | null): Record<string, unknown> {
  return defaultsForModel(model);
}

function demoResult(model: FeedModel, prompt: string): Generated | null {
  const url = model.type === "video" ? model.video : model.thumb;
  if (!url) return null;
  return { url, kind: model.type === "video" ? "video" : "image", name: prompt.slice(0, 40) || model.title, model: model.title };
}


export default function GenerateModal({ open, initialPrompt = "", variant = "modal", onClose, onAdd, onLib }: Props) {
  const [models, setModels] = useState<FeedModel[]>([]);
  const [mState, setMState] = useState<"loading" | "ready" | "error">("loading");
  const [sel, setSel] = useState<FeedModel | null>(null);
  const [prompt, setPrompt] = useState("");
  const [opts, setOpts] = useState<Record<string, unknown>>({});
  const [imageUrlsText, setImageUrlsText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Generated | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) setPrompt(initialPrompt);
  }, [open, initialPrompt]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setMState("loading");
    fetchFeed(1, 48).then((items) => {
      if (!alive) return;
      const available = items.filter((item) => isSupportedModel(item) && !isUnsupportedLegacyModel(item.mode));
      const first = available[0] ?? null;
      setModels(available);
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

  const list = models;
  const schema = modelSchema(sel);
  const imageUrls = imageUrlsText.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
  const invalidImageUrl = imageUrls.some((value) => !/^https:\/\//i.test(value));
  const invalidVideoUrl = Boolean(videoUrl.trim() && !/^https:\/\//i.test(videoUrl.trim()));
  const invalidReference = invalidImageUrl || invalidVideoUrl;
  const missingRequiredInput = Boolean(schema?.requiresImageUrls && (!imageUrls.length || invalidImageUrl)) || Boolean(schema?.requiresVideoUrl && (!videoUrl.trim() || invalidVideoUrl));
  if (!open) return null;

  const pick = (model: FeedModel) => {
    setSel(model);
    setOpts(optionValues(model));
    setPhase("idle");
    setResult(null);
    setErr("");
  };

  const run = async () => {
    if (!sel || !prompt.trim() || missingRequiredInput || invalidReference || phase === "working") return;
    setPhase("working");
    setErr("");
    setResult(null);
    setStatus(hasKeys ? "Queued" : "Preview");
    try {
      let out: Generated | null = null;
      if (hasKeys) {
        const generated = await generate(sel.mode, bodyForModel(sel, prompt.trim(), opts, { imageUrls, videoUrl: videoUrl.trim() || undefined }), (next) => setStatus(next === "in_progress" ? "Rendering" : next));
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

  const content = (
    <div className="gen gen-focused" role="dialog" aria-label="Create asset">
      <header className="gen-head">
        <div><span className="gen-kicker">Generate</span><strong className="gen-title">New asset</strong></div>
        <button className="gen-close" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </header>
      <div className="gen-focused-body">
        <label className="gen-prompt-focused"><span className="gen-section-label">Direction</span><textarea className="device-input" rows={5} maxLength={500} placeholder={sel ? `Describe what ${sel.title} should make…` : "Pick a model below, then describe the idea."} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
        <label className="model-picker gen-model-picker"><span>Model</span>
          <select value={sel?.mode ?? ""} onChange={(event) => { const model = models.find((item) => item.mode === event.target.value); setSel(model ?? null); if (model) setOpts(optionValues(model)); }}>
            <option value="">Choose a model</option>
            {list.map((model) => <option key={model.mode + model.title} value={model.mode}>{model.title} · {model.company}{model.price ? ` · $${model.price}/${model.priceUnit ?? ""}` : ""}</option>)}
          </select>
        </label>
        {schema?.acceptsImageUrls && <label className="gen-prompt-focused"><span className="gen-section-label">Reference images <small>{schema.requiresImageUrls ? "required" : "optional"}</small></span><textarea className="device-input gen-reference-input" rows={2} placeholder="Paste one public HTTPS URL per line…" value={imageUrlsText} onChange={(event) => setImageUrlsText(event.target.value)} /></label>}
        {schema?.acceptsVideoUrl && <label className="gen-prompt-focused"><span className="gen-section-label">Motion video URL <small>{schema.requiresVideoUrl ? "required" : "optional"}</small></span><input className="device-input gen-reference-input" type="url" placeholder="https://…" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} /></label>}
        {sel && paramsFor(sel).length > 0 && <div className="gen-params gen-params-focused">{paramsFor(sel).map((param) => <div className="gen-param" key={param.key}><span>{param.label}</span>{param.type === "select" ? <select className="gen-param-select" value={String(opts[param.key] ?? param.default)} onChange={(event) => setOpts((current) => ({ ...current, [param.key]: event.target.value }))}>{(param.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : param.type === "boolean" ? <input type="checkbox" checked={Boolean(opts[param.key] ?? param.default)} onChange={(event) => setOpts((current) => ({ ...current, [param.key]: event.target.checked }))} /> : <input className="gen-param-input" type="number" min={param.min} max={param.max} step={param.step} value={String(opts[param.key] ?? param.default)} onChange={(event) => setOpts((current) => ({ ...current, [param.key]: event.target.value }))} />}</div>)}</div>}
        {!hasKeys && <div className="gen-preview-note">Preview mode is on. Live generation needs Higgsfield credentials configured on the server.</div>}
        <footer className="gen-foot gen-foot-focused"><span className="gen-price">{sel?.price ? `Estimated $${sel.price}/${sel.priceUnit ?? ""}` : "Price shown before live generation"}</span><button className="gen-go" onClick={() => void run()} disabled={!sel || !prompt.trim() || missingRequiredInput || invalidReference || phase === "working"}>{phase === "working" ? "Working…" : hasKeys ? "Generate" : "Preview"}</button></footer>
        {invalidReference && <div className="gen-status err">Reference assets must use public HTTPS URLs.</div>}
        {phase === "error" && <div className="gen-status err">{err}</div>}
        {result && <div className="gen-result gen-result-focused"><div className="gen-result-media">{result.kind === "video" ? <video src={result.url} controls muted loop playsInline /> : <img src={result.url} alt={result.name} />}</div><div className="gen-result-actions"><span className="gen-result-name">{result.name} · {result.model}</span><div className="gen-result-btns"><button className="chip" onClick={() => onLib(result)}>Save</button><button className="gen-go" onClick={() => { onAdd(result); onClose(); }}>Add to timeline</button></div></div></div>}
      </div>
    </div>
  );
  return variant === "panel"
    ? <div className="gen-panel">{content}</div>
    : <div className="gen-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{content}</div>;
}
