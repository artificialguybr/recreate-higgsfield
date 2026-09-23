export type LaunchframeVideoType = "A" | "B" | "C";
export type LaunchframeStatus = "draft" | "approved" | "running" | "complete" | "failed";
export type LaunchframeLayerKind = "ui" | "generated" | "higgsfield" | "external" | "founder" | "text" | "audio";

export interface LaunchframeBeat {
  type: string;
  text: string;
  duration: number;
  requiresAI: boolean;
}

export interface LaunchframeApiChoice {
  id: string;
  model: string;
  endpoint: string;
  purpose: string;
  estimatedSeconds: number;
  estimatedCost: number;
}

export interface LaunchframePlan {
  videoType: LaunchframeVideoType;
  title: string;
  hook: string;
  beats: LaunchframeBeat[];
  apiChoices: LaunchframeApiChoice[];
  estimatedCost: number;
  maxBudget: number;
  inputs: { url: string; founderVideoPath?: string; founderVoicePath?: string; logoPath?: string };
  consent: boolean;
}

export interface LaunchframeLayer {
  id: string;
  kind: LaunchframeLayerKind;
  label: string;
  duration: number;
  source?: string;
  text?: string;
  order: number;
}

export interface LaunchframeTranscript {
  step: string;
  detail: string;
}

export interface LaunchframeProfile {
  category: string;
  videoType: LaunchframeVideoType;
  reasons: string[];
  palette: string[];
}

export interface LaunchframeWorkflow {
  id: string;
  url: string;
  status: LaunchframeStatus;
  progress: number;
  plan: LaunchframePlan | null;
  layers: LaunchframeLayer[];
  videoUrl?: string;
  shareUrl?: string;
  error?: string;
  transcript: LaunchframeTranscript[];
  profile?: LaunchframeProfile;
  usedFixture?: boolean;
}

export interface LaunchframePlanInput {
  url: string;
  videoType: LaunchframeVideoType;
  instruction?: string;
  maxBudget: number;
  founderVideoBase64?: string;
  founderVoiceBase64?: string;
  logoBase64?: string;
  consent: boolean;
}

export interface LaunchframeLayerEdit {
  id: string;
  order?: number;
  duration?: number;
  text?: string;
  removed?: boolean;
}

export interface LaunchframeChatMessage {
  role: "user" | "assistant";
  content: string;
}

const API_ROOT = import.meta.env.VITE_LAUNCHFRAME_API_URL || "/launchframe-api";

function endpoint(path: string): string {
  return `${API_ROOT}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | T | null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error?.message : undefined;
    throw new Error(message || `Launchframe request failed (${response.status})`);
  }
  return body as T;
}

export function createLaunchframePlan(input: LaunchframePlanInput): Promise<LaunchframeWorkflow> {
  return request<LaunchframeWorkflow>("/api/workflows/plan", { method: "POST", body: JSON.stringify(input) });
}

export function approveLaunchframePlan(id: string, maxBudget: number): Promise<{ id: string; status: "approved"; plan: LaunchframePlan }> {
  return request<{ id: string; status: "approved"; plan: LaunchframePlan }>(`/api/workflows/${id}/approve`, { method: "POST", body: JSON.stringify({ maxBudget }) });
}

export function startLaunchframeWorkflow(id: string): Promise<{ id: string; status: "running" }> {
  return request<{ id: string; status: "running" }>(`/api/workflows/${id}/start`, { method: "POST" });
}

export function getLaunchframeWorkflow(id: string): Promise<LaunchframeWorkflow> {
  return request<LaunchframeWorkflow>(`/api/workflows/${id}`);
}

export function patchLaunchframeLayers(id: string, layers: LaunchframeLayerEdit[]): Promise<{ id: string; layers: LaunchframeLayer[] }> {
  return request<{ id: string; layers: LaunchframeLayer[] }>(`/api/workflows/${id}/layers`, { method: "PATCH", body: JSON.stringify({ layers }) });
}

export function exportLaunchframeWorkflow(id: string): Promise<{ id: string; videoUrl: string }> {
  return request<{ id: string; videoUrl: string }>(`/api/workflows/${id}/export`, { method: "POST" });
}

export function chatWithLaunchframe(input: { url?: string; workflowId?: string; message: string; history?: LaunchframeChatMessage[] }): Promise<{ reply: string }> {
  return request<{ reply: string }>("/api/conversation/chat", { method: "POST", body: JSON.stringify(input) });
}

export function launchframeMediaUrl(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" && parsed.port === "3000") return endpoint(`${parsed.pathname}${parsed.search}`);
  } catch {
    return url;
  }
  return url;
}
