import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Spark, ArrowUp, ImageIc, VideoIc, Film } from "../components/Icons";
import {
  fetchFeed,
  generate,
  hasKeys,
  IMAGE_MODE,
  VIDEO_MODE,
  imageBody,
  videoBody,
  type FeedModel,
} from "../lib/hf";
import { setPending } from "../lib/transfer";
import { activeWorkspaceProjectId, upsertWorkspaceArtifact } from "../lib/workspace";
import TimelineAgent from "../components/TimelineAgent";

type Mode = "image" | "video";
type Media = { url: string; kind: "image" | "video"; title: string; note?: "catalog" };
type Msg = { who: "user" | "ai"; tx: string; mode?: Mode; media?: Media; working?: boolean };

const IDEAS: { label: string; prompt: string; mode: Mode }[] = [
  { label: "Product shot", prompt: "Studio product shot of a ceramic watch, soft key light, dark background", mode: "image" },
  { label: "Editorial portrait", prompt: "Editorial portrait, dramatic rim light, 85mm, shallow depth of field", mode: "image" },
  { label: "Storyboard", prompt: "Storyboard of a heist film, one panel per shot, film grain, muted palette", mode: "image" },
  { label: "Slow push-in", prompt: "Cinematic slow push-in on a lone figure in a vast foggy landscape", mode: "video" },
  { label: "Neon reel", prompt: "Vertical reel, fast cuts, neon city at night, rain reflections, energetic", mode: "video" },
  { label: "Space timelapse", prompt: "Timelapse of a nebula forming, deep space, drifting stars, 35mm film", mode: "video" },
];

export default function Supercomputer() {
  const location = useLocation();
  const nav = useNavigate();
  const chatKey = useRef(`field-chat:${activeWorkspaceProjectId()}`).current;
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(chatKey) ?? "[]") as Msg[];
      return Array.isArray(saved) ? saved.filter((msg) => msg && (msg.who === "user" || msg.who === "ai") && typeof msg.tx === "string" && !msg.working) : [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [surface, setSurface] = useState<"create" | "edit">("create");
  const [val, setVal] = useState("");
  const [model, setModel] = useState<Mode>("image");
  const [sugs, setSugs] = useState<FeedModel[]>([]);
  const [n, setN] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastUser = [...msgs].reverse().find((msg) => msg.who === "user");

  useEffect(() => {
    let on = true;
    fetchFeed(1, 12).then((r) => on && setSugs(r)).catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  useEffect(() => {
    const workspacePrompt = (location.state as { workspacePrompt?: string } | null)?.workspacePrompt;
    if (workspacePrompt) setVal(workspacePrompt);
  }, [location.key]);
  useEffect(() => {
    const messages = msgs[msgs.length - 1]?.working ? msgs.slice(0, -2) : msgs;
    try {
      localStorage.setItem(chatKey, JSON.stringify(messages));
    } catch {
      /* Storage is optional; generation remains available. */
    }
  }, [chatKey, msgs]);

  useEffect(() => {
    const thread = endRef.current?.parentElement;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = (raw?: string, m?: Mode) => {
    const tx = (raw ?? val).trim();
    if (!tx || busy) return;
    const mode = m ?? model;
    setVal("");
    if (taRef.current) taRef.current.style.height = "auto";
    setMsgs((ms) => [
      ...ms,
      { who: "user", tx, mode },
      { who: "ai", working: true, tx: mode === "image" ? "Generating with SOUL 2" : "Generating with Kling 3.0" },
    ]);
    setBusy(true);

    const done = (media: Media | undefined, reply: string) => {
      setMsgs((ms) => {
        const c = [...ms];
        c[c.length - 1] = { who: "ai", tx: reply, media };
        return c;
      });
      upsertWorkspaceArtifact({
        id: "chat",
        tool: "chat",
        title: media?.title || "Field Chat",
        summary: media ? `${media.note ? "Catalog preview" : "Generated"} ${media.kind} ready to send to Editor.` : reply.slice(0, 100),
        route: "/chat",
        status: "ready",
        prompt: tx,
        outputUrl: media?.url,
        outputKind: media?.kind,
        outputSource: media?.note ? "catalog" : "generation",
      });
      setBusy(false);
    };

    const fallback = (why: string) => {
      const s = sugs[n % sugs.length];
      setN((k) => k + 1);
      if (s) {
        done(
          { url: s.video ?? s.thumb!, kind: s.video ? "video" : "image", title: s.title, note: "catalog" },
          `${why} Here's a catalog pick in the spirit of "${tx}".`
        );
      } else {
        done(undefined, `${why} The catalog isn't loaded yet — try again in a second.`);
      }
    };

    if (hasKeys) {
      void (async () => {
        try {
          const g =
            mode === "image"
              ? await generate(IMAGE_MODE, imageBody(tx, { ratio: "16:9", resolution: "1080p" }))
              : await generate(VIDEO_MODE, videoBody(tx, { duration: 5, ratio: "16:9" }));
          done(
            { url: g.url, kind: g.kind === "audio" ? "image" : g.kind, title: mode === "image" ? "SOUL 2" : "Kling 3.0" },
            `First take on "${tx}".`
          );
        } catch (e) {
          fallback(`Generation failed (${e instanceof Error ? e.message : "error"}).`);
        }
      })();
    } else {
      setTimeout(() => fallback("Live generation isn't configured on this server."), 900);
    }
  };

  const toEditor = (m: Media) => {
    setPending(m.url, m.kind);
    nav("/editor");
  };

  const newChat = () => {
    setMsgs([]);
    setN(0);
    setVal("");
  };

  return (
    <div className="studio">
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-mark">
            <Spark size={13} />
          </span>
          <b>Field Chat</b>
        </div>
        <button className="rail-item active" onClick={newChat}>
          <Plus size={15} /> New chat
        </button>
        <button className="rail-item" onClick={() => nav("/workspace")}>
          <Spark size={15} /> Project workspace
        </button>
        <div className="rail-foot">
          <a className="rail-upgrade" href="/pricing">
            <div className="ru-t">Go Unlimited</div>
            <div className="ru-d">No caps. Every model, every day.</div>
            <span className="ru-cta">See pricing</span>
          </a>
        </div>
      </aside>
      <div className="studio-canvas">
        <div className="chat-mode-tabs" role="tablist" aria-label="Chat workspace">
          <button role="tab" aria-selected={surface === "create"} className={surface === "create" ? "on" : ""} onClick={() => setSurface("create")}>Create</button>
          <button role="tab" aria-selected={surface === "edit"} className={surface === "edit" ? "on" : ""} onClick={() => setSurface("edit")}>Edit timeline</button>
        </div>
        {surface === "edit" ? <TimelineAgent /> : (
        <div className="chat-wrap">
          <div className={`c2-main${msgs.length ? " has-thread" : ""}`}>
            {msgs.length === 0 ? (
              <div className="c2-hero">
                <div className="chat-greeting">What are we making?</div>
                <p className="c2-greet-sub">One prompt — image or video. Pick an idea, or write your own.</p>
                <div className="c2-ideas">
                  {IDEAS.map((i) => (
                    <button key={i.label} className="chip" onClick={() => send(i.prompt, i.mode)}>
                      {i.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="chat-thread">
                {msgs.map((m, i) => (
                  <div key={i}>
                    {m.working ? (
                      <div className="bubble ai c2-working">
                        <span className="ring small" />
                        <span className="cap">{m.tx}</span>
                      </div>
                    ) : (
                      <div className={`bubble ${m.who}${m.media ? " has-media" : ""}`}>
                        {m.who === "user" ? m.tx : !m.media && m.tx}
                        {m.media && (
                          <>
                            <div className="c2-media">
                              {m.media.kind === "video" ? (
                                <video src={m.media.url} muted loop playsInline autoPlay />
                              ) : (
                                <img src={m.media.url} alt={m.tx} />
                              )}
                            </div>
                            <div className="c2-actions">
                              <span className="c2-src">
                                {m.media.note === "catalog" ? "catalog" : "generated"} · {m.media.title}
                              </span>
                              <span className="spacer" />
                              <button className="chip" onClick={() => toEditor(m.media!)}>
                                <Film size={13} /> Editor
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {m.who === "ai" && !m.working && i === msgs.length - 1 && !busy && (
                      <div className="follows">
                        {lastUser && (
                          <button className="chip" onClick={() => send(lastUser!.tx, lastUser!.mode)}>
                            Regenerate
                          </button>
                        )}
                        <button className="chip" onClick={() => send(`${lastUser?.tx ?? ""} — darker and more dramatic`, lastUser?.mode)}>
                          Darker & dramatic
                        </button>
                        <button className="chip" onClick={() => send(`${lastUser?.tx ?? ""} — wide angle, more room`, lastUser?.mode)}>
                          Wide angle
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="c2-sticky">
            <div className="device">
              <div className="device-modes">
                <button className={`mode-btn ${model === "image" ? "on" : ""}`} onClick={() => setModel("image")}>
                  <ImageIc size={14} /> Image
                </button>
                <button className={`mode-btn ${model === "video" ? "on" : ""}`} onClick={() => setModel("video")}>
                  <VideoIc size={14} /> Video
                </button>
                <span className="model-tag">
                  <Spark size={13} /> {model === "image" ? "SOUL 2" : "Kling 3.0"}
                </span>
              </div>
              <textarea
                ref={taRef}
                className="device-input"
                rows={1}
                autoFocus
                value={val}
                placeholder={model === "image" ? "Describe the image…" : "Describe the video…"}
                onChange={(e) => {
                  setVal(e.target.value);
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = t.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="device-bar">
                <span className="spacer" />
                <button className="send" onClick={() => send()} disabled={busy || !val.trim()} aria-label="Generate">
                  {busy ? <span className="ring" /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
