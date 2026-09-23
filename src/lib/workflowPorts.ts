import type { Connection, Edge } from "@xyflow/react";
import type { WorkspaceArtifact, WorkspaceConnection } from "./workspace";
import { VIDEO_MODE } from "./hf";
import { bodyForModel } from "./hfModels";

export type PortType = "text" | "image" | "video" | "audio" | "3d";
export type WorkflowPort = { id: string; label: string; type: PortType; multiple?: boolean; limit?: number };
export type ConnectedInput = { input: WorkflowPort; output: WorkflowPort; artifact: WorkspaceArtifact; ready: boolean };
export type WorkflowEdge = Edge | WorkspaceConnection;

export const MOTION_CONTROL_MODE = "kling-video/v3/motion-control/std";
 export const MOTION_TRANSFER_MODE = "higgsfiled/genjutsu/motion-transfer/v1.0";
export const AUDIO_MODE = "field/audio/seed-1";
export const THREE_MODE = "field/3d";
export const MARKETING_IMAGE_MODE = "marketing-studio/image";

export const PORT_COLORS: Record<PortType, string> = {
  text: "#d3a64b", image: "#748ee8", video: "#43a990", audio: "#dd8c43", "3d": "#aa77df",
};

export const NODE_COLORS: Record<WorkspaceArtifact["tool"], string> = {
  brief: "#8a929e", chat: "#796de2", launch: "#4989d5", studio: "#4d9bb0", editor: "#3da77d",
  export: "#258d6a", gallery: "#c18346", image: "#9a6bdd", video: "#428bd1", audio: "#d18a43", "3d": "#46a48b",
  "motion-control": "#d75e83", "motion-transfer": "#ba67c8", stock: "#2aa8a0",
};

const prompt: WorkflowPort = { id: "prompt", label: "Prompt", type: "text" };
const image: WorkflowPort = { id: "image", label: "Image", type: "image" };
const video: WorkflowPort = { id: "video", label: "Video", type: "video" };
const audio: WorkflowPort = { id: "audio", label: "Audio", type: "audio" };
const model3d: WorkflowPort = { id: "model", label: "3D model", type: "3d" };

export function inputPortsFor(artifact: WorkspaceArtifact): WorkflowPort[] {
  switch (artifact.tool) {
    case "stock":
    case "video": return [prompt];
    case "motion-control": return [prompt, { ...image, id: "character", label: "Character" }, { ...video, id: "motion", label: "Motion" }];
    case "motion-transfer": return [prompt, { ...image, id: "references", label: "Reference images", multiple: true, limit: 8 }, { ...video, id: "motion", label: "Motion video" }];
     case "audio": return [prompt];
    case "3d": return [prompt];
    case "chat":
    case "launch": return [prompt];
    case "studio": return [prompt, image, video];
    case "editor": return [image, video];
    case "export": return [video];
  }
  return [];
}

export function outputPortsFor(artifact: WorkspaceArtifact): WorkflowPort[] {
  switch (artifact.tool) {
    case "brief": return [prompt];
    case "gallery": return [image, video];
    case "image": return [image];
    case "video":
    case "motion-control":
    case "motion-transfer":
    case "stock":
    case "launch":
    case "export": return [video];
    case "audio": return [audio];
    case "3d": return [model3d];
    case "chat": return [prompt, image, video, audio];
    case "studio": return [image, video];
  }
  return [];
}

export function handleId(direction: "in" | "out", port: WorkflowPort): string {
  return `${direction}:${port.id}`;
}

function selectedPort(ports: WorkflowPort[], handle: string | null | undefined, direction: "in" | "out"): WorkflowPort[] {
  if (!handle) return ports;
  const prefix = `${direction}:`;
  return handle.startsWith(prefix) ? ports.filter((port) => port.id === handle.slice(prefix.length)) : [];
}

export function connectionPorts(
  connection: Connection | Edge | WorkspaceConnection,
  artifacts: WorkspaceArtifact[],
): { input: WorkflowPort; output: WorkflowPort } | null {
  const source = artifacts.find((item) => item.id === connection.source);
  const target = artifacts.find((item) => item.id === connection.target);
  if (!source || !target || source.id === target.id) return null;
  const outputs = selectedPort(outputPortsFor(source), connection.sourceHandle, "out");
  const inputs = selectedPort(inputPortsFor(target), connection.targetHandle, "in");
  for (const output of outputs) {
    const input = inputs.find((candidate) => candidate.type === output.type);
    if (input) return { input, output };
  }
  return null;
}

export function connectionFits(
  connection: Connection | Edge | WorkspaceConnection,
  artifacts: WorkspaceArtifact[],
  existing: WorkflowEdge[] = [],
): boolean {
  const ports = connectionPorts(connection, artifacts);
  if (!ports) return false;
  if (ports.input.multiple) {
    const connected = existing.filter((edge) => edge.target === connection.target && edge.targetHandle === handleId("in", ports.input));
    return connected.length < (ports.input.limit ?? Infinity);
  }
  return !existing.some((edge) => edge.target === connection.target && edge.targetHandle === handleId("in", ports.input));
}

export function normalizeConnections(edges: WorkflowEdge[], artifacts: WorkspaceArtifact[]): WorkspaceConnection[] {
  const normalized: WorkspaceConnection[] = [];
  for (const edge of edges) {
    const ports = connectionPorts(edge, artifacts);
    if (!ports) continue;
    const next = { ...edge, sourceHandle: handleId("out", ports.output), targetHandle: handleId("in", ports.input) };
    if (connectionFits(next, artifacts, normalized)) normalized.push(next);
  }
  return normalized;
}

function hasPublicUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

export function connectedInputsFor(target: WorkspaceArtifact, edges: WorkflowEdge[], artifacts: WorkspaceArtifact[]): ConnectedInput[] {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return edges.filter((edge) => edge.target === target.id).flatMap((edge) => {
    const artifact = byId.get(edge.source);
    const ports = connectionPorts(edge, artifacts);
    if (!artifact || !ports) return [];
    const ready = ports.output.type === "text"
      ? Boolean(artifact.prompt?.trim())
      : Boolean(artifact.outputUrl && artifact.outputKind === ports.output.type);
    return [{ ...ports, artifact, ready }];
  });
}

export function promptForNode(artifact: WorkspaceArtifact, inputs: ConnectedInput[]): string {
  return [artifact.prompt?.trim(), ...inputs.filter((item) => item.input.type === "text" && item.ready).map((item) => item.artifact.prompt?.trim())]
    .filter((value): value is string => Boolean(value)).join("\n");
}

export type GenerationPlan = { mode: string; body: Record<string, unknown>; prompt: string } | { error: string };

export function generationPlan(artifact: WorkspaceArtifact, inputs: ConnectedInput[]): GenerationPlan {
  const prompt = promptForNode(artifact, inputs);
  const media = (portId: string) => inputs.filter((item) => item.input.id === portId);
  const urls = (portId: string) => media(portId).filter((item) => item.ready).map((item) => item.artifact.outputUrl!);
  const waitFor = (portId: string) => media(portId).some((item) => !item.ready);
  const requirePublic = (portId: string, label: string): string[] | string => {
    const connected = media(portId);
    if (waitFor(portId)) return `Waiting for a ${label.toLowerCase()} output.`;
    const values = urls(portId);
    if (!values.length) return `Connect a ${label.toLowerCase()} input first.`;
    if (values.some((value) => !hasPublicUrl(value))) return `${label} inputs must be public HTTPS URLs.`;
    return values;
  };

  if (artifact.tool === "image") {
    if (!prompt) return { error: "Add a prompt or connect a text input." };
    const references = requirePublic("reference", "Reference image");
    if (typeof references === "string" && media("reference").length) return { error: references };
    const imageUrls = Array.isArray(references) ? references : [];
    const mode = artifact.model && !/soul/i.test(artifact.model) ? artifact.model : MARKETING_IMAGE_MODE;
    const body = bodyForModel(
      { mode, type: "image" },
      prompt,
      {
        ...artifact.parameters,
        aspect_ratio: artifact.parameters?.aspect_ratio ?? "16:9",
        resolution: artifact.parameters?.resolution ?? "2k",
        enhance_prompt: artifact.parameters?.enhance_prompt ?? false,
      },
      { imageUrls },
    );
    return { mode, prompt, body };
  }

  if (artifact.tool === "video" || artifact.tool === "motion-control" || artifact.tool === "motion-transfer") {
    const mode = artifact.model && artifact.model !== MARKETING_IMAGE_MODE && !artifact.model.includes("/image") ? artifact.model : VIDEO_MODE;
    if (!prompt) return { error: "Add a prompt or connect a text input." };
    if (artifact.tool === "video") {
      return {
        mode,
        prompt,
        body: bodyForModel(
          { mode, type: "video" },
          prompt,
          {
            ...artifact.parameters,
            duration: artifact.parameters?.duration ?? 5,
            aspect_ratio: artifact.parameters?.aspect_ratio ?? "16:9",
            resolution: artifact.parameters?.resolution ?? artifact.resolution ?? "720p",
            sound: artifact.parameters?.sound ?? "on",
            generate_audio: artifact.parameters?.generate_audio ?? true,
          },
        ),
      };
    }
  }


  if (artifact.tool === "motion-control") {
    const character = requirePublic("character", "Character image");
    const motion = requirePublic("motion", "Motion video");
    if (typeof character === "string") return { error: character };
    if (typeof motion === "string") return { error: motion };
    return {
      mode: artifact.model && artifact.model.includes("kling") && !artifact.model.includes("/image") ? artifact.model : MOTION_CONTROL_MODE,
      prompt,
      body: { image_url: character[0], video_url: motion[0], ...(prompt ? { prompt } : {}), keep_original_sound: "yes", character_orientation: "video" },
    };
  }
  if (artifact.tool === "motion-transfer") {
    if (!prompt) return { error: "Add a prompt or connect a text input." };
    const references = requirePublic("references", "Reference images");
    const motion = requirePublic("motion", "Motion video");
    if (typeof references === "string") return { error: references };
    if (typeof motion === "string") return { error: motion };
    if (references.length > 8) return { error: "Genjutsu accepts up to 8 reference images." };
    return {
      mode: artifact.model && !artifact.model.includes("/image") ? artifact.model : MOTION_TRANSFER_MODE,
      prompt,
      body: { prompt, video_url: motion[0], image_urls: references, resolution: artifact.resolution || "720p" },
  };

  }

  if (artifact.tool === "audio") {
    if (!prompt) return { error: "Add a prompt or connect a text input." };
    return { mode: artifact.model || AUDIO_MODE, prompt, body: { prompt } };
  }
  if (artifact.tool === "3d") {
    if (!prompt) return { error: "Add a prompt or connect a text input." };
    return { mode: artifact.model || THREE_MODE, prompt, body: { prompt, resolution: artifact.resolution || "1080p", mesh_quality: (artifact.parameters?.mesh_quality as string) || "high" } };
  }
  return { error: "This node has no live Higgsfield model." };
}
