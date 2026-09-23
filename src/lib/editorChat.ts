// Editor chat — a small command interpreter that edits through the same
// commit() the UI uses, so every chat edit is live on the timeline/preview
// and undoable with ⌘Z. No NLP: explicit verbs, honest replies.

import type { Clip } from "./editor";

export type ChatCtx = {
  target: () => Clip | null; // selected clip, else clip under the playhead
  clipsCount: () => number;
  patch: (id: string, p: Partial<Clip>) => void;
  commitFn: (fn: (cs: Clip[]) => Clip[]) => void;
  split: () => boolean;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  add: (kind: "image" | "video", name: string, url: string) => void;
  library: () => { url: string; kind: "image" | "video"; name: string }[];
  seek: (t: number) => void;
  totalDur: () => number;
  playhead: () => number;
  rename: (name: string) => void;
  export: () => void | string;
  generate: (prompt: string) => void;
  status: () => { n: number; dur: number; name: string; res: string; ratio: string };
};

export type ChatOut = { reply: string; changed?: boolean; followups?: string[] };

const HELP = `What I can do:
• split — cut the clip at the playhead
• speed 0.5× / slow down / speed up
• volume 50% / mute / louder / quieter
• mirror · fade · fit / fill
• caption "your title" · remove caption
• trim to 8s · duplicate · delete
• rename to "My Reel"
• add <asset> — from your library
• generate "prompt" — opens the generator
• go to 1:30 · start · end
• export · status · help`;

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function chatCommand(raw: string, ctx: ChatCtx): ChatOut {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const needClip = (msg: string) => ({ reply: msg, followups: ["help"] });

  // ---- project-level ----
  if (/^(status|summary|what('| i)?s this|report)\b/.test(text)) {
    const s = ctx.status();
    return {
      reply: `${s.n} clip${s.n === 1 ? "" : "s"} · ${Math.floor(s.dur / 60)}:${Math.floor(s.dur % 60).toString().padStart(2, "0")} · "${s.name}" · ${s.ratio} ${s.res}p`,
      followups: ["export", "help"],
    };
  }
  if (text === "help" || text === "?") return { reply: HELP };
  if (/^(export|render|render it|make the mp4|finish)\b/.test(text)) {
    if (!ctx.clipsCount()) return needClip("Nothing to export yet — add clips first.");
    const response = ctx.export();
    return { reply: typeof response === "string" ? response : "Exporting now — watch the progress in the top bar.", followups: ["status"] };
  }
  if (/^(clear|empty|new project|reset project)\b/.test(text)) {
    if (!ctx.clipsCount()) return { reply: "Already empty." };
    ctx.commitFn(() => []);
    return { reply: "Project cleared. ⌘Z brings it all back.", changed: true, followups: ["status"] };
  }
  if (/^rename (to|as) "?([^"]+)"?$/.test(text) || /^name (it )?"?([^"]+)"?$/.test(text)) {
    const m = text.match(/^rename (to|as) "?([^"]+)"?$/)?.[2] ?? text.match(/^name (it )?"?([^"]+)"?$/)?.[2];
    ctx.rename((m ?? "Untitled").slice(0, 40));
    return { reply: `Project renamed to "${m}". That's your export filename.`, changed: true, followups: ["export", "status"] };
  }

  // ---- transport ----
  const go = text.match(/^(?:go to|jump to|seek to|move to)\s+(\d{1,2}(?::\d{2})?|\d+(?:\.\d+)?)\s*s?$/);
  if (go) {
    const v = go[1]!;
    const t = v.includes(":") ? v.split(":").reduce((a, b) => a * 60 + Number(b), 0) : Number(v);
    ctx.seek(clamp(t, 0, ctx.totalDur()));
    return { reply: `Playhead at ${t}s.`, followups: ["split", "export"] };
  }
  if (text === "start") return (ctx.seek(0), { reply: "Back to start." });
  if (text === "end") return (ctx.seek(ctx.totalDur()), { reply: "At the end." });

  // ---- generate ----
  const gen = text.match(/^generate\s+"?([^"]+)"?$/);
  if (gen) {
    ctx.generate(gen[1]!.trim());
    return { reply: `Opening the generator with: "${gen[1]!.trim()}"`, followups: ["status"] };
  }

  // ---- library ----
  const addm = text.match(/^add\s+(?:the\s+)?(?:first\s+|last\s+)?(.+)$/);
  if (addm) {
    const lib = ctx.library();
    if (!lib.length) return needClip("Your library is empty — generate or save something first.");
    const want = addm[1]!.replace(/^(first|last)\s+/, "");
    const found =
      want === "first" || want === "last" || !want
        ? lib[0]!
        : lib.find((g) => g.name.toLowerCase().includes(want) || g.url.toLowerCase().includes(want));
    if (!found) return needClip(`No asset matching "${want}" in the library.`);
    ctx.add(found.kind, found.name, found.url);
    return { reply: `Added "${found.name}" to the timeline.`, changed: true, followups: ["split", "trim to 5s", "export"] };
  }

  // ---- clip-level (need a target) ----
  const c = ctx.target();
  const noClip = () => needClip("I need a clip — click one on the timeline, or put the playhead on it.");
  const tgt = (m: string) => ({ reply: m, changed: true, followups: ["undo it", "export", "status"] });

  if (/^(split|cut)\b/.test(text)) {
    if (!ctx.split()) return needClip("Split failed — move the playhead into a clip first.");
    return tgt(`Split at ${ctx.playhead().toFixed(2)}s.`);
  }
  if (text === "undo it" || text === "undo") return (window.dispatchEvent(new CustomEvent("field-chat-undo")), { reply: "Undone." });
  if (!c) return noClip();

  const spd = text.match(/^speed\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*[x×]?$/);
  if (spd) {
    const s = clamp(Number(spd[1]), 0.25, 4);
    ctx.patch(c.id, { speed: s });
    return tgt(`Speed set to ${s}×.`);
  }
  if (/^slow( (down|it))?$/.test(text)) {
    const s = clamp((c.speed ?? 1) / 1.5, 0.25, 4);
    ctx.patch(c.id, { speed: Math.round(s * 100) / 100 });
    return tgt(`Slowed to ${Math.round(s * 100) / 100}×.`);
  }
  if (/^speed( (up|it))?$/.test(text) || /^faster$/.test(text)) {
    const s = clamp((c.speed ?? 1) * 1.5, 0.25, 4);
    ctx.patch(c.id, { speed: Math.round(s * 100) / 100 });
    return tgt(`Sped up to ${Math.round(s * 100) / 100}×.`);
  }

  const vol = text.match(/^volume\s+(?:to\s+)?(\d{1,3})\s*%?$/);
  if (vol) {
    const v = clamp(Number(vol[1]) / 100, 0, 2);
    ctx.patch(c.id, { volume: v });
    return tgt(`Volume at ${Math.round(v * 100)}%.`);
  }
  if (text === "mute" || text === "silence it") return (ctx.patch(c.id, { volume: 0 }), tgt("Muted."));
  if (text === "louder") return (ctx.patch(c.id, { volume: clamp((c.volume ?? 1) + 0.25, 0, 2) }), tgt("Louder."));
  if (text === "quieter") return (ctx.patch(c.id, { volume: clamp((c.volume ?? 1) - 0.25, 0, 2) }), tgt("Quieter."));

  if (/^(mirror|flip)\b/.test(text)) return (ctx.patch(c.id, { mirror: !c.mirror }), tgt(c.mirror ? "Mirror off." : "Mirrored."));
  if (/^(remove|no|off)\s+fade$/.test(text)) return (ctx.patch(c.id, { fade: false }), tgt("Fade removed."));
  if (text === "fade" || text === "fade it") return (ctx.patch(c.id, { fade: true }), tgt("0.25s fade in + out."));
  if (text === "fit" || text === "letterbox") return (ctx.patch(c.id, { fit: "contain" }), tgt("Letterbox (fit)."));
  if (text === "fill" || text === "crop") return (ctx.patch(c.id, { fit: "cover" }), tgt("Fill (crop to frame)."));

  if (text.startsWith("caption") || text.startsWith("title") || text.startsWith("label")) {
    if (/remove|clear|off/.test(text)) return (ctx.patch(c.id, { caption: "" }), tgt("Caption removed."));
    const m = raw.trim().match(/^(?:caption|title|label)\s+(?:to\s+|as\s+)?[""]?([^""]+)[""]?$/i);
    if (!m) return needClip('Say: caption "your text"');
    ctx.patch(c.id, { caption: m[1]!.slice(0, 60) });
    return tgt(`Caption: "${m[1]!.slice(0, 60)}"`);
  }

  const trim = text.match(/^trim (?:to|it to)?\s+(\d+(?:\.\d+)?)\s*s?$/);
  if (trim) {
    const n = Number(trim[1]);
    const out = c.kind === "video" ? Math.min(c.in + n, c.dur) : c.in + n;
    if (out <= c.in + 0.2) return needClip(`Can't trim below ${c.in.toFixed(1)}s on this clip.`);
    ctx.patch(c.id, { out });
    return tgt(`Trimmed to ${(out - c.in).toFixed(1)}s.`);
  }

  if (/^(duplicate|copy)\b/.test(text)) {
    ctx.duplicate(c.id);
    return tgt("Duplicated — the copy is next in the timeline.");
  }
  if (/^(delete|remove|kill|drop)\b/.test(text)) {
    ctx.remove(c.id);
    return tgt("Deleted. ⌘Z brings it back.");
  }


  return {
    reply: `I didn't catch that. ${HELP}`,
    followups: ["split", "status", "help"],
  };
}
