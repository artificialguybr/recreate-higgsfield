// Browser export via ffmpeg.wasm (MIT). The engine is loaded from a CDN on
// first export; clips are normalized to the requested frame (h264 @30) and
// concatenated. Per-clip look (speed, volume, mirror, fade, fit, caption)
// is previewed in the DOM and baked here.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Clip } from "./editor";
import { clipLen } from "./editor";

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
const FPS = 30;
const FADE = 0.25;

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
const logBuf: string[] = [];

export function loadFfmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (!loading) {
    loading = (async () => {
      const f = new FFmpeg();
      f.on("log", ({ message }) => {
        logBuf.push(message);
        onLog?.(message);
      });
      await f.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpeg = f;
      return f;
    })();
  }
  return loading;
}

// Local files (object URLs) can't be re-fetched by the worker — pass the Blob.
type Source = { url: string; blob?: Blob };

async function toBlob(src: Source | undefined): Promise<Blob> {
  if (!src) throw new Error("Clip source is missing");
  if (src.blob) return src.blob;
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  return res.blob();
}

function withLog(ff: FFmpeg, args: string[]): Promise<{ code: number; log: string[] }> {
  logBuf.length = 0;
  return ff.exec(args).then((code) => {
    const log = [...logBuf];
    logBuf.length = 0;
    return { code, log };
  });
}

// Caption as a transparent PNG overlay — the wasm core has no fonts, so
// drawtext would fail; canvas text matches the app's type exactly.
async function captionPng(text: string, W: number, H: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const size = Math.round(W * 0.038);
  ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  // soft ground so it reads over any shot
  const y = H - Math.round(H * 0.06);
  const w = Math.min(W * 0.9, ctx.measureText(text).width + size * 1.6);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  const r = size * 0.5;
  const x = (W - w) / 2;
  ctx.beginPath();
  ctx.roundRect(x, y - size * 1.7, w, size * 2.2, r);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, W / 2, y, W * 0.86);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
}

export async function exportClips(
  clips: Clip[],
  sources: Map<string, Source>,
  onProgress: (p: number) => void,
  W = 1280,
  H = 720
): Promise<Blob> {
  const ff = await loadFfmpeg();

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const blob = await toBlob(sources.get(c.id));
    const base = i.toString().padStart(3, "0");
    const input = `${base}.in`;
    await ff.writeFile(input, await fetchFile(blob));
    const output = `segment${base}.mp4`;

    const sp = c.kind === "video" ? c.speed ?? 1 : 1;
    const len = Math.max(0.1, clipLen(c) / sp);
    const cover = c.fit === "cover";

    const vf: string[] = [
      cover
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
        : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    ];
    if (c.mirror) vf.push("hflip");
    if (c.kind === "video" && sp !== 1) vf.push(`setpts=PTS/${sp}`);
    if (c.fade) {
      vf.push(`fade=t=in:st=0:d=${FADE}`, `fade=t=out:st=${Math.max(0, len - FADE).toFixed(3)}:d=${FADE}`);
    }
    vf.push(`fps=${FPS}`, "format=yuv420p");

    // Does the source carry audio? Decides whether audio filters apply.
    const probe = await withLog(ff, ["-i", input]);
    const audio = probe.log.some((l) => l.includes("Audio:"));

    const af: string[] = [];
    if (audio) {
      if (sp !== 1) af.push(`atempo=${sp}`);
      const vol = c.volume ?? 1;
      if (vol !== 1) af.push(`volume=${vol}`);
      if (c.fade) {
        af.push(`afade=t=in:st=0:d=${FADE}`, `afade=t=out:st=${Math.max(0, len - FADE).toFixed(3)}:d=${FADE}`);
      }
    }

    const cap = c.caption?.trim();
    const args: string[] = ["-y"];
    if (c.kind === "image") args.push("-loop", "1", "-t", len.toFixed(3));
    else {
      args.push("-ss", c.in.toFixed(3), "-to", c.out.toFixed(3));
    }
    args.push("-i", input);
    if (cap) {
      const capFile = `cap${base}.png`;
      await ff.writeFile(capFile, await fetchFile(await captionPng(cap, W, H)));
      args.push("-loop", "1", "-i", capFile);
      args.push(
        "-filter_complex",
        `[0:v]${vf.join(",")}[v];[v][1:v]overlay=0:0:shortest=1[outv]`,
        "-map", "[outv]"
      );
      if (audio) args.push("-map", "0:a");
      args.push("-shortest");
    } else {
      args.push("-vf", vf.join(","));
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23");
    if (audio && af.length) args.push("-af", af.join(","));
    else args.push("-an");
    args.push("-movflags", "+faststart", output);

    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg step ${base} failed (code ${code})`);
    onProgress((i + 1) / (clips.length + 1));
  }

  const list = clips.map((_, i) => `file 'segment${i.toString().padStart(3, "0")}.mp4'`).join("\n");
  ff.writeFile("list.txt", list);

  const cc = await ff.exec(["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "out.mp4"]);
  if (cc !== 0) throw new Error("concat failed (code " + cc + ")");
  onProgress(1);

  const data = await ff.readFile("out.mp4");
  return new Blob([data as Uint8Array], { type: "video/mp4" });
}
