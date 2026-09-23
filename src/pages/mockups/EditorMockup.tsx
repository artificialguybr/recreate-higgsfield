import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Editor from "../Editor";
import { deleteAsset, saveAsset } from "../../lib/assets";

const PROJECT_ID = "project-editor-mockup";
const IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=85";
const IMAGE_DETAIL = "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=85";
const VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const MOCK_CLIPS = [
  { id: "editor-mockup-image", kind: "image", src: IMAGE, name: "Product still", dur: 0, in: 0, out: 3, caption: "Make room for light." },
  { id: "editor-mockup-video", kind: "video", src: VIDEO, name: "Golden-hour motion", dur: 5, in: 0, out: 5, speed: 1, volume: 0.9, fit: "cover", caption: "A quieter kind of launch." },
  { id: "editor-mockup-detail", kind: "image", src: IMAGE_DETAIL, name: "Editorial detail", dur: 0, in: 0, out: 3 },
] as const;

const MOCK_MESSAGES = [
  { role: "ai", text: "I’ve set up the first cut with the hero still, the golden-hour motion shot, and an editorial detail." },
  { role: "user", text: "Slow the final reveal down and keep the caption restrained." },
  { role: "ai", text: "Done — the motion shot is ready with a quieter title treatment. You can still undo this edit." },
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
];

function seedStorage() {
  localStorage.setItem("field-workspace-active-project", PROJECT_ID);
  localStorage.setItem("field-workspace-title", "Spring launch · first cut");
  localStorage.setItem("field-workspace-artifacts", "[]");
  localStorage.setItem("field-workspace-projects", JSON.stringify([{ id: PROJECT_ID, title: "Spring launch · first cut", artifacts: [], positions: {}, edges: [] }]));
  localStorage.setItem(`field-editor-project:${PROJECT_ID}`, JSON.stringify({ clips: MOCK_CLIPS, t: 4.2, name: "Spring launch · first cut" }));
  localStorage.setItem(`field-agent-chat:${PROJECT_ID}`, JSON.stringify(MOCK_MESSAGES));
  localStorage.setItem(`field-chat:${PROJECT_ID}`, JSON.stringify(MOCK_MESSAGES));
}

function restoreStorage(snapshot: Record<string, string | null>) {
  for (const key of STORAGE_KEYS) {
    const value = snapshot[key];
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

export default function EditorMockup() {
  const [searchParams] = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const snapshot = Object.fromEntries(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]));
    if (!sessionStorage.getItem("field-mockup-restore")) sessionStorage.setItem("field-mockup-restore", JSON.stringify(snapshot));
    const assetIds: string[] = [];
    let live = true;
    seedStorage();
    void Promise.allSettled([
      saveAsset({ url: IMAGE, kind: "image", name: "Product still", source: "generation" }),
      saveAsset({ url: VIDEO, kind: "video", name: "Golden-hour motion", source: "generation" }),
      saveAsset({ url: IMAGE_DETAIL, kind: "image", name: "Editorial detail", source: "generation" }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        if (live) assetIds.push(result.value.id);
        else void deleteAsset(result.value.id).catch(() => {});
      }
      if (live) setReady(true);
    });

    return () => {
      live = false;
      restoreStorage(snapshot);
      void Promise.all(assetIds.map((id) => deleteAsset(id).catch(() => {})));
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.querySelector<HTMLButtonElement>('[aria-label="Toggle editor chat"]')?.click();
    const timer = window.setInterval(() => {
      const videoClip = Array.from(document.querySelectorAll<HTMLElement>(".tl-clip")).find((clip) => clip.textContent?.includes("Golden-hour motion"));
      if (!videoClip) return;
      videoClip.click();
      window.clearInterval(timer);
      window.clearTimeout(stop);
    }, 50);
    const stop = window.setTimeout(() => window.clearInterval(timer), 2000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [ready]);

  if (searchParams.get("mockup") !== "1") return <Navigate replace to="?mockup=1" />;
  if (!ready) return null;
  return <div style={{ width: "100%", height: "100%", display: "flex" }}><Editor /></div>;
}
