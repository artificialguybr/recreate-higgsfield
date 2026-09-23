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

declare global {
  interface Window { __FIELD_HF_CONFIGURED__?: boolean }
}

export const hasKeys = import.meta.env.VITE_HF_CONFIGURED === "true"
  || (typeof window !== "undefined" && window.__FIELD_HF_CONFIGURED__ === true);

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
  const seen = new Set<string>();
  return data.results.flatMap((r) => {
    if (seen.has(r.default_mode_id)) return [];
    seen.add(r.default_mode_id);
    return [{
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
    }];
  });
}

/* ---------------- generation (authed, async) ---------------- */

export type GenResult = { url: string; kind: "image" | "video" | "audio" };
export type GenStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export type GenerationRequest = { requestId?: string; statusUrl: string; cancelUrl?: string };
export type GenerateOptions = {
  onStatus?: (status: GenStatus) => void;
  onRequest?: (request: GenerationRequest) => void;
  signal?: AbortSignal;
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException("Generation canceled", "AbortError")); return; }
  const timer = window.setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Generation canceled", "AbortError")); }, { once: true });
});

const viaProxy = (u: string) => {
  if (u.startsWith("/hfapi/")) return u;
  if (u.startsWith("/")) return `/hfapi${u}`;
  return u.replace(/^https:\/\/api\.higgsfield\.ai/, "/hfapi");
};

export async function cancelGeneration(request: Pick<GenerationRequest, "requestId" | "cancelUrl">): Promise<void> {
  const url = request.cancelUrl ? viaProxy(request.cancelUrl) : request.requestId ? `/hfapi/requests/${encodeURIComponent(request.requestId)}/cancel` : "";
  if (!url) throw new Error("This generation cannot be canceled.");
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Cancel failed (${res.status})`);
  }
}

export async function generate(
  mode: string,
  body: Record<string, unknown>,
  callback?: ((status: GenStatus) => void) | GenerateOptions,
  signal?: AbortSignal,
): Promise<GenResult> {
  const options: GenerateOptions = typeof callback === "function" ? { onStatus: callback, signal } : { ...(callback ?? {}), signal: callback?.signal ?? signal };
  const res = await fetch(`/hfapi/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(t).detail?.message || JSON.parse(t).error || msg; } catch { if (t.length < 120) msg = t; }
    throw new Error(msg);
  }
  const accepted = (await res.json()) as { request_id?: string; status_url?: string; cancel_url?: string };
  if (!accepted.status_url) throw new Error("Higgsfield did not return a status URL.");
  const request: GenerationRequest = { requestId: accepted.request_id, statusUrl: viaProxy(accepted.status_url), cancelUrl: accepted.cancel_url };
  options.onRequest?.(request);
  let delay = 2000;
  for (;;) {
    await sleep(delay, options.signal);
    type Poll = {
      status: GenStatus;
      images?: { url: string }[];
      video?: { url: string };
      audio?: { url: string };
      audios?: { url: string }[];
      error?: { message?: string };
    };
    const pollResponse = await fetch(request.statusUrl, { signal: options.signal });
    if (!pollResponse.ok) throw new Error(`Status request failed (${pollResponse.status})`);
    const current = (await pollResponse.json()) as Poll;
    options.onStatus?.(current.status);
    if (current.status === "completed") {
      const image = current.images?.[0]?.url;
      const video = current.video?.url;
      const audio = current.audio?.url ?? current.audios?.[0]?.url;
      if (image) return { url: image, kind: "image" };
      if (video) return { url: video, kind: "video" };
      if (audio) return { url: audio, kind: "audio" };
      throw new Error("Generation completed without an output.");
    }
    if (current.status === "failed" || current.status === "nsfw" || current.status === "canceled") {
      throw new Error(current.error?.message || current.status);
    }
    delay = Math.min(delay * 1.5, 10000);
  }
}

/* ---------------- legacy endpoint identity ---------------- */

export const LEGACY_IMAGE_MODE = "higgsfield-ai/soul/v2/standard";
export const VIDEO_MODE = "kling-video/v3.0/std/text-to-video";


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
