import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addEdge, Background, Controls, Handle, Position, ReactFlow, useReactFlow,
  useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Cube, Film, ImageIc, Music, Plus, Spark, VideoIc } from "../components/Icons";
import { setPending } from "../lib/transfer";
import { generate, hasKeys, IMAGE_MODE, VIDEO_MODE, imageBody, videoBody, type GenStatus } from "../lib/hf";
import {
  activeWorkspaceProjectId, createWorkspaceProject, listWorkspaceProjects, openWorkspaceProject,
  readWorkspaceArtifacts, readWorkspaceEdges, readWorkspacePositions, saveWorkspaceArtifacts,
  saveWorkspaceEdges, saveWorkspacePositions, saveWorkspaceTitle,
  type WorkspaceArtifact, type WorkspaceConnection, type WorkspacePositions, type WorkspaceTool,
} from "../lib/workspace";

interface NodeData extends WorkspaceArtifact, Record<string, unknown> {
  onOpen?: (route: string, prompt?: string) => void;
  onPatch?: (id: string, patch: Partial<WorkspaceArtifact>) => void;
  onGenerate?: (id: string) => void;
  onSendEditor?: (url: string, kind: "image" | "video") => void;
  onDetails?: (id: string) => void;
  inputs?: WorkspaceArtifact[];
  busy?: boolean;
  requestStatus?: string;
  noKeys?: boolean;
}
type WorkspaceNode = Node<NodeData, "artifact">;
type ToolOption = { tool: WorkspaceTool; title: string; description: string; route: string };
type PortType = "text" | "image" | "video" | "audio" | "3d";

const TOOLS: ToolOption[] = [
  { tool: "image", title: "Image", description: "Generate a still or use image inputs.", route: "/image" },
  { tool: "video", title: "Video", description: "Generate a shot from connected text.", route: "/video" },
  { tool: "audio", title: "Audio", description: "Prepare a prompt for an audio model.", route: "/audio" },
  { tool: "3d", title: "3D", description: "Prepare a prompt for a 3D model.", route: "/3d" },
  { tool: "chat", title: "Chat", description: "Explore ideas and generate assets.", route: "/chat" },
  { tool: "launch", title: "Launch", description: "Turn a product URL into a launch video.", route: "/launch" },
  { tool: "studio", title: "Studio", description: "Shape scenes and cinematic structure.", route: "/studio" },
  { tool: "editor", title: "Editor", description: "Cut and export connected assets.", route: "/editor" },
  { tool: "export", title: "Publish", description: "Open the finished cut in Editor.", route: "/editor" },
];

const POSITIONS: Record<WorkspaceTool, { x: number; y: number }> = {
  brief: { x: 30, y: 180 }, chat: { x: 340, y: 20 }, launch: { x: 340, y: 270 },
  image: { x: 650, y: 20 }, video: { x: 650, y: 270 }, audio: { x: 960, y: 20 },
  "3d": { x: 960, y: 270 }, studio: { x: 960, y: 520 }, editor: { x: 1270, y: 180 }, export: { x: 1580, y: 180 },
};

const EMPTY_EDGES: Edge[] = [];
const MARKETING_IMAGE_MODE = "marketing-studio/image";

function outputPorts(artifact: WorkspaceArtifact): PortType[] {
  if (artifact.tool === "brief") return ["text"];
  if (artifact.tool === "image") return ["image"];
  if (artifact.tool === "video" || artifact.tool === "launch" || artifact.tool === "editor" || artifact.tool === "export") return ["video"];
  if (artifact.tool === "audio") return ["audio"];
  if (artifact.tool === "3d") return ["3d"];
  if (artifact.tool === "chat") return artifact.outputKind ? [artifact.outputKind] : ["text", "image", "video"];
  return ["image", "video"];
}

function inputPorts(artifact: WorkspaceArtifact): PortType[] {
  switch (artifact.tool) {
    case "brief": return [];
    case "image": return ["text", "image"];
    case "audio": return ["text", "audio"];
    case "3d": return ["text", "image", "3d"];
    case "studio":
    case "editor": return ["image", "video"];
    case "export": return ["video"];
    default: return ["text"];
  }
}

function connectionFits(connection: Connection | Edge, artifacts: WorkspaceArtifact[]): boolean {
  const source = artifacts.find((item) => item.id === connection.source);
  const target = artifacts.find((item) => item.id === connection.target);
  if (!source || !target || source.id === target.id) return false;
  const accepted = inputPorts(target);
  return outputPorts(source).some((kind) => accepted.includes(kind));
}

function iconForTool(tool: WorkspaceTool) {
  if (tool === "chat") return <Spark size={16} />;
  if (tool === "launch" || tool === "video") return <VideoIc size={16} />;
  if (tool === "studio" || tool === "image") return <ImageIc size={16} />;
  if (tool === "audio") return <Music size={16} />;
  if (tool === "3d") return <Cube size={16} />;
  return <Film size={16} />;
}

function nodeFromArtifact(
  artifact: WorkspaceArtifact,
  callbacks: Pick<NodeData, "onOpen" | "onPatch" | "onGenerate" | "onSendEditor" | "onDetails" | "busy" | "requestStatus" | "noKeys">,
  inputs: WorkspaceArtifact[], position?: { x: number; y: number }, selected = false,
): WorkspaceNode {
  return { id: artifact.id, type: "artifact", position: position ?? POSITIONS[artifact.tool], selected, data: { ...artifact, ...callbacks, inputs } };
}

function InputAssets({ inputs }: { inputs: WorkspaceArtifact[] }) {
  const assets = inputs.filter((item) => item.outputUrl);
  if (!assets.length) return <span className="workflow-node-hint">No media inputs connected</span>;
  return <div className="workflow-input-assets">{assets.map((asset) => <div key={asset.id} className="workflow-input-asset">{asset.outputKind === "video" ? <video src={asset.outputUrl} muted playsInline /> : asset.outputKind === "audio" ? <audio src={asset.outputUrl} controls /> : <img src={asset.outputUrl} alt={asset.title} />}<span>{asset.title}</span></div>)}</div>;
}

function OutputAsset({ artifact }: { artifact: NodeData }) {
  if (!artifact.outputUrl || !artifact.outputKind) return null;
  return <div className="workflow-output"><span className="workflow-node-label">Output{artifact.outputSource === "catalog" ? " · catalog preview" : ""}</span>{artifact.outputKind === "video" ? <video src={artifact.outputUrl} controls muted playsInline /> : artifact.outputKind === "audio" ? <audio src={artifact.outputUrl} controls /> : <img src={artifact.outputUrl} alt={artifact.title} />}</div>;
}

function ArtifactNode({ data, selected }: NodeProps<WorkspaceNode>) {
  const artifact = data as NodeData;
  const inputs = artifact.inputs ?? [];
  const inheritedPrompt = inputs.map((input) => input.prompt?.trim()).filter(Boolean).join("\n");
  const prompt = artifact.prompt ?? "";
  const imageInputs = inputs.filter((input) => input.outputKind === "image" && input.outputUrl);
  const isGenerator = artifact.tool === "image" || artifact.tool === "video";
  const isUnsupported = artifact.tool === "audio" || artifact.tool === "3d";
  const editorInput = artifact.tool === "editor" ? inputs.find((input) => input.outputUrl && (input.outputKind === "image" || input.outputKind === "video")) : undefined;
  const out = outputPorts(artifact).join(" / ");
  return (
    <div className={`workspace-node ${artifact.status}${selected ? " selected" : ""} workflow-node-${artifact.tool}`}>
      <Handle id="input" type="target" position={Position.Left} />
      <div className="workspace-node-top"><span className="workspace-node-icon">{iconForTool(artifact.tool)}</span><span className="workspace-node-kind">{artifact.tool === "3d" ? "3D" : artifact.tool}</span><span className="workspace-node-status"><i />{artifact.status}</span></div>
      <strong>{artifact.title}</strong>
      <div className="workflow-node-port-label">Input accepts · {inputPorts(artifact).join(" / ") || "none"}</div>
      <button className="workflow-node-details nodrag" onClick={() => artifact.onDetails?.(artifact.id)}>View {artifact.outputUrl ? "asset" : "details"} <ArrowRight size={11} /></button>
      {artifact.tool === "brief" && <label className="workflow-node-label">Input · project direction<textarea className="workflow-node-prompt nodrag" rows={3} value={prompt} placeholder="Write an idea, then connect this to the next step." onChange={(event) => artifact.onPatch?.(artifact.id, { prompt: event.target.value, summary: event.target.value.trim() ? event.target.value.trim().slice(0, 90) : "The shared starting point for this project." })} /></label>}
      {isGenerator && <>
        <div className="workflow-node-label">Connected inputs</div><InputAssets inputs={inputs} />
        <textarea className="workflow-node-prompt nodrag" rows={2} value={prompt} placeholder={inheritedPrompt || (artifact.tool === "image" ? "Describe the image…" : "Describe the shot…")} onChange={(event) => artifact.onPatch?.(artifact.id, { prompt: event.target.value })} />
        {artifact.tool === "image" && <label className="workflow-node-select"><span>Model</span><select className="nodrag" value={artifact.model || IMAGE_MODE} onChange={(event) => artifact.onPatch?.(artifact.id, { model: event.target.value })}><option value={IMAGE_MODE}>SOUL 2 · text to image</option><option value={MARKETING_IMAGE_MODE}>Marketing Studio · image input</option></select></label>}
        {artifact.tool === "image" && imageInputs.length > 0 && artifact.model !== MARKETING_IMAGE_MODE && <span className="workflow-node-hint">Choose Marketing Studio to use connected image references.</span>}
        <button className="workflow-node-action nodrag" disabled={!artifact.onGenerate || artifact.busy || artifact.noKeys || (!prompt.trim() && !inheritedPrompt)} onClick={() => artifact.onGenerate?.(artifact.id)}>{artifact.busy ? `${artifact.requestStatus || "Generating"}…` : artifact.noKeys ? "Live model not connected" : "Generate"} {!artifact.busy && !artifact.noKeys && <ArrowRight size={12} />}</button>
        {artifact.noKeys && <span className="workflow-node-hint">Connect a Higgsfield account for live generation.</span>}
        {artifact.status === "failed" && <span className="workflow-node-error">{artifact.summary}</span>}
        <OutputAsset artifact={artifact} />
      </>}
      {artifact.tool === "chat" && <><p>{artifact.summary}</p><OutputAsset artifact={artifact} /><button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route, inheritedPrompt)}>Open Chat with input <ArrowRight size={13} /></button></>}
      {isUnsupported && <>
        <label className="workflow-node-label">Input · prompt<textarea className="workflow-node-prompt nodrag" rows={2} value={prompt} placeholder={`Describe ${artifact.tool === "3d" ? "the 3D asset" : "the sound"}…`} onChange={(event) => artifact.onPatch?.(artifact.id, { prompt: event.target.value })} /></label>
        <span className="workflow-node-hint">No live {artifact.tool === "3d" ? "3D" : "audio"} model is available in the connected Higgsfield catalog.</span>
        <button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route, prompt || inheritedPrompt)}>Open {artifact.tool === "3d" ? "3D" : "Audio"} composer <ArrowRight size={13} /></button>
      </>}
      {artifact.tool === "editor" && <><p>{artifact.summary}</p><InputAssets inputs={inputs} />{editorInput?.outputUrl && <button className="workflow-node-action" onClick={() => artifact.onSendEditor?.(editorInput.outputUrl!, editorInput.outputKind as "image" | "video")}>Send connected asset to Editor <ArrowRight size={12} /></button>}<button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route)}>Open Editor <ArrowRight size={13} /></button></>}
      {!isGenerator && !isUnsupported && artifact.tool !== "brief" && artifact.tool !== "chat" && artifact.tool !== "editor" && <><p>{artifact.summary}</p><OutputAsset artifact={artifact} /><button className="workspace-node-open" onClick={() => artifact.onOpen?.(artifact.route)}>Open {artifact.title} <ArrowRight size={13} /></button></>}
      <span className="workflow-node-output-label">Output · {out}</span>
      <Handle id={`output-${out.replaceAll(" / ", "-")}`} type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { artifact: ArtifactNode };

function ArtifactDetailsModal({ artifact, onClose, onSave, onSendEditor, saving, error }: {
  artifact: WorkspaceArtifact & { inputs: WorkspaceArtifact[] };
  onClose: () => void;
  onSave: () => void;
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
  const hasVisualAsset = Boolean(artifact.outputUrl && (mediaKind === "image" || mediaKind === "video"));
  return <div className="workflow-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`workflow-modal workflow-modal-${artifact.tool}`} role="dialog" aria-modal="true" aria-label={`${artifact.title} details`}>
      <header className="workflow-modal-head"><div><span className="workflow-modal-kicker">{artifact.tool === "3d" ? "3D asset" : artifact.tool} · {artifact.status}</span><h2>{artifact.outputKind ? `${artifact.outputKind[0].toUpperCase()}${artifact.outputKind.slice(1)} output` : artifact.title}</h2></div><button onClick={onClose} aria-label="Close details">Close</button></header>
      <div className="workflow-modal-body">
        {artifact.outputUrl && mediaKind === "image" && <img className="workflow-modal-media" src={artifact.outputUrl} alt={artifact.title} />}
        {artifact.outputUrl && mediaKind === "video" && <video className="workflow-modal-media" src={artifact.outputUrl} controls playsInline />}
        {artifact.outputUrl && mediaKind === "audio" && <audio className="workflow-modal-audio" src={artifact.outputUrl} controls />}
        {!artifact.outputUrl && <div className="workflow-modal-empty"><span>{artifact.tool === "image" ? <ImageIc size={24} /> : artifact.tool === "video" ? <VideoIc size={24} /> : artifact.tool === "audio" ? <Music size={24} /> : artifact.tool === "3d" ? <Cube size={24} /> : <Film size={24} />}</span><strong>{artifact.tool === "audio" || artifact.tool === "3d" ? "Live model unavailable" : "No output yet"}</strong><p>{artifact.summary}</p></div>}
        <dl className="workflow-modal-info"><div><dt>Node</dt><dd>{artifact.title}</dd></div>{artifact.model && <div><dt>Model</dt><dd>{artifact.model}</dd></div>}{artifact.outputKind && <div><dt>Asset type</dt><dd>{artifact.outputKind}</dd></div>}<div><dt>State</dt><dd>{artifact.status}</dd></div><div className="workflow-modal-prompt"><dt>Prompt</dt><dd>{artifact.prompt || "No prompt saved on this node."}</dd></div>{artifact.inputs.length > 0 && <div><dt>Connected inputs</dt><dd>{artifact.inputs.map((input) => `${input.title} · ${input.outputKind || "text"}`).join(", ")}</dd></div>}</dl>
      </div>
      {error && <p className="workflow-modal-error" role="alert">{error}</p>}
      <footer className="workflow-modal-actions">{hasVisualAsset && <button className="workflow-modal-save" onClick={onSave} disabled={saving}>{saving ? "Saving…" : `Save ${mediaKind}`}</button>}{artifact.outputUrl && (mediaKind === "image" || mediaKind === "video") && <button onClick={() => onSendEditor(artifact.outputUrl!, mediaKind)}>Send to Editor</button>}<button onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

function FitOnResize({ selectedId, nodeCount }: { selectedId: string; nodeCount: number }) {
  const { fitView, getNode } = useReactFlow<WorkspaceNode>();
  useEffect(() => {
    const fit = () => requestAnimationFrame(() => {
      if (window.innerWidth <= 768) {
        const selected = getNode(selectedId);
        fitView({ nodes: selected ? [selected] : undefined, padding: 0.25, minZoom: 0.7, maxZoom: 1 });
      } else fitView({ padding: 0.02, minZoom: 0.25, maxZoom: 1.35 });
    });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fitView, getNode, nodeCount, selectedId]);
  return null;
}

export default function Workspace() {
  const navigate = useNavigate();
  const openArtifact = useCallback((route: string, prompt?: string) => {
    if (prompt?.trim()) navigate(route, { state: { workspacePrompt: prompt } });
    else navigate(route);
  }, [navigate]);
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>(() => readWorkspaceArtifacts());
  const artifactsRef = useRef(artifacts);
  const [projects, setProjects] = useState(() => listWorkspaceProjects());
  const [activeId, setActiveId] = useState(() => activeWorkspaceProjectId());
  const [selectedId, setSelectedId] = useState("brief");
  const [title, setTitle] = useState(() => localStorage.getItem("field-workspace-title") || "Untitled project");
  const [addOpen, setAddOpen] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [detailsId, setDetailsId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [initialEdges] = useState<WorkspaceConnection[] | null>(() => readWorkspaceEdges());
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkspaceNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges === null ? EMPTY_EDGES : initialEdges as Edge[]);

  useEffect(() => { artifactsRef.current = artifacts; }, [artifacts]);

  const patchArtifact = useCallback((id: string, patch: Partial<WorkspaceArtifact>) => {
    const next = artifactsRef.current.map((artifact) => artifact.id === id ? { ...artifact, ...patch, updatedAt: new Date().toISOString() } : artifact);
    artifactsRef.current = next;
    setArtifacts(next);
    saveWorkspaceArtifacts(next);
  }, []);

  const sendToEditor = useCallback((url: string, kind: "image" | "video") => {
    setPending(url, kind);
    navigate("/editor");
  }, [navigate]);

  const runGeneration = async (id: string) => {
    const artifact = artifactsRef.current.find((item) => item.id === id);
    if (!artifact || runningId || !hasKeys) return;
    const inputs = edges.filter((edge) => edge.target === id).map((edge) => artifactsRef.current.find((item) => item.id === edge.source)).filter((item): item is WorkspaceArtifact => Boolean(item));
    const prompt = artifact.prompt?.trim() || inputs.map((input) => input.prompt?.trim()).filter(Boolean).join("\n");
    if (!prompt) return;
    const imageInputs = inputs.filter((input) => input.outputKind === "image" && input.outputUrl).map((input) => input.outputUrl!);
    setRunningId(id);
    setRequestStatus("Queued");
    patchArtifact(id, { status: "active", summary: "Generation is running…" });
    try {
      const mode = artifact.tool === "image" ? artifact.model || (imageInputs.length ? MARKETING_IMAGE_MODE : IMAGE_MODE) : VIDEO_MODE;
      const body = artifact.tool === "image"
        ? mode === MARKETING_IMAGE_MODE
          ? { prompt, resolution: "2k", aspect_ratio: "16:9", quality: "medium", enhance_prompt: true, ...(imageInputs.length ? { image_urls: imageInputs } : {}) }
          : imageBody(prompt, { ratio: "16:9", resolution: "1080p" })
        : videoBody(prompt, { duration: 5, ratio: "16:9" });
      const output = await generate(mode, body, (status: GenStatus) => setRequestStatus(status === "in_progress" ? "Rendering" : status));
      patchArtifact(id, {
        status: "ready", summary: `${artifact.tool === "image" ? "Image" : "Video"} generated · ${prompt.slice(0, 72)}`,
        prompt, model: mode, outputUrl: output.url, outputKind: output.kind, outputSource: "generation",
      });
    } catch (error) {
      patchArtifact(id, { status: "failed", summary: error instanceof Error ? error.message : "Generation failed." });
    } finally {
      setRunningId("");
      setRequestStatus("");
    }
  };

  const openDetails = useCallback((id: string) => { setSaveError(""); setDetailsId(id); }, []);
  const closeDetails = useCallback(() => setDetailsId(""), []);
  const saveOutput = async (artifact: WorkspaceArtifact | undefined) => {
    if (!artifact?.outputUrl || !artifact.outputKind || (artifact.outputKind !== "image" && artifact.outputKind !== "video")) return;
    setSaving(true);
    setSaveError("");
    try {
      const url = new URL(artifact.outputUrl, window.location.origin);
      const source = url.hostname === "d28lhcrx5qdowv.cloudfront.net" ? `/hfblob${url.pathname}${url.search}` : artifact.outputUrl;
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const extension = url.pathname.match(/\.(png|jpe?g|webp|mp4|webm|svg)(?:$|\/)/i)?.[1] || blob.type.split("/").pop()?.replace("+xml", "") || (artifact.outputKind === "video" ? "mp4" : "png");
      const fileName = `${artifact.title.trim().replace(/[^a-z0-9_-]+/gi, "-") || artifact.outputKind}.${extension}`;
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
    const positions = readWorkspacePositions();
    const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    setNodes(artifacts.map((artifact) => {
      const inputs = edges.filter((edge) => edge.target === artifact.id).map((edge) => artifactById.get(edge.source)).filter((item): item is WorkspaceArtifact => Boolean(item));
      return nodeFromArtifact(artifact, {
        onOpen: openArtifact, onPatch: patchArtifact, onGenerate: runGeneration, onSendEditor: sendToEditor, onDetails: openDetails,
        busy: runningId === artifact.id, requestStatus, noKeys: !hasKeys,
      }, inputs, positions[artifact.id], artifact.id === selectedId);
    }));
  }, [artifacts, edges, openArtifact, openDetails, patchArtifact, requestStatus, runningId, selectedId, sendToEditor, setNodes]);

  useEffect(() => {
    if (nodes.length) saveWorkspacePositions(Object.fromEntries(nodes.map((node) => [node.id, node.position])) as WorkspacePositions);
  }, [nodes]);
  useEffect(() => { saveWorkspaceEdges(edges.map(({ id, source, target }) => ({ id, source, target }))); }, [edges]);

  const isValidConnection = useCallback((connection: Connection | Edge) => connectionFits(connection, artifactsRef.current), []);
  const handleConnect = useCallback((connection: Connection) => {
    if (connectionFits(connection, artifactsRef.current)) setEdges((current) => addEdge({ ...connection, type: "smoothstep" }, current));
  }, [setEdges]);

  const updateTitle = (value: string) => {
    setTitle(value);
    saveWorkspaceTitle(value);
    setProjects(listWorkspaceProjects());
  };

  const selectProject = (id: string) => {
    const project = openWorkspaceProject(id);
    if (!project) return;
    setActiveId(project.id);
    setProjects(listWorkspaceProjects());
    setTitle(project.title);
    setArtifacts(project.artifacts);
    artifactsRef.current = project.artifacts;
    setSelectedId(project.artifacts[0]?.id ?? "brief");
    setEdges(project.edges === undefined ? EMPTY_EDGES : project.edges as Edge[]);
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
    const artifact: WorkspaceArtifact = { id, tool: tool.tool, title: tool.title, summary: tool.description, route: tool.route, status: tool.tool === "image" || tool.tool === "video" ? "draft" : "empty", updatedAt: new Date().toISOString() };
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

  const refreshArtifacts = () => setArtifacts(readWorkspaceArtifacts());
  const detailArtifact = artifacts.find((artifact) => artifact.id === detailsId);
  const detailInputs = detailArtifact ? edges.filter((edge) => edge.target === detailArtifact.id).map((edge) => artifacts.find((artifact) => artifact.id === edge.source)).filter((artifact): artifact is WorkspaceArtifact => Boolean(artifact)) : [];

  return (
    <div className="app-scroll workspace-scroll"><div className="workspace-page">
      <div className="workspace-toolbar">
        <input aria-label="Project title" value={title} onChange={(event) => updateTitle(event.target.value)} />
        <div className="workspace-toolbar-right">
          {projects.length > 1 && <select aria-label="Open existing project" value="" onChange={(event) => selectProject(event.target.value)}><option value="">Open project</option>{projects.filter((project) => project.id !== activeId).map((project) => <option key={project.id} value={project.id}>{project.title || "Untitled project"}</option>)}</select>}
          <button className="workspace-ghost" onClick={refreshArtifacts}>Refresh</button><button className="workspace-reset" onClick={newProject}><Plus size={14} /> New project</button>
        </div>
      </div>
      <section className="workspace-canvas" aria-label="Project flow canvas">
        <div className="workspace-canvas-head"><span>Flow · connect nodes manually</span><button className="workspace-add-trigger" onClick={() => setAddOpen((open) => !open)}><Plus size={14} /> Add to flow</button></div>
        {addOpen && <div className="workspace-add-popover"><div className="workspace-inspector-label">Choose a step</div><div className="workspace-tool-list">{TOOLS.map((tool) => <button key={tool.tool} onClick={() => addTool(tool)}><span>{iconForTool(tool.tool)}</span><span><b>{tool.title}</b><small>{tool.description}</small></span><Plus size={14} /></button>)}</div></div>}
        <div className="workspace-flow"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={handleConnect} isValidConnection={isValidConnection} onNodeClick={(_, node) => setSelectedId(node.id)} fitView fitViewOptions={{ padding: 0.14 }} minZoom={0.25} maxZoom={1.35} colorMode="light"><Background gap={24} size={1} color="#d9ddd4" /><Controls showInteractive={false} /><FitOnResize selectedId={selectedId} nodeCount={nodes.length} /></ReactFlow></div>
      </section>
      {detailArtifact && <ArtifactDetailsModal artifact={{ ...detailArtifact, inputs: detailInputs }} onClose={closeDetails} onSave={() => saveOutput(detailArtifact)} onSendEditor={sendToEditor} saving={saving} error={saveError} />}
    </div></div>
  );
}
