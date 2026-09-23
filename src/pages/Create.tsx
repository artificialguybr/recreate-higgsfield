import Composer from "../components/Composer";
import { ImageIc, VideoIc, Music, Cube } from "../components/Icons";
import { hasKeys } from "../lib/hf";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const meta: Record<string, { title: string; sub: string; model: string; icon: ReactNode }> = {
  Image: { title: "Image", sub: "Turn an idea into a still — photoreal, poster, or product.", model: "Marketing Studio Image", icon: <ImageIc size={15} /> },
  Video: { title: "Video", sub: "A sentence becomes a shot. Refine it in the editor.", model: "Kling 3.0", icon: <VideoIc size={15} /> },
  Audio: { title: "Audio", sub: "Shape a soundtrack or voice from a description.", model: "Seed Audio 1.0", icon: <Music size={15} /> },
  "3D": { title: "3D", sub: "Prompt a scene, block out props, and set the camera.", model: "Field 3D", icon: <Cube size={15} /> },
};

export default function Create({ mode }: { mode: "Image" | "Video" | "Audio" | "3D" }) {
  const m = meta[mode];
  const location = useLocation();
  const workspacePrompt = (location.state as { workspacePrompt?: string } | null)?.workspacePrompt ?? "";
  const model = m.model === "Demo" || hasKeys || mode === "Audio" || mode === "3D" ? m.model : `${m.model} · demo`;
  return (
    <div className="app-scroll">
      <div className="page direct-create">
        <div className="direct-create-icon">{m.icon}</div>
        <h1 className="page-title">{m.title}</h1>
        <p className="page-sub">{m.sub}</p>
        <Composer model={model} initialMode={mode} prompt={workspacePrompt || undefined} />
      </div>
    </div>
  );
}
