// Pass a media URL from one page to the editor (survives route change).

const KEY = "field-pending";

export function setPending(url: string, kind: "image" | "video" | "audio" = "video", assetId?: string) {
  sessionStorage.setItem(KEY, JSON.stringify({ url, kind, assetId }));
}

export function pendingMedia(): { url: string; kind: "image" | "video" | "audio"; assetId?: string } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { url?: string; kind?: "image" | "video" | "audio"; assetId?: string };
    return p.url ? { url: p.url, kind: p.kind === "image" || p.kind === "audio" ? p.kind : "video", ...(p.assetId ? { assetId: p.assetId } : {}) } : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  sessionStorage.removeItem(KEY);
}
