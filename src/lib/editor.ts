// Timeline model: clips in order. A clip is a source span [in, out].
// Images have a fixed on-screen duration (out - in), videos use their own.

export type Clip = {
  id: string;
  kind: "image" | "video" | "audio";
  src: string;
  assetId?: string; // IndexedDB asset used to restore local object URLs
  name: string;
  dur: number; // total source duration (video/audio) — images: 0
  in: number; // trim start (seconds into source)
  out: number; // trim end
  thumb?: string; // canvas-captured frame for the timeline
  // per-clip look — previewed live, baked at export
  speed?: number; // 0.5–2 (video)
  volume?: number; // 0–2 (video/audio)
  mirror?: boolean;
  fade?: boolean; // 0.25s in/out
  fit?: "contain" | "cover";
  caption?: string; // title overlay
};

export const IMG_SECONDS = 3; // default on-screen duration for image clips

export function clipLen(c: Clip) {
  return Math.max(0.1, c.out - c.in);
}

export function totalDur(clips: Clip[]) {
  return clips.reduce((s, c) => s + clipLen(c), 0);
}

export function clipAt(clips: Clip[], t: number) {
  if (!clips.length) return { index: 0, at: 0, len: 0 };
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = clipLen(clips[i]);
    if (t < acc + len || i === clips.length - 1) return { index: i, at: t - acc, len };
    acc += len;
  }
  return { index: 0, at: 0, len: clipLen(clips[0]!) };
}

export function makeVideoClip(src: string, name: string, dur: number): Clip {
  return { id: crypto.randomUUID(), kind: "video", src, name, dur, in: 0, out: Math.max(0.1, dur) };
}

export function makeImageClip(src: string, name: string): Clip {
  return { id: crypto.randomUUID(), kind: "image", src, name, dur: 0, in: 0, out: IMG_SECONDS };
}

export function makeAudioClip(src: string, name: string, dur: number): Clip {
  return { id: crypto.randomUUID(), kind: "audio", src, name, dur, in: 0, out: Math.max(0.1, dur) };
}

// Split a clip at `pos` (seconds into the clip). Returns [left, right] or null.
export function splitClip(c: Clip, pos: number): [Clip, Clip] | null {
  if (pos <= 0.15 || pos >= clipLen(c) - 0.15) return null;
  const left: Clip = { ...c, out: c.in + pos };
  const right: Clip = { ...c, id: crypto.randomUUID(), in: c.in + pos };
  return [left, right];
}
