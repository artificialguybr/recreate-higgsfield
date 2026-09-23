import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Composer from "../components/Composer";

type Surface = "create" | "effects" | "studio";
type HomeProps = { initialSurface?: Surface };

const EFFECTS = [
  { label: "ReLight", prompt: "Re-light the scene with warm evening light, soft shadows, and a cinematic finish" },
  { label: "Inpaint", prompt: "Refine the composition with a cleaner background and a more intentional subject" },
  { label: "Edit text", prompt: "Replace the typography with a restrained editorial wordmark and balanced spacing" },
  { label: "Motion", prompt: "Create a subtle camera push-in with natural movement and a premium film texture" },
];

const STUDIO_SHOTS = [
  "Slow dolly through a quiet architectural space",
  "Hero product reveal with a precise studio camera move",
  "Editorial close-up with soft practical light and depth",
];

function surfaceTitle(surface: Surface) {
  if (surface === "effects") return "Shape an image.";
  if (surface === "studio") return "Set the shot.";
  return "Yours to create.";
}

function surfaceKicker(surface: Surface) {
  if (surface === "effects") return "Effects / image treatment";
  if (surface === "studio") return "Studio / direction";
  return "Create / first take";
}

function surfaceModel(surface: Surface) {
  return surface === "studio" ? "Cinema Studio 4.0" : "SOUL 2";
}

function surfaceMode(surface: Surface) {
  return surface === "studio" ? "Video" as const : "Image" as const;
}

function surfacePlaceholder(surface: Surface) {
  if (surface === "effects") return "Describe the image you want to reshape…";
  if (surface === "studio") return "Describe the shot, movement, and feeling…";
  return "Describe what you want to make…";
}

export default function Home({ initialSurface = "create" }: HomeProps) {
  const navigate = useNavigate();
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [prompt, setPrompt] = useState("");

  return (
    <div className="app-scroll">
      <div className="create-hub create-centered">
        <header className="hub-head hub-head-quiet">
          <div className="hub-eyebrow"><span className="hub-dot" /> {surfaceKicker(surface)}</div>
          <div className="hub-tools">
            <button className={surface === "effects" ? "on" : ""} onClick={() => setSurface("effects")}>Effects</button>
            <button className={surface === "studio" ? "on" : ""} onClick={() => setSurface("studio")}>Studio</button>
            <button className="hub-workspace" onClick={() => navigate("/workspace")}>Workspace <span>↗</span></button>
          </div>
        </header>

        <main className={`creation-card surface-${surface}`}>
          <div className="creation-card-head creation-card-head-centered">
            <div><h1>{surfaceTitle(surface)}</h1><p>One prompt. A clear first take.</p></div>
          </div>

          {surface === "effects" && <div className="creation-presets">{EFFECTS.map((effect) => <button key={effect.label} className={prompt === effect.prompt ? "on" : ""} onClick={() => setPrompt(effect.prompt)}><strong>{effect.label}</strong><span>{effect.prompt}</span></button>)}</div>}
          {surface === "studio" && <div className="studio-prompts">{STUDIO_SHOTS.map((shot) => <button key={shot} className={prompt === shot ? "on" : ""} onClick={() => setPrompt(shot)}>{shot}<span>↗</span></button>)}</div>}

          <Composer
            key={surface}
            model={surfaceModel(surface)}
            initialMode={surfaceMode(surface)}
            prompt={prompt}
            onPrompt={setPrompt}
            placeholder={surfacePlaceholder(surface)}
          />
        </main>

        <div className="hub-utility"><button onClick={() => navigate("/workspace")}>Workspace ↗</button><i>·</i><button onClick={() => navigate("/editor")}>Editor ↗</button></div>
      </div>
    </div>
  );
}
