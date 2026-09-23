import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Film, Pause, Play, Spark } from "./Icons";
import { chatCommand, type ChatCtx } from "../lib/editorChat";
import { clipAt, clipLen, makeImageClip, makeVideoClip, totalDur, type Clip } from "../lib/editor";
import { activeWorkspaceProjectId, upsertWorkspaceArtifact } from "../lib/workspace";
import type { Generated } from "./GenerateModal";

type Save = { clips: Clip[]; t: number; name: string };
type Message = { role: "user" | "ai"; text: string; followups?: string[] };
const EMPTY: Save = { clips: [], t: 0, name: "Untitled" };
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function readSave(key: string): Save {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as Partial<Save> | null;
    return saved && Array.isArray(saved.clips)
      ? { clips: saved.clips.filter((clip): clip is Clip => Boolean(clip && typeof clip.src === "string" && !clip.src.startsWith("blob:"))), t: saved.t ?? 0, name: saved.name || "Untitled" }
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function TimelineAgent() {
  const navigate = useNavigate();
  const projectId = activeWorkspaceProjectId();
  const saveKey = `field-editor-project:${projectId}`;
  const chatKey = `field-editor-chat:${projectId}`;
  const [save, setSave] = useState(() => readSave(saveKey));
  const saveRef = useRef(save);
  const history = useRef<Save[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(chatKey) || "[]") as Message[];
      return Array.isArray(stored) ? stored.filter((message) => message && (message.role === "user" || message.role === "ai") && typeof message.text === "string") : [];
    } catch {
      return [];
    }
  });
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  const duration = totalDur(save.clips);
  const active = save.clips[clipAt(save.clips, save.t).index];
  const start = active ? save.clips.slice(0, save.clips.indexOf(active)).reduce((sum, clip) => sum + clipLen(clip), 0) : 0;
  const targetId = selected && save.clips.some((clip) => clip.id === selected) ? selected : active?.id;
  const target = save.clips.find((clip) => clip.id === targetId) ?? null;

  const persist = (next: Save) => {
    saveRef.current = next;
    setSave(next);
    try {
      localStorage.setItem(saveKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("field-editor-timeline", { detail: next }));
    } catch {
      setNotice("Timeline storage is unavailable.");
    }
  };
  const commit = (update: (clips: Clip[]) => Clip[]) => {
    const current = saveRef.current;
    history.current.push(current);
    if (history.current.length > 50) history.current.shift();
    persist({ ...current, clips: update(current.clips) });
  };
  const seek = (seconds: number) => {
    setPlaying(false);
    persist({ ...saveRef.current, t: Math.max(0, Math.min(seconds, totalDur(saveRef.current.clips))) });
  };
  const undo = () => {
    const previous = history.current.pop();
    if (!previous) {
      setNotice("No chat edits to undo.");
      return;
    }
    persist(previous);
    setNotice("Undone");
  };
  const addClip = (kind: "image" | "video", name: string, url: string) => {
    const clip = kind === "image" ? makeImageClip(url, name) : makeVideoClip(url, name, 5);
    commit((clips) => [...clips, clip]);
    setSelected(clip.id);
  };

  useEffect(() => {
    try {
      localStorage.setItem(chatKey, JSON.stringify(messages));
    } catch {
      /* Chat history is optional. */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatKey, messages]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    upsertWorkspaceArtifact({
      id: "editor",
      tool: "editor",
      title: save.name || "Untitled",
      summary: save.clips.length ? `${save.clips.length} clips · ${fmt(duration)} timeline` : "No clips in the timeline yet.",
      route: "/editor",
      status: save.clips.length ? "ready" : "empty",
    });
  }, [duration, save.clips, save.name]);
  useEffect(() => {
    const onUndo = () => undo();
    window.addEventListener("field-chat-undo", onUndo);
    return () => window.removeEventListener("field-chat-undo", onUndo);
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === saveKey) {
        saveRef.current = readSave(saveKey);
        setSave(saveRef.current);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [saveKey]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || active.kind !== "video") return;
    video.currentTime = active.in + Math.max(0, save.t - start) * (active.speed ?? 1);
    if (playing) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }, [active?.id, active?.in, active?.src, active?.speed, playing]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || active.kind !== "video" || playing) return;
    const position = active.in + Math.max(0, save.t - start) * (active.speed ?? 1);
    if (Math.abs(video.currentTime - position) > 0.2) video.currentTime = position;
  }, [active?.id, active?.in, active?.speed, playing, save.t, start]);
  useEffect(() => {
    if (!playing || active?.kind === "video") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = saveRef.current.t + (now - last) / 1000;
      last = now;
      if (next >= totalDur(saveRef.current.clips)) {
        seek(totalDur(saveRef.current.clips));
        setPlaying(false);
        return;
      }
      saveRef.current = { ...saveRef.current, t: next };
      setSave(saveRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, active?.id]);

  const ctx: ChatCtx = {
    target: () => target,
    clipsCount: () => saveRef.current.clips.length,
    patch: (id, patch) => commit((clips) => clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip)),
    commitFn: (update) => commit(update),
    split: () => {
      const at = clipAt(saveRef.current.clips, saveRef.current.t);
      const clip = saveRef.current.clips[at.index];
      if (!clip || at.at <= 0.15 || at.at >= clipLen(clip) - 0.15) return false;
      const left = { ...clip, out: clip.in + at.at };
      const right = { ...clip, id: crypto.randomUUID(), in: clip.in + at.at };
      const next = [...saveRef.current.clips];
      next.splice(at.index, 1, left, right);
      commit(() => next);
      return true;
    },
    remove: (id) => {
      commit((clips) => clips.filter((clip) => clip.id !== id));
      setSelected(null);
    },
    duplicate: (id) => {
      commit((clips) => {
        const index = clips.findIndex((clip) => clip.id === id);
        if (index < 0) return clips;
        const copy = { ...clips[index]!, id: crypto.randomUUID() };
        const next = [...clips];
        next.splice(index + 1, 0, copy);
        return next;
      });
    },
    add: addClip,
    library: () => {
      try {
        return (JSON.parse(localStorage.getItem("field-editor-library") || "[]") as Generated[]).filter((asset) => asset && !asset.url.startsWith("blob:")).map(({ url, kind, name }) => ({ url, kind, name }));
      } catch {
        return [];
      }
    },
    seek,
    totalDur: () => totalDur(saveRef.current.clips),
    playhead: () => saveRef.current.t,
    rename: (name) => persist({ ...saveRef.current, name }),
    export: () => "Open the Editor to export this cut; rendering progress appears there.",
    generate: (prompt) => navigate("/image", { state: { workspacePrompt: prompt } }),
    status: () => ({ n: saveRef.current.clips.length, dur: totalDur(saveRef.current.clips), name: saveRef.current.name, res: "720", ratio: "16:9" }),
  };
  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || busy.current) return;
    busy.current = true;
    setThinking(true);
    setValue("");
    setMessages((items) => [...items, { role: "user", text }]);
    timer.current = window.setTimeout(() => {
      const result = chatCommand(text, ctx);
      setMessages((items) => [...items, { role: "ai", text: result.reply, followups: result.followups }]);
      setThinking(false);
      busy.current = false;
      timer.current = null;
    }, 350);
  };
  const clips = save.clips;
  let offset = 0;
  const blocks = clips.map((clip) => {
    const block = { clip, left: offset, width: clipLen(clip) };
    offset += block.width;
    return block;
  });

  return (
    <section className="timeline-agent" aria-label="Live editor agent">
      <div className="ta-chat">
        <header className="ta-head"><span><Spark size={14} /> Timeline agent</span><small>LIVE · PROJECT-SCOPED</small></header>
        <div className="ta-thread">
          {!messages.length && <div className="ta-welcome"><strong>Edit this timeline by chat.</strong><p>Changes update the preview and Editor project immediately. Every edit can be undone.</p><div className="follows">{["status", 'caption "Made with Field"', "speed 1.5×", "add first"].map((suggestion) => <button className="chip" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div></div>}
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`bubble ${message.role}`}>{message.text}{message.role === "ai" && message.followups?.length ? <div className="follows">{message.followups.map((suggestion) => <button className="chip" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}</div>)}
          {thinking && <div className="bubble ai thinking"><span /><span /><span /></div>}
          <div ref={endRef} />
        </div>
        <form className="ta-input" onSubmit={(event) => { event.preventDefault(); send(value); }}>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={clips.length ? 'Try “split”, “fade”, or “caption …”' : 'Add a clip from your library to begin'} aria-label="Edit timeline with chat" />
          <button className="send-key" disabled={!value.trim() || thinking} aria-label="Send edit"><ArrowUp size={15} /></button>
        </form>
      </div>
      <div className="ta-preview">
        <header className="ta-preview-head"><div><span>LIVE PREVIEW</span><strong>{save.name || "Untitled"}</strong></div><button className="chip" onClick={() => navigate("/editor")}><Film size={13} /> Open Editor</button></header>
        <div className="ta-stage">
          {active?.kind === "video" ? <video ref={videoRef} src={active.src} muted playsInline onTimeUpdate={(event) => { const time = start + Math.max(0, event.currentTarget.currentTime - active.in) / (active.speed ?? 1); saveRef.current = { ...saveRef.current, t: time }; setSave(saveRef.current); }} style={{ transform: active.mirror ? "scaleX(-1)" : undefined, objectFit: active.fit === "cover" ? "cover" : "contain" }} /> : active ? <img src={active.src} alt={active.name} style={{ transform: active.mirror ? "scaleX(-1)" : undefined, objectFit: active.fit === "cover" ? "cover" : "contain" }} /> : <div className="ta-empty"><Film size={20} /><span>{clips.length ? "Move the playhead to preview a clip." : "Your project timeline appears here."}</span><button onClick={() => navigate("/editor")}>Add media in Editor</button></div>}
          {active?.caption?.trim() && <span className="ta-caption">{active.caption}</span>}
        </div>
        <div className="ta-transport"><button className="ta-play" onClick={() => setPlaying((value) => !value)} disabled={!active} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><span>{fmt(save.t)} <i>/</i> {fmt(duration)}</span>{notice && <small role="status">{notice}</small>}<span className="spacer" />{clips.length} {clips.length === 1 ? "clip" : "clips"}</div>
        <div className="ta-scrub"><input aria-label="Preview position" type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(save.t, duration)} onChange={(event) => seek(Number(event.target.value))} /></div>
        <div className="ta-timeline" aria-label="Timeline clips">
          {blocks.map(({ clip, left }) => <button key={clip.id} className={`ta-clip${clip.id === targetId ? " on" : ""}`} onClick={() => { setSelected(clip.id); seek(left); }} title={clip.name}><span>{clip.thumb ? <img src={clip.thumb} alt="" /> : clip.kind === "image" ? <img src={clip.src} alt="" /> : <Film size={15} />}</span><b>{clip.name}</b><small>{fmt(clipLen(clip))}</small></button>)}
        </div>
      </div>
    </section>
  );
}
