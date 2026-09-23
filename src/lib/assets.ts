export type AssetKind = "image" | "video";
export type AssetSource = "upload" | "generation" | "catalog" | "export";

export type LocalAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  source: AssetSource;
  model?: string;
  prompt?: string;
  remoteUrl?: string;
  mime: string;
  size: number;
  createdAt: number;
  blob: Blob;
};

type AssetInput = Pick<LocalAsset, "name" | "kind" | "source"> & Partial<Pick<LocalAsset, "model" | "prompt">> & (
  | { blob: Blob; url?: never }
  | { url: string; blob?: never }
);

const DB_NAME = "field-local-assets";
const STORE = "assets";
const LEGACY_KEY = "field-editor-library";
const CDN = "https://d28lhcrx5qdowv.cloudfront.net";
export const ASSETS_CHANGED = "field-assets-updated";

let database: Promise<IDBDatabase> | null = null;
let legacyMigration: Promise<void> | null = null;
const objectUrls = new Map<string, string>();

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local asset storage is unavailable."));
    request.onblocked = () => reject(new Error("Close another Field tab to initialize local asset storage."));
  });
  return database;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local asset storage failed."));
  });
}

async function readAll(): Promise<LocalAsset[]> {
  const db = await openDatabase();
  return requestResult(db.transaction(STORE, "readonly").objectStore(STORE).getAll()) as Promise<LocalAsset[]>;
}

function mediaUrl(url: string): string {
  const parsed = new URL(url, window.location.origin);
  if (parsed.hostname === "d28lhcrx5qdowv.cloudfront.net") return `/hfblob${parsed.pathname}${parsed.search}`;
  return url;
}

export async function saveAsset(input: AssetInput): Promise<LocalAsset> {
  const remoteUrl = "url" in input ? input.url : undefined;
  let blob = "blob" in input ? input.blob : undefined;
  if (!blob && remoteUrl) {
    const response = await fetch(mediaUrl(remoteUrl));
    if (!response.ok) throw new Error(`Could not save media (${response.status}).`);
    blob = await response.blob();
  }
  if (!blob || blob.size === 0) throw new Error("The asset is empty or unavailable.");
  const asset: LocalAsset = {
    id: crypto.randomUUID(),
    name: input.name.trim() || (input.kind === "image" ? "Untitled image" : "Untitled video"),
    kind: input.kind,
    source: input.source,
    ...(input.model ? { model: input.model } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
    mime: blob.type || (input.kind === "image" ? "image/unknown" : "video/unknown"),
    size: blob.size,
    createdAt: Date.now(),
    blob,
  };
  const db = await openDatabase();
  await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).put(asset));
  window.dispatchEvent(new Event(ASSETS_CHANGED));
  return asset;
}

export async function getAsset(id: string): Promise<LocalAsset | null> {
  const db = await openDatabase();
  return (await requestResult(db.transaction(STORE, "readonly").objectStore(STORE).get(id))) ?? null;
}

async function migrateLegacy(): Promise<void> {
  let old: { url?: string; kind?: AssetKind; name?: string; model?: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
    if (Array.isArray(parsed)) old = parsed.filter((item) => item && typeof item.url === "string" && !item.url.startsWith("blob:") && (item.kind === "image" || item.kind === "video"));
  } catch { return; }
  if (!old.length) return;
  const existing = new Set((await readAll()).map((asset) => asset.remoteUrl).filter((url): url is string => Boolean(url)));
  for (const item of old) {
    if (!item.url || existing.has(item.url)) continue;
    try {
      await saveAsset({ url: item.url, kind: item.kind!, source: "generation", name: item.name || "Saved media", ...(item.model ? { model: item.model } : {}) });
      existing.add(item.url);
    } catch { /* Keep the legacy entry; remote media may have expired. */ }
  }
}

export async function listAssets(): Promise<LocalAsset[]> {
  if (!legacyMigration) legacyMigration = migrateLegacy().catch(() => { legacyMigration = null; });
  return (await readAll()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDatabase();
  await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  window.dispatchEvent(new Event(ASSETS_CHANGED));
}

export function assetObjectUrl(asset: LocalAsset): string {
  let url = objectUrls.get(asset.id);
  if (!url) {
    url = URL.createObjectURL(asset.blob);
    objectUrls.set(asset.id, url);
  }
  return url;
}
