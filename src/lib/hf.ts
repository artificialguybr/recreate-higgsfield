import { useEffect, useState } from "react";

// Higgsfield backend client.
//
// The API is async: POST a model endpoint -> { request_id, status_url } ->
// poll status_url (2s backoff up to 10s, per docs) until a terminal status.
// The browser can't hit api.higgsfield.ai directly (no CORS headers), so all
// calls go through the Vite dev proxy (/hfapi, /hfdata). A real server does
// the same job in production.
//
// Docs: https://docs.higgsfield.ai/docs

const KEY_ID = import.meta.env.VITE_HF_KEY_ID as string | undefined;
const KEY_SECRET = import.meta.env.VITE_HF_KEY_SECRET as string | undefined;

export const hasKeys = Boolean(KEY_ID && KEY_SECRET);

const auth = () => ({ Authorization: `Key ${KEY_ID}:${KEY_SECRET}` });

/* ---------------- feed (public catalog, no auth) ---------------- */

export type FeedModel = {
  title: string;
  company: string;
  type: "image" | "video";
  mode: string;
  video?: string;
  thumb?: string;
  description: string;
  price?: string;
  priceOriginal?: string;
  priceUnit?: string;
  discount?: number;
  releasedOn?: string;
};

type RawModel = {
  title: string;
  company: { name: string };
  description: string;
  output_types: string[];
  default_mode_id: string;
  preview_image?: string | { image_url: string } | null;
  preview_video?: { video_url: string; thumbnail_url: string } | null;
  pricing?: { primary?: { amount: string; original_amount: string; unit: string; discount_percentage?: number } };
  released_on?: string;
};

export async function fetchFeed(page = 1, pageSize = 24, outputType?: string): Promise<FeedModel[]> {
  const q = new URLSearchParams({ tags: "featured", page: String(page), page_size: String(pageSize) });
  if (outputType) q.set("output_type", outputType);
  const res = await fetch(`/hfdata/catalog-models/?${q.toString()}`);
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const data = (await res.json()) as { results: RawModel[] };
  return data.results.map((r) => ({
    title: r.title,
    company: r.company.name,
    type: r.output_types.includes("video") ? "video" : "image",
    mode: r.default_mode_id,
    video: r.preview_video?.video_url,
    thumb: r.preview_video?.thumbnail_url ?? (typeof r.preview_image === "string" ? r.preview_image : r.preview_image?.image_url),
    description: r.description,
    price: r.pricing?.primary?.amount,
    priceOriginal: r.pricing?.primary?.original_amount,
    priceUnit: r.pricing?.primary?.unit,
    discount: r.pricing?.primary?.discount_percentage,
    releasedOn: r.released_on,
  }));
}

/* ---------------- generation (authed, async) ---------------- */

export type GenResult = { url: string; kind: "image" | "video" | "audio" };

export type GenStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

const sleep = (ms: number) => { const { promise, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, ms); return promise; };


// "https://api.higgsfield.ai/requests/x/status" -> "/hfapi/requests/x/status"
const viaProxy = (u: string) => u.replace(/^https:\/\/api\.higgsfield\.ai/, "/hfapi");

export async function generate(
  mode: string,
  body: Record<string, unknown>,
  onStatus?: (s: GenStatus) => void,
): Promise<GenResult> {
  const res = await fetch(`/hfapi/${mode}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(t).detail?.message || msg; } catch { if (t.length < 120) msg = t; }
    throw new Error(msg);
  }
  const { status_url } = (await res.json()) as { status_url: string };
  const statusUrl = viaProxy(status_url);

  let delay = 2000;
  for (;;) {
    await sleep(delay);
    type Poll = {
      status: GenStatus;
      images?: { url: string }[];
      video?: { url: string };
      audio?: { url: string };
      audios?: { url: string }[];
      error?: { message?: string };
    };
    const s = (await (await fetch(statusUrl, { headers: auth() })).json()) as Poll;
    onStatus?.(s.status);
    if (s.status === "completed") {
      const img = s.images?.[0]?.url;
      const vid = s.video?.url;
      const aud = s.audio?.url ?? s.audios?.[0]?.url;
      if (img) return { url: img, kind: "image" };
      if (vid) return { url: vid, kind: "video" };
      if (aud) return { url: aud, kind: "audio" };
      throw new Error("completed with no output");
    }
    if (s.status === "failed" || s.status === "nsfw" || s.status === "canceled") {
      throw new Error(s.error?.message || s.status);
    }
    delay = Math.min(delay * 1.5, 10000);
  }
}

/* ---------------- mode presets for the device ---------------- */

export const IMAGE_MODE = "higgsfield-ai/soul/v2/standard"; // SOUL 2 — $0.0032/img, fastest in catalog
export const VIDEO_MODE = "kling-video/v3.0/std/text-to-video"; // Kling 3.0 — $0.042/s

export function imageBody(prompt: string, opts: { ratio: string; resolution: string }) {
  return { prompt, aspect_ratio: opts.ratio, resolution: opts.resolution, enhance_prompt: true, batch_size: 1 };
}

export function videoBody(prompt: string, opts: { duration: number; ratio: string }) {
  return { prompt, duration: opts.duration, aspect_ratio: opts.ratio };
}


/* ---------------- feed hook (one loading/ready/error/retry pattern) ---------------- */

export type FeedState = "loading" | "ready" | "error";


export function useFeed(page: number, pageSize: number, outputType?: string) {
  const [items, setItems] = useState<FeedModel[]>([]);
  const [state, setState] = useState<FeedState>("loading");
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    setState("loading");
    fetchFeed(page, pageSize, outputType)
      .then((r) => { if (live) { setItems(r); setState("ready"); } })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [page, pageSize, outputType, n]);

  return { items, state, retry: () => setN((k) => k + 1) };
}
