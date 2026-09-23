// Pexels stock-footage client. Same server-side-key pattern as the
// Higgsfield client: the key lives on the server (PEXELS_API_KEY) and the
// browser goes through the /pexels proxy — no key is ever exposed.
// API: GET /v1/videos/search?query=&orientation=&per_page= (Authorization header).
// Docs: https://www.pexels.com/api/documentation/

import.meta.env;

export type StockClip = {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string; // pexels page (credit link)
  photographer: string;
  picture: string; // thumbnail image
  files: { quality: string; file_type: string; width: number; height: number; link: string }[];
};
export type StockPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string;
  src: { original: string; large2x: string; large: string; medium: string; small: string; portrait: string; landscape: string; tiny: string };
};

export type StockMedia = { kind: "video"; item: StockClip } | { kind: "image"; item: StockPhoto };

declare global {
  interface Window { __FIELD_STOCK_CONFIGURED__?: boolean; }
}

export const stockConfigured = import.meta.env.VITE_STOCK_CONFIGURED === "true"
  || (typeof window !== "undefined" && window.__FIELD_STOCK_CONFIGURED__ === true);

function bestFile(clip: StockClip): { link: string; width: number; height: number } | null {
  // Prefer the largest mp4 under 1920 wide (SD/mobile fallbacks first).
  const mp4s = clip.files.filter((f) => f.file_type === "video/mp4" && f.width <= 1920);
  mp4s.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return mp4s[0] ?? null;
}

// Fetch stock clips for a query. Throws with an honest message when the
// server has no Pexels key — the UI must show the failure, never fake it.
export async function searchStock(query: string, perPage = 12): Promise<StockClip[]> {
  if (!stockConfigured) throw new Error("Pexels is not configured (PEXELS_API_KEY on the server).");
  const params = new URLSearchParams({ query, per_page: String(perPage), orientation: "landscape" });
  const res = await fetch(`/pexels/v1/videos/search?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Pexels search failed (${res.status}).`);
  const data = (await res.json()) as { videos?: StockClip[] };
  return data.videos ?? [];
}

export async function searchStockPhotos(query: string, perPage = 12): Promise<StockPhoto[]> {
  if (!stockConfigured) throw new Error("Pexels is not configured (PEXELS_API_KEY on the server).");
  const params = new URLSearchParams({ query, per_page: String(perPage), orientation: "landscape" });
  const res = await fetch(`/pexels/v1/search?${params}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Pexels photo search failed (${res.status}).`);
  const data = (await res.json()) as { photos?: StockPhoto[] };
  return data.photos ?? [];
}

export { bestFile };
