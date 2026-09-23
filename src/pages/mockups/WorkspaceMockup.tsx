import "./MockupScreens.css";
import { useEffect, useState } from "react";
import Workspace from "../Workspace";
import type { WorkspaceArtifact, WorkspaceConnection, WorkspacePositions, WorkspaceProject } from "../../lib/workspace";

const MOCK_PROJECT_ID = "mockup-workspace";
const IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=85";
const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const MOCK_ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: "brief",
    tool: "brief",
    title: "Solstice launch brief",
    summary: "A restrained spring campaign for a sculptural glass fragrance bottle.",
    route: "/",
    status: "ready",
    updatedAt: "just now",
    prompt: "Create a quiet 9:16 launch story for a sculptural glass fragrance bottle in late afternoon light.",
  },
  {
    id: "chat",
    tool: "chat",
    title: "Field Agent direction",
    summary: "Direction approved · 6 prompts · editorial pacing",
    route: "/chat",
    status: "ready",
    updatedAt: "just now",
    prompt: "Keep the camera close, the movement slow, and the final frame generous with negative space.",
  },
  {
    id: "launch",
    tool: "launch",
    title: "Solstice launch video",
    summary: "Approved plan · 5 beats · ready to edit",
    route: "/launch",
    status: "ready",
    updatedAt: "just now",
    prompt: "A glass fragrance bottle catches the last warm light of day as the camera makes one precise, quiet move.",
    outputUrl: VIDEO,
    outputKind: "video",
    outputSource: "catalog",
  },
  {
    id: "image",
    tool: "image",
    title: "Marketing Studio still",
    summary: "4:3 · 2k · product still ready",
    route: "/image",
    status: "ready",
    updatedAt: "just now",
    model: "marketing-studio/image",
    prompt: "Sculptural glass fragrance bottle on warm limestone, soft shadows, restrained editorial product photography.",
    outputUrl: IMAGE,
    outputKind: "image",
    outputSource: "catalog",
  },
  {
    id: "video",
    tool: "video",
    title: "Kling 3.0 motion study",
    summary: "9:16 · 5 seconds · motion output ready",
    route: "/video",
    status: "ready",
    updatedAt: "just now",
    model: "kling-video/v3.0/std/text-to-video",
    prompt: "A slow editorial camera move through warm evening light around a translucent fragrance bottle.",
    outputUrl: VIDEO,
    outputKind: "video",
    outputSource: "catalog",
  },
  {
    id: "studio",
    tool: "studio",
    title: "Cinema Studio treatment",
    summary: "Product still and motion study connected",
    route: "/studio",
    status: "ready",
    updatedAt: "just now",
    prompt: "Shape a quiet hero reveal with a measured studio camera move and an unhurried final hold.",
  },
  {
    id: "editor",
    tool: "editor",
    title: "Solstice · first cut",
    summary: "1 still + 1 motion output · 0:11 timeline · ready to cut",
    route: "/editor",
    status: "ready",
    updatedAt: "just now",
  },
];

const MOCK_EDGES: WorkspaceConnection[] = [
  { id: "xy-edge__brief-chat", source: "brief", target: "chat", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__brief-launch", source: "brief", target: "launch", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__chat-image", source: "chat", target: "image", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__chat-video", source: "chat", target: "video", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__image-studio", source: "image", target: "studio", sourceHandle: "out:image", targetHandle: "in:image" },
  { id: "xy-edge__video-studio", source: "video", target: "studio", sourceHandle: "out:video", targetHandle: "in:video" },
  { id: "xy-edge__image-editor", source: "image", target: "editor", sourceHandle: "out:image", targetHandle: "in:image" },
  { id: "xy-edge__launch-editor", source: "launch", target: "editor", sourceHandle: "out:video", targetHandle: "in:video" },
];

const MOCK_POSITIONS: WorkspacePositions = {
  brief: { x: 30, y: 20 },
  chat: { x: 340, y: 20 },
  launch: { x: 650, y: 20 },
  image: { x: 960, y: 20 },
  video: { x: 30, y: 600 },
  stock: { x: 340, y: 600 },
  studio: { x: 650, y: 600 },
  editor: { x: 960, y: 600 },
};

const STORAGE_KEYS = [
  "field-workspace-active-project",
  "field-workspace-title",
  "field-workspace-artifacts",
  "field-workspace-positions",
  "field-workspace-edges",
  "field-workspace-projects",
];

function seedMockupState() {
  const project: WorkspaceProject = {
    id: MOCK_PROJECT_ID,
    title: "Solstice / Spring campaign",
    artifacts: MOCK_ARTIFACTS,
    positions: MOCK_POSITIONS,
    edges: MOCK_EDGES,
  };
  localStorage.setItem("field-workspace-active-project", MOCK_PROJECT_ID);
  localStorage.setItem("field-workspace-title", project.title);
  localStorage.setItem("field-workspace-artifacts", JSON.stringify(MOCK_ARTIFACTS));
  localStorage.setItem("field-workspace-positions", JSON.stringify(MOCK_POSITIONS));
  localStorage.setItem("field-workspace-edges", JSON.stringify(MOCK_EDGES));
  localStorage.setItem("field-workspace-projects", JSON.stringify([project]));
}

function restoreState(snapshot: Record<string, string | null>) {
  for (const key of STORAGE_KEYS) {
    const value = snapshot[key];
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

export default function WorkspaceMockup() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const snapshot = Object.fromEntries(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    if (!sessionStorage.getItem("field-mockup-restore")) sessionStorage.setItem("field-mockup-restore", JSON.stringify(snapshot));
    seedMockupState();
    setReady(true);
    return () => restoreState(snapshot);
  }, []);
  if (!ready) return <div className="app-scroll workspace-scroll mockup-workspace-shell"><div className="workspace-page">Preparing workspace mockup…</div></div>;
  return <div className="mockup-workspace-shell"><Workspace /></div>;
}
