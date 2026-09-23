import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import TimelineAgent from "../../components/TimelineAgent";

const IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=85";
const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const DETAIL = "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=85";

const PROJECT_ID = "chat-mockup-project";
const ARCHIVE_PROJECT_ID = "chat-mockup-archive";
const MOCK_CLIPS = [
  { id: "chat-mockup-still", kind: "image", src: IMAGE, name: "Product still", dur: 0, in: 0, out: 3, caption: "Make room for light." },
  { id: "chat-mockup-motion", kind: "video", src: VIDEO, name: "Last light motion", dur: 5, in: 0, out: 5, caption: "A quieter kind of launch." },
  { id: "chat-mockup-detail", kind: "image", src: DETAIL, name: "Editorial detail", dur: 0, in: 0, out: 3 },
];
const MOCK_ARTIFACTS = [
  { id: "brief", tool: "brief", title: "Spring launch brief", summary: "A restrained product launch for a new glass fragrance.", route: "/", status: "ready", updatedAt: "now", prompt: "Create a quiet 9:16 spring launch for a glass fragrance bottle." },
  { id: "chat", tool: "chat", title: "Field Agent", summary: "6 prompts · direction approved", route: "/chat", status: "ready", updatedAt: "now", prompt: "Turn the brief into a slower, more editorial final shot." },
  { id: "image", tool: "image", title: "Marketing Studio Image", summary: "4:3 · 2k · output ready", route: "/image", status: "ready", updatedAt: "now", model: "marketing-studio/image", outputUrl: IMAGE, outputKind: "image", outputSource: "catalog", prompt: "A sculptural glass perfume bottle on warm limestone." },
  { id: "video", tool: "video", title: "Kling 3.0", summary: "9:16 · 5 seconds · output ready", route: "/video", status: "ready", updatedAt: "now", model: "kling-video/v3.0/std/text-to-video", outputUrl: VIDEO, outputKind: "video", outputSource: "catalog", prompt: "A slow editorial camera move through warm evening light." },
  { id: "editor", tool: "editor", title: "Spring launch · first cut", summary: "3 clips · 0:11 timeline · captioned", route: "/editor", status: "ready", updatedAt: "now" },
];
const MOCK_EDGES = [
  { id: "xy-edge__brief-chat", source: "brief", target: "chat", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__chat-image", source: "chat", target: "image", sourceHandle: "out:prompt", targetHandle: "in:prompt" },
  { id: "xy-edge__image-editor", source: "image", target: "editor", sourceHandle: "out:image", targetHandle: "in:image" },
  { id: "xy-edge__video-editor", source: "video", target: "editor", sourceHandle: "out:video", targetHandle: "in:video" },
];
const MOCK_MESSAGES = [
  { role: "ai", text: "I have the spring launch brief and the current first cut. The timeline has three clips ready for a slower, more editorial finish." },
  { role: "user", text: "Make the final shot feel like the last light of the day. Keep it restrained and leave room for the bottle to breathe." },
  { role: "ai", text: "I prepared a generation proposal using Kling 3.0. The 9:16, 5-second pass is estimated at $0.48; nothing will render until you approve it.", proposal: { prompt: "A restrained glass fragrance bottle catching the last warm light of day, slow editorial camera move, soft limestone reflections, minimal composition.", kind: "video", ratio: "9:16", duration: 5, model: "kling-video/v3.0/std/text-to-video" } },
];
const ARCHIVE_MESSAGES = [
  { role: "user", text: "Can we make the first frame feel more tactile?" },
  { role: "ai", text: "Yes. I left the product still and the editorial detail in this earlier direction." },
];
const STORAGE_KEYS = [
  "field-workspace-active-project",
  "field-workspace-title",
  "field-workspace-artifacts",
  "field-workspace-positions",
  "field-workspace-edges",
  "field-workspace-projects",
  `field-editor-project:${PROJECT_ID}`,
  `field-agent-chat:${PROJECT_ID}`,
  `field-chat:${PROJECT_ID}`,
  `field-agent-chat:${ARCHIVE_PROJECT_ID}`,
  `field-editor-chat:${ARCHIVE_PROJECT_ID}`,
];

type Snapshot = Record<string, string | null>;

function seedMockupState() {
  localStorage.setItem("field-workspace-active-project", PROJECT_ID);
  localStorage.setItem("field-workspace-title", "Spring launch · final shot");
  localStorage.setItem("field-workspace-artifacts", JSON.stringify(MOCK_ARTIFACTS));
  localStorage.setItem("field-workspace-positions", JSON.stringify({ brief: { x: 40, y: 150 }, chat: { x: 350, y: 30 }, image: { x: 680, y: 30 }, video: { x: 680, y: 320 }, editor: { x: 1010, y: 170 } }));
  localStorage.setItem("field-workspace-edges", JSON.stringify(MOCK_EDGES));
  localStorage.setItem("field-workspace-projects", JSON.stringify([
    { id: PROJECT_ID, title: "Spring launch · final shot", artifacts: MOCK_ARTIFACTS, positions: {}, edges: MOCK_EDGES },
    { id: ARCHIVE_PROJECT_ID, title: "Spring launch · early direction", artifacts: [], positions: {}, edges: [] },
  ]));
  localStorage.setItem(`field-editor-project:${PROJECT_ID}`, JSON.stringify({ clips: MOCK_CLIPS, t: 4.3, name: "Spring launch · final shot" }));
  localStorage.setItem(`field-agent-chat:${PROJECT_ID}`, JSON.stringify(MOCK_MESSAGES));
  localStorage.setItem(`field-chat:${PROJECT_ID}`, JSON.stringify(MOCK_MESSAGES));
  localStorage.setItem(`field-agent-chat:${ARCHIVE_PROJECT_ID}`, JSON.stringify(ARCHIVE_MESSAGES));
  localStorage.setItem(`field-editor-chat:${ARCHIVE_PROJECT_ID}`, JSON.stringify(ARCHIVE_MESSAGES));
}

function restoreState(snapshot: Snapshot) {
  for (const key of STORAGE_KEYS) {
    const value = snapshot[key];
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

export default function ChatMockup() {
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const snapshot = useRef<Snapshot | null>(null);
  const isMockup = new URLSearchParams(location.search).get("mockup") === "1";

  useEffect(() => {
    snapshot.current = Object.fromEntries(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    if (!sessionStorage.getItem("field-mockup-restore")) sessionStorage.setItem("field-mockup-restore", JSON.stringify(snapshot.current));
    seedMockupState();
    return () => { if (snapshot.current) restoreState(snapshot.current); };
  }, []);

  useEffect(() => {
    if (!isMockup) {
      navigate(`${location.pathname}?mockup=1`, { replace: true });
      return;
    }
    setReady(true);
  }, [isMockup, location.pathname, navigate]);

  if (!ready) return <div style={{ flex: 1, display: "grid", placeItems: "center" }}>Preparing Agent mockup…</div>;
  return <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}><TimelineAgent /></div>;
}
