import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, Film, Pause, Play, Spark } from "./Icons";
import { chatCommand, type ChatCtx } from "../lib/editorChat";
import { clipAt, clipLen, makeImageClip, makeVideoClip, totalDur, type Clip } from "../lib/editor";
import { ASSETS_CHANGED, assetObjectUrl, getAsset, listAssets, saveAsset, type LocalAsset } from "../lib/assets";
import { activeWorkspaceProjectId, readWorkspaceArtifacts, upsertWorkspaceArtifact } from "../lib/workspace";
import { fetchFeed, generate, hasKeys, type FeedModel } from "../lib/hf";
import { bodyForModel, isSupportedModel, isUnsupportedLegacyModel } from "../lib/hfModels";
import "./TimelineAgent.css";
import AssetPicker from "./AssetPicker";
const safeModel = (model: FeedModel) => isSupportedModel(model) && !isUnsupportedLegacyModel(model.mode) && (model.type === "image" || model.type === "video");

type Save = { clips: Clip[]; t: number; name: string };
type Proposal = { prompt: string; kind: "image" | "video"; ratio: string; duration: number; model: string; phase?: string; result?: string; preview?: boolean };
type Message = { role: "user" | "ai"; text: string; followups?: string[]; proposal?: Proposal; legacyMode?: string; media?: { url: string; assetId?: string; kind?: string; title?: string; note?: string } };
const EMPTY: Save = { clips: [], t: 0, name: "Untitled" };
const RATIOS = ["16:9", "9:16", "1:1"];
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function readSave(key: string): Save {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as Partial<Save> | null;
    return saved && Array.isArray(saved.clips)
      ? { clips: saved.clips.filter((clip): clip is Clip => Boolean(clip && typeof clip.src === "string" && !clip.src.startsWith("blob:"))), t: saved.t ?? 0, name: saved.name || "Untitled" }
      : EMPTY;
  } catch { return EMPTY; }
}
function readMessages(keys: string[]): Message[] {
  const merged: Message[] = [];
  for (let index = 0; index < keys.length; index++) try {
    const raw = localStorage.getItem(keys[index]!);
    if (raw === null) continue;
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) continue;
    const messages = stored.flatMap((item): Message[] => {
      const role = item?.role === "user" || item?.who === "user" ? "user" : item?.role === "ai" || item?.role === "assistant" || item?.who === "ai" || item?.who === "assistant" ? "ai" : null;
      const text = typeof item?.text === "string" ? item.text : typeof item?.tx === "string" ? item.tx : null;
      return role && text !== null ? [{
        role, text,
        ...(Array.isArray(item.followups) ? { followups: item.followups } : {}),
        ...(typeof item.mode === "string" ? { legacyMode: item.mode } : {}),
        ...(item.media && (typeof item.media.url === "string" || typeof item.media.assetId === "string") ? { media: item.media } : {}),
      }] : [];
    });
    if (index === 0 && messages.length) return messages;
    merged.push(...messages);
  } catch { /* Older transcripts are optional. */ }
  return merged;
}
function readHistoryProjectIds() {
  try {
    const ids = new Set<string>();
    for (const key of Object.keys(localStorage)) {
      const match = /^(?:field-agent-chat|field-editor-chat|field-chat):(.+)$/.exec(key);
      if (match?.[1]) ids.add(match[1]);
    }
    return [...ids];
  } catch { return []; }
}


function requestKind(text: string): "image" | "video" | null {
  if (/\b(video|vídeo|clip|clipe|footage|shot|animation|filme)\b/i.test(text) && /\b(make|create|generate|need|want|produce|preciso|quero|gerar|gere|crie|criar|fazer|faz|produzir|produza)\b/i.test(text)) return "video";
  if (/\b(image|imagem|picture|photo|foto|illustration|still)\b/i.test(text) && /\b(make|create|generate|need|want|produce|preciso|quero|gerar|gere|crie|criar|fazer|faz|produzir|produza)\b/i.test(text)) return "image";
  return null;
}
function estimate(model: FeedModel | undefined, proposal: Proposal) {
  if (!model?.price) return "Catalog price unavailable";
  if (proposal.kind === "video") {
    const unit = model.priceUnit || "";
    const normalizedUnit = unit.trim().toLowerCase().replace(/\s+/g, "");
    const perSecond = normalizedUnit === "s" || normalizedUnit === "sec" || normalizedUnit === "second" || normalizedUnit === "seconds" || normalizedUnit === "/s" || normalizedUnit === "/sec" || normalizedUnit === "/second" || normalizedUnit === "/seconds" || normalizedUnit === "persecond" || normalizedUnit === "persec" || normalizedUnit === "pers";
    if (perSecond) {
      const rate = Number(model.price.replace(/[^0-9.,-]/g, "").replace(",", "."));
      if (Number.isFinite(rate)) {
        const total = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(rate * proposal.duration);
        return `Catalog estimate: $${total} total ($${model.price}/${unit.replace(/^\//, "")} × ${proposal.duration}s)`;
      }
    }
    return `Catalog price: $${model.price}${unit ? `/${unit.replace(/^\//, "")}` : ""} · total estimate unavailable`;
  }
  return `Catalog estimate: $${model.price}${model.priceUnit ? `/${model.priceUnit.replace(/^\//, "")}` : ""}`;
}
function extractPrompt(text: string) {
  return text.replace(/^\s*(?:(?:please|por favor)\s+)?(?:(?:i\s+)?(?:need|want|would like)|preciso(?:\s+de)?|quero|(?:make|create|generate|produce|gerar|gere|criar|crie|fazer|faz|produzir|produza))\s+(?:me\s+)?(?:(?:a|an|the|um|uma|o|a)\s+)?(?:video|vídeo|clip|clipe|footage|shot|animation|filme|image|imagem|picture|photo|foto|illustration|still)\s*(?:of|showing|about|de|com|sobre)?\s*/i, "").trim() || text;
}
export default function TimelineAgent({ showPreview = true }: { showPreview?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [projectId, setProjectId] = useState(() => activeWorkspaceProjectId());
  const saveKey = `field-editor-project:${projectId}`;
  const chatKey = `field-agent-chat:${projectId}`;
  const [save, setSave] = useState(() => readSave(saveKey));
  const saveRef = useRef(save);
  const history = useRef<Save[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => readMessages([`field-agent-chat:${projectId}`, `field-editor-chat:${projectId}`, `field-chat:${projectId}`]));
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [models, setModels] = useState<FeedModel[]>([]);
  const [generating, setGenerating] = useState(false);
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const consumedNavigation = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = useRef(false);
  const duration = totalDur(save.clips);
  const active = save.clips[clipAt(save.clips, save.t).index];
  const start = active ? save.clips.slice(0, save.clips.indexOf(active)).reduce((sum, clip) => sum + clipLen(clip), 0) : 0;
  const targetId = selected && save.clips.some((clip) => clip.id === selected) ? selected : active?.id;
  const target = save.clips.find((clip) => clip.id === targetId) ?? null;


  const persist = (next: Save, key = `field-editor-project:${activeWorkspaceProjectId()}`) => {
    saveRef.current = next;
    setSave(next);
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new CustomEvent("field-editor-timeline", { detail: next })); }
    catch { setNotice("Timeline storage is unavailable."); }
  };
  const commit = (update: (clips: Clip[]) => Clip[]) => {
    const current = saveRef.current;
    history.current.push(current);
    if (history.current.length > 50) history.current.shift();
    persist({ ...current, clips: update(current.clips) });
  };
  const seek = (seconds: number) => { setPlaying(false); persist({ ...saveRef.current, t: Math.max(0, Math.min(seconds, totalDur(saveRef.current.clips))) }); };
  const undo = () => { const previous = history.current.pop(); if (!previous) { setNotice("No chat edits to undo."); return; } persist(previous); setNotice("Undone"); };
  const addClip = (kind: "image" | "video", name: string, url: string) => {
    const clip = kind === "image" ? makeImageClip(url, name) : makeVideoClip(url, name, 5);
    commit((clips) => [...clips, clip]); setSelected(clip.id);
  };

  useEffect(() => {
    let live = true;
    fetchFeed(1, 48).then((items) => { if (live) setModels(items.filter(safeModel)); }).catch(() => { if (live) setModels([]); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => { void listAssets().then((items) => { if (live) setAssets(items); }).catch(() => { if (live) setAssets([]); }); };
    refresh();
    window.addEventListener(ASSETS_CHANGED, refresh);
    return () => { live = false; window.removeEventListener(ASSETS_CHANGED, refresh); };
  }, []);
  useEffect(() => {
    if (!assets.length) return;
    setMessages((items) => {
      let changed = false;
      const next = items.map((message) => {
        const asset = assets.find((item) => item.id === message.media?.assetId);
        if (!asset) return message;
        const url = assetObjectUrl(asset);
        if (message.media?.url === url) return message;
        changed = true;
        return { ...message, media: { ...message.media!, url } };
      });
      return changed ? next : items;
    });
  }, [assets]);
  useEffect(() => {
    const state = location.state as { fieldAssetId?: unknown } | null;
    const id = typeof state?.fieldAssetId === "string" ? state.fieldAssetId : "";
    if (!id || consumedNavigation.current === location.key) return;
    consumedNavigation.current = location.key;
    void getAsset(id).then((asset) => {
      if (asset) setMessages((items) => [...items, { role: "ai", text: "Opened from your library.", media: { url: assetObjectUrl(asset), assetId: asset.id, kind: asset.kind, title: asset.name, note: "Local library" } }]);
      else setNotice("That library asset is unavailable.");
    }).catch(() => setNotice("That library asset is unavailable."));
    const stateWithoutAsset = { ...state };
    delete stateWithoutAsset.fieldAssetId;
    navigate(location.pathname, { replace: true, state: Object.keys(stateWithoutAsset).length ? stateWithoutAsset : null });
  }, [location.key, location.pathname, location.state, navigate]);
  useEffect(() => {
    try { localStorage.setItem(chatKey, JSON.stringify(messages)); } catch { /* Chat history is optional. */ }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatKey, messages]);
  useEffect(() => () => { /* No delayed command survives unmount. */ }, []);
  useEffect(() => {
    upsertWorkspaceArtifact({ id: "editor", tool: "editor", title: save.name || "Untitled", summary: save.clips.length ? `${save.clips.length} clips · ${fmt(duration)} timeline` : "No clips in the timeline yet.", route: "/editor", status: save.clips.length ? "ready" : "empty" });
  }, [duration, save.clips, save.name]);
  useEffect(() => {
    const onUndo = () => undo(); window.addEventListener("field-chat-undo", onUndo); return () => window.removeEventListener("field-chat-undo", onUndo);
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === saveKey) { saveRef.current = readSave(saveKey); setSave(saveRef.current); } };
    window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage);
  }, [saveKey]);
  useEffect(() => {
    const video = videoRef.current; if (!video || !active || active.kind !== "video") return;
    video.currentTime = active.in + Math.max(0, save.t - start) * (active.speed ?? 1);
    if (playing) void video.play().catch(() => setPlaying(false)); else video.pause();
  }, [active?.id, active?.in, active?.src, active?.speed, playing, previewOpen]);
  useEffect(() => {
    const video = videoRef.current; if (!video || !active || active.kind !== "video" || playing) return;
    const position = active.in + Math.max(0, save.t - start) * (active.speed ?? 1); if (Math.abs(video.currentTime - position) > 0.2) video.currentTime = position;
  }, [active?.id, active?.in, active?.speed, playing, save.t, start, previewOpen]);
  useEffect(() => {
    if (!playing || active?.kind === "video") return;
    let frame = 0; let last = performance.now();
    const tick = (now: number) => { const next = saveRef.current.t + (now - last) / 1000; last = now; if (next >= totalDur(saveRef.current.clips)) { seek(totalDur(saveRef.current.clips)); setPlaying(false); return; } saveRef.current = { ...saveRef.current, t: next }; setSave(saveRef.current); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, active?.id]);

  const ctx: ChatCtx = {
    target: () => target, clipsCount: () => saveRef.current.clips.length,
    patch: (id, patch) => commit((clips) => clips.map((clip) => clip.id === id ? { ...clip, ...patch } : clip)),
    commitFn: (update) => commit(update),
    split: () => { const at = clipAt(saveRef.current.clips, saveRef.current.t); const clip = saveRef.current.clips[at.index]; if (!clip || at.at <= 0.15 || at.at >= clipLen(clip) - 0.15) return false; const left = { ...clip, out: clip.in + at.at }; const right = { ...clip, id: crypto.randomUUID(), in: clip.in + at.at }; const next = [...saveRef.current.clips]; next.splice(at.index, 1, left, right); commit(() => next); return true; },
    remove: (id) => { commit((clips) => clips.filter((clip) => clip.id !== id)); setSelected(null); },
    duplicate: (id) => commit((clips) => { const index = clips.findIndex((clip) => clip.id === id); if (index < 0) return clips; const copy = { ...clips[index]!, id: crypto.randomUUID() }; const next = [...clips]; next.splice(index + 1, 0, copy); return next; }),
    add: addClip,
    library: () => assets.map((asset) => ({ url: assetObjectUrl(asset), kind: asset.kind, name: asset.name })),
    seek, totalDur: () => totalDur(saveRef.current.clips), playhead: () => saveRef.current.t, rename: (name) => persist({ ...saveRef.current, name }),
    export: () => "Open the Editor to export this cut; rendering progress appears there.",
    generate: (prompt) => navigate("/image", { state: { workspacePrompt: prompt } }),
    status: () => ({ n: saveRef.current.clips.length, dur: totalDur(saveRef.current.clips), name: saveRef.current.name, res: "720", ratio: "16:9" }),
  };
  const updateMessage = (index: number, proposal: Proposal) => setMessages((items) => items.map((item, i) => i === index ? { ...item, proposal } : item));
  const send = (raw: string) => {
    const text = raw.trim(); if (!text || busy.current) return;
    // Re-read all project-owned context at the turn boundary; same-tab writes don't emit StorageEvent.
    const currentProject = activeWorkspaceProjectId();
    const currentSaveKey = `field-editor-project:${currentProject}`;
    const currentSave = readSave(currentSaveKey);
    const artifacts = readWorkspaceArtifacts();
    const title = localStorage.getItem("field-workspace-title") || "Untitled project";
    setProjectId(currentProject); history.current = []; saveRef.current = currentSave; setSave(currentSave);
    const threadKey = `field-agent-chat:${currentProject}`;
    const prior = currentProject === projectId ? messages : readMessages([threadKey, `field-editor-chat:${currentProject}`, `field-chat:${currentProject}`]);
    const kind = requestKind(text);
    const selectedModel = kind === "image"
      ? models.find((model) => model.type === "image" && safeModel(model))
      : models.find((model) => model.type === "video" && safeModel(model));
    const contextLine = `${title} · ${artifacts.length} workspace artifacts · ${currentSave.clips.length} timeline clips`;
    const userMessage: Message = { role: "user", text };
    if (kind) {
      const proposal: Proposal = { prompt: extractPrompt(text), kind, ratio: "16:9", duration: 5, model: selectedModel?.mode || "" };
      const next = [...prior, userMessage, { role: "ai" as const, text: `Generation proposal · ${contextLine}`, proposal }];
      setMessages(next); setValue(""); return;
    }
    busy.current = true; setThinking(true);
    const result = chatCommand(text, { ...ctx, target: () => currentSave.clips.find((clip) => clip.id === target?.id) ?? currentSave.clips[clipAt(currentSave.clips, currentSave.t).index] ?? null });
    setMessages([...prior, userMessage, { role: "ai", text: result.reply, followups: result.followups }]);
    setThinking(false); busy.current = false;
  };
  const approve = async (index: number, proposal: Proposal) => {
    if (generating || !proposal.prompt.trim()) return;
    const model = models.find((item) => item.mode === proposal.model && item.type === proposal.kind && safeModel(item));
    if (!hasKeys) {
      if (!model?.thumb && !model?.video) { updateMessage(index, { ...proposal, phase: "Preview unavailable: no credentials or catalog preview." }); return; }
      const url = proposal.kind === "video" ? model.video || model.thumb! : model.thumb!;
      const next = { ...proposal, phase: "Catalog preview · not generated output", result: url, preview: true };
      updateMessage(index, next);
      upsertWorkspaceArtifact({ id: proposal.kind, tool: proposal.kind, title: model.title, summary: "Catalog preview · not generated output.", route: `/${proposal.kind}`, status: "ready", prompt: proposal.prompt, model: model.mode, outputUrl: url, outputKind: proposal.kind, outputSource: "catalog" });
      window.dispatchEvent(new CustomEvent("field-workspace-updated"));
      return;
    }
    if (!model) { updateMessage(index, { ...proposal, phase: "Choose a catalog model before generating." }); return; }
    setGenerating(true); updateMessage(index, { ...proposal, phase: "Generating…" });
    upsertWorkspaceArtifact({ id: proposal.kind, tool: proposal.kind, title: model.title, summary: `Generating with ${model.title}…`, route: `/${proposal.kind}`, status: "active", prompt: proposal.prompt, model: model.mode });
    try {
      const endpoint = model.mode;
      const body = bodyForModel(model, proposal.prompt, proposal.kind === "image"
        ? { aspect_ratio: proposal.ratio, resolution: "2k" }
        : { aspect_ratio: proposal.ratio, duration: proposal.duration });
      const output = await generate(endpoint, body);
      if (output.kind !== proposal.kind) throw new Error(`Expected ${proposal.kind} output, received ${output.kind}.`);
      const name = proposal.prompt.slice(0, 60) || model.title;
      let asset: LocalAsset | undefined;
      let persistenceFailure = "";
      try { asset = await saveAsset({ url: output.url, kind: output.kind, name, source: "generation", model: model.title, prompt: proposal.prompt }); }
      catch (error) { persistenceFailure = error instanceof Error ? ` Local save failed: ${error.message}` : " Local save failed."; }
      addClip(output.kind, name, output.url);
      upsertWorkspaceArtifact({ id: proposal.kind, tool: proposal.kind, title: model.title, summary: `${proposal.kind} generation complete.${persistenceFailure}`, route: `/${proposal.kind}`, status: "ready", prompt: proposal.prompt, model: model.mode, outputUrl: output.url, outputKind: output.kind, outputSource: "generation", assetId: asset?.id });
      window.dispatchEvent(new CustomEvent("field-workspace-updated"));
      updateMessage(index, { ...proposal, phase: `Generated and added to the active timeline.${persistenceFailure}`, result: output.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed.";
      updateMessage(index, { ...proposal, phase: message });
      upsertWorkspaceArtifact({ id: proposal.kind, tool: proposal.kind, title: model.title, summary: message, route: `/${proposal.kind}`, status: "failed", prompt: proposal.prompt, model: model.mode });
    } finally { setGenerating(false); }
  };
  const clips = save.clips;
  const modelFor = (proposal: Proposal) => models.find((model) => model.mode === proposal.model && model.type === proposal.kind && safeModel(model));
  const projectLabel = localStorage.getItem("field-workspace-title") || save.name || "Untitled project";
  const recentMessages = messages.filter((message) => message.role === "user" && message.text.trim()).slice(-6).reverse();
  const recentProjects = readHistoryProjectIds()
    .filter((id) => id !== projectId)
    .map((id) => ({ id, messages: readMessages([`field-agent-chat:${id}`, `field-editor-chat:${id}`, `field-chat:${id}`]) }))
    .filter(({ messages: items }) => items.some((message) => message.role === "user" && message.text.trim()));
  const startNewConversation = () => { setValue(""); inputRef.current?.focus(); };

  return <section className={`timeline-agent${showPreview ? (previewOpen ? "" : " no-preview") : " embedded"}`} aria-label="Agent">
    <aside className="ta-history" aria-label="Agent history">
      <div className="ta-history-head"><div><small>PROJECT</small><span>Conversations</span></div><button className="chip ta-new-conversation" type="button" onClick={startNewConversation}>New conversation</button></div>
      <div className="ta-history-list">
        <div className="ta-history-current" aria-current="page">
          <div className="ta-history-current-top"><span className="ta-history-dot" aria-hidden="true" /><strong>{projectLabel}</strong><span>ACTIVE</span></div>
          <small>{recentMessages.length ? `${recentMessages.length} prompt${recentMessages.length === 1 ? "" : "s"}` : "Ready for a new idea"}</small>
        </div>
        <div className="ta-history-label">Recent prompts</div>
        {recentMessages.length ? recentMessages.map((message, index) => <div className="ta-history-entry" key={`${message.text}-${index}`} title={message.text}><span>Prompt</span>{message.text}</div>) : <p className="ta-history-empty">Your conversations will appear here.</p>}
        {recentProjects.length > 0 && <div className="ta-history-older">
          <div className="ta-history-label">Other projects</div>
          {recentProjects.map(({ id, messages: projectMessages }) => <div className="ta-history-session" key={id}>
            <div className="ta-history-project"><strong>Session · {id}</strong><small>{projectMessages.filter((message) => message.role === "user" && message.text.trim()).length} prompts</small></div>
            {projectMessages.filter((message) => message.role === "user" && message.text.trim()).slice(-2).reverse().map((message, index) => <div className="ta-history-entry" key={`${id}-${message.text}-${index}`} title={message.text}><span>Prompt</span>{message.text}</div>)}
          </div>)}
        </div>}
      </div>
    </aside>
    <div className="ta-chat">
      <header className="ta-head"><span><Spark size={14} /> Agent</span><div><button className="chip" onClick={() => setAssetPickerOpen(true)}>Library</button>{showPreview && <button className="chip ta-preview-toggle" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen} aria-controls={previewOpen ? "ta-preview-pane" : undefined}>{previewOpen ? "Hide preview" : "Live preview"}</button>}</div></header>
      <div className="ta-thread" aria-live="polite">
        {!messages.length && <div className="ta-welcome"><strong>What are we making?</strong><p>Chat, propose image or video generation, or edit the active timeline. Timeline changes are undoable.</p><div className="follows">{["Create an image of a quiet coastal town", "I need a video of a desert at sunset", "status", 'caption "Made with Field"'].map((suggestion) => <button className="chip" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div></div>}
        {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`bubble ${message.role}`}>{message.text}{message.legacyMode && <small className="ta-legacy-mode">{message.legacyMode}</small>}{message.media && <div className="ta-legacy-media">{message.media.kind === "video" ? <video src={message.media.url} controls playsInline /> : <img src={message.media.url} alt={message.media.title || "Shared media"} />}<div>{message.media.title && <strong>{message.media.title}</strong>}{message.media.note && <small>{message.media.note}</small>}</div></div>}{message.role === "ai" && message.followups?.length ? <div className="follows">{message.followups.map((suggestion) => <button className="chip" key={suggestion} onClick={() => send(suggestion)}>{suggestion}</button>)}</div> : null}
          {message.proposal && (() => { const proposal = message.proposal!; const model = modelFor(proposal); return <div className="ta-proposal">
            <label>Prompt<textarea value={proposal.prompt} onChange={(event) => updateMessage(index, { ...proposal, prompt: event.target.value })} rows={3} /></label>
            <div className="ta-proposal-fields"><label>Type<select value={proposal.kind} onChange={(event) => { const kind = event.target.value as "image" | "video"; const model = models.find((item) => item.type === kind && safeModel(item)); updateMessage(index, { ...proposal, kind, model: model?.mode || "" }); }}>{["image", "video"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
              <label>Aspect ratio<select value={proposal.ratio} onChange={(event) => updateMessage(index, { ...proposal, ratio: event.target.value })}>{RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
              {proposal.kind === "video" && <label>Duration<select value={proposal.duration} onChange={(event) => updateMessage(index, { ...proposal, duration: Number(event.target.value) })}>{[5, 10, 15].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}</select></label>}
              <label>Model<select value={proposal.model} onChange={(event) => updateMessage(index, { ...proposal, model: event.target.value })}>{models.filter((item) => item.type === proposal.kind && safeModel(item)).map((item) => <option key={item.mode} value={item.mode}>{item.title}</option>)}{!models.some((item) => item.mode === proposal.model && safeModel(item)) && <option value="">Catalog model unavailable</option>}</select></label></div>
            <div className="ta-proposal-foot"><span>{estimate(model, proposal)}{proposal.phase ? <small role="status">{proposal.phase}</small> : null}</span><div><button className="chip" disabled={!model?.thumb && !model?.video} onClick={() => updateMessage(index, { ...proposal, phase: "Catalog preview · not generated output", result: proposal.kind === "video" ? model?.video || model?.thumb : model?.thumb, preview: true })}>Preview</button><button className="ta-generate" disabled={generating || !proposal.prompt.trim() || !model} onClick={() => void approve(index, proposal)}>{hasKeys ? "Generate" : "Use catalog preview"}</button></div></div>
            {proposal.result && <div className="ta-result">{proposal.kind === "video" ? <video src={proposal.result} controls playsInline /> : <img src={proposal.result} alt={proposal.preview ? "Catalog model preview" : "Generated result"} />}<small>{proposal.phase}</small></div>}
          </div>; })()}
        </div>)}
        {thinking && <div className="bubble ai thinking"><span /><span /><span /></div>}<div ref={endRef} />
      </div>
      <form className="ta-input" onSubmit={(event) => { event.preventDefault(); send(value); }}>
        <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Chat, request a generation, or edit your timeline…" aria-label="Message Agent" />
        <button className="send-key" disabled={!value.trim() || thinking} aria-label="Send message"><ArrowUp size={15} /></button>
      </form>
    </div>
    {showPreview && previewOpen && <aside id="ta-preview-pane" className="ta-preview-pane" aria-label="Live preview">
      <header className="ta-preview-head"><div><small>LIVE PREVIEW</small><h2>{save.name || "Untitled"}</h2></div></header>
      <div className="ta-stage">{active?.kind === "video" ? <video ref={videoRef} src={active.src} muted playsInline onTimeUpdate={(event) => { const time = start + Math.max(0, event.currentTarget.currentTime - active.in) / (active.speed ?? 1); saveRef.current = { ...saveRef.current, t: time }; setSave(saveRef.current); }} style={{ transform: active.mirror ? "scaleX(-1)" : undefined, objectFit: active.fit === "cover" ? "cover" : "contain" }} /> : active ? <img src={active.src} alt={active.name} style={{ transform: active.mirror ? "scaleX(-1)" : undefined, objectFit: active.fit === "cover" ? "cover" : "contain" }} /> : <div className="ta-empty"><Film size={20} /><span>{clips.length ? "Move the playhead to preview a clip." : "Your project timeline appears here."}</span><button onClick={() => navigate("/editor")}>Open Editor</button></div>}{active?.caption?.trim() && <span className="ta-caption">{active.caption}</span>}</div>
      <div className="ta-transport"><button className="ta-play" onClick={() => setPlaying((value) => !value)} disabled={!active} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><span className="ta-time">{fmt(save.t)} <i>/</i> {fmt(duration)}</span>{notice && <small role="status">{notice}</small>}<span className="spacer" /><button className="chip" onClick={() => navigate("/editor")}><Film size={13} /> Open Editor</button></div>
      <div className="ta-scrub"><input aria-label="Preview position" type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(save.t, duration)} onChange={(event) => seek(Number(event.target.value))} /></div>
      <div className="ta-preview-timeline">
        <div className="ta-timeline-head"><span>Timeline</span><small>{clips.length} {clips.length === 1 ? "clip" : "clips"} · {fmt(duration)}</small></div>
        <div className="ta-timeline" aria-label="Timeline clips">{clips.map((clip, index) => { const left = clips.slice(0, index).reduce((sum, item) => sum + clipLen(item), 0); return <button key={clip.id} className={`ta-clip${clip.id === targetId ? " on" : ""}`} onClick={() => { setSelected(clip.id); seek(left); }} title={clip.name}><span>{clip.thumb ? <img src={clip.thumb} alt="" /> : clip.kind === "image" ? <img src={clip.src} alt="" /> : <Film size={15} />}</span><b>{clip.name}</b><small>{fmt(clipLen(clip))}</small></button>; })}</div>
      </div>
    </aside>}
    <AssetPicker open={assetPickerOpen} onClose={() => setAssetPickerOpen(false)} onSelect={(asset) => {
      setMessages((items) => [...items, { role: "ai", text: `Selected "${asset.name}" from your library.`, media: { url: assetObjectUrl(asset), assetId: asset.id, kind: asset.kind, title: asset.name, note: "Local library" } }]);
    }} title="Library" />
  </section>;
}
