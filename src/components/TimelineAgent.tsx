import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUp, Film, Pause, Play, Spark } from "./Icons";
import { chatCommand, type ChatCtx } from "../lib/editorChat";
import { clipAt, clipLen, makeAudioClip, makeImageClip, makeVideoClip, totalDur, type Clip } from "../lib/editor";
import { ASSETS_CHANGED, assetObjectUrl, getAsset, listAssets, saveAsset, type LocalAsset } from "../lib/assets";
import { activeWorkspaceProjectId, readWorkspaceArtifacts, upsertWorkspaceArtifact } from "../lib/workspace";
import { fetchFeed, generate, hasKeys, type FeedModel } from "../lib/hf";
import { bodyForModel, isSupportedModel, isUnsupportedLegacyModel } from "../lib/hfModels";
import { bestFile, searchStock, searchStockPhotos, type StockClip, type StockPhoto } from "../lib/pexels";
import { approveLaunchframePlan, createLaunchframePlan, exportLaunchframeWorkflow, getLaunchframeWorkflow, launchframeMediaUrl, startLaunchframeWorkflow, type LaunchframePlan, type LaunchframeVideoType } from "../lib/launchframe";
import "./TimelineAgent.css";
import AssetPicker from "./AssetPicker";
const safeModel = (model: FeedModel) => isSupportedModel(model) && !isUnsupportedLegacyModel(model.mode) && (model.type === "image" || model.type === "video");

type StockItem = { id: string; kind: "image" | "video" | "audio"; title: string; url: string; thumb: string; credit: string; sourcePage: string; duration?: number };
type Save = { clips: Clip[]; t: number; name: string };
type Proposal = {
  prompt: string;
  kind: "image" | "video" | "launch" | "stock";
  ratio: string;
  duration: number;
  model: string;
  url?: string;
  videoType?: LaunchframeVideoType;
  maxBudget?: number;
  workflowId?: string;
  plan?: LaunchframePlan;
  phase?: string;
  result?: string;
  preview?: boolean;
  stockKind?: "image" | "video" | "both";
  stockResults?: StockItem[];
};
type Message = { role: "user" | "ai"; text: string; followups?: string[]; proposal?: Proposal; legacyMode?: string; media?: { url: string; assetId?: string; kind?: string; title?: string; note?: string } };
const EMPTY: Save = { clips: [], t: 0, name: "Untitled" };
const RATIOS = ["16:9", "9:16", "1:1"];
const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

function launchUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0].replace(/[),.!?]+$/, "") : null;
}
function stockQueryKind(text: string): "image" | "video" | "both" {
  const wantsImage = /\b(photo|photos|image|images|picture|pictures|foto|fotos|imagem|imagens)\b/i.test(text);
  const wantsVideo = /\b(video|videos|footage|b-?roll|clip|clipe)\b/i.test(text);
  if (wantsImage && wantsVideo) return "both";
  if (wantsImage) return "image";
  if (wantsVideo) return "video";
  return "both";
}

function clipToStockItem(clip: StockClip): StockItem | null {
  const file = bestFile(clip);
  return file ? { id: String(clip.id), kind: "video", title: "Pexels video", url: file.link, thumb: clip.picture, credit: clip.photographer, sourcePage: clip.url, duration: clip.duration } : null;
}

function photoToStockItem(photo: StockPhoto): StockItem {
  return { id: String(photo.id), kind: "image", title: photo.alt || "Pexels photo", url: photo.src.large2x || photo.src.large || photo.src.original, thumb: photo.src.medium || photo.src.small, credit: photo.photographer, sourcePage: photo.url };
}

function LaunchProposalCard({ proposal, onChange, onApprove, busy }: {
  proposal: Proposal & { kind: "launch" };
  onChange: (proposal: Proposal) => void;
  onApprove: () => void;
  busy: boolean;
}) {
  const plan = proposal.plan;
  return <div className="ta-proposal ta-launch-proposal">
    <label>Product URL<input value={proposal.url || ""} onChange={(event) => onChange({ ...proposal, url: event.target.value })} /></label>
    <div className="ta-proposal-fields">
      <label>Type<select value={proposal.videoType || "A"} onChange={(event) => onChange({ ...proposal, videoType: event.target.value as LaunchframeVideoType })}><option value="A">Flash demo</option><option value="C">Concept story</option></select></label>
      <label>Max budget<input type="number" min={0} step={0.01} value={proposal.maxBudget ?? 0.5} onChange={(event) => onChange({ ...proposal, maxBudget: Number(event.target.value) })} /></label>
    </div>
    {plan && <div className="ta-launch-plan"><strong>{plan.title}</strong><small>{plan.hook}</small>{plan.beats.map((beat, index) => <div key={`${beat.type}-${index}`}><span>{index + 1}</span><p>{beat.text}</p><small>{beat.duration}s</small></div>)}<b>Estimated cost: ${plan.estimatedCost.toFixed(2)}</b></div>}
    <div className="ta-proposal-foot"><span>{proposal.phase || (plan ? `${plan.beats.length} beats ready for approval` : "Preparing plan…")}</span><button className="ta-generate" disabled={busy || !proposal.workflowId || !proposal.url?.trim()} onClick={onApprove}>{busy ? "Running…" : "Approve & run"}</button></div>
    {proposal.result && <div className="ta-result"><video src={launchframeMediaUrl(proposal.result)} controls playsInline /><small>{proposal.phase}</small></div>}
  </div>;
}
function StockProposalCard({ proposal, onAddEditor, onAddWorkspace, onUpdate }: {
  proposal: Proposal & { kind: "stock" };
  onAddEditor: (item: StockItem) => void;
  onAddWorkspace: (item: StockItem) => void;
  onUpdate: (proposal: Proposal) => void;
}) {
  return <div className="ta-proposal ta-stock-proposal">
    <label>Search query<input value={proposal.prompt} onChange={(event) => onUpdate({ ...proposal, prompt: event.target.value })} /></label>
    <div className="ta-stock-results">
      {proposal.stockResults?.map((item) => <article className="ta-stock-result" key={`${item.kind}-${item.id}`}>
        {item.kind === "video" ? <video src={item.url} poster={item.thumb} muted loop playsInline controls /> : <img src={item.url} srcSet={`${item.thumb} 1x`} alt={item.title} loading="lazy" />}
        <strong>{item.title}</strong><small><a href={item.sourcePage} target="_blank" rel="noreferrer">Provided by Pexels</a> · {item.credit}{item.duration ? ` · ${item.duration}s` : ""}</small>
        <div><button className="chip" onClick={() => onAddEditor(item)}>Add to editor</button><button className="chip" onClick={() => onAddWorkspace(item)}>Workspace</button></div>
      </article>)}
    </div>
    {proposal.phase && <small role="status">{proposal.phase}</small>}
  </div>;
}

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
        ...(item.proposal && typeof item.proposal === "object" ? { proposal: item.proposal as Proposal } : {}),
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
export default function TimelineAgent({ showPreview = true, exportRequest }: { showPreview?: boolean; exportRequest?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const mockup = new URLSearchParams(location.search).get("mockup") === "1";
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
  const [previewOpen, setPreviewOpen] = useState(mockup);
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
  const addClip = (kind: "image" | "video" | "audio", name: string, url: string, assetId?: string) => {
    const append = (duration?: number) => {
      const clip = kind === "audio" ? makeAudioClip(url, name, duration ?? 10) : kind === "image" ? makeImageClip(url, name) : makeVideoClip(url, name, 5);
      commit((clips) => [...clips, { ...clip, ...(assetId ? { assetId } : {}) }]); setSelected(clip.id);
    };
    if (kind !== "audio") { append(); return; }
    const audio = new Audio();
    audio.preload = "metadata";
    let added = false;
    const finish = (duration?: number) => {
      if (added) return;
      added = true;
      append(duration);
    };
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish();
    audio.src = url;
    audio.load();
  };
  const saveStockItem = async (item: StockItem) => {
    try {
      return await saveAsset({ url: item.url, kind: item.kind, name: item.title, source: "catalog", prompt: item.title });
    } catch (error) {
      setNotice(error instanceof Error ? `Could not save stock media: ${error.message}` : "Could not save stock media.");
      return undefined;
    }
  };
  const addStockToEditor = async (item: StockItem) => {
    await saveStockItem(item);
    addClip(item.kind, item.title, item.url);
    setNotice(`${item.kind === "image" ? "Photo" : "Video"} added to the editor.`);
  };
  const addStockToWorkspace = async (item: StockItem) => {
    const asset = await saveStockItem(item);
    upsertWorkspaceArtifact({ id: `stock-${item.kind}-${item.id}`, tool: item.kind, title: item.title, summary: `Pexels ${item.kind} · ${item.credit}`, route: `/${item.kind}`, status: "ready", prompt: item.title, outputUrl: item.url, outputKind: item.kind, outputSource: "catalog", assetId: asset?.id });
    window.dispatchEvent(new CustomEvent("field-workspace-updated"));
    setNotice(`${item.kind === "image" ? "Photo" : "Video"} added to the workspace.`);
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
    library: () => assets.map((asset) => ({ id: asset.id, url: assetObjectUrl(asset), kind: asset.kind, name: asset.name })),
    seek, totalDur: () => totalDur(saveRef.current.clips), playhead: () => saveRef.current.t, rename: (name) => persist({ ...saveRef.current, name }),
    export: () => exportRequest ? (void exportRequest(), "Exporting — watch the progress in the Editor top bar.") : "Open the Editor to export this cut; rendering progress appears there.",
    generate: (prompt) => navigate("/image", { state: { workspacePrompt: prompt } }),
    status: () => ({ n: saveRef.current.clips.length, dur: totalDur(saveRef.current.clips), name: saveRef.current.name, res: "720", ratio: "16:9" }),
  };
  const updateMessage = (index: number, proposal: Proposal) => setMessages((items) => items.map((item, i) => i === index ? { ...item, proposal } : item));
  const prepareLaunch = async (prior: Message[], userMessage: Message, url: string, instruction: string) => {
    busy.current = true;
    setMessages([...prior, userMessage]);
    setThinking(true);
    try {
      const workflow = await createLaunchframePlan({ url, videoType: "A", instruction: instruction || undefined, maxBudget: 0.5, consent: true });
      if (!workflow.plan) throw new Error("Launchframe returned no plan.");
      const proposal: Proposal = { prompt: instruction, kind: "launch", ratio: "16:9", duration: 0, model: "", url, videoType: workflow.plan.videoType, maxBudget: workflow.plan.maxBudget, workflowId: workflow.id, plan: workflow.plan };
      setMessages([...prior, userMessage, { role: "ai", text: "Launch plan ready for approval.", proposal }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare the launch plan.";
      setMessages([...prior, userMessage, { role: "ai", text: `Launch plan failed: ${message}` }]);
    } finally {
      setThinking(false);
      busy.current = false;
    }
  };
  const prepareStock = async (prior: Message[], userMessage: Message, query: string, request: string) => {
    busy.current = true;
    setMessages([...prior, userMessage]);
    setThinking(true);
    try {
      const kind = stockQueryKind(request);
      const [photos, clips] = await Promise.all([
        kind === "video" ? Promise.resolve([] as StockPhoto[]) : searchStockPhotos(query),
        kind === "image" ? Promise.resolve([] as StockClip[]) : searchStock(query),
      ]);
      const results = [...photos.map(photoToStockItem), ...clips.map(clipToStockItem).filter((item): item is StockItem => item !== null)];
      const proposal: Proposal = { prompt: query, kind: "stock", ratio: "16:9", duration: 5, model: "", stockKind: kind, stockResults: results };
      setMessages([...prior, userMessage, { role: "ai", text: results.length ? "Stock media found. Add any photo or video to the editor or workspace." : "No stock media found for that search.", proposal }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stock search failed.";
      setMessages([...prior, userMessage, { role: "ai", text: `Stock search failed: ${message}` }]);
    } finally {
      setThinking(false);
      busy.current = false;
    }
  };
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
    const contextLine = `${title} · ${artifacts.length} workspace artifacts · ${currentSave.clips.length} timeline clips`;
    const userMessage: Message = { role: "user", text };
    const url = launchUrl(text);
    if ((!url || !/\b(launch|create|make|generate)\b/i.test(text)) && /\b(stock|pexels|b-?roll|footage)\b/i.test(text)) {
      const query = text.replace(/\b(find|search|show|get|add|stock|pexels|b-?roll|footage|video|videos|photo|photos|image|images|of|for|me|some|please)\b/gi, " ").replace(/\s+/g, " ").trim() || text;
      setValue("");
      void prepareStock(prior, userMessage, query, text);
      return;
    }
    if (url && /\b(launch|video|product|site|url|create|make|generate)\b/i.test(text)) {
      setValue("");
      void prepareLaunch(prior, userMessage, url, text.replace(url, "").trim());
      return;
    }
    const kind = requestKind(text);
    const selectedModel = kind === "image"
      ? models.find((model) => model.type === "image" && safeModel(model))
      : models.find((model) => model.type === "video" && safeModel(model));
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
  const approveLaunch = async (index: number, proposal: Proposal & { kind: "launch" }) => {
    if (generating || !proposal.workflowId || !proposal.plan || !proposal.url?.trim()) return;
    setGenerating(true);
    updateMessage(index, { ...proposal, phase: "Approving plan…" });
    try {
      await approveLaunchframePlan(proposal.workflowId, proposal.maxBudget ?? proposal.plan.maxBudget);
      await startLaunchframeWorkflow(proposal.workflowId);
      let workflow = await getLaunchframeWorkflow(proposal.workflowId);
      for (let attempt = 0; attempt < 120 && workflow.status === "running"; attempt++) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
        workflow = await getLaunchframeWorkflow(proposal.workflowId!);
      }
      if (workflow.status === "failed") throw new Error(workflow.error || "Launch workflow failed.");
      let output = workflow.videoUrl;
      if (!output && workflow.status === "complete") output = (await exportLaunchframeWorkflow(proposal.workflowId)).videoUrl;
      if (!output) throw new Error(`Launch workflow ended as ${workflow.status}.`);
      const url = launchframeMediaUrl(output);
      const name = workflow.plan?.title || proposal.plan.title || "Launch video";
      addClip("video", name, url);
      upsertWorkspaceArtifact({ id: `launch-${workflow.id}`, tool: "launch", title: name, summary: "Launch video added to the editor timeline.", route: "/launch", status: "ready", outputUrl: url, outputKind: "video", outputSource: "generation" });
      window.dispatchEvent(new CustomEvent("field-workspace-updated"));
      updateMessage(index, { ...proposal, phase: "Launch complete and added to the editor timeline.", result: url });
    } catch (error) {
      updateMessage(index, { ...proposal, phase: error instanceof Error ? error.message : "Launch execution failed." });
    } finally {
      setGenerating(false);
    }
  };
  const approve = async (index: number, proposal: Proposal) => {
    if (proposal.kind === "launch" || proposal.kind === "stock") return;
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
  const modelFor = (proposal: Proposal) => proposal.kind === "launch" || proposal.kind === "stock" ? undefined : models.find((model) => model.mode === proposal.model && model.type === proposal.kind && safeModel(model));
  const projectLabel = localStorage.getItem("field-workspace-title") || save.name || "Untitled project";
  const recentMessages = messages.filter((message) => message.role === "user" && message.text.trim()).slice(-6).reverse();
  const recentProjects = readHistoryProjectIds()
    .filter((id) => id !== projectId)
    .map((id) => ({ id, messages: readMessages([`field-agent-chat:${id}`, `field-editor-chat:${id}`, `field-chat:${id}`]) }))
    .filter(({ messages: items }) => items.some((message) => message.role === "user" && message.text.trim()));
  const startNewConversation = () => { setValue(""); inputRef.current?.focus(); };
  const renderProposal = (proposal: Proposal, index: number) => {
    if (proposal.kind === "launch") {
      return <LaunchProposalCard proposal={proposal as Proposal & { kind: "launch" }} onChange={(next) => updateMessage(index, next)} onApprove={() => void approveLaunch(index, proposal as Proposal & { kind: "launch" })} busy={generating} />;
    }
    if (proposal.kind === "stock") {
      return <StockProposalCard proposal={proposal as Proposal & { kind: "stock" }} onAddEditor={(item) => void addStockToEditor(item)} onAddWorkspace={(item) => void addStockToWorkspace(item)} onUpdate={(next) => updateMessage(index, next)} />;
    }
    const model = modelFor(proposal);
    return <div className="ta-proposal">
      <label>Prompt<textarea value={proposal.prompt} onChange={(event) => updateMessage(index, { ...proposal, prompt: event.target.value })} rows={3} /></label>
      <div className="ta-proposal-fields">
        <label>Type<select value={proposal.kind} onChange={(event) => { const kind = event.target.value as "image" | "video"; const nextModel = models.find((item) => item.type === kind && safeModel(item)); updateMessage(index, { ...proposal, kind, model: nextModel?.mode || "" }); }}>{["image", "video"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        <label>Aspect ratio<select value={proposal.ratio} onChange={(event) => updateMessage(index, { ...proposal, ratio: event.target.value })}>{RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
        {proposal.kind === "video" && <label>Duration<select value={proposal.duration} onChange={(event) => updateMessage(index, { ...proposal, duration: Number(event.target.value) })}>{[5, 10, 15].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}</select></label>}
        <label>Model<select value={proposal.model} onChange={(event) => updateMessage(index, { ...proposal, model: event.target.value })}>{models.filter((item) => item.type === proposal.kind && safeModel(item)).map((item) => <option key={item.mode} value={item.mode}>{item.title}</option>)}{!models.some((item) => item.mode === proposal.model && safeModel(item)) && <option value="">Catalog model unavailable</option>}</select></label>
      </div>
      <div className="ta-proposal-foot"><span>{estimate(model, proposal)}{proposal.phase ? <small role="status">{proposal.phase}</small> : null}</span><div><button className="chip" disabled={!model?.thumb && !model?.video} onClick={() => updateMessage(index, { ...proposal, phase: "Catalog preview · not generated output", result: proposal.kind === "video" ? model?.video || model?.thumb : model?.thumb, preview: true })}>Preview</button><button className="ta-generate" disabled={generating || !proposal.prompt.trim() || !model} onClick={() => void approve(index, proposal)}>{hasKeys ? "Generate" : "Use catalog preview"}</button></div></div>
      {proposal.result && <div className="ta-result">{proposal.kind === "video" ? <video src={proposal.result} controls playsInline /> : <img src={proposal.result} alt={proposal.preview ? "Catalog model preview" : "Generated result"} />}<small>{proposal.phase}</small></div>}
    </div>;
  };

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
          {message.proposal && renderProposal(message.proposal, index)}
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
