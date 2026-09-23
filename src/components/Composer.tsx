import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImageIc, VideoIc, Music, Cube, Ratio, Clock, Monitor, ArrowUp, Check, Film } from "./Icons";
import { setPending } from "../lib/transfer";
import { upsertWorkspaceArtifact } from "../lib/workspace";
import { saveAsset } from "../lib/assets";
import { hasKeys, generate, fetchFeed, VIDEO_MODE, type GenResult, type FeedModel } from "../lib/hf";
import { MARKETING_IMAGE_MODE, MOTION_CONTROL_MODE } from "../lib/workflowPorts";
import { bodyForModel, isSupportedModel, modelSchema, type ModelField } from "../lib/hfModels";

export type Mode = "Image" | "Video" | "Audio" | "3D";
type Phase = "idle" | "working" | "done" | "error";
type VideoTab = "create" | "edit" | "motion";
type AudioTab = "tts" | "voice" | "translate";
type ImageOptions = {
  ratio: string;
  quality: string;
  resolution: string;
  background: string;
  batch: number;
  enhance: boolean;
};

type VideoOptions = {
  ratio: string;
  duration: string;
  quality: string;
  resolution: string;
  sound: string;
};

const MODES: { id: Mode; icon: React.ReactNode }[] = [
  { id: "Image", icon: <ImageIc size={14} /> },
  { id: "Video", icon: <VideoIc size={14} /> },
  { id: "Audio", icon: <Music size={14} /> },
  { id: "3D", icon: <Cube size={14} /> },
];
const CREATE_LINKS: Array<{ label: string; path: string; icon: React.ReactNode }> = [
  { label: "Launchframe", path: "/launch", icon: <Film size={14} /> },
  { label: "Studio", path: "/studio", icon: <Monitor size={14} /> },
];

const DEFAULT_MODELS: Record<Mode, string> = {
  Image: "Marketing Studio Image",
  Video: "Kling 3.0",
  Audio: "Seed Audio 1.0",
  "3D": "Field 3D",
};

const PALETTES: [string, string][] = [
  ["#4a3826", "#15100a"], ["#5a6b8c", "#2a1e33"], ["#2e4d3a", "#0b1210"],
  ["#8c4a5a", "#1c0d13"], ["#3a5a8c", "#0c1424"], ["#6b5a2e", "#141007"],
  ["#4a5d6b", "#0e1418"], ["#5a4a8c", "#160f24"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function gradientStyle(url: string): React.CSSProperties {
  const [a, b, angle] = url.slice("gradient:".length).split("|");
  return { background: `linear-gradient(${angle}deg, ${a}, ${b})` };
}

const COST: Record<Mode, string> = { Image: "≈ $0.003", Video: "≈ $0.21", Audio: "—", "3D": "—" };

function pickDemo(pool: FeedModel[], p: string, m: Mode): GenResult | null {
  const wantVideo = m === "Video";
  const cands = pool.filter((x) => (wantVideo ? x.video : x.thumb));
  if (!cands.length) return null;
  const c = cands[hash(p + m) % cands.length];
  return { url: wantVideo ? c.video! : c.thumb!, kind: wantVideo ? "video" : "image" };
}

function ratioStyle(ratio: string): React.CSSProperties | undefined {
  if (!ratio || !ratio.includes(":")) return undefined;
  const [w, h] = ratio.split(":").map(Number);
  return { aspectRatio: `${w} / ${h}` };
}

function labelForModel(item: FeedModel | undefined, fallback: string) {
  return item?.title || fallback;
}
function publicUrls(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function invalidPublicUrl(value: string) {
  return publicUrls(value).some((item) => !/^https:\/\//i.test(item));
}


export default function Composer({
  model = "Field 1",
  placeholder = "Describe what you want to create…",
  initialMode = "Image",
  prompt: promptProp,
  onPrompt,
}: {
  model?: string;
  placeholder?: string;
  initialMode?: Mode;
  prompt?: string;
  onPrompt?: (v: string) => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [prompt, setPrompt] = useState(promptProp ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [demoPool, setDemoPool] = useState<FeedModel[] | null>(null);
  const [models, setModels] = useState<FeedModel[]>([]);
  const [selectedModeId, setSelectedModeId] = useState(initialMode === "Image" ? MARKETING_IMAGE_MODE : VIDEO_MODE);
  const [selectedModelName, setSelectedModelName] = useState(/soul\s*2/i.test(model) ? DEFAULT_MODELS.Image : model.replace(/ · demo$/, ""));
  const [advanced, setAdvanced] = useState(false);
  const [videoTab, setVideoTab] = useState<VideoTab>("create");
  const [audioTab, setAudioTab] = useState<AudioTab>("tts");
  const [imageOpts, setImageOpts] = useState<ImageOptions>({ ratio: "1:1", quality: "medium", resolution: "1080p", background: "opaque", batch: 1, enhance: false });
  const [videoOpts, setVideoOpts] = useState<VideoOptions>({ ratio: "16:9", duration: "5s", quality: "high", resolution: "1080p", sound: "on" });
  const [threeOpts, setThreeOpts] = useState({ resolution: "1080p", mesh: "High" });
  const [schemaParams, setSchemaParams] = useState<Record<string, string | number | boolean>>({});
  const [videoRef, setVideoRef] = useState("");
  const [videoElements, setVideoElements] = useState("");
  const [imageRefUrls, setImageRefUrls] = useState("");
  const [videoRefUrl, setVideoRefUrl] = useState("");
  const [videoElementUrl, setVideoElementUrl] = useState("");
  const [audioFile, setAudioFile] = useState("");
  const [voiceDetails, setVoiceDetails] = useState("");
  const [audioScript, setAudioScript] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    if (promptProp !== undefined) setPrompt(promptProp);
  }, [promptProp]);

  useEffect(() => {
    setAdvanced(false);
    setSelectedModeId(mode === "Image" ? MARKETING_IMAGE_MODE : mode === "Video" ? VIDEO_MODE : mode === "Audio" ? "field/audio/seed-1" : "field/3d");
    setSelectedModelName(mode === initialMode ? (/soul\s*2/i.test(model) ? DEFAULT_MODELS.Image : model.replace(/ · demo$/, "")) : DEFAULT_MODELS[mode]);
    if (mode !== "Video") setVideoTab("create");
    if (mode !== "Audio") setAudioTab("tts");
  }, [initialMode, mode, model]);

  useEffect(() => {
    if (mode !== "Image" && mode !== "Video") {
      setModels([]);
      return;
    }
    let live = true;
    fetchFeed(1, 12, mode.toLowerCase())
      .then((items) => {
        if (!live) return;
        const available = mode === "Image"
          ? items.filter((item) => isSupportedModel(item) && item.mode !== "higgsfield-ai/soul/v2/standard" && modelSchema(item)?.kind === "image")
          : items.filter((item) => isSupportedModel(item) && modelSchema(item)?.kind === "video" && !modelSchema(item)?.requiresVideoUrl);
        setModels(available);
        const preferred = available.find((item) => item.title.toLowerCase().includes(selectedModelName.split(" ")[0].toLowerCase())) ?? available[0];
        if (preferred) {
          setSelectedModeId(preferred.mode);
          setSelectedModelName(preferred.title);
        }
      })
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "Image") return;
    const next = selectedModeId.toLowerCase().includes("soul") ? "1080p" : "2k";
    setImageOpts((o) => o.resolution === next ? o : { ...o, resolution: next });
  }, [mode, selectedModeId]);
  useEffect(() => {
    if (mode !== "Image" && mode !== "Video") {
      setSchemaParams({});
      return;
    }
    const schema = modelSchema({ mode: selectedModeId, type: mode === "Image" ? "image" : "video" });
    setSchemaParams(Object.fromEntries((schema?.fields ?? []).map((field) => [field.key, field.default])));
  }, [mode, selectedModeId]);


  const changePrompt = (v: string) => {
    setPrompt(v);
    onPrompt?.(v);
  };

  const imageQualities = selectedModeId.toLowerCase().includes("grok") ? ["low", "medium"] : [];
  const imageResolutions = selectedModeId.toLowerCase().includes("grok") ? ["1k", "2k"] : ["1k", "2k", "4k"];
  const imageRatios = modelSchema({ mode: selectedModeId, type: "image" })?.fields.find((field) => field.key === "aspect_ratio")?.options ?? ["1:1", "16:9", "9:16"];

  const activeSchema = mode === "Image" || mode === "Video" ? modelSchema({ mode: selectedModeId, type: mode.toLowerCase() as "image" | "video" }) : null;
  const schemaFields = (activeSchema?.fields ?? []).filter((field) => !["aspect_ratio", "duration", "resolution", "sound", "quality", "enhance_prompt", "generate_audio"].includes(field.key));
  const renderSchemaFields = (fields: ModelField[]) => fields.length === 0 ? null : <div className="schema-fields">{fields.map((field) => <label className="option-group" key={field.key}><span className="option-label">{field.label}</span>{field.type === "select" ? <select className="option-select" value={String(schemaParams[field.key] ?? field.default)} onChange={(event) => setSchemaParams((current) => ({ ...current, [field.key]: event.target.value }))}>{(field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select> : field.type === "boolean" ? <input type="checkbox" checked={schemaParams[field.key] === true} onChange={(event) => setSchemaParams((current) => ({ ...current, [field.key]: event.target.checked }))} /> : <input className="option-select" type="number" min={field.min} max={field.max} step={field.step} value={String(schemaParams[field.key] ?? field.default)} onChange={(event) => setSchemaParams((current) => ({ ...current, [field.key]: Number(event.target.value) }))} />}</label>)}</div>;
  const imageReferenceUrls = publicUrls(imageRefUrls);
  const motionImageUrls = publicUrls(videoElementUrl);
  const referenceError = invalidPublicUrl(imageRefUrls)
    ? "Reference images must use public HTTPS URLs."
    : mode === "Video" && videoTab === "motion" && (!videoRefUrl.trim() || !videoElementUrl.trim())
      ? "Motion control needs one public motion video URL and one character image URL."
      : mode === "Video" && videoTab === "motion" && (invalidPublicUrl(videoRefUrl) || invalidPublicUrl(videoElementUrl))
        ? "Motion references must use public HTTPS URLs."
        : "";

  const demoResult = async (p: string, m: Mode): Promise<GenResult> => {
    const pool = demoPool ?? (await fetchFeed(1, 24).then((r) => { setDemoPool(r); return r; }).catch(() => null));
    const picked = pool ? pickDemo(pool, p, m) : null;
    if (picked) return picked;
    const h = hash(p + m);
    const [a, b] = PALETTES[h % PALETTES.length];
    return { url: `gradient:${a}|${b}|${h % 360}`, kind: m === "Video" ? "video" : "image" };
  };

  const imagePayload = (p: string): Record<string, unknown> => bodyForModel(
    { mode: selectedModeId || MARKETING_IMAGE_MODE, type: "image" },
    p,
    { ...schemaParams, aspect_ratio: imageOpts.ratio, resolution: imageOpts.resolution, quality: imageOpts.quality, enhance_prompt: imageOpts.enhance },
    { imageUrls: imageReferenceUrls },
  );

  const videoPayload = (p: string): Record<string, unknown> => videoTab === "motion"
    ? { prompt: p, image_url: motionImageUrls[0], video_url: videoRefUrl.trim(), keep_original_sound: videoOpts.sound === "on" ? "yes" : "no", character_orientation: "video" }
    : bodyForModel(
      { mode: selectedModeId || VIDEO_MODE, type: "video" },
      p,
      {
        ...schemaParams,
        duration: Number(videoOpts.duration.replace("s", "")) || 5,
        aspect_ratio: videoOpts.ratio,
        resolution: videoOpts.resolution,
        sound: videoOpts.sound,
        generate_audio: schemaParams.generate_audio ?? videoOpts.sound === "on",
      },
      { imageUrls: publicUrls(videoElementUrl), videoUrl: videoRefUrl.trim() || undefined },
    );
  const syncWorkspaceAsset = (p: string, phase: "active" | "ready" | "failed", output?: GenResult, error = "", assetId?: string) => {
    if (mode !== "Image" && mode !== "Video") return;
    const tool = mode.toLowerCase() as "image" | "video";
    const hasMedia = Boolean(output && !output.url.startsWith("gradient:"));
    upsertWorkspaceArtifact({
      id: tool,
      tool,
      title: selectedModelName || DEFAULT_MODELS[mode],
      summary: phase === "active" ? `Generating with ${selectedModelName}…` : phase === "failed" ? error : hasKeys ? `${tool} generation complete.` : hasMedia ? `Catalog preview · ${selectedModelName}` : "Demo preview · no live output.",
      route: `/${tool}`,
      status: phase,
      prompt: p,
      model: mode === "Video" && videoTab === "motion" ? MOTION_CONTROL_MODE : selectedModeId,
      ...(phase === "ready" ? {
        outputUrl: hasMedia ? output?.url : undefined,
        outputKind: hasMedia ? tool : undefined,
        outputSource: hasMedia ? hasKeys ? "generation" : "catalog" : undefined,
        assetId,
      } : {}),
    });
  };

  const generateWork = async () => {
    setSaveError("");
    const p = (mode === "Audio" && audioTab === "tts" && audioScript.trim() ? audioScript : prompt).trim();
    if (!p || busy.current) return;
    if (referenceError) {
      setError(referenceError);
      setPhase("error");
      return;
    }
    busy.current = true;
    setError("");
    setResult(null);
    setPhase("working");
    syncWorkspaceAsset(p, "active");
    if (!hasKeys || mode === "Audio" || mode === "3D") {
      await new Promise((r) => setTimeout(r, 900));
      const r = await demoResult(p, mode);
      setResult(r);
      syncWorkspaceAsset(p, "ready", r);
      setPhase("done");
      busy.current = false;
      return;
    }
    try {
      const endpoint = mode === "Image" ? selectedModeId || MARKETING_IMAGE_MODE : videoTab === "motion" ? MOTION_CONTROL_MODE : selectedModeId || VIDEO_MODE;
      const body = mode === "Image" ? imagePayload(p) : videoPayload(p);
      const r = await generate(endpoint, body, (s) => setStatus(s));
      setResult(r);
      syncWorkspaceAsset(p, "ready", r);
      setPhase("done");
      if ((mode === "Image" || mode === "Video") && (r.kind === "image" || r.kind === "video") && !r.url.startsWith("gradient:")) {
        try {
          const asset = await saveAsset({ url: r.url, kind: r.kind, name: `${selectedModelName} ${r.kind}`, source: "generation", model: selectedModelName, prompt: p });
          syncWorkspaceAsset(p, "ready", r, "", asset.id);
        } catch (e) {
          setSaveError(`Generated output is visible but could not be saved locally: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      syncWorkspaceAsset(p, "failed", undefined, message);
      setPhase("error");
    }
    busy.current = false;
  };
  const pickFile = (setter: (name: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    setter(file?.name ?? "");
    if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
      setSaveError("");
      void saveAsset({ blob: file, kind: file.type.startsWith("video/") ? "video" : "image", name: file.name, source: "upload" })
        .catch((error) => setSaveError(`Could not save ${file.name} locally: ${error instanceof Error ? error.message : String(error)}`));
    }
    e.currentTarget.value = "";
  };


  const renderImageControls = () => (
    <div className="create-options">
      <div className="create-basic">
        <label className="option-group">
          <span className="option-label"><Ratio size={12} aria-hidden="true" /> Aspect ratio</span>
          <select className="option-select" value={imageOpts.ratio} onChange={(e) => setImageOpts((o) => ({ ...o, ratio: e.target.value }))}>
            {imageRatios.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="option-group">
          <span className="option-label">Resolution</span>
          <select className="option-select" value={imageOpts.resolution} onChange={(e) => setImageOpts((o) => ({ ...o, resolution: e.target.value }))}>
            {imageResolutions.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <button className={`advanced-toggle${advanced ? " on" : ""}`} onClick={() => setAdvanced((v) => !v)}>
          Advanced <span>{advanced ? "−" : "+"}</span>
        </button>
      </div>
      {advanced && (
        <div className="advanced-panel">
          {imageQualities.length > 0 && <div className="option-group"><span className="option-label">Quality</span><div className="option-seg">{imageQualities.map((value) => <button key={value} className={imageOpts.quality === value ? "on" : ""} onClick={() => setImageOpts((o) => ({ ...o, quality: value }))}>{value}</button>)}</div></div>}
          {selectedModeId === MARKETING_IMAGE_MODE && <div className="option-group"><span className="option-label">Enhance prompt</span><div className="option-seg"><button className={!imageOpts.enhance ? "on" : ""} onClick={() => setImageOpts((o) => ({ ...o, enhance: false }))}>Off</button><button className={imageOpts.enhance ? "on" : ""} onClick={() => setImageOpts((o) => ({ ...o, enhance: true }))}>On</button></div></div>}
          <label className="text-panel compact"><span className="option-label">Reference image URLs <em>Optional · public HTTPS</em></span><textarea rows={2} value={imageRefUrls} onChange={(event) => setImageRefUrls(event.target.value)} placeholder="One public image URL per line…" /></label>
        </div>
      )}
    </div>
  );

  const renderVideoControls = () => (
    <div className="create-options video-options">
      <div className="create-tabs">
        {([["create", "Create video"], ["edit", "Edit video"], ["motion", "Motion control"]] as [VideoTab, string][]).map(([id, label]) => <button key={id} className={videoTab === id ? "on" : ""} onClick={() => { setVideoTab(id); if (id === "motion") { setSelectedModeId(MOTION_CONTROL_MODE); setSelectedModelName("Kling Motion Control"); } else if (id === "create" || selectedModeId === MOTION_CONTROL_MODE) { setSelectedModeId(VIDEO_MODE); setSelectedModelName("Kling 3.0"); } }}>{label}</button>)}
      </div>
      <div className="asset-grid">
        {videoTab === "create" && <>
          <label className="asset-slot"><input type="file" accept="video/*" onChange={pickFile(setVideoRef)} /><VideoIc size={18} /><strong>{videoRef || "Add reference video"}</strong><span>Extract motion · 4–30s</span></label>
          <label className="asset-slot"><input type="file" accept="image/*" onChange={pickFile(setVideoElements)} /><ImageIc size={18} /><strong>{videoElements || "Add characters or products"}</strong><span>Up to 30 images</span></label>
        </>}
        {videoTab === "edit" && <>
          <label className="asset-slot"><input type="file" accept="video/*" onChange={pickFile(setVideoRef)} /><VideoIc size={18} /><strong>{videoRef || "Add a video to edit"}</strong><span>Up to 30 seconds</span></label>
          <label className="asset-slot"><input type="file" accept="image/*,audio/*" onChange={pickFile(setVideoElements)} /><ImageIc size={18} /><strong>{videoElements || "Add elements or references"}</strong><span>Images or audio</span></label>
        </>}
        {videoTab === "motion" && <>
          <label className="asset-slot"><input type="file" accept="video/*" onChange={pickFile(setVideoRef)} /><VideoIc size={18} /><strong>{videoRef || "Add motion video"}</strong><span>3–30 seconds</span></label>
          <label className="asset-slot"><input type="file" accept="image/*" onChange={pickFile(setVideoElements)} /><ImageIc size={18} /><strong>{videoElements || "Add your character"}</strong><span>Visible face or body</span></label>
        </>}
      </div>
      {videoTab === "motion" && <div className="reference-url-grid">
        <label className="text-panel compact"><span className="option-label">Motion video URL <em>Public HTTPS</em></span><input type="url" value={videoRefUrl} onChange={(event) => setVideoRefUrl(event.target.value)} placeholder="https://…" /></label>
        <label className="text-panel compact"><span className="option-label">Character image URL <em>Public HTTPS</em></span><input type="url" value={videoElementUrl} onChange={(event) => setVideoElementUrl(event.target.value)} placeholder="https://…" /></label>
      </div>}
      <div className="video-basic">
        <label className="option-group">
          <span className="option-label"><Ratio size={12} aria-hidden="true" /> Aspect ratio</span>
          <select className="option-select" value={videoOpts.ratio} onChange={(e) => setVideoOpts((o) => ({ ...o, ratio: e.target.value }))}>
            {["16:9", "9:16", "1:1"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="option-group"><span className="option-label">Duration</span><div className="option-seg">{["5s", "10s", "15s"].map((value) => <button key={value} className={videoOpts.duration === value ? "on" : ""} onClick={() => setVideoOpts((o) => ({ ...o, duration: value }))}>{value}</button>)}</div></div>
      </div>
      <button className={`advanced-toggle${advanced ? " on" : ""}`} onClick={() => setAdvanced((v) => !v)}>Advanced <span>{advanced ? "−" : "+"}</span></button>
      {advanced && <div className="advanced-panel">
        <label className="option-group"><span className="option-label">Resolution</span><select className="option-select" value={videoOpts.resolution} onChange={(e) => setVideoOpts((o) => ({ ...o, resolution: e.target.value }))}>{["720p", "1080p", "4K"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <div className="option-group"><span className="option-label">Quality</span><div className="option-seg">{["standard", "high"].map((value) => <button key={value} className={videoOpts.quality === value ? "on" : ""} onClick={() => setVideoOpts((o) => ({ ...o, quality: value }))}>{value}</button>)}</div></div>
        <div className="option-group"><span className="option-label">Sound</span><div className="option-seg">{["on", "off"].map((value) => <button key={value} className={videoOpts.sound === value ? "on" : ""} onClick={() => setVideoOpts((o) => ({ ...o, sound: value }))}>{value}</button>)}</div></div>
        {renderSchemaFields(schemaFields)}
      </div>}
    </div>
  );


  const renderAudioControls = () => (
    <div className="create-options audio-options">
      <div className="create-tabs">{([["tts", "Text to speech"], ["voice", "Voice change"], ["translate", "Translate"]] as [AudioTab, string][]).map(([id, label]) => <button key={id} className={audioTab === id ? "on" : ""} onClick={() => setAudioTab(id)}>{label}</button>)}</div>
      {audioTab === "tts" && <>
        <label className="asset-slot audio-upload"><input type="file" accept="image/*,audio/*,video/*" onChange={pickFile(setAudioFile)} /><Music size={18} /><strong>{audioFile || "Upload media"}</strong><span>Up to 3 voices, audio or image · optional</span></label>
        <label className="text-panel"><span className="option-label">Script</span><textarea value={audioScript} onChange={(e) => setAudioScript(e.target.value)} placeholder="Write exactly what the voice will read out loud." /></label>
        <label className="text-panel compact"><span className="option-label">Voice details <em>Optional</em></span><textarea maxLength={500} value={voiceDetails} onChange={(e) => setVoiceDetails(e.target.value)} placeholder="Young female voice with a soft British accent…" /></label>
      </>}
      {audioTab === "voice" && <><label className="asset-slot"><input type="file" accept="audio/*" onChange={pickFile(setAudioFile)} /><Music size={18} /><strong>{audioFile || "Pick a voice"}</strong><span>Choose a preset or uploaded voice</span></label><label className="asset-slot"><input type="file" accept="video/*,audio/*" onChange={pickFile(setVideoRef)} /><VideoIc size={18} /><strong>{videoRef || "Add your clip"}</strong><span>Upload the video to change its voice</span></label></>}
      {audioTab === "translate" && <><label className="asset-slot"><input type="file" accept="video/*,audio/*" onChange={pickFile(setVideoRef)} /><VideoIc size={18} /><strong>{videoRef || "Add your clip"}</strong><span>Upload the video you want to dub</span></label><label className="select-row"><span className="option-label">Language</span><select defaultValue="English"><option>English</option><option>Português</option><option>Español</option><option>日本語</option></select></label></>}
      <button className={`advanced-toggle${advanced ? " on" : ""}`} onClick={() => setAdvanced((v) => !v)}>Advanced settings <span>{advanced ? "−" : "+"}</span></button>
      {advanced && <div className="advanced-panel"><div className="option-group"><span className="option-label">Batch size</span><div className="option-seg"><button className={imageOpts.batch === 1 ? "on" : ""} onClick={() => setImageOpts((o) => ({ ...o, batch: 1 }))}>1</button><button className={imageOpts.batch === 4 ? "on" : ""} onClick={() => setImageOpts((o) => ({ ...o, batch: 4 }))}>4</button></div></div></div>}
    </div>
  );
  const render3DControls = () => (
    <div className="create-options three-options">
      <div className="create-basic">
        <label className="option-group">
          <span className="option-label">Resolution</span>
          <select className="option-select" value={threeOpts.resolution} onChange={(e) => setThreeOpts((o) => ({ ...o, resolution: e.target.value }))}>
            {["720p", "1080p"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="option-group"><span className="option-label">Mesh</span><div className="option-seg">{["Low", "High"].map((value) => <button key={value} className={threeOpts.mesh === value ? "on" : ""} onClick={() => setThreeOpts((o) => ({ ...o, mesh: value }))}>{value}</button>)}</div></div>
      </div>
    </div>
  );


  const controls = mode === "Image" ? renderImageControls() : mode === "Video" ? renderVideoControls() : mode === "Audio" ? renderAudioControls() : render3DControls();
  const resultRatio = mode === "Image" ? imageOpts.ratio : mode === "Video" ? videoOpts.ratio : "";

  return (
    <div className="device-wrap">
      <div className="device">
        <div className="creation-dock">
          <div className="prompt-dock">
            <span className="prompt-add" aria-hidden="true">＋</span>
            <textarea className="device-input" value={prompt} placeholder={mode === "Audio" ? "Write what you want to hear…" : placeholder} onChange={(e) => changePrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void generateWork(); } }} />
            <button className="send prompt-send" onClick={() => void generateWork()} disabled={phase === "working" || Boolean(referenceError) || !(mode === "Audio" && audioTab === "tts" ? audioScript.trim() || prompt.trim() : prompt.trim())} aria-label="Generate">{phase === "working" ? <span className="ring" /> : <><span className="send-label">Generate</span><ArrowUp size={14} /></>}</button>
          </div>
          <div className={`settings-dock settings-${mode.toLowerCase()}`}>
            {controls}
            {referenceError && <span className="reference-error" role="alert">{referenceError}</span>}
            <div className="device-bar">
              <label className="model-picker"><span>Model</span><select value={selectedModeId} onChange={(e) => { const value = e.target.value; const item = models.find((x) => x.mode === value); setSelectedModeId(value); setSelectedModelName(labelForModel(item, e.target.options[e.target.selectedIndex]?.text ?? DEFAULT_MODELS[mode])); if (mode === "Image") setImageOpts((o) => ({ ...o, resolution: value.toLowerCase().includes("soul") ? "1080p" : "2k" })); }}><option value={selectedModeId}>{selectedModelName}</option>{models.filter((x) => x.mode !== selectedModeId).map((x) => <option key={x.mode} value={x.mode}>{x.title}</option>)}</select></label>
            </div>
          </div>
        </div>
        <div className="device-modes">
          {MODES.map((m) => <button type="button" key={m.id} className={`mode-btn${mode === m.id ? " on" : ""}`} onClick={() => setMode(m.id)}>{m.icon}{m.id}</button>)}
          <span className="mode-divider" aria-hidden="true" />
          {CREATE_LINKS.map((item) => <button type="button" key={item.path} className="mode-btn mode-link" onClick={() => navigate(item.path)}>{item.icon}{item.label}</button>)}
        </div>
      </div>
      <button type="button" className="composer-gallery" onClick={() => navigate("/assets")}>Gallery <span aria-hidden="true">↗</span></button>
      {phase === "working" && <div className="result"><div className="result-bar pad"><span className="ring small" /><span className="result-cap">{status ? `Request ${status} — generating…` : "Generating…"}</span><span className="result-cost">{hasKeys && mode !== "Audio" && mode !== "3D" ? "higgsfield.ai" : "demo"}</span></div></div>}
      {phase === "done" && result && <div className="result">{result.url.startsWith("gradient:") ? <div className="result-video" style={{ ...gradientStyle(result.url), ...ratioStyle(resultRatio) }} /> : result.kind === "video" ? <video className="result-video" style={ratioStyle(resultRatio)} src={result.url} autoPlay loop muted playsInline /> : <img className="result-video" style={ratioStyle(resultRatio)} src={result.url} alt={prompt} />}<div className="result-bar"><span className="result-tag">{mode}</span><span className="result-cap">{prompt}</span>{!hasKeys && <span className="result-demo">demo</span>}<span className="result-cost">{hasKeys && mode !== "Audio" && mode !== "3D" ? COST[mode] : "free"}</span>{!result.url.startsWith("gradient:") && <button className="chip" onClick={() => { setPending(result.url, result.kind === "image" ? "image" : "video"); navigate("/editor"); }}><Film size={13} /> Editor</button>}<button className="chip" onClick={() => { setResult(null); setPhase("idle"); }}>Generate again</button>{hasKeys && <a className="chip" href={result.url} target="_blank" rel="noreferrer"><Check size={13} /> Open</a>}</div></div>}
      {saveError && <div className="result"><div className="result-bar pad"><span className="result-tag" style={{ color: "#f0a44c" }}>Not saved</span><span className="result-cap">{saveError}</span></div></div>}
      {phase === "error" && <div className="result"><div className="result-bar pad"><span className="result-tag" style={{ color: "#f0a44c" }}>Failed</span><span className="result-cap">{error}</span><button className="chip" onClick={() => void generateWork()}>Try again</button></div></div>}
    </div>
  );
}
