// Pass a media URL from one page to the editor (survives route change).

const KEY = "field-pending";

export function setPending(url: string, kind: "image" | "video" = "video") {
  sessionStorage.setItem(KEY, JSON.stringify({ url, kind }));
}

export function pendingMedia(): { url: string; kind: "image" | "video" } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { url?: string; kind?: "image" | "video" };
    return p.url ? { url: p.url, kind: p.kind === "image" ? "image" : "video" } : null;
  } catch {
    return null;
  }
}

export function clearPending() {
  sessionStorage.removeItem(KEY);
}
