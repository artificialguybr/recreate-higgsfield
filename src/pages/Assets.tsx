import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ASSETS_CHANGED, assetObjectUrl, deleteAsset, listAssets, saveAsset,
  type LocalAsset,
} from "../lib/assets";
import { setPending } from "../lib/transfer";
import { upsertWorkspaceArtifact } from "../lib/workspace";
import "./Assets.css";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Assets() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your library couldn’t be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(ASSETS_CHANGED, refresh);
    return () => window.removeEventListener(ASSETS_CHANGED, refresh);
  }, [refresh]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
        if (!kind) throw new Error(`${file.name} isn’t a supported image or video.`);
        await saveAsset({ blob: file, kind, name: file.name, source: "upload" });
      }
      await refresh();
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : "One or more files couldn’t be saved.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (asset: LocalAsset) => {
    setError("");
    try {
      await deleteAsset(asset.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This asset couldn’t be deleted.");
    }
  };

  const addToEditor = (asset: LocalAsset) => {
    setPending(assetObjectUrl(asset), asset.kind);
    navigate("/editor");
  };

  const addToWorkspace = (asset: LocalAsset) => {
    upsertWorkspaceArtifact({
      id: `asset-${crypto.randomUUID()}`,
      tool: asset.kind,
      title: asset.name,
      summary: `${asset.kind === "image" ? "Image" : "Video"} from your asset library · ${formatSize(asset.size)}.`,
      route: `/${asset.kind}`,
      status: "ready",
      assetId: asset.id,
      outputKind: asset.kind,
      ...(asset.remoteUrl ? { outputUrl: asset.remoteUrl } : {}),
      ...(asset.source === "generation" || asset.source === "catalog" ? { outputSource: asset.source } : {}),
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
      ...(asset.model ? { model: asset.model } : {}),
    });
    window.dispatchEvent(new CustomEvent("field-workspace-updated"));
    navigate("/workspace");
  };

  return (
    <div className="app-scroll">
      <main className="assets-page">
        <header className="assets-header">
          <div>
            <span className="assets-eyebrow">FIELD / LIBRARY</span>
            <h1>Your assets</h1>
            <p>A home for the images and videos you upload or create.</p>
          </div>
          <div className="assets-header-actions">
            <span className="assets-count">{assets.length} {assets.length === 1 ? "asset" : "assets"}</span>
            <button className="assets-add" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Adding…" : "+ Add files"}
            </button>
            <input ref={inputRef} className="assets-file-input" type="file" accept="image/*,video/*" multiple onChange={(event) => void upload(event.currentTarget.files)} />
          </div>
        </header>

        {error && <div className="assets-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Try again</button></div>}
        {loading ? <div className="assets-state" role="status"><span className="assets-spinner" />Loading your library…</div> : assets.length === 0 ? (
          <section className="assets-empty">
            <div className="assets-empty-mark" aria-hidden="true">✳</div>
            <h2>Your library starts here</h2>
            <p>Upload an image or video, or save something you create in Field. Your assets stay on this device.</p>
            <button className="assets-add" type="button" onClick={() => inputRef.current?.click()}>Choose files</button>
          </section>
        ) : (
          <section className="assets-grid" aria-label="Saved assets">
            {assets.map((asset) => {
              const url = assetObjectUrl(asset);
              return <article className="asset-card" key={asset.id}>
                <div className="asset-preview">
                  {asset.kind === "video" ? <video src={url} controls preload="metadata" aria-label={asset.name} /> : <img src={url} alt={asset.name} loading="lazy" />}
                  <span className="asset-kind">{asset.kind}</span>
                </div>
                <div className="asset-info">
                  <div className="asset-name" title={asset.name}>{asset.name}</div>
                  <div className="asset-meta"><span>{asset.source}</span><span>{formatSize(asset.size)}</span></div>
                  <div className="asset-actions">
                    <button type="button" onClick={() => addToEditor(asset)}>Add to Editor</button>
                    <button type="button" onClick={() => navigate("/chat", { state: { fieldAssetId: asset.id } })}>Open in Chat</button>
                    <button type="button" onClick={() => addToWorkspace(asset)}>Workspace</button>
                    <button className="asset-delete" type="button" onClick={() => void remove(asset)} aria-label={`Delete ${asset.name}`}>Delete</button>
                  </div>
                </div>
              </article>;
            })}
          </section>
        )}
      </main>
    </div>
  );
}
