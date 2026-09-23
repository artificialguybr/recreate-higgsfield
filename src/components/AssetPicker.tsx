import { useEffect, useRef, useState } from "react";
import { ASSETS_CHANGED, assetObjectUrl, listAssets, saveAsset, type LocalAsset } from "../lib/assets";
import { X } from "./Icons";
import "./AssetPicker.css";

type Filter = "all" | "image" | "video";

type AssetPickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: LocalAsset) => void | Promise<void>;
  title?: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssetPicker({ open, onClose, onSelect, title = "Library" }: AssetPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFilter("all");
    setQuery("");
    setSelected(null);
    setError("");
    setLoading(true);
    void listAssets().then((items) => { if (live) setAssets(items); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Library unavailable."); }).finally(() => { if (live) setLoading(false); });
    const refresh = () => { void listAssets().then((items) => { if (live) setAssets(items); }).catch(() => {}); };
    window.addEventListener(ASSETS_CHANGED, refresh);
    return () => { live = false; window.removeEventListener(ASSETS_CHANGED, refresh); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
        if (!kind) continue;
        await saveAsset({ blob: file, kind, name: file.name, source: "upload" });
      }
      setAssets(await listAssets());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add those files.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (!open) return null;
  const visible = assets.filter((asset) => (filter === "all" || asset.kind === filter) && (!query.trim() || asset.name.toLowerCase().includes(query.trim().toLowerCase())));
  const chosen = assets.find((asset) => asset.id === selected) ?? null;
  const choose = async () => {
    if (!chosen) return;
    setLoading(true);
    try { await onSelect(chosen); onClose(); }
    finally { setLoading(false); }
  };

  return <div className="asset-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="asset-picker" role="dialog" aria-modal="true" aria-label={`${title} library`}>
      <header className="asset-picker-head">
        <div><span className="asset-picker-kicker">FIELD / LIBRARY</span><h2>{title}</h2><p>Select an image or video from your local library.</p></div>
        <button className="asset-picker-close" type="button" onClick={onClose} aria-label="Close library"><X size={16} /></button>
      </header>
      <div className="asset-picker-tools">
        <div className="asset-picker-tabs" role="tablist" aria-label="Asset type">
          {(["all", "image", "video"] as Filter[]).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "on" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "image" ? "Images" : "Videos"}</button>)}
        </div>
        <input className="asset-picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library" aria-label="Search library" />
        <button className="asset-picker-upload" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? "Adding…" : "Add files"}</button>
        <input ref={inputRef} className="asset-picker-file" type="file" accept="image/*,video/*" multiple onChange={(event) => void upload(event.currentTarget.files)} />
      </div>
      {error && <p className="asset-picker-error" role="alert">{error}</p>}
      <div className="asset-picker-body">
        {loading && !assets.length ? <div className="asset-picker-empty"><span className="asset-picker-spinner" />Loading library…</div> : visible.length ? <div className="asset-picker-grid">{visible.map((asset) => <button type="button" key={asset.id} className={`asset-picker-item${selected === asset.id ? " selected" : ""}`} onClick={() => setSelected(asset.id)} aria-pressed={selected === asset.id}>
          <span className="asset-picker-media">{asset.kind === "video" ? <video src={assetObjectUrl(asset)} muted playsInline preload="metadata" /> : <img src={assetObjectUrl(asset)} alt="" loading="lazy" />}<span className="asset-picker-kind">{asset.kind}</span>{selected === asset.id && <span className="asset-picker-check">✓</span>}</span>
          <span className="asset-picker-meta"><strong title={asset.name}>{asset.name}</strong><small>{asset.source} · {formatSize(asset.size)}</small></span>
        </button>)}</div> : <div className="asset-picker-empty"><span className="asset-picker-empty-mark">＋</span><strong>{assets.length ? "No matching assets" : "Your library is empty"}</strong><span>{assets.length ? "Try another search or filter." : "Add images or videos to use them across Field."}</span></div>}
      </div>
      <footer className="asset-picker-foot"><span>{chosen ? chosen.name : `${visible.length} ${visible.length === 1 ? "asset" : "assets"}`}</span><div><button className="asset-picker-cancel" type="button" onClick={onClose}>Cancel</button><button className="asset-picker-use" type="button" onClick={() => void choose()} disabled={!chosen || loading}>{loading ? "Opening…" : "Use selected"}</button></div></footer>
    </aside>
  </div>;
}
