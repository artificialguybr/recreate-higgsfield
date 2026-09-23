import { useEffect, useRef, useState } from "react";
import FeedCard from "../components/FeedCard";
import { Play, Pause, Scissors, Trash, Plus, Film, Volume, VolumeX, StepBack, StepFwd, ArrowLeft, Camera, Spark, X, Chat } from "../components/Icons";
import { Clip, clipAt, clipLen, makeImageClip, makeVideoClip, splitClip, totalDur } from "../lib/editor";
import { exportClips } from "../lib/ffmpeg";
import { pendingMedia, clearPending } from "../lib/transfer";
import { useFeed } from "../lib/hf";
import GenerateModal, { Generated } from "../components/GenerateModal";
import ChatPanel from "../components/ChatPanel";
import { ChatCtx } from "../lib/editorChat";
import { upsertWorkspaceArtifact } from "../lib/workspace";

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
  const [clips, setClips] = useState<Clip[]>([]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState<Generated[]>([]);
  const LIB_KEY = "field-editor-library";
  const libLoaded = useRef(false);
  useEffect(() => {
    upsertWorkspaceArtifact({
      id: "editor",
      tool: "editor",
      title: "Editor",
      summary: "Your shared timeline is ready for the next handoff.",
      route: "/editor",
      status: "active",
    });
  }, []);
  // Load the asset library once; remote URLs survive a refresh.
  useEffect(() => {
    if (libLoaded.current) return;
    libLoaded.current = true;
    try {
      const raw = localStorage.getItem(LIB_KEY);
      if (raw) {
        const items = (JSON.parse(raw) as Generated[]).filter((g) => !g.url.startsWith("blob:"));
        if (items.length) setLib(items);
      }
    } catch {
      /* corrupt save */
    }
  }, []);
  const libSaveTimer = useRef<number>(0);
  useEffect(() => {
    window.clearTimeout(libSaveTimer.current);
    libSaveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(LIB_KEY, JSON.stringify(lib.filter((g) => !g.url.startsWith("blob:"))));
      } catch {
        /* storage full */
      }
    }, 500);
    return () => window.clearTimeout(libSaveTimer.current);
  }, [lib]);
  const libAdd = (g: Generated) => setLib((l) => [g, ...l].slice(0, 24));
  const libRemove = (url: string) => setLib((l) => l.filter((g) => g.url !== url));
  const libToTimeline = (g: Generated) => {
    const s: Source = { url: proxyMedia(g.url) };
    if (g.kind === "image") addImage(s, g.name);
    else void addVideo(s, g.name);
  };
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState("");
  const [toast, setToast] = useState("");
  const [px, setPx] = useState(PX0);
  const [res, setRes] = useState<Res>("720");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [name, setName] = useState("Untitled");
  const [muted, setMuted] = useState(true);
  const [drag, setDrag] = useState<null | "live" | "moved">(null);
  const sources = useRef(new Map<string, Source>());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{ x: number } | null>(null);
  const feed = useFeed(1, 8, "video");

  // Undo/redo: whole-clip snapshots. Playhead and selection are transient —
  // they restore from the timeline position, not from history.
  const hist = useRef<{ past: Clip[][]; future: Clip[][] }>({ past: [], future: [] });
  const lastEdit = useRef(0);
  const commit = (next: Clip[], coalesce = false) => {
    const now = Date.now();
    if (coalesce && now - lastEdit.current < 800) return setClips(next);
    lastEdit.current = now;
    hist.current.past.push(clips);
    if (hist.current.past.length > 50) hist.current.past.shift();
    hist.current.future = [];
    setClips(next);
  };
  const commitFn = (fn: (cs: Clip[]) => Clip[], coalesce = false) => {
    setClips((cs) => {
      const now = Date.now();
      if (!coalesce || now - lastEdit.current > 800) {
        hist.current.past.push(cs);
        if (hist.current.past.length > 50) hist.current.past.shift();
        hist.current.future = [];
      }
      lastEdit.current = now;
      return fn(cs);
    });
  };
  const undo = () => {
    const p = hist.current.past.pop();
    if (!p) return;
    setClips((cs) => {
      hist.current.future.push(cs);
      return p;
    });
    flash("Undone");
  };
  const redo = () => {
    const f = hist.current.future.pop();
    if (!f) return;
    setClips((cs) => {
      hist.current.past.push(cs);
      return f;
    });
    flash("Redone");
  };
  // The chat dispatches undo as an event so it never captures a stale closure.
  useEffect(() => {
    const onChatUndo = () => undo();
    window.addEventListener("field-chat-undo", onChatUndo);
    return () => window.removeEventListener("field-chat-undo", onChatUndo);
  });

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
        localStorage.setItem(SAVE_KEY, JSON.stringify({ clips, t, name }));
      } catch {
        /* storage full — skip */
      }
    }, 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [clips, t, name]);

  // Restore the saved sequence, or ingest "Editor" handoff from a result card.
  const boot = useRef(false);
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { clips?: Clip[]; t?: number; name?: string };
        const cs = (saved.clips ?? []).filter((c) => !c.src.startsWith("blob:"));
        if (cs.length) {
          cs.forEach((c) => {
            if (!sources.current.has(c.id)) sources.current.set(c.id, { url: c.src });
          });
          setClips(cs);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture a thumbnail for new video clips so the timeline shows the shot, not a block.
  useEffect(() => {
    if (!current || current.kind !== "video" || current.thumb) return;
    let alive = true;
    void videoThumb(current.src).then((th) => {
      if (!alive || !th) return;
      setClips((cs) => cs.map((x) => (x.id === current.id ? { ...x, thumb: th } : x)));
    });
    return () => {
      alive = false;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
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

  const onFiles = (files: FileList | null, input: HTMLInputElement) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const s: Source = { url: URL.createObjectURL(f), blob: f };
      if (f.type.startsWith("video")) void addVideo(s, f.name);
      else if (f.type.startsWith("image")) addImage(s, f.name);
    });
    input.value = ""; // allow re-selecting the same file
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

  const zoom = () => setPx((p) => ZOOMS[(ZOOMS.indexOf(p) + 1) % ZOOMS.length]!);

  const fileName = () => `${name.trim() || "field-edit"}.mp4`.replace(/[^\w\-. ]+/g, "");

  const doExport = async () => {
    if (!clips.length || busy) return;
    setBusy(true);
    setProgress(0);
    flash("Loading engine…");
    try {
      const blob = await exportClips(clips, sources.current, setProgress, W, H);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName();
      a.click();
      flash(`Exported ${fileName()}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Export failed");
    }
    setBusy(false);
  };

  // The chat's view of the editor — every call lands through commit/patch,
  // so its edits are live on the timeline and undoable like any other.
  const chatCtx: ChatCtx = {
    target: () => selected ?? current,
    clipsCount: () => clips.length,
    patch: (id, p) => commit(patchClip(clips, id, p)),
    commitFn: (fn) => commitFn(fn),
    split: () => {
      const c = current;
      if (!c) return false;
      const { at } = clipAt(clips, t);
      const parts = splitClip(c, at);
      if (!parts) return false;
      const next = [...clips];
      next.splice(clips.indexOf(c), 1, parts[0], parts[1]);
      commit(next);
      return true;
    },
    remove: (id) => {
      commit(clips.filter((c) => c.id !== id));
      setSel(null);
    },
    duplicate: (id) => {
      const i = clips.findIndex((c) => c.id === id);
      if (i < 0) return;
      const c = clips[i]!;
      const copy: Clip = { ...c, id: crypto.randomUUID() };
      sources.current.set(copy.id, sources.current.get(c.id)!);
      const next = [...clips];
      next.splice(i + 1, 0, copy);
      commit(next);
      setSel(copy.id);
    },
    add: (kind, nm, url) => {
      const s: Source = { url: proxyMedia(url) };
      if (kind === "image") addImage(s, nm);
      else void addVideo(s, nm);
    },
    library: () => lib,
    seek: (x) => {
      setPlaying(false);
      setT(x);
    },
    totalDur: () => dur,
    playhead: () => t,
    rename: (nm) => setName(nm),
    export: () => void doExport(),
    generate: () => setGenOpen(true),
    status: () => ({ n: clips.length, dur, name, res, ratio }),
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
        <input
          className="ed-name"
          value={name}
          maxLength={40}
          spellCheck={false}
          aria-label="Project name"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="ed-time">{fmt(t)} / {fmt(dur)}</span>
        <div className="ed-actions">
          <button className="chip" onClick={undo} disabled={!hist.current.past.length} aria-label="Undo">
            <ArrowLeft size={13} /> Undo
          </button>
          <button className="chip" onClick={redo} disabled={!hist.current.future.length} aria-label="Redo">
            <ArrowLeft size={13} style={{ transform: "scaleX(-1)" }} /> Redo
          </button>
          <span className="ed-sep" />
          <button className="chip" onClick={zoom} aria-label="Zoom timeline">
            <Plus size={13} /> {Math.round((px / 72) * 100)}%
          </button>
          <button className="chip" onClick={() => setRatio((r) => RATIOS[(RATIOS.indexOf(r) + 1) % RATIOS.length])} aria-label="Export aspect ratio">
            {ratio}
          </button>
          <button className="chip" onClick={() => setRes((r) => (r === "720" ? "1080" : "720"))} aria-label="Export resolution">
            {res === "720" ? "720p" : "1080p"}
          </button>
          <span className="ed-sep" />
          <button className="chip" onClick={split} disabled={!current}>
            <Scissors size={13} /> Split
          </button>
          <button className="chip" onClick={duplicate} disabled={!sel} aria-label="Duplicate clip">
            <Plus size={13} />
          </button>
          <button className="chip" onClick={remove} disabled={!sel} aria-label="Delete clip">
            <Trash size={13} />
          </button>
          <span className="ed-sep" />
          <button className={`chip${chatOpen ? " on" : ""}`} onClick={() => setChatOpen((o) => !o)} aria-label="Toggle editor chat">
            <Chat size={13} /> Chat
          </button>
          <button className="chip gen-chip" onClick={() => setGenOpen(true)}>
            <Spark size={13} /> Generate
          </button>
          <button className="chip" onClick={newProject} disabled={!clips.length} aria-label="New project">
            New
          </button>
          <button className="ed-export" onClick={doExport} disabled={!clips.length || busy}>
            {busy ? `Rendering ${Math.round(progress * 100)}%` : "Export MP4"}
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

          {lib.length > 0 && (
            <div className="ed-cats">
              <div className="ed-cats-t">Asset library</div>
              <div className="ed-lib-grid">
                {lib.map((g) => (
                  <div className="lib-cell" key={g.url} onClick={() => libToTimeline(g)} title={`Add "${g.name}" to the timeline`}>
                    {g.kind === "video" ? (
                      <video src={proxyMedia(g.url)} muted loop autoPlay playsInline preload="metadata" />
                    ) : (
                      <img src={proxyMedia(g.url)} alt={g.name} loading="lazy" />
                    )}
                    <button className="lib-x" onClick={(e) => { e.stopPropagation(); libRemove(g.url); }} aria-label="Remove from library">
                      <X size={11} />
                    </button>
                    <span className="lib-add">Add to timeline</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="ed-cats">
            <div className="ed-cats-t">Generated clips</div>
            {feed.state === "ready" && (
              <div className="ed-cat-grid">
                {feed.items.slice(0, 4).map((m) => (
                  <FeedCard key={m.mode} m={m} onOpen={() => void addVideo({ url: proxyMedia(m.video ?? m.thumb!) }, m.title)} />
                ))}
              </div>
            )}
            {feed.state === "loading" && <div className="ed-cats-d">Loading catalog…</div>}
            {feed.state === "error" && <button className="chip" onClick={feed.retry}>Retry</button>}
          </div>
        </div>
        {chatOpen && <ChatPanel ctx={chatCtx} />}
      </div>

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
        <button className="ed-play" onClick={() => setPlaying((p) => !p)} disabled={!dur} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="chip" onClick={() => { setT(0); setPlaying(false); }}>
          <ArrowLeft size={13} /> Start
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

      <GenerateModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onAdd={(g) => libToTimeline(g)}
        onLib={(g) => {
          libAdd(g);
          flash("Saved to library");
        }}
      />
    </div>
  );
}
