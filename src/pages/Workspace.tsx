import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ASSETS_CHANGED, assetObjectUrl, getAsset, listAssets, saveAsset, type LocalAsset } from "../lib/assets";
import { useNavigate } from "react-router-dom";
import {
  addEdge, Background, Controls, Handle, Position, ReactFlow, useReactFlow,
  useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "./WorkspaceAgent.css";
import TimelineAgent from "../components/TimelineAgent";
import AssetPicker from "../components/AssetPicker";
import { ArrowRight, Cube, Film, ImageIc, Music, Plus, Spark, VideoIc } from "../components/Icons";
import { setPending } from "../lib/transfer";
import { generate, hasKeys, LEGACY_IMAGE_MODE, VIDEO_MODE, type GenStatus } from "../lib/hf";
import {
  activeWorkspaceProjectId, createWorkspaceProject, listWorkspaceProjects, openWorkspaceProject,
  readWorkspaceArtifacts, readWorkspaceEdges, readWorkspacePositions, saveWorkspaceArtifacts,
  saveWorkspaceEdges, saveWorkspacePositions, saveWorkspaceTitle, upsertWorkspaceArtifact,
  type WorkspaceArtifact, type WorkspaceConnection, type WorkspacePositions, type WorkspaceTool,
} from "../lib/workspace";

import {
  connectionFits, connectionPorts, connectedInputsFor, generationPlan, handleId,
  inputPortsFor, normalizeConnections, AUDIO_MODE, MARKETING_IMAGE_MODE, outputPortsFor, promptForNode, THREE_MODE,
  NODE_COLORS, PORT_COLORS, type ConnectedInput, type WorkflowPort,
} from "../lib/workflowPorts";
import { bestFile, searchStock, stockConfigured, type StockClip } from "../lib/pexels";
import { defaultsForModel, modelSchema, type ModelSchema } from "../lib/hfModels";

// Generator nodes expose verified catalog-backed model IDs, not one node per model.
const IMAGE_MODES: [string, string][] = [
  [MARKETING_IMAGE_MODE, "Marketing Studio Image"],
  ["xai/grok-imagine-image-2.0", "Grok Imagine 2.0"],
];
const VIDEO_MODES: [string, string][] = [
  ["kling-video/v3.0/std/text-to-video", "Kling 3.0"],
  ["bytedance/seedance-2.5/text-to-video", "Seedance 2.5"],
  ["bytedance/seedance-2.0/text-to-video", "Seedance 2.0"],
  ["minimax/h3/text-to-video", "MiniMax H3"],
  ["alibaba/wan-3.0-prime/text-to-video", "Wan 3.0 Prime"],
  ["higgsfield/cinema-studio/4.0", "Cinema Studio 4.0"],
];
const LEGACY_MODEL_IDS: Record<string, string> = {
  "Marketing Studio Image": MARKETING_IMAGE_MODE,
  "Grok Imagine 2.0": "xai/grok-imagine-image-2.0",
  "Kling 3.0": VIDEO_MODE,
  "Seedance 2.5": "bytedance/seedance-2.5/text-to-video",
  "Seedance 2.0": "bytedance/seedance-2.0/text-to-video",
  "MiniMax H3": "minimax/h3/text-to-video",
  "Wan 3.0 Prime": "alibaba/wan-3.0-prime/text-to-video",
  "Cinema Studio 4.0": "higgsfield/cinema-studio/4.0",
};
interface NodeData extends WorkspaceArtifact, Record<string, unknown> {
  onOpen?: (route: string, prompt?: string) => void;
  onOpenGallery?: () => void;
  onPatch?: (id: string, patch: Partial<WorkspaceArtifact>) => void;
  onGenerate?: (id: string) => void;
  onSendEditor?: (url: string, kind: "image" | "video") => void;
  onDetails?: (id: string) => void;
  inputs?: ConnectedInput[];
  busy?: boolean;
  requestStatus?: string;
  noKeys?: boolean;
  onSearchStock?: (id: string, query: string) => void;
  onPickStock?: (id: string, clipUrl: string, clipName: string, credit: string) => void;
  stockResults?: StockClip[];
  stockBusy?: boolean;
  stockError?: string;
  assetSaveError?: string;
}
type WorkspaceNode = Node<NodeData, "artifact">;

type ToolOption = { tool: WorkspaceTool; title: string; description: string; route: string };

 
const TOOLS: ToolOption[] = [
  { tool: "image", title: "Image", description: "Generate a still or use image inputs.", route: "/image" },
  { tool: "video", title: "Video", description: "Generate a shot from connected text.", route: "/video" },
  { tool: "audio", title: "Audio", description: "Prepare a prompt for an audio model.", route: "/audio" },
  { tool: "3d", title: "3D", description: "Prepare a prompt for a 3D model.", route: "/3d" },
  { tool: "motion-control", title: "Motion control", description: "Drive a character image with a motion video.", route: "/video" },
  { tool: "motion-transfer", title: "Motion transfer", description: "Transfer motion to up to eight reference images.", route: "/video" },
  { tool: "stock", title: "Stock footage", description: "Find free Pexels b-roll from a prompt.", route: "/video" },
  { tool: "chat", title: "Chat", description: "Explore ideas and generate assets.", route: "/chat" },
  { tool: "launch", title: "Launch", description: "Turn a product URL into a launch video.", route: "/launch" },
  { tool: "studio", title: "Studio", description: "Shape scenes and cinematic structure.", route: "/studio" },
  { tool: "editor", title: "Editor", description: "Cut and export connected assets.", route: "/editor" },
  { tool: "export", title: "Publish", description: "Open the finished cut in Editor.", route: "/editor" },
  { tool: "gallery", title: "Gallery", description: "Browse saved image and video assets.", route: "/gallery" },
];
const byTool = (tool: WorkspaceTool) => TOOLS.find((item) => item.tool === tool)!;
const TOOL_GROUPS: { label: string; tools: ToolOption[] }[] = [
  { label: "Generate", tools: (["image", "video", "audio", "3d"] as WorkspaceTool[]).map(byTool) },
  { label: "Motion", tools: (["motion-control", "motion-transfer"] as WorkspaceTool[]).map(byTool) },
  { label: "Surfaces", tools: (["launch", "studio", "editor", "export"] as WorkspaceTool[]).map(byTool) },
  { label: "Library", tools: (["gallery", "stock"] as WorkspaceTool[]).map(byTool) },
];

const POSITIONS: Record<WorkspaceTool, { x: number; y: number }> = {
  brief: { x: 30, y: 180 }, chat: { x: 340, y: 20 }, launch: { x: 340, y: 270 },
  gallery: { x: 340, y: 520 }, image: { x: 650, y: 20 }, video: { x: 650, y: 270 }, audio: { x: 960, y: 20 },
  "3d": { x: 960, y: 270 }, studio: { x: 960, y: 520 }, editor: { x: 1270, y: 180 }, export: { x: 1580, y: 180 },
  "motion-control": { x: 1270, y: 20 }, "motion-transfer": { x: 1270, y: 320 }, stock: { x: 340, y: 770 },
};

const EMPTY_EDGES: Edge[] = [];
const NODE_HEIGHTS: Record<WorkspaceTool, number> = {
  brief: 180, chat: 240, launch: 220, gallery: 200, studio: 240, editor: 220, export: 220, stock: 220,
  image: 280, video: 260, audio: 240, "3d": 240, "motion-control": 280, "motion-transfer": 300,
};

const OUTPUT_NODE_HEIGHTS: Partial<Record<WorkspaceTool, number>> = {
  chat: 360, launch: 340, studio: 340, editor: 340, export: 340, image: 390,
  video: 360, audio: 320, "3d": 300, "motion-control": 360, "motion-transfer": 380, stock: 300,
};
function flowEdges(connections: WorkspaceConnection[], artifacts: WorkspaceArtifact[]): Edge[] {
  return normalizeConnections(connections, artifacts).map((edge) => {
    const ports = connectionPorts(edge, artifacts);
    return { ...edge, type: "smoothstep", style: { stroke: PORT_COLORS[ports?.output.type ?? "text"], strokeWidth: 2 } };
  });
}
function sanitizeArtifacts(artifacts: WorkspaceArtifact[]): WorkspaceArtifact[] {
  const clean: WorkspaceArtifact[] = [];
  let hasBrief = false;
  for (const artifact of artifacts) {
    if (artifact.tool === "brief") {
      if (hasBrief) continue;
      hasBrief = true;
    }
    const next = { ...artifact };
    if (next.model && LEGACY_MODEL_IDS[next.model]) next.model = LEGACY_MODEL_IDS[next.model];
    if (next.tool === "image") {
      if (!next.model || next.model === LEGACY_IMAGE_MODE || /soul\s*2/i.test(next.model)) next.model = MARKETING_IMAGE_MODE;
      if (/soul\s*2/i.test(next.title)) next.title = "Marketing Studio Image";
    }
    if (next.outputUrl?.startsWith("blob:")) delete next.outputUrl;
    clean.push(next);
  }
  return clean;
}

function iconForTool(tool: WorkspaceTool) {
  if (tool === "gallery") return <ImageIc size={16} />;
  if (tool === "chat") return <Spark size={16} />;
  if (tool === "launch" || tool === "video" || tool === "motion-control" || tool === "motion-transfer") return <VideoIc size={16} />;
  if (tool === "studio" || tool === "image") return <ImageIc size={16} />;
  if (tool === "audio") return <Music size={16} />;
  if (tool === "3d") return <Cube size={16} />;
  return <Film size={16} />;
}

function nodeFromArtifact(
  artifact: WorkspaceArtifact & Pick<NodeData, "assetSaveError">,
  callbacks: Pick<NodeData, "onOpen" | "onOpenGallery" | "onPatch" | "onGenerate" | "onSendEditor" | "onDetails" | "busy" | "requestStatus" | "noKeys" | "onSearchStock" | "onPickStock" | "stockResults" | "stockBusy" | "stockError">,
  inputs: ConnectedInput[], position?: { x: number; y: number }, selected = false,
): WorkspaceNode {
  return { id: artifact.id, type: "artifact", position: position ?? POSITIONS[artifact.tool], selected, data: { ...artifact, ...callbacks, inputs } };
}

function PortRows({ direction, ports }: { direction: "in" | "out"; ports: WorkflowPort[] }) {
  if (!ports.length) return null;
  return <div className={`workflow-ports ${direction}`}>
    <span className="workflow-ports-title">{direction === "in" ? "Inputs" : "Outputs"}</span>
    {ports.map((port) => <div className={`workflow-port ${direction} type-${port.type}`} key={port.id}>
      <Handle id={handleId(direction, port)} type={direction === "in" ? "target" : "source"} position={direction === "in" ? Position.Left : Position.Right} />
      <i /><span>{port.label}</span><small>{port.type}</small>{port.limit && <small>max {port.limit}</small>}
    </div>)}
  </div>;
}

function InputAssets({ inputs, onSendEditor }: { inputs: ConnectedInput[]; onSendEditor?: NodeData["onSendEditor"] }) {
  if (!inputs.length) return <span className="workflow-node-hint">No inputs connected</span>;
  return <div className="workflow-input-assets">{inputs.map(({ input, artifact, ready }) => <div key={`${input.id}:${artifact.id}`} className={`workflow-input-asset${ready ? "" : " waiting"}`}>
    {ready && input.type === "text" && <span className="workflow-input-text">{artifact.prompt}</span>}
    {ready && input.type === "image" && <img src={artifact.outputUrl} alt={artifact.title} />}
    {ready && input.type === "video" && <video src={artifact.outputUrl} muted playsInline controls />}
    {ready && input.type === "audio" && <audio src={artifact.outputUrl} controls />}
    {ready && input.type === "3d" && <a href={artifact.outputUrl} target="_blank" rel="noreferrer">Open 3D model</a>}
    {!ready && <span className="workflow-input-wait">Waiting for {input.type} output</span>}
    <span className="workflow-input-meta"><b>{input.label}</b><small>{artifact.title}</small></span>
    {ready && onSendEditor && artifact.outputUrl && (artifact.outputKind === "image" || artifact.outputKind === "video") && <button className="workflow-input-action nodrag" onClick={() => onSendEditor(artifact.outputUrl!, artifact.outputKind as "image" | "video")}>Add to Editor</button>}
  </div>)}</div>;
}

function OutputAsset({ artifact }: { artifact: NodeData }) {
  if (!artifact.outputUrl || !artifact.outputKind) return null;
  return <div className="workflow-output"><span className="workflow-node-label">{artifact.outputSource === "render" ? "Rendered output" : artifact.outputSource === "catalog" ? "Catalog preview" : "Output"}</span>
    {artifact.outputKind === "video" ? <video src={artifact.outputUrl} controls muted playsInline /> : artifact.outputKind === "audio" ? <audio src={artifact.outputUrl} controls /> : artifact.outputKind === "3d" ? <a href={artifact.outputUrl} target="_blank" rel="noreferrer">Open 3D model</a> : <img src={artifact.outputUrl} alt={artifact.title} />}
  </div>;
}

function ParameterControls({ schema, values, onChange }: { schema: ModelSchema; values: Record<string, string | number | boolean>; onChange: (key: string, value: string | number | boolean) => void }) {
  return <div className="workflow-node-params">{schema.fields.map((field) => <label className="workflow-node-select" key={field.key}><span>{field.label}</span>{field.type === "select" ? <select className="nodrag" value={String(values[field.key] ?? field.default)} onChange={(event) => onChange(field.key, event.target.value)}>{(field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select> : field.type === "boolean" ? <input className="nodrag" type="checkbox" checked={values[field.key] === true || values[field.key] === "true"} onChange={(event) => onChange(field.key, event.target.checked)} /> : <input className="nodrag" type="number" min={field.min} max={field.max} step={field.step} value={String(values[field.key] ?? field.default)} onChange={(event) => onChange(field.key, Number(event.target.value))} />}</label>)}</div>;
}

function ArtifactNode({ data, selected }: NodeProps<WorkspaceNode>) {
  const artifact = data as NodeData;
  const inputs = artifact.inputs ?? [];
  const inheritedPrompt = promptForNode(artifact, inputs);
  const prompt = artifact.prompt ?? "";
  const isGenerator = artifact.tool === "image" || artifact.tool === "video" || artifact.tool === "motion-control" || artifact.tool === "motion-transfer" || artifact.tool === "audio" || artifact.tool === "3d";
  const generation = isGenerator ? generationPlan(artifact, inputs) : null;
  const canGenerate = Boolean(generation && !("error" in generation));
  const generatorMode = artifact.tool === "image" ? artifact.model || MARKETING_IMAGE_MODE : artifact.tool === "video" ? artifact.model || VIDEO_MODE : artifact.tool === "audio" ? artifact.model || AUDIO_MODE : artifact.tool === "3d" ? artifact.model || THREE_MODE : "";
  const generatorSchema = generatorMode && (artifact.tool === "image" || artifact.tool === "video") ? modelSchema({ mode: generatorMode, type: artifact.tool }) : null;
  const generatorParameters = artifact.parameters ?? defaultsForModel(generatorSchema ? { mode: generatorMode, type: generatorSchema.kind } : null);
  return (
    <div className={`workspace-node ${artifact.status}${selected ? " selected" : ""} workflow-node-${artifact.tool}`} style={{ "--node-color": NODE_COLORS[artifact.tool] } as CSSProperties}>
      <div className="workspace-node-top"><span className="workspace-node-icon">{iconForTool(artifact.tool)}</span><span className="workspace-node-kind">{artifact.tool.replace("-", " ") === "3d" ? "3D" : artifact.tool.replace("-", " ")}</span><span className="workspace-node-status"><i />{artifact.status}</span></div>
      <strong>{artifact.title}</strong>
      <PortRows direction="in" ports={inputPortsFor(artifact) ?? []} />
      {artifact.tool === "gallery" ? <button className="workflow-node-details nodrag" onClick={() => artifact.onOpenGallery?.()}>Open gallery <ArrowRight size={11} /></button> : <button className="workflow-node-details nodrag" onClick={() => artifact.onDetails?.(artifact.id)}>View {artifact.outputUrl ? "asset" : "details"} <ArrowRight size={11} /></button>}
      {artifact.tool === "stock" && <div className="workflow-node-stock">
        <p>{artifact.summary}</p>
        <div className="workflow-stock-search">
          <textarea className="workflow-node-prompt nodrag" rows={1} placeholder={inheritedPrompt || "Describe the b-roll you need (e.g. city timelapse)…"} value={prompt} onChange={(event) => artifact.onPatch?.(artifact.id, { prompt: event.target.value })} />
          <button className="workflow-node-action nodrag" disabled={!artifact.onSearchStock || artifact.stockBusy || !prompt.trim()} onClick={() => artifact.onSearchStock?.(artifact.id, prompt)}>{artifact.stockBusy ? "Searching…" : "Find footage"}</button>
        </div>
        {artifact.stockError && <span className="workspace-node-error" role="alert">{artifact.stockError}</span>}
        {artifact.stockResults && artifact.stockResults.length > 0 && <div className="workflow-stock-grid">{artifact.stockResults.map((clip) => {
          const file = bestFile(clip);
          return <button key={clip.id} className="workflow-stock-item nodrag" disabled={!artifact.onPickStock} onClick={() => artifact.onPickStock?.(artifact.id, file?.link ?? clip.files[0]?.link ?? clip.url, `${clip.photographer} · ${clip.url.split("/").pop()?.split("-")[0]}`, clip.photographer)}>
            <span className="workflow-stock-thumb"><img src={clip.picture} alt="" loading="lazy" /></span>
            <small>{clip.photographer} · {clip.duration}s</small>
            <b>Use in timeline</b>
          </button>;
        })}</div>}
        <a className="workflow-stock-credit" href="https://www.pexels.com" target="_blank" rel="noreferrer">Photos and videos provided by Pexels</a>
        {artifact.stockResults && artifact.stockResults.length === 0 && <span className="workspace-node-hint">No footage found — try another phrase.</span>}
      </div>}
      {isGenerator && <>
        <div className="workflow-node-label">Selected upstream inputs</div><InputAssets inputs={inputs} />
        <textarea className="workflow-node-prompt nodrag" rows={2} value={prompt} placeholder={inheritedPrompt || (artifact.tool === "image" ? "Describe the image…" : artifact.tool === "video" ? "Describe the shot…" : "Add an optional direction…")} onChange={(event) => artifact.onPatch?.(artifact.id, { prompt: event.target.value })} />
        {artifact.tool === "image" && <label className="workflow-node-select"><span>Model</span><select className="nodrag" value={artifact.model || MARKETING_IMAGE_MODE} onChange={(event) => artifact.onPatch?.(artifact.id, { model: event.target.value, parameters: defaultsForModel({ mode: event.target.value, type: "image" }) })}>{IMAGE_MODES.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}
        {artifact.tool === "video" && <label className="workflow-node-select"><span>Model</span><select className="nodrag" value={artifact.model || VIDEO_MODE} onChange={(event) => artifact.onPatch?.(artifact.id, { model: event.target.value, parameters: defaultsForModel({ mode: event.target.value, type: "video" }) })}>{VIDEO_MODES.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>}
        {generatorSchema && <ParameterControls schema={generatorSchema} values={generatorParameters} onChange={(key, value) => artifact.onPatch?.(artifact.id, { parameters: { ...generatorParameters, [key]: value } })} />}
        {artifact.tool === "motion-transfer" && <label className="workflow-node-select"><span>Resolution</span><select className="nodrag" value={artifact.resolution || "720p"} onChange={(event) => artifact.onPatch?.(artifact.id, { resolution: event.target.value as "480p" | "720p" })}><option value="480p">480p</option><option value="720p">720p</option></select></label>}
        {generation && "error" in generation && <span className="workflow-node-hint">{generation.error}</span>}
        <button className="workflow-node-action nodrag" disabled={!artifact.onGenerate || !canGenerate || artifact.busy || artifact.noKeys} onClick={() => artifact.onGenerate?.(artifact.id)}>{artifact.busy ? `${artifact.requestStatus || "Generating"}…` : artifact.noKeys ? "Live model not connected" : "Generate"} {!artifact.busy && !artifact.noKeys && <ArrowRight size={12} />}</button>
        {artifact.status === "failed" && <span className="workflow-node-error">{artifact.summary}</span>}
        {artifact.assetSaveError && <span className="workflow-node-error" role="alert">{artifact.assetSaveError}</span>}
        <OutputAsset artifact={artifact} />
      </>}
      {artifact.tool === "editor" && <><p>{artifact.summary}</p><InputAssets inputs={inputs} onSendEditor={artifact.onSendEditor} /><button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route)}>Open Editor <ArrowRight size={13} /></button></>}
      {artifact.tool === "export" && <><p>{artifact.summary}</p><InputAssets inputs={inputs} /><button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route)}>Open Editor <ArrowRight size={13} /></button></>}
      {artifact.tool === "gallery" && <><p>{artifact.summary}</p><span className="workflow-node-hint">Image and video assets from the shared local library.</span></>}
      {!isGenerator && artifact.tool !== "brief" && artifact.tool !== "chat" && artifact.tool !== "editor" && artifact.tool !== "export" && artifact.tool !== "gallery" && <><p>{artifact.summary}</p><InputAssets inputs={inputs} /><OutputAsset artifact={artifact} /><button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route, inheritedPrompt)}>Open {artifact.title} <ArrowRight size={13} /></button></>}
      <PortRows direction="out" ports={outputPortsFor(artifact) ?? []} />
    </div>
  );
}



const nodeTypes = { artifact: ArtifactNode };

function ArtifactDetailsModal({ artifact, onClose, onSave, onSendEditor, saving, error }: {
  artifact: WorkspaceArtifact & { inputs: ConnectedInput[]; assetSaveError?: string };
  onClose: () => void;
  onSave: (artifact: WorkspaceArtifact) => void;
  onSendEditor: (url: string, kind: "image" | "video") => void;
  saving: boolean;
  error: string;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const mediaKind = artifact.outputKind;
  const hasSaveableAsset = Boolean(artifact.outputUrl && mediaKind);
  const prompt = artifact.generationPrompt || artifact.prompt;
  return <div className="workflow-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`workflow-modal workflow-modal-${artifact.tool}`} role="dialog" aria-modal="true" aria-label={`${artifact.title} details`}>
      <header className="workflow-modal-head"><div><span className="workflow-modal-kicker">{artifact.tool.replace("-", " ")} · {artifact.status}</span><h2>{mediaKind ? `${mediaKind[0]!.toUpperCase()}${mediaKind.slice(1)} output` : artifact.title}</h2></div><button onClick={onClose} aria-label="Close details">Close</button></header>
      <div className="workflow-modal-body">
        {artifact.outputUrl && mediaKind === "image" && <img className="workflow-modal-media" src={artifact.outputUrl} alt={artifact.title} />}
        {artifact.outputUrl && mediaKind === "video" && <video className="workflow-modal-media" src={artifact.outputUrl} controls playsInline />}
        {artifact.outputUrl && mediaKind === "audio" && <audio className="workflow-modal-audio" src={artifact.outputUrl} controls />}
        {artifact.outputUrl && mediaKind === "3d" && <a className="workflow-modal-model" href={artifact.outputUrl} target="_blank" rel="noreferrer">Open 3D model</a>}
        {!artifact.outputUrl && <div className="workflow-modal-empty"><span>{artifact.tool === "image" ? <ImageIc size={24} /> : artifact.tool === "video" ? <VideoIc size={24} /> : artifact.tool === "audio" ? <Music size={24} /> : artifact.tool === "3d" ? <Cube size={24} /> : <Film size={24} />}</span><strong>{artifact.tool === "audio" || artifact.tool === "3d" ? "Live model unavailable" : "No output yet"}</strong><p>{artifact.summary}</p></div>}
        <dl className="workflow-modal-info"><div><dt>Node</dt><dd>{artifact.title}</dd></div>{artifact.model && <div><dt>Model</dt><dd>{artifact.model}</dd></div>}{mediaKind && <div><dt>Asset type</dt><dd>{mediaKind}</dd></div>}<div><dt>State</dt><dd>{artifact.status}</dd></div><div className="workflow-modal-prompt"><dt>Prompt</dt><dd>{prompt || "No prompt saved on this node."}</dd></div>{artifact.inputs.length > 0 && <div><dt>Connected inputs</dt><dd>{artifact.inputs.map((input) => `${input.input.label} ← ${input.artifact.title} · ${input.ready ? "ready" : "waiting"}`).join(", ")}</dd></div>}</dl>
      </div>
      {error && <p className="workflow-modal-error" role="alert">{error}</p>}
      {artifact.assetSaveError && <p className="workflow-modal-error" role="alert">{artifact.assetSaveError}</p>}
      <footer className="workflow-modal-actions">{hasSaveableAsset && <button className="workflow-modal-save" onClick={() => onSave(artifact)} disabled={saving}>{saving ? "Saving…" : `Save ${mediaKind}`}</button>}{artifact.outputUrl && (mediaKind === "image" || mediaKind === "video") && <button onClick={() => onSendEditor(artifact.outputUrl!, mediaKind)}>Send to Editor</button>}<button onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

function formatAssetSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function WorkspaceGalleryModal({ assets, outputs, onClose, onUse, onSendEditor, onSaveOutput, savingId, error }: {
  assets: LocalAsset[];
  outputs: WorkspaceArtifact[];
  onClose: () => void;
  onUse: (asset: LocalAsset) => void;
  onSendEditor: (url: string, kind: "image" | "video") => void;
  onSaveOutput: (artifact: WorkspaceArtifact) => void;
  savingId: string;
  error: string;
}) {
  const [detailsId, setDetailsId] = useState("");
  const details = assets.find((asset) => asset.id === detailsId);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const preview = (asset: LocalAsset) => asset.kind === "video"
    ? <video src={assetObjectUrl(asset)} muted playsInline controls preload="metadata" aria-label={asset.name} style={{ maxWidth: "100%", maxHeight: "56vh", objectFit: "contain" }} />
    : <img src={assetObjectUrl(asset)} alt={asset.name} loading="lazy" style={{ maxWidth: "100%", maxHeight: "56vh", objectFit: "contain" }} />;
  return <div className="workflow-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="workflow-modal" role="dialog" aria-modal="true" aria-label="Workspace gallery" style={{ width: "min(980px, 100%)" }}>
      <header className="workflow-modal-head"><div><span className="workflow-modal-kicker">Field / Library</span><h2>{details ? details.name : "Workspace gallery"}</h2></div><button onClick={onClose} aria-label="Close gallery">Close</button></header>
      {details ? <div className="workflow-modal-body" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(220px, .7fr)" }}>
        <div style={{ display: "grid", placeItems: "center", minWidth: 0, background: "var(--bg)", borderRadius: 10, padding: 12 }}>{preview(details)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <dl className="workflow-modal-info"><div><dt>Type</dt><dd>{details.kind}</dd></div><div><dt>Source</dt><dd>{details.source}</dd></div><div><dt>Size</dt><dd>{formatAssetSize(details.size)}</dd></div>{details.model && <div><dt>Model</dt><dd>{details.model}</dd></div>}{details.prompt && <div className="workflow-modal-prompt"><dt>Prompt</dt><dd>{details.prompt}</dd></div>}</dl>
          <div className="workflow-modal-actions" style={{ padding: 0, borderTop: 0, justifyContent: "flex-start", flexWrap: "wrap" }}><button onClick={() => onUse(details)}>Use in Workspace</button><button onClick={() => onSendEditor(assetObjectUrl(details), details.kind)}>Send to Editor</button><button onClick={() => setDetailsId("")}>Back to gallery</button></div>
        </div>
      </div> : <div className="workflow-modal-body" style={{ display: "block" }}>
        {error && <p className="workflow-modal-error" role="alert" style={{ padding: "0 0 12px" }}>{error}</p>}
        {outputs.length > 0 && <section aria-label="Workspace outputs" style={{ marginBottom: 22 }}><span className="workflow-modal-kicker">Workspace outputs</span><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 10 }}>{outputs.map((artifact) => <article key={artifact.id} style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--bg)" }}>
          <div style={{ aspectRatio: "16 / 10", background: "#090a0b" }}>{artifact.outputKind === "video" ? <video src={artifact.outputUrl} muted playsInline controls preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={artifact.outputUrl} alt={artifact.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
          <div style={{ display: "grid", gap: 8, padding: 10 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.title}</strong><small style={{ color: "var(--text-3)" }}>{artifact.outputKind} · Not saved to library</small><button type="button" onClick={() => onSaveOutput(artifact)} disabled={savingId === artifact.id}>{savingId === artifact.id ? "Saving…" : "Save to gallery"}</button></div>
        </article>)}</div></section>}
        <section aria-label="Saved workspace assets"><span className="workflow-modal-kicker">Saved assets</span>{assets.length === 0 ? <p className="workflow-modal-empty" style={{ minHeight: 140, marginTop: 10 }}>Your local gallery is empty.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 10 }}>{assets.map((asset) => <article key={asset.id} style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--bg)" }}>
          <div style={{ aspectRatio: "16 / 10", background: "#090a0b" }}>{asset.kind === "video" ? <video src={assetObjectUrl(asset)} muted playsInline controls preload="metadata" aria-label={asset.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={assetObjectUrl(asset)} alt={asset.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
          <div style={{ display: "grid", gap: 8, padding: 10 }}><strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={asset.name}>{asset.name}</strong><small style={{ color: "var(--text-3)" }}>{asset.kind} · {asset.source} · {formatAssetSize(asset.size)}</small><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" onClick={() => onUse(asset)}>Use in Workspace</button><button type="button" onClick={() => setDetailsId(asset.id)}>Open details</button>{(asset.kind === "image" || asset.kind === "video") && <button type="button" onClick={() => onSendEditor(assetObjectUrl(asset), asset.kind)}>Send to Editor</button>}</div></div>
        </article>)}</div>}</section>
      </div>}
      {!details && <footer className="workflow-modal-actions"><button onClick={() => onClose()}>Done</button></footer>}
    </section>
  </div>;
}

function FitOnResize({ selectedId, nodeCount, layoutKey, edgeCount, projectId }: {
  selectedId: string; nodeCount: number; layoutKey: string; edgeCount: number; projectId: string;
}) {
  const { fitView, getNode, getNodes, setNodes } = useReactFlow<WorkspaceNode>();
  const compactedProject = useRef("");
  useEffect(() => {
    const fit = () => {
      if (window.innerWidth <= 768) {
        const selected = getNode(selectedId);
        fitView({ nodes: selected ? [selected] : undefined, padding: 0.18, minZoom: 0.45, maxZoom: 1 });
      } else fitView({ padding: 0.12, minZoom: 0.25, maxZoom: 1.35 });
    };
    const frame = requestAnimationFrame(() => {
      const nodes = getNodes();
      if (nodes.length && compactedProject.current !== projectId) {
        compactedProject.current = projectId;
        if (nodes.length > 4) {
          const bounds = nodes.map((node) => ({
            x: node.position.x,
            y: node.position.y,
            w: node.measured?.width ?? 258,
            h: Math.max(node.measured?.height ?? 0, NODE_HEIGHTS[node.data.tool]),
          }));
          const width = Math.max(...bounds.map((box) => box.x + box.w)) - Math.min(...bounds.map((box) => box.x));
          const height = Math.max(...bounds.map((box) => box.y + box.h)) - Math.min(...bounds.map((box) => box.y));
          if (width > 1800 || height > 900) {
            const columns = Math.min(5, nodes.length);
            const rows = Math.ceil(nodes.length / columns);
            const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...nodes.slice(row * columns, (row + 1) * columns).map((node) => Math.max(node.measured?.height ?? 0, NODE_HEIGHTS[node.data.tool], node.data.outputUrl ? OUTPUT_NODE_HEIGHTS[node.data.tool] ?? 0 : 0))));
            const rowTops: number[] = [];
            let top = 40;
            for (let row = 0; row < rows; row += 1) {
              rowTops[row] = top;
              top += rowHeights[row]! + 56;
            }
            setNodes(nodes.map((node, index) => ({ ...node, position: { x: 40 + (index % columns) * 280, y: rowTops[Math.floor(index / columns)]! } })));
            requestAnimationFrame(fit);
            return;
          }
        }
      }
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const positions = new Map<string, { x: number; y: number }>();
      const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
      for (const node of ordered) {
        const w = node.measured?.width ?? 258;
        const floor = node.data.outputUrl
          ? OUTPUT_NODE_HEIGHTS[node.data.tool] ?? NODE_HEIGHTS[node.data.tool]
          : NODE_HEIGHTS[node.data.tool];
        const h = Math.max(node.measured?.height ?? 0, floor);
        let x = node.position.x;
        let y = node.position.y;
        const collisionsAt = (left: number, top: number) => placed.filter((item) =>
          left < item.x + item.w + 24 && left + w + 24 > item.x && top < item.y + item.h + 32 && top + h + 32 > item.y);
        const collisions = collisionsAt(x, y);
        if (collisions.length) {
          let below = y;
          let belowCollisions = collisions;
          while (belowCollisions.length) {
            below = Math.max(...belowCollisions.map((item) => item.y + item.h + 40));
            belowCollisions = collisionsAt(x, below);
          }
          let right = x;
          while (collisionsAt(right, y).length) right += w + 40;
          const fitScale = (left: number, top: number) => {
            const boxes = [...placed, { x: left, y: top, w, h }];
            const width = Math.max(...boxes.map((item) => item.x + item.w)) - Math.min(...boxes.map((item) => item.x)) + 48;
            const height = Math.max(...boxes.map((item) => item.y + item.h)) - Math.min(...boxes.map((item) => item.y)) + 48;
            return Math.min(2.1 / width, 1 / height);
          };
          if (fitScale(right, y) > fitScale(x, below)) x = right;
          else y = below;
        }
        positions.set(node.id, { x, y });
        placed.push({ x, y, w, h });
      }
      const next = nodes.map((node) => ({ ...node, position: positions.get(node.id)! }));
      if (next.some((node, index) => node.position.x !== nodes[index]!.position.x || node.position.y !== nodes[index]!.position.y)) {
        setNodes(next);
        requestAnimationFrame(fit);
      } else fit();
    });
    let resizeFrame = 0;
    const handleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, [edgeCount, fitView, getNode, getNodes, layoutKey, nodeCount, projectId, selectedId, setNodes]);
  return null;
}

export default function Workspace() {
  const navigate = useNavigate();
  const openArtifact = useCallback((route: string, prompt?: string) => {
    if (prompt?.trim()) navigate(route, { state: { workspacePrompt: prompt } });
    else navigate(route);
  }, [navigate]);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>(() => sanitizeArtifacts(readWorkspaceArtifacts()));
  const artifactsRef = useRef(artifacts);
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const assetsRef = useRef(assets);
  const [assetSaveErrors, setAssetSaveErrors] = useState<Record<string, string>>({});
  const [stockResults, setStockResults] = useState<StockClip[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockError, setStockError] = useState("");
  useEffect(() => {
    const clean = sanitizeArtifacts(readWorkspaceArtifacts());
    saveWorkspaceArtifacts(clean);
  }, []);
  const [projects, setProjects] = useState(() => listWorkspaceProjects());
  const [activeId, setActiveId] = useState(() => activeWorkspaceProjectId());
  const [selectedId, setSelectedId] = useState("brief");
  const [title, setTitle] = useState(() => localStorage.getItem("field-workspace-title") || "Untitled project");
  const [addOpen, setAddOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [gallerySavingId, setGallerySavingId] = useState("");
  const [galleryError, setGalleryError] = useState("");
  const [runningId, setRunningId] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [detailsId, setDetailsId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [initialEdges] = useState<WorkspaceConnection[] | null>(() => readWorkspaceEdges());
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkspaceNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges === null ? EMPTY_EDGES : flowEdges(initialEdges, artifacts));

  useEffect(() => { artifactsRef.current = artifacts; }, [artifacts]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  const [agentOpen, setAgentOpen] = useState(false);
  useEffect(() => {
    const refresh = () => {
      const next = sanitizeArtifacts(readWorkspaceArtifacts());
      artifactsRef.current = next;
      setArtifacts(next);
      saveWorkspaceArtifacts(next);
    };
    window.addEventListener("field-workspace-updated", refresh);
    return () => window.removeEventListener("field-workspace-updated", refresh);
  }, []);
  useEffect(() => {
    let mounted = true;
    const refreshAssets = () => { void listAssets().then((next) => { if (mounted) { assetsRef.current = next; setAssets(next); } }).catch(() => {}); };
    refreshAssets();
    window.addEventListener(ASSETS_CHANGED, refreshAssets);
    return () => { mounted = false; window.removeEventListener(ASSETS_CHANGED, refreshAssets); };
  }, []);
  const patchArtifact = useCallback((id: string, patch: Partial<WorkspaceArtifact>) => {
    const next = sanitizeArtifacts(artifactsRef.current.map((artifact) => artifact.id === id ? { ...artifact, ...patch, updatedAt: new Date().toISOString() } : artifact));
    artifactsRef.current = next;
    setArtifacts(next);
    saveWorkspaceArtifacts(next);
  }, []);

  const sendToEditor = useCallback((url: string, kind: "image" | "video") => {
    setPending(url, kind);
    navigate("/editor");
  }, [navigate]);

  const searchStockFor = async (id: string, query: string) => {
    if (stockBusy) return;
    setStockBusy(true); setStockError("");
    patchArtifact(id, { status: "active", summary: `Searching Pexels for ${query.slice(0, 60)}...` });
    try {
      const clips = await searchStock(query);
      setStockResults(clips);
      patchArtifact(id, { status: clips.length ? "ready" : "draft", summary: clips.length ? `${clips.length} stock clips found — pick one to use.` : "No stock clips found — try another phrase." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stock search failed.";
      setStockError(message);
      patchArtifact(id, { status: "failed", summary: message });
    } finally {
      setStockBusy(false);
    }
  };

  const pickStock = (id: string, clipUrl: string, clipName: string, credit: string) => {
    void saveAsset({ url: clipUrl, kind: "video", name: clipName, source: "catalog" }).then((asset) => {
      upsertWorkspaceArtifact({ id, tool: "stock", title: clipName, summary: `Pexels footage · ${credit}`, route: "/video", status: "ready", outputUrl: asset.remoteUrl ?? clipUrl, outputKind: "video", outputSource: "catalog", assetId: asset.id, prompt: artifactsRef.current.find((item) => item.id === id)?.prompt });
      window.dispatchEvent(new CustomEvent("field-workspace-updated"));
    }).catch((error) => {
      patchArtifact(id, { summary: `Local save failed: ${error instanceof Error ? error.message : "unknown"}` });
    });
  };

  const runGeneration = async (id: string) => {
    const artifact = artifactsRef.current.find((item) => item.id === id);
    if (!artifact || runningId || !hasKeys) return;
    const inputs = connectedInputsFor(artifact, edges, artifactsRef.current);
    const plan = generationPlan(artifact, inputs);
    if ("error" in plan) return;
    setRunningId(id);
    setRequestStatus("Queued");
    patchArtifact(id, { status: "active", summary: "Generation is running…", model: artifact.tool === "image" ? MARKETING_IMAGE_MODE : artifact.model });
    setAssetSaveErrors((current) => { const next = { ...current }; delete next[id]; return next; });
    try {
      const output = await generate(plan.mode, plan.body, (status: GenStatus) => setRequestStatus(status === "in_progress" ? "Rendering" : status));
      let assetId: string | undefined;
      if (output.kind === "image" || output.kind === "video") {
        try {
          const saved = await saveAsset({ url: output.url, kind: output.kind, name: artifact.title, source: "generation", model: plan.mode, prompt: plan.prompt });
          assetId = saved.id;
        } catch (error) {
          setAssetSaveErrors((current) => ({ ...current, [id]: `Local copy failed: ${error instanceof Error ? error.message : "Unable to save this asset."}` }));
        }
      }
      patchArtifact(id, {
        status: "ready", summary: `${output.kind} generated · ${plan.prompt.slice(0, 72)}`,
        generationPrompt: plan.prompt, model: plan.mode, outputUrl: output.url, outputKind: output.kind, outputSource: "generation", assetId,
      });
    } catch (error) {
      patchArtifact(id, { status: "failed", summary: error instanceof Error ? error.message : "Generation failed." });
    } finally {
      setRunningId("");
      setRequestStatus("");
    }
  };

  const resolveAssets = (items: WorkspaceArtifact[], savedAssets: LocalAsset[]) => {
    const urls = Object.fromEntries(savedAssets.map((asset) => [asset.id, assetObjectUrl(asset)]));
    return items.map((artifact) => ({ ...artifact, outputUrl: artifact.assetId ? urls[artifact.assetId] ?? artifact.outputUrl : artifact.outputUrl }));
  };

  const openDetails = useCallback((id: string) => { setSaveError(""); setDetailsId(id); }, []);
  const openGallery = useCallback(() => { setGalleryError(""); setGalleryOpen(true); }, []);
  const closeDetails = useCallback(() => setDetailsId(""), []);
  const saveOutput = async (artifact: WorkspaceArtifact | undefined) => {
    if (!artifact?.outputUrl || !artifact.outputKind) return;
    setSaving(true);
    setSaveError("");
    try {
      const persisted = artifactsRef.current.find((item) => item.id === artifact.id) ?? artifact;
      const url = new URL(persisted.outputUrl || artifact.outputUrl, window.location.origin);
      const extension = url.pathname.match(/\.(png|jpe?g|webp|mp4|webm|svg|mp3|wav|glb|gltf|obj|fbx)(?:$|\/)/i)?.[1]
        || ({ image: "png", video: "mp4", audio: "mp3", "3d": "glb" }[artifact.outputKind]);
      const fileName = `${artifact.title.trim().replace(/[^a-z0-9_-]+/gi, "-") || artifact.outputKind}.${extension}`;
      const existing = persisted.assetId
        ? assetsRef.current.find((asset) => asset.id === persisted.assetId) ?? await getAsset(persisted.assetId)
        : null;
      let blob: Blob;
      if (existing) blob = existing.blob;
      else if ((artifact.outputKind === "image" || artifact.outputKind === "video") && persisted.outputUrl && !persisted.outputUrl.startsWith("blob:")) {
        const saved = await saveAsset({
          url: persisted.outputUrl, kind: artifact.outputKind, name: artifact.title,
          source: persisted.outputSource === "catalog" ? "catalog" : "generation",
          ...(artifact.model ? { model: artifact.model } : {}),
          ...(artifact.generationPrompt || artifact.prompt ? { prompt: artifact.generationPrompt || artifact.prompt } : {}),
        });
        patchArtifact(artifact.id, { assetId: saved.id });
        blob = saved.blob;
      } else {
        const source = url.hostname === "d28lhcrx5qdowv.cloudfront.net" ? `/hfblob${url.pathname}${url.search}` : artifact.outputUrl;
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Download failed (${response.status}).`);
        blob = await response.blob();
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save this asset.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const renderArtifacts = resolveAssets(artifacts, assets);
    const positions = readWorkspacePositions();
    setNodes(renderArtifacts.map((artifact) => {
      const inputs = connectedInputsFor(artifact, edges, renderArtifacts);
      return nodeFromArtifact({ ...artifact, assetSaveError: assetSaveErrors[artifact.id] }, {
        onOpen: openArtifact, onOpenGallery: openGallery, onPatch: patchArtifact, onGenerate: runGeneration, onSendEditor: sendToEditor, onDetails: openDetails,
        onSearchStock: searchStockFor, onPickStock: pickStock, stockResults, stockBusy, stockError, noKeys: !hasKeys,
      }, inputs, positions[artifact.id], artifact.id === selectedId);
    }));
  }, [artifacts, assets, assetSaveErrors, edges, openArtifact, openDetails, openGallery, patchArtifact, requestStatus, runningId, selectedId, sendToEditor, setNodes, stockResults, stockBusy, stockError]);

  useEffect(() => {
    if (nodes.length) saveWorkspacePositions(Object.fromEntries(nodes.map((node) => [node.id, node.position])) as WorkspacePositions);
  }, [nodes]);
  useEffect(() => {
    saveWorkspaceEdges(edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
      id, source, target, sourceHandle: sourceHandle ?? undefined, targetHandle: targetHandle ?? undefined,
    })));
  }, [edges]);

  const isValidConnection = useCallback((connection: Connection | Edge) => connectionFits(connection, artifactsRef.current, edges), [edges]);
  const handleConnect = useCallback((connection: Connection) => {
    const ports = connectionPorts(connection, artifactsRef.current);
    if (!ports) return;
    setEdges((current) => connectionFits(connection, artifactsRef.current, current)
      ? addEdge({ ...connection, type: "smoothstep", style: { stroke: PORT_COLORS[ports.output.type], strokeWidth: 2 } }, current)
      : current);
  }, [setEdges]);

  const updateTitle = (value: string) => {
    setTitle(value);
    saveWorkspaceTitle(value);
    setProjects(listWorkspaceProjects());
  };

  const selectProject = (id: string) => {
    const project = openWorkspaceProject(id);
    if (!project) return;
    const projectArtifacts = sanitizeArtifacts(project.artifacts);
    setActiveId(project.id);
    setProjects(listWorkspaceProjects());
    setTitle(project.title);
    setArtifacts(projectArtifacts);
    artifactsRef.current = projectArtifacts;
    setSelectedId(projectArtifacts[0]?.id ?? "brief");
    setEdges(project.edges === undefined ? EMPTY_EDGES : flowEdges(project.edges, projectArtifacts));
    saveWorkspaceArtifacts(projectArtifacts);
  };

  const newProject = () => {
    const project = createWorkspaceProject();
    setActiveId(project.id);
    setProjects(listWorkspaceProjects());
    setTitle(project.title);
    setArtifacts(project.artifacts);
    artifactsRef.current = project.artifacts;
    setSelectedId("brief");
    setEdges(EMPTY_EDGES);
  };

  const addTool = (tool: ToolOption) => {
    const id = `${tool.tool}-${Date.now()}`;
    const artifact: WorkspaceArtifact = { id, tool: tool.tool, title: tool.tool === "image" ? "Marketing Studio Image" : tool.title, summary: tool.description, route: tool.route, status: ["image", "video", "motion-control", "motion-transfer"].includes(tool.tool) ? "draft" : "empty", updatedAt: new Date().toISOString(), ...(tool.tool === "image" ? { model: MARKETING_IMAGE_MODE } : {}) };
    const positions = readWorkspacePositions();
    const sourcePosition = positions[selectedId] ?? POSITIONS.brief;
    const x = sourcePosition.x + 310;
    const occupiedRows = Object.values(positions).filter((position) => position.x === x).map((position) => position.y);
    const y = occupiedRows.length ? Math.max(...occupiedRows) + 260 : sourcePosition.y;
    saveWorkspacePositions({ ...positions, [id]: { x, y } });
    const next = [...artifactsRef.current, artifact];
    artifactsRef.current = next;
    setArtifacts(next);
    saveWorkspaceArtifacts(next);
    setSelectedId(id);
    setAddOpen(false);
  };

  const refreshArtifacts = () => {
    const next = sanitizeArtifacts(readWorkspaceArtifacts());
    artifactsRef.current = next;
    setArtifacts(next);
    saveWorkspaceArtifacts(next);
  };
  const useLibraryAsset = (asset: LocalAsset) => {
    const outputSource = asset.source === "generation" || asset.source === "catalog" ? asset.source : undefined;
    upsertWorkspaceArtifact({
      id: `asset-${crypto.randomUUID()}`,
      tool: asset.kind,
      title: asset.name,
      summary: `${asset.kind === "image" ? "Image" : "Video"} from your local gallery · ${formatAssetSize(asset.size)}.`,
      route: `/${asset.kind}`,
      status: "ready",
      assetId: asset.id,
      outputKind: asset.kind,
      ...(asset.remoteUrl ? { outputUrl: asset.remoteUrl } : {}),
      ...(outputSource ? { outputSource } : {}),
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
      ...(asset.model ? { model: asset.model } : {}),
    });
    window.dispatchEvent(new CustomEvent("field-workspace-updated"));
    setGalleryOpen(false);
  };

  const saveOutputToGallery = async (artifact: WorkspaceArtifact) => {
    if (!artifact.outputUrl || (artifact.outputKind !== "image" && artifact.outputKind !== "video") || artifact.assetId) return;
    setGallerySavingId(artifact.id);
    setGalleryError("");
    try {
      const existing = assetsRef.current.find((asset) => asset.remoteUrl === artifact.outputUrl);
      if (existing) {
        patchArtifact(artifact.id, { assetId: existing.id });
        return;
      }
      const saved = await saveAsset({
        url: artifact.outputUrl,
        kind: artifact.outputKind,
        name: artifact.title,
        source: artifact.outputSource === "catalog" ? "catalog" : "generation",
        ...(artifact.model ? { model: artifact.model } : {}),
        ...(artifact.generationPrompt || artifact.prompt ? { prompt: artifact.generationPrompt || artifact.prompt } : {}),
      });
      patchArtifact(artifact.id, { assetId: saved.id });
      assetsRef.current = [saved, ...assetsRef.current];
      setAssets(assetsRef.current);
    } catch (cause) {
      setGalleryError(cause instanceof Error ? cause.message : "Unable to save this output to your gallery.");
    } finally {
      setGallerySavingId("");
    }
  };

  const renderArtifacts = resolveAssets(artifacts, assets);
  const detailArtifact = renderArtifacts.find((artifact) => artifact.id === detailsId);
  const detailInputs = detailArtifact ? connectedInputsFor(detailArtifact, edges, renderArtifacts) : [];
  return (
    <div className="app-scroll workspace-scroll"><div className="workspace-page">
      <div className="workspace-toolbar">
        <input aria-label="Project title" value={title} onChange={(event) => updateTitle(event.target.value)} />
        <div className="workspace-toolbar-right">
          {projects.length > 1 && <select aria-label="Open existing project" value="" onChange={(event) => selectProject(event.target.value)}><option value="">Open project</option>{projects.filter((project) => project.id !== activeId).map((project) => <option key={project.id} value={project.id}>{project.title || "Untitled project"}</option>)}</select>}
          <button className="workspace-ghost" onClick={refreshArtifacts}>Refresh</button><button className="workspace-reset" onClick={newProject}><Plus size={14} /> New project</button>
        </div>
      </div>
      <section className={`workspace-stage${agentOpen ? " workspace-stage-agent-open" : ""}`} aria-label="Workspace and Agent">
        <div className="workspace-canvas">
          <div className="workspace-canvas-head"><span>Flow · connect matching input and output ports</span><div className="workspace-canvas-actions"><button className="workspace-agent-toggle" aria-pressed={agentOpen} onClick={() => setAgentOpen((open) => !open)}>{agentOpen ? "Close Agent" : "Open Agent"}</button><button className="workspace-library-trigger" type="button" onClick={() => setAssetPickerOpen(true)}>Library</button><button className="workspace-add-trigger" onClick={() => setAddOpen((open) => !open)}><Plus size={14} /> Add to flow</button></div></div>
          {addOpen && <div className="workspace-add-popover"><div className="workspace-inspector-label">Choose a step</div>{TOOL_GROUPS.map((group) => <div className="workspace-add-group" key={group.label}><span className="workspace-add-group-label">{group.label}</span><div className="workspace-tool-list">{group.tools.map((tool) => <button key={tool.tool} onClick={() => addTool(tool)}><span>{iconForTool(tool.tool)}</span><span><b>{tool.title}</b><small>{tool.description}</small></span><Plus size={14} /></button>)}</div></div>)}</div>}
          <div className="workspace-flow"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={handleConnect} isValidConnection={isValidConnection} onNodeClick={(_, node) => setSelectedId(node.id)} fitView fitViewOptions={{ padding: 0.14 }} minZoom={0.25} maxZoom={1.35} colorMode="light"><Background gap={24} size={1} color="#d9ddd4" /><Controls showInteractive={false} /><FitOnResize selectedId={selectedId} nodeCount={nodes.length} edgeCount={edges.length} projectId={activeId} layoutKey={artifacts.map((artifact) => `${artifact.id}:${artifact.status}:${artifact.outputUrl ?? ""}`).join("|")} /></ReactFlow></div>
        </div>
        {agentOpen && <aside className="workspace-agent-pane" aria-label="Field Agent"><TimelineAgent key={activeId} showPreview={false} /></aside>}
      </section>
      {detailArtifact && <ArtifactDetailsModal artifact={{ ...detailArtifact, inputs: detailInputs, assetSaveError: assetSaveErrors[detailsId] }} onClose={closeDetails} onSave={saveOutput} onSendEditor={sendToEditor} saving={saving} error={saveError} />}
      <AssetPicker open={assetPickerOpen} onClose={() => setAssetPickerOpen(false)} onSelect={useLibraryAsset} title="Workspace library" />
    </div></div>
  );
}