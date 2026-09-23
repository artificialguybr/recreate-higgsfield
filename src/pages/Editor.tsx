import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Pause, Scissors, Trash, Plus, Minus, Film, Volume, VolumeX, StepBack, StepFwd, ArrowLeft, Camera, Spark, X, Chat, Ratio, Monitor } from "../components/Icons";
import { Clip, clipAt, clipLen, makeImageClip, makeVideoClip, splitClip, totalDur } from "../lib/editor";
import { exportClips } from "../lib/ffmpeg";
import { pendingMedia, clearPending } from "../lib/transfer";
import GenerateModal, { Generated } from "../components/GenerateModal";
import TimelineAgent from "../components/TimelineAgent";
import AssetPicker from "../components/AssetPicker";
import { activeWorkspaceProjectId, upsertWorkspaceArtifact } from "../lib/workspace";
import { assetObjectUrl, deleteAsset, listAssets, LocalAsset, saveAsset, ASSETS_CHANGED } from "../lib/assets";
import { bestFile, searchStock, searchStockPhotos, type StockClip, type StockPhoto } from "../lib/pexels";
const FPS = 30;
const PX0 = 72;
const ZOOMS = [24, 48, 72, 120];
const CF = "https://d28lhcrx5qdowv.cloudfront.net";
const SAVE_KEY = "field-editor-project";
const SPEEDS = [0.5, 1, 1.5, 2];
const RATIOS = ["16:9", "9:16", "1:1"] as const;
type Ratio = (typeof RATIOS)[number];
type Res = "720" | "1080";
// Frame dimensions per (ratio, resolution) — the preview stage matches the
// export exactly, so what you see is the file you get.
const DIM: Record<Ratio, Record<Res, [number, number]>> = {
  "16:9": { "720": [1280, 720], "1080": [1920, 1080] },
  "9:16": { "720": [720, 1280], "1080": [1080, 1920] },
  "1:1": { "720": [960, 960], "1080": [1080, 1080] },
};

type StockResult = { id: string; kind: "image" | "video"; title: string; url: string; thumb: string; credit: string; sourcePage: string; duration?: number };
const stockFromPhoto = (photo: StockPhoto): StockResult => ({ id: String(photo.id), kind: "image", title: photo.alt || "Pexels photo", url: photo.src.large2x || photo.src.large || photo.src.original, thumb: photo.src.medium || photo.src.small, credit: photo.photographer, sourcePage: photo.url });
const stockFromClip = (clip: StockClip): StockResult | null => {
  const file = bestFile(clip);
  return file ? { id: String(clip.id), kind: "video", title: "Pexels video", url: file.link, thumb: clip.picture, credit: clip.photographer, sourcePage: clip.url, duration: clip.duration } : null;
};
type Source = { url: string; blob?: Blob };

function proxyMedia(url: string): string {
  return url.startsWith(CF) ? "/hfblob" + url.slice(CF.length) : url;
}

async function videoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(isFinite(v.duration) ? v.duration : 5);
    v.onerror = () => resolve(5);
    v.src = url;
  });
}

function videoThumb(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    let done = false;
    const finish = (url2: string | null) => {
      if (done) return;
      done = true;
      resolve(url2);
    };
    const to = window.setTimeout(() => finish(null), 8000);
    v.onerror = () => {
      window.clearTimeout(to);
      finish(null);
    };
    v.onloadeddata = () => {
      v.currentTime = Math.min(1.5, v.duration / 2);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        const w = 160;
        c.width = w;
        c.height = Math.max(1, Math.round((w * v.videoHeight) / Math.max(1, v.videoWidth)));
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        window.clearTimeout(to);
        finish(c.toDataURL("image/jpeg", 0.6));
      } catch {
        window.clearTimeout(to);
        finish(null);
      }
    };
    v.src = url;
  });
}

// Snapshot the current preview frame (native video element).
function snapshotFrame(el: HTMLVideoElement | null): Promise<string | null> {
  return new Promise((resolve) => {
    if (!el || !el.videoWidth) return resolve(null);
    try {
      const c = document.createElement("canvas");
      c.width = el.videoWidth;
      c.height = el.videoHeight;
      c.getContext("2d")!.drawImage(el, 0, 0);
      resolve(c.toDataURL("image/png"));
    } catch {
      resolve(null);
    }
  });
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const patchClip = (cs: Clip[], id: string, p: Partial<Clip>) =>
  cs.map((x) => (x.id === id ? { ...x, ...p } : x));
export default function Editor() {
  const projectSaveKey = `${SAVE_KEY}:${activeWorkspaceProjectId()}`;
  const [clips, setClips] = useState<Clip[]>([]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("");
  const [stockMode, setStockMode] = useState<"both" | "image" | "video">("both");
  const [stockResults, setStockResults] = useState<StockResult[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState<LocalAsset[]>([]);
  const savedGenerated = useRef(new Map<string, LocalAsset>());
  const refreshLib = () => void listAssets().then((assets) => {
    setLib(assets);
    savedGenerated.current.clear();
    for (const asset of assets) if (asset.remoteUrl) savedGenerated.current.set(asset.remoteUrl, asset);
  }).catch((error) => flash(error instanceof Error ? error.message : "Could not load asset library"));
  useEffect(() => {
    refreshLib();
    window.addEventListener(ASSETS_CHANGED, refreshLib);
    return () => window.removeEventListener(ASSETS_CHANGED, refreshLib);
  }, []);
  const pendingSaves = useRef(new Map<string, Promise<LocalAsset>>());
  const saveGenerated = (g: Generated) => {
    const existing = savedGenerated.current.get(g.url);
    if (existing) return Promise.resolve(existing);
    const pending = pendingSaves.current.get(g.url);
    if (pending) return pending;
    const saving = saveAsset({ url: g.url, kind: g.kind, name: g.name, model: g.model, source: "generation" })
      .then((asset) => {
        savedGenerated.current.set(g.url, asset);
        return asset;
      })
      .finally(() => pendingSaves.current.delete(g.url));
    pendingSaves.current.set(g.url, saving);
    return saving;
  };
  const libToTimeline = async (asset: LocalAsset) => {
    const s: Source = { url: assetObjectUrl(asset), blob: asset.blob };
    if (asset.kind === "image") addImage(s, asset.name);
    else {
      try { await addVideo(s, asset.name); }
      catch (error) { flash(error instanceof Error ? error.message : "Could not add video"); }
    }
  };
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState("");
  const [toast, setToast] = useState("");
  const [px, setPx] = useState(PX0);
  const [res, setRes] = useState<Res>("720");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [name, setName] = useState("Untitled");
  const [renderAsset, setRenderAsset] = useState<LocalAsset | null>(null);
  useEffect(() => {
    upsertWorkspaceArtifact({
      id: "editor",
      tool: "editor",
      title: name || "Untitled",
      summary: clips.length ? `${clips.length} clips · ${fmt(totalDur(clips))} timeline` : "No clips in the timeline yet.",
      route: "/editor",
      status: clips.length ? "ready" : "empty",
      ...(renderAsset ? {
        assetId: renderAsset.id,
        outputUrl: renderAsset.remoteUrl,
        outputKind: renderAsset.kind,
        outputSource: "render",
      } : {}),
    });
  }, [clips, name, renderAsset]);
  const [muted, setMuted] = useState(true);
  const [drag, setDrag] = useState<null | "live" | "moved">(null);
  const sources = useRef(new Map<string, Source>());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ x: number } | null>(null);

  // Undo/redo: whole-clip snapshots. Playhead and selection are transient —
  // they restore from the timeline position, not from history.
  const hist = useRef<{ past: Clip[][]; future: Clip[][] }>({ past: [], future: [] });
  const lastEdit = useRef(0);
  const clipsRef = useRef(clips);
  const setTimeline = (next: Clip[]) => {
    clipsRef.current = next;
    setClips(next);
  };
  const commit = (next: Clip[], coalesce = false) => {
    const now = Date.now();
    if (coalesce && now - lastEdit.current < 800) {
      setTimeline(next);
      return;
    }
    lastEdit.current = now;
    hist.current.past.push(clipsRef.current);
    if (hist.current.past.length > 50) hist.current.past.shift();
    hist.current.future = [];
    setTimeline(next);
  };
  const commitFn = (fn: (cs: Clip[]) => Clip[], coalesce = false) => {
    const now = Date.now();
    if (!coalesce || now - lastEdit.current > 800) {
      hist.current.past.push(clipsRef.current);
      if (hist.current.past.length > 50) hist.current.past.shift();
      hist.current.future = [];
    }
    lastEdit.current = now;
    setTimeline(fn(clipsRef.current));
  };
  const undo = () => {
    const previous = hist.current.past.pop();
    if (!previous) return;
    hist.current.future.push(clipsRef.current);
    setTimeline(previous);
    flash("Undone");
  };
  const redo = () => {
    const next = hist.current.future.pop();
    if (!next) return;
    hist.current.past.push(clipsRef.current);
    setTimeline(next);
    flash("Redone");
  };

  const dur = totalDur(clips);
  const { index } = clipAt(clips, t);
  const current = clips[index];
  const selected = clips.find((c) => c.id === sel) ?? null;
  const isVideo = current?.kind === "video";
  const [W, H] = DIM[ratio][res];

  const posOf = (id: string) => {
    let a = 0;
    for (const c of clips) {
      if (c.id === id) return a;
      a += clipLen(c);
    }
    return 0;
  };

  // Image clips are driven by the playhead clock; video clips drive themselves.
  useEffect(() => {
    if (!playing || isVideo) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((x) => Math.min(x + dt, dur));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, isVideo, dur]);

  // Mount/seek the native video when the clip (or its speed) changes.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current || current.kind !== "video") return;
    el.src = current.src;
    el.playbackRate = current.speed ?? 1;
    el.currentTime = current.in;
    if (playing) void el.play().catch(() => {});
  }, [current?.id, current?.in, current?.out, current?.src, current?.speed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrub sync (only while paused, to avoid fighting native playback).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current || current.kind !== "video" || playing) return;
    const want = current.in + (t - posOf(current.id)) * (current.speed ?? 1);
    if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
  }, [t, playing, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute + volume propagate to the live element.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = Math.min(1, current?.volume ?? 1);
  }, [muted, current?.id, current?.volume]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave: the sequence survives a refresh (local object URLs don't — they'll reappear blank).
  const saveTimer = useRef<number>(0);
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(projectSaveKey, JSON.stringify({ clips, t, name }));
      } catch {
        /* storage full — skip */
      }
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [clips, t, name, projectSaveKey]);

  // Restore the saved sequence, or ingest "Editor" handoff from a result card.
  const boot = useRef(false);
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    try {
      const raw = localStorage.getItem(projectSaveKey) ?? (activeWorkspaceProjectId() === "project-default" ? localStorage.getItem(SAVE_KEY) : null);
      if (raw) {
        const saved = JSON.parse(raw) as { clips?: Clip[]; t?: number; name?: string };
        const cs = (saved.clips ?? []).filter((c) => !c.src.startsWith("blob:"));
        if (cs.length) {
          cs.forEach((c) => {
            if (!sources.current.has(c.id)) sources.current.set(c.id, { url: c.src });
          });
          setTimeline(cs);
          if (saved.name) setName(saved.name);
          setT(Math.min(saved.t ?? 0, totalDur(cs)));
        }
      }
    } catch {
      /* corrupt save — fall through */
    }
    const p = pendingMedia();
    if (!p) return;
    clearPending();
    const s: Source = { url: proxyMedia(p.url) };
    if (p.kind === "image") addImage(s, "generated");
    else void addVideo(s, "generated");
  }, []);
  // Chat on another route/tab writes the same project-scoped timeline.
  useEffect(() => {
    const applyExternal = (value: unknown) => {
      const saved = value as { clips?: Clip[]; t?: number; name?: string };
      if (!Array.isArray(saved?.clips)) return;
      const next = saved.clips.filter((clip) => clip && typeof clip.src === "string" && !clip.src.startsWith("blob:"));
      hist.current.past.push(clipsRef.current);
      if (hist.current.past.length > 50) hist.current.past.shift();
      hist.current.future = [];
      next.forEach((clip) => {
        if (!sources.current.has(clip.id)) sources.current.set(clip.id, { url: clip.src });
      });
      setTimeline(next);
      setName(saved.name || "Untitled");
      setT(Math.min(saved.t ?? 0, totalDur(next)));
      setSel(null);
      setPlaying(false);
      flash("Updated from Chat");
    };
    const onBridge = (event: Event) => applyExternal((event as CustomEvent<unknown>).detail);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== projectSaveKey || !event.newValue) return;
      try { applyExternal(JSON.parse(event.newValue)); } catch { /* Ignore invalid external state. */ }
    };
    window.addEventListener("field-editor-timeline", onBridge);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("field-editor-timeline", onBridge);
      window.removeEventListener("storage", onStorage);
    };
  }, [projectSaveKey]);
  // Capture a thumbnail for new video clips so the timeline shows the shot, not a block.
  useEffect(() => {
    if (!current || current.kind !== "video" || current.thumb) return;
    let alive = true;
    void videoThumb(current.src).then((th) => {
      if (!alive || !th) return;
      setTimeline(clipsRef.current.map((clip) => clip.id === current.id ? { ...clip, thumb: th } : clip));
    });
    return () => {
      alive = false;
    };
  }, [current?.id, current?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };
  const replaceSelectedFromLibrary = async (asset: LocalAsset) => {
    const target = selected;
    if (!target || target.kind !== asset.kind) return;
    const source: Source = { url: assetObjectUrl(asset), blob: asset.blob };
    const id = crypto.randomUUID();
    let replacement: Clip = { ...target, id, src: source.url, name: asset.name, thumb: undefined };
    if (asset.kind === "video") {
      const duration = await videoDuration(source.url);
      const start = Math.min(target.in, Math.max(0, duration - 0.2));
      replacement = { ...replacement, dur: duration, in: start, out: Math.max(start + 0.2, Math.min(target.out, duration)) };
    }
    sources.current.set(id, source);
    commitFn((cs) => cs.map((clip) => clip.id === target.id ? replacement : clip));
    setSel(id);
    flash("Replaced source");
  };

  const addVideo = async (s: Source, nm: string) => {
    const d = await videoDuration(s.url);
    const c = makeVideoClip(s.url, nm, d);
    sources.current.set(c.id, s);
    commitFn((cs) => [...cs, c]);
    setSel(c.id);
    flash(`Added · ${fmt(d)}`);
  };
  const addImage = (s: Source, nm: string) => {
    const c = makeImageClip(s.url, nm);
    sources.current.set(c.id, s);
    commitFn((cs) => [...cs, c]);
    setSel(c.id);
    flash("Added image");
  };
  const searchEditorStock = async () => {
    const query = stockQuery.trim();
    if (!query || stockBusy) return;
    setStockBusy(true);
    setStockError("");
    try {
      const [photos, videos] = await Promise.all([
        stockMode === "video" ? Promise.resolve([] as StockPhoto[]) : searchStockPhotos(query),
        stockMode === "image" ? Promise.resolve([] as StockClip[]) : searchStock(query),
      ]);
      setStockResults([...photos.map(stockFromPhoto), ...videos.map(stockFromClip).filter((item): item is StockResult => item !== null)]);
    } catch (error) {
      setStockResults([]);
      setStockError(error instanceof Error ? error.message : "Could not search stock media.");
    } finally {
      setStockBusy(false);
    }
  };
  const addStockToEditor = async (item: StockResult) => {
    try {
      const asset = await saveAsset({ url: item.url, kind: item.kind, name: item.title, source: "catalog", prompt: stockQuery });
      refreshLib();
      await libToTimeline(asset);
      flash(`${item.kind === "image" ? "Photo" : "Video"} added from Pexels`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not add stock media");
    }
  };
  const addStockToWorkspace = async (item: StockResult) => {
    try {
      const asset = await saveAsset({ url: item.url, kind: item.kind, name: item.title, source: "catalog", prompt: stockQuery });
      upsertWorkspaceArtifact({ id: `stock-${item.kind}-${item.id}`, tool: item.kind, title: item.title, summary: `Pexels ${item.kind} · ${item.credit}`, route: `/${item.kind}`, status: "ready", prompt: stockQuery, outputUrl: item.url, outputKind: item.kind, outputSource: "catalog", assetId: asset.id });
      window.dispatchEvent(new CustomEvent("field-workspace-updated"));
      flash(`${item.kind === "image" ? "Photo" : "Video"} sent to Workspace`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not send stock media to Workspace");
    }
  };

  const onFiles = (files: FileList | null, input: HTMLInputElement) => {
    if (!files) return;
    void (async () => {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
        if (!kind) continue;
        try {
          const asset = await saveAsset({ blob: file, kind, name: file.name, source: "upload" });
          await libToTimeline(asset);
        } catch (error) {
          flash(error instanceof Error ? error.message : "Could not add uploaded media");
        }
      }
    })();
    input.value = ""; // allow re-selecting the same file
  };

  const addGeneratedToTimeline = async (g: Generated) => {
    try {
      await libToTimeline(await saveGenerated(g));
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not save generated media");
    }
  };

  const addUrl = () => {
    const raw = url.trim();
    if (!raw) return;
    const s: Source = { url: proxyMedia(raw) };
    if (/\.(mp4|webm|mov)(\?|$)/i.test(raw)) void addVideo(s, "clip");
    else addImage(s, "image");
    setUrl("");
  };

  const split = () => {
    const c = current;
    if (!c) return;
    const { at } = clipAt(clips, t);
    const parts = splitClip(c, at);
    if (!parts) {
      flash("Move the playhead into the clip first");
      return;
    }
    const next = [...clips];
    next.splice(clips.indexOf(c), 1, parts[0], parts[1]);
    commit(next);
    flash("Split");
  };

  const remove = () => {
    if (!sel) return;
    commit(clips.filter((c) => c.id !== sel));
    setSel(null);
  };

  const duplicate = () => {
    if (!sel) return;
    const i = clips.findIndex((c) => c.id === sel);
    if (i < 0) return;
    const c = clips[i]!;
    const copy: Clip = { ...c, id: crypto.randomUUID() };
    sources.current.set(copy.id, sources.current.get(c.id)!);
    const next = [...clips];
    next.splice(i + 1, 0, copy);
    commit(next);
    setSel(copy.id);
    flash("Duplicated");
  };

  const snap = async () => {
    const shot = await snapshotFrame(current?.kind === "video" ? videoRef.current : null);
    if (!shot) {
      flash(current?.kind === "image" ? "Snapshot is for video" : "Nothing to snapshot");
      return;
    }
    const s: Source = { url: shot };
    addImage(s, "snapshot");
  };

  const newProject = () => {
    if (!clips.length) return;
    commit([]);
    setSel(null);
    setPlaying(false);
    setT(0);
    setName("Untitled");
    flash("New project — ⌘Z brings it back");
  };

  const reposition = (id: string, pos: number) => {
    commitFn((cs) => {
      const c = cs.find((x) => x.id === id);
      if (!c) return cs;
      const rest = cs.filter((x) => x.id !== id);
      let a = 0;
      let target = rest.length;
      for (let i = 0; i < rest.length; i++) {
        const l = clipLen(rest[i]!);
        if (pos < a + l) {
          target = i;
          break;
        }
        a += l;
      }
      const next = [...rest];
      next.splice(target, 0, c);
      return next;
    }, true);
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    e.preventDefault();
    e.stopPropagation();
    setSel(id);
    dragRef.current = { x: e.clientX };
    setDrag("live");
  };
  const dragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag("moved");
    if (Math.abs(e.clientX - d.x) > 12) reposition(sel!, (e.clientX - d.x) / px);
  };
  const dragEnd = () => {
    dragRef.current = null;
    setDrag(null);
  };
  // Re-bound every render so the handlers see the latest sel/px/clips.
  useEffect(() => {
    if (drag === null) return;
    window.addEventListener("pointermove", dragMove);
    window.addEventListener("pointerup", dragEnd);
    return () => {
      window.removeEventListener("pointermove", dragMove);
      window.removeEventListener("pointerup", dragEnd);
    };
  });

  const scrub = (e: React.MouseEvent) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    setT(Math.max(0, Math.min(dur, (e.clientX - rect.left) / px)));
    setPlaying(false);
  };

  const goClip = (id: string) => {
    setT(posOf(id));
    setPlaying(false);
  };

  const onVideoTime = () => {
    const el = videoRef.current;
    if (!el || !current) return;
    setT(posOf(current.id) + (el.currentTime - current.in) / (current.speed ?? 1));
  };

  const onVideoEnd = () => {
    if (index < clips.length - 1) {
      setT(posOf(clips[index + 1]!.id));
    } else {
      setPlaying(false);
    }
  };

  const stepFrame = (d: number) => {
    setPlaying(false);
    setT((x) => Math.max(0, Math.min(dur, x + d / FPS)));
  };

  const zoom = (direction: -1 | 1) => setPx((p) => {
    const index = ZOOMS.indexOf(p);
    return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index + direction))]!;
  });

  const fileName = () => `${name.trim() || "field-edit"}.mp4`.replace(/[^\w\-. ]+/g, "");

  const doExport = async () => {
    if (!clips.length || busy) return;
    setBusy(true);
    setProgress(0);
    flash("Loading engine…");
    try {
      const blob = await exportClips(clips, sources.current, setProgress, W, H);
      const outputName = fileName();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = outputName;
      a.click();
      try {
        const asset = await saveAsset({
          blob,
          kind: "video",
          name: outputName,
          source: "export",
          prompt: name.trim() || "Untitled",
        });
        setRenderAsset(asset);
        flash(`Exported ${outputName}`);
      } catch (error) {
        flash(`Exported ${outputName}, but could not save it: ${error instanceof Error ? error.message : "local storage failed"}`);
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "Export failed");
    }
    setBusy(false);
  };


  const trim = (e: React.PointerEvent, id: string, edge: "in" | "out") => {
    e.preventDefault();
    e.stopPropagation();
    const start = e.clientX;
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    const onMove = (ev: PointerEvent) => {
      const dt = (ev.clientX - start) / px;
      commit(
        clips.map((x) => {
          if (x.id !== id) return x;
          if (edge === "in") {
            const ni = Math.max(0, Math.min(x.out - 0.2, x.in + dt));
            return { ...x, in: ni };
          }
          const max = x.kind === "video" ? x.dur : x.in + 60;
          const no = Math.max(x.in + 0.2, Math.min(max, x.out + dt));
          return { ...x, out: no };
        }),
        true
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const patch = (id: string, p: Partial<Clip>, coalesce = false) =>
    commit(patchClip(clips, id, p), coalesce);

  // Keyboard: the editor is for the hands.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        void doExport();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flash("Saved");
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "s" || e.key === "S") {
        split();
      } else if (e.key === "d" || e.key === "D") {
        duplicate();
      } else if (e.key === "m" || e.key === "M") {
        setMuted((m) => !m);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        remove();
      } else if (e.key === "Home") {
        e.preventDefault();
        setT(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setT(dur);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepFrame(e.shiftKey ? -FPS : -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepFrame(e.shiftKey ? FPS : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let acc = 0;
  const positions = clips.map((c) => {
    const left = acc;
    acc += clipLen(c);
    return left;
  });

  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(dur); s++) ticks.push(s);

  // Live preview transform — mirrors exactly what the export bakes.
  const pv = current;
  const pvStyle: React.CSSProperties | undefined = pv
    ? {
        transform: pv.mirror ? "scaleX(-1)" : undefined,
        objectFit: pv.fit === "cover" ? "cover" : "contain",
      }
    : undefined;
  return (
    <div className="editor">
      <div className="ed-top">
        <div className="ed-project">
          <input
            className="ed-name"
            value={name}
            maxLength={40}
            spellCheck={false}
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
          />
          <span className="ed-time">{fmt(t)} / {fmt(dur)}</span>
          <div className="ed-history">
            <button className="chip" onClick={undo} disabled={!hist.current.past.length} aria-label="Undo">
              <ArrowLeft size={13} /> Undo
            </button>
            <button className="chip" onClick={redo} disabled={!hist.current.future.length} aria-label="Redo">
              <ArrowLeft size={13} style={{ transform: "scaleX(-1)" }} /> Redo
            </button>
          </div>
        </div>
        <div className="ed-actions">
          <div className="ed-control-group ed-view-actions" aria-label="Timeline view controls">
            <div className="ed-zoom" aria-label="Zoom timeline">
              <button className="chip" onClick={() => zoom(-1)} disabled={px === ZOOMS[0]} aria-label="Zoom out"><Minus size={13} /></button>
              <span>{Math.round((px / 72) * 100)}%</span>
              <button className="chip" onClick={() => zoom(1)} disabled={px === ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in"><Plus size={13} /></button>
            </div>
            <label className="chip ed-select" aria-label="Export aspect ratio">
              <Ratio size={13} />
              <select value={ratio} onChange={(event) => setRatio(event.target.value as Ratio)} aria-label="Export aspect ratio">
                {RATIOS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="chip ed-select" aria-label="Export resolution">
              <Monitor size={13} />
              <select value={res} onChange={(event) => setRes(event.target.value as Res)} aria-label="Export resolution">
                <option value="720">720p</option>
                <option value="1080">1080p</option>
              </select>
            </label>
          </div>
          <span className="ed-sep" />
          <div className="ed-control-group ed-edit-actions" aria-label="Editing actions">
            <button className="chip" onClick={split} disabled={!current}>
              <Scissors size={13} /> Split
            </button>
            <button className="chip" onClick={duplicate} disabled={!sel} aria-label="Duplicate clip">
              <Plus size={13} />
            </button>
            <button className="chip" onClick={remove} disabled={!sel} aria-label="Delete clip">
              <Trash size={13} />
            </button>
          </div>
          <span className="ed-sep" />
          <div className="ed-control-group ed-secondary-actions" aria-label="Secondary actions">
            <button className={`chip${chatOpen ? " on" : ""}`} onClick={() => {
              setChatOpen((open) => {
                if (!open) setGenOpen(false);
                return !open;
              });
            }} aria-label="Toggle editor chat">
              <Chat size={13} /> Chat
            </button>
            <button className={`chip${stockOpen ? " on" : ""}`} onClick={() => {
              setStockOpen((open) => !open);
              setChatOpen(false);
              setGenOpen(false);
            }} aria-label="Search stock media">
              <Film size={13} /> Stock
            </button>
            <button className={`chip gen-chip${genOpen ? " on" : ""}`} onClick={() => {
              setGenPrompt("");
              setGenOpen((open) => {
                if (!open) setChatOpen(false);
                return !open;
              });
            }}>
              <Spark size={13} /> Generate
            </button>
          </div>
          <button className="chip ed-new" onClick={newProject} disabled={!clips.length} aria-label="New project">
            New
          </button>
          <button className="ed-export" onClick={doExport} disabled={!clips.length || busy}>
            {busy ? `Rendering ${Math.round(progress * 100)}%` : "Export"}
          </button>
        </div>
      </div>

      <div className="ed-body">
        <div className="ed-preview">
          {current ? (
            <div className="ed-stage" style={{ aspectRatio: `${W} / ${H}` }}>
              {current.kind === "video" ? (
                <video
                  key={current.id}
                  ref={videoRef}
                  src={current.src}
                  muted={muted}
                  playsInline
                  preload="auto"
                  onTimeUpdate={onVideoTime}
                  onEnded={onVideoEnd}
                  style={pvStyle}
                />
              ) : (
                <img key={current.id} src={current.src} alt={current.name} style={pvStyle} />
              )}
              {current.caption?.trim() && (
                <span className="pv-cap">{current.caption}</span>
              )}
            </div>
          ) : (
            <div className="ed-empty">
              <Film size={22} />
              <span>Add video or images, then export.</span>
            </div>
          )}
          {toast && <div className="ed-toast">{toast}</div>}
        </div>

        <div className="ed-side">
          <div className="ed-cats ed-library">
            <div className="ed-cats-head">
              <div className="ed-cats-t">Asset library</div>
              <button className="chip" type="button" onClick={() => setAssetPickerOpen(true)}>Open library</button>
            </div>
            {lib.length > 0 ? (
              <div className="ed-lib-grid">
                {lib.map((asset) => (
                  <div className="lib-cell" key={asset.id} onClick={() => void libToTimeline(asset)} title={`Add "${asset.name}" to the timeline`}>
                    {asset.kind === "video" ? (
                      <video src={assetObjectUrl(asset)} muted loop autoPlay playsInline preload="metadata" />
                    ) : (
                      <img src={assetObjectUrl(asset)} alt={asset.name} loading="lazy" />
                    )}
                    <button className="lib-x" onClick={(event) => {
                      event.stopPropagation();
                      void deleteAsset(asset.id).then(() => {
                        if (asset.remoteUrl) savedGenerated.current.delete(asset.remoteUrl);
                      }).catch((error) => flash(error instanceof Error ? error.message : "Could not remove asset"));
                    }} aria-label="Remove from library">
                      <X size={11} />
                    </button>
                    <span className="lib-add">Add to timeline</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ed-cats-d">No saved assets yet.</div>
            )}
          </div>
          <div className="ed-add">
            <label className="chip file">
              <Plus size={13} /> Upload video / image
              <input type="file" accept="video/*,image/*" multiple hidden onChange={(e) => onFiles(e.target.files, e.currentTarget)} />
            </label>
            <div className="ed-url">
              <input
                value={url}
                placeholder="Paste a video URL…"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUrl()}
              />
              <button className="chip" onClick={addUrl}>Add</button>
            </div>
          </div>
          {stockOpen && (
            <div className="ed-cats ed-stock-panel">
              <div className="ed-cats-head">
                <div><div className="ed-cats-t">Stock media</div><small>Photos and videos from Pexels</small></div>
                <button className="chip" type="button" onClick={() => setStockOpen(false)}>Close</button>
              </div>
              <div className="ed-stock-controls">
                <select value={stockMode} onChange={(event) => setStockMode(event.target.value as "both" | "image" | "video")}>
                  <option value="both">Photos + videos</option>
                  <option value="image">Photos</option>
                  <option value="video">Videos</option>
                </select>
                <input value={stockQuery} placeholder="Search sunsets, city, hands…" onChange={(event) => setStockQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchEditorStock(); }} />
                <button className="chip" type="button" disabled={stockBusy || !stockQuery.trim()} onClick={() => void searchEditorStock()}>{stockBusy ? "Searching…" : "Search"}</button>
              </div>
              {stockError && <div className="ed-stock-error" role="alert">{stockError}</div>}
              {stockResults.length > 0 && <div className="ed-stock-grid">{stockResults.map((item) => (
                <article className="ed-stock-card" key={`${item.kind}-${item.id}`}>
                  {item.kind === "video" ? <video src={item.url} poster={item.thumb} muted loop playsInline controls /> : <img src={item.url} srcSet={`${item.thumb} 1x`} alt={item.title} loading="lazy" />}
                  <strong>{item.title}</strong>
                  <small><a href={item.sourcePage} target="_blank" rel="noreferrer">Provided by Pexels</a> · {item.credit}{item.duration ? ` · ${item.duration}s` : ""}</small>
                  <div><button className="chip" type="button" onClick={() => void addStockToEditor(item)}>Add to timeline</button><button className="chip" type="button" onClick={() => void addStockToWorkspace(item)}>Workspace</button></div>
                </article>
              ))}</div>}
            </div>
          )}

          {selected && (
            <div className="ed-props">
              <div className="ed-cats-t">Clip</div>
              <div className="prop-name">
                <span className="prop-kind">{selected.kind}</span>
                <span className="prop-tx">{selected.name}</span>
              </div>
              <div className="prop-row"><span>Timeline</span><span>{fmt(posOf(selected.id))}</span></div>
              {selected.kind === "video" && (
                <div className="prop-row"><span>Source</span><span>{selected.dur.toFixed(1)}s</span></div>
              )}
              <div className="prop-row">
                <span>In</span>
                <input className="prop-in" type="number" min={0} max={selected.out - 0.2} step={0.1} value={Number(selected.in.toFixed(2))}
                  onChange={(e) => patch(selected.id, { in: Math.max(0, Math.min(selected.out - 0.2, Number(e.target.value) || 0)) })} />
              </div>
              <div className="prop-row">
                <span>Out</span>
                <input className="prop-in" type="number" min={selected.in + 0.2} max={selected.kind === "video" ? selected.dur : selected.in + 60} step={0.1} value={Number(selected.out.toFixed(2))}
                  onChange={(e) => patch(selected.id, { out: Math.max(selected.in + 0.2, Number(e.target.value) || selected.in + 0.2) })} />
              </div>
              <div className="prop-row"><span>Length</span><span>{clipLen(selected).toFixed(1)}s</span></div>
              {lib.some((asset) => asset.kind === selected.kind) && (
                <div className="prop-row col">
                  <span>Replace source</span>
                  <select className="prop-txt" aria-label="Replace selected clip source" value="" onChange={(event) => {
                    const asset = lib.find((item) => item.id === event.target.value);
                    if (asset) void replaceSelectedFromLibrary(asset);
                  }}>
                    <option value="">Choose from library</option>
                    {lib.filter((asset) => asset.kind === selected.kind).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                  </select>
                </div>
              )}

              <div className="ed-cats-t" style={{ marginTop: 6 }}>Look</div>
              {selected.kind === "video" && (
                <>
                  <div className="prop-row">
                    <span>Speed</span>
                    <div className="prop-seg">
                      {SPEEDS.map((s) => (
                        <button key={s} className={`prop-btn${(selected.speed ?? 1) === s ? " on" : ""}`} onClick={() => patch(selected.id, { speed: s })}>
                          {s}×
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="prop-row">
                    <span>Volume</span>
                    <input className="prop-range" type="range" min={0} max={2} step={0.05} value={selected.volume ?? 1}
                      onChange={(e) => patch(selected.id, { volume: Number(e.target.value) }, true)} />
                  </div>
                  <div className="prop-row"><span>{(selected.volume ?? 1).toFixed(2)}×</span><span /></div>
                </>
              )}
              <div className="prop-row">
                <span>Mirror</span>
                <button className={`prop-btn${selected.mirror ? " on" : ""}`} onClick={() => patch(selected.id, { mirror: !selected.mirror })}>
                  {selected.mirror ? "On" : "Off"}
                </button>
              </div>
              <div className="prop-row">
                <span>Fade</span>
                <button className={`prop-btn${selected.fade ? " on" : ""}`} onClick={() => patch(selected.id, { fade: !selected.fade })}>
                  {selected.fade ? "0.25s" : "Off"}
                </button>
              </div>
              <div className="prop-row">
                <span>Frame</span>
                <div className="prop-seg">
                  <button className={`prop-btn${selected.fit !== "cover" ? " on" : ""}`} onClick={() => patch(selected.id, { fit: "contain" })}>Fit</button>
                  <button className={`prop-btn${selected.fit === "cover" ? " on" : ""}`} onClick={() => patch(selected.id, { fit: "cover" })}>Fill</button>
                </div>
              </div>
              <div className="prop-row col">
                <span>Caption</span>
                <input className="prop-txt" type="text" maxLength={60} placeholder="Title over this clip…" value={selected.caption ?? ""}
                  onChange={(e) => patch(selected.id, { caption: e.target.value }, true)} />
              </div>
              <div className="prop-row">
                <span>Reset</span>
                <button className="chip prop-reset" onClick={() => patch(selected.id, { speed: 1, volume: 1, mirror: false, fade: false, fit: "contain", caption: "" })}>
                  Reset look
                </button>
              </div>
              {selected.kind === "video" && (
                <button className="chip prop-snap" onClick={() => void snap()}>
                  <Camera size={13} /> Snapshot frame
                </button>
              )}
              <button className="chip prop-del" onClick={remove}><Trash size={13} /> Delete clip</button>
            </div>
          )}

        </div>
        {chatOpen && <aside className="ed-chat-pane" aria-label="Editor chat"><TimelineAgent showPreview={false} exportRequest={doExport} /></aside>}
        {genOpen && <aside className="ed-generate-pane" aria-label="Generate asset"><GenerateModal
          open={genOpen}
          variant="panel"
          initialPrompt={genPrompt}
          onClose={() => setGenOpen(false)}
          onAdd={(g) => void addGeneratedToTimeline(g)}
          onLib={(g) => {
            void saveGenerated(g).then(() => flash("Saved to library")).catch((error) => flash(error instanceof Error ? error.message : "Could not save generated media"));
          }}
        /></aside>}
      </div>
      <AssetPicker open={assetPickerOpen} onClose={() => setAssetPickerOpen(false)} onSelect={libToTimeline} title="Library" />

      <div className="ed-timeline" onClick={scrub}>
        <div className="tl-ruler">
          <div className="tl" style={{ width: Math.max(dur * px, 480) }}>
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * px }}>
                {s % 5 === 0 ? fmt(s) : ""}
              </span>
            ))}
          </div>
        </div>
        <div className="tl-track">
          <div className="tl" style={{ width: Math.max(dur * px, 480) }}>
            {clips.map((c, i) => (
              <div
                key={c.id}
                className={`tl-clip${sel === c.id ? " on" : ""}${c.kind === "image" ? " img" : ""}${drag === "moved" && sel === c.id ? " drag" : ""}`}
                style={{ left: positions[i] * px, width: clipLen(c) * px }}
                onClick={(e) => { e.stopPropagation(); setSel(c.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); goClip(c.id); }}
                onPointerDown={(e) => startDrag(e, c.id)}
              >
                {c.thumb && <img className="tl-thumb" src={c.thumb} alt="" draggable={false} />}
                <span className="tl-name">
                  {c.name}
                  {c.kind === "video" && (c.speed ?? 1) !== 1 && <em> {c.speed}×</em>}
                  {c.mirror && <em> ⇋</em>}
                  {c.fade && <em> ◐</em>}
                  {c.caption?.trim() && <em> T</em>}
                </span>
                {sel === c.id && (
                  <>
                    <span className="tl-handle in" onPointerDown={(e) => trim(e, c.id, "in")} />
                    <span className="tl-handle out" onPointerDown={(e) => trim(e, c.id, "out")} />
                  </>
                )}
              </div>
            ))}
            <div className="tl-ph" style={{ left: t * px }} />
          </div>
        </div>
      </div>

      <div className="ed-transport">
      <button className="ed-play" onClick={() => { if (t > 0) { setT(0); setPlaying(false); } else setPlaying((p) => !p); }} disabled={!dur} aria-label={t > 0 ? "Return to start" : "Play"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="ed-sep" />
      <button className="chip" onClick={() => stepFrame(-1)} disabled={!dur} aria-label="Previous frame">
        <StepBack size={13} />
      </button>
      <button className="chip" onClick={() => stepFrame(1)} disabled={!dur} aria-label="Next frame">
        <StepFwd size={13} />
      </button>
      <button className="chip" onClick={() => setMuted((m) => !m)} disabled={!current || current.kind !== "video"} aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX size={13} /> : <Volume size={13} />}
      </button>
      <span className="ed-dur">{clips.length} clip{clips.length === 1 ? "" : "s"} · {fmt(dur)}</span>
      </div>

    </div>
  );
}
