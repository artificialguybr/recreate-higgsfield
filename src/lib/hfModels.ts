import type { FeedModel } from "./hf";

export type ModelFieldType = "select" | "number" | "boolean" | "text";

export type ModelField = {
  key: string;
  label: string;
  type: ModelFieldType;
  options?: readonly string[];
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

export type ModelSchema = {
  mode: string;
  kind: "image" | "video";
  fields: readonly ModelField[];
  acceptsImageUrls?: boolean;
  acceptsVideoUrl?: boolean;
  requiresImageUrls?: boolean;
  requiresVideoUrl?: boolean;
};

const RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
const SEEDANCE_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
const KLING_RATIOS = ["16:9", "9:16", "1:1"] as const;

const schemas: Record<string, ModelSchema> = {
  "marketing-studio/image": {
    mode: "marketing-studio/image",
    kind: "image",
    acceptsImageUrls: true,
    fields: [
      { key: "resolution", label: "Resolution", type: "select", options: ["1k", "2k", "4k"], default: "2k" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: RATIOS, default: "auto" },
      { key: "enhance_prompt", label: "Enhance prompt", type: "boolean", default: false },
    ],
  },
  "xai/grok-imagine-image-2.0": {
    mode: "xai/grok-imagine-image-2.0",
    kind: "image",
    acceptsImageUrls: true,
    fields: [
      { key: "quality", label: "Quality", type: "select", options: ["low", "medium"], default: "medium" },
      { key: "resolution", label: "Resolution", type: "select", options: ["1k", "2k"], default: "1k" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: RATIOS, default: "auto" },
    ],
  },
  "bytedance/seedance-2.5/text-to-video": {
    mode: "bytedance/seedance-2.5/text-to-video",
    kind: "video",
    fields: [
      { key: "duration", label: "Duration", type: "number", default: 5, min: 4, max: 30, step: 1 },
      { key: "resolution", label: "Resolution", type: "select", options: ["480p", "720p"], default: "720p" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: SEEDANCE_RATIOS, default: "16:9" },
      { key: "output_format", label: "Format", type: "select", options: ["mp4", "mov"], default: "mp4" },
      { key: "generate_audio", label: "Generate audio", type: "boolean", default: true },
    ],
  },
  "bytedance/seedance-2.0/text-to-video": {
    mode: "bytedance/seedance-2.0/text-to-video",
    kind: "video",
    fields: [
      { key: "duration", label: "Duration", type: "number", default: 5, min: 4, max: 15, step: 1 },
      { key: "resolution", label: "Resolution", type: "select", options: ["480p", "720p", "1080p", "4k"], default: "720p" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: SEEDANCE_RATIOS, default: "16:9" },
      { key: "generate_audio", label: "Generate audio", type: "boolean", default: true },
    ],
  },
  "kling-video/v3.0/std/text-to-video": {
    mode: "kling-video/v3.0/std/text-to-video",
    kind: "video",
    fields: [
      { key: "sound", label: "Sound", type: "select", options: ["on", "off"], default: "on" },
      { key: "duration", label: "Duration", type: "number", default: 5, min: 3, max: 15, step: 1 },
      { key: "cfg_scale", label: "Guidance", type: "number", default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: "multi_shots", label: "Multiple shots", type: "boolean", default: false },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: KLING_RATIOS, default: "16:9" },
    ],
  },
  "minimax/h3/text-to-video": {
    mode: "minimax/h3/text-to-video",
    kind: "video",
    fields: [
      { key: "duration", label: "Duration", type: "number", default: 5, min: 5, max: 15, step: 1 },
      { key: "resolution", label: "Resolution", type: "select", options: ["2K"], default: "2K" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: ["auto", "adaptive", ...SEEDANCE_RATIOS], default: "auto" },
      { key: "aigc_watermark", label: "AIGC watermark", type: "boolean", default: false },
    ],
  },
  "alibaba/wan-3.0-prime/text-to-video": {
    mode: "alibaba/wan-3.0-prime/text-to-video",
    kind: "video",
    fields: [
      { key: "duration", label: "Duration", type: "number", default: 5, min: 2, max: 30, step: 1 },
      { key: "resolution", label: "Resolution", type: "select", options: ["480p", "720p", "1080p"], default: "1080p" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: ["adaptive", ...SEEDANCE_RATIOS], default: "adaptive" },
      { key: "generate_audio", label: "Generate audio", type: "boolean", default: true },
      { key: "enable_thinking", label: "Deep thinking", type: "boolean", default: false },
      { key: "seed", label: "Seed", type: "number", default: 0, min: 0, max: 2147483647, step: 1 },
    ],
  },
  "higgsfield/cinema-studio/4.0": {
    mode: "higgsfield/cinema-studio/4.0",
    kind: "video",
    fields: [
      { key: "duration", label: "Duration", type: "number", default: 5, min: 1, max: 30, step: 1 },
      { key: "resolution", label: "Resolution", type: "select", options: ["480p", "720p", "1080p"], default: "720p" },
      { key: "aspect_ratio", label: "Aspect ratio", type: "select", options: SEEDANCE_RATIOS, default: "16:9" },
      { key: "generate_audio", label: "Generate audio", type: "boolean", default: true },
    ],
  },
  "higgsfiled/genjutsu/motion-transfer/v1.0": {
    mode: "higgsfiled/genjutsu/motion-transfer/v1.0",
    kind: "video",
    acceptsImageUrls: true,
    acceptsVideoUrl: true,
    requiresImageUrls: true,
    requiresVideoUrl: true,
    fields: [{ key: "resolution", label: "Resolution", type: "select", options: ["480p", "720p"], default: "720p" }],
  },
};

const fallback = (model: Pick<FeedModel, "mode" | "type">): ModelSchema => ({
  mode: model.mode,
  kind: model.type,
  fields: [],
});

export function modelSchema(model: Pick<FeedModel, "mode" | "type"> | null | undefined): ModelSchema | null {
  if (!model) return null;
  return schemas[model.mode] ?? fallback(model);
}

export function isSupportedModel(model: Pick<FeedModel, "mode" | "type"> | null | undefined): boolean {
  return Boolean(model && schemas[model.mode]);
}

export function defaultsForModel(model: Pick<FeedModel, "mode" | "type"> | null | undefined): Record<string, string | number | boolean> {
  return Object.fromEntries((modelSchema(model)?.fields ?? []).map((field) => [field.key, field.default]));
}

function normalizeFieldValue(field: ModelField, value: unknown): string | number | boolean | undefined {
  if (field.type === "boolean") return value === true || (typeof value === "string" && value === "true");
  if (field.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) return field.default as number;
    return Math.min(field.max ?? number, Math.max(field.min ?? number, number));
  }
  if (typeof value !== "string" || !value) return field.default as string;
  if (field.type === "select" && field.options && !field.options.includes(value)) return field.default as string;
  return value;
}

export function bodyForModel(
  model: Pick<FeedModel, "mode" | "type">,
  prompt: string,
  values: Record<string, unknown> = {},
  inputs: { imageUrls?: string[]; videoUrl?: string } = {},
): Record<string, unknown> {
  const schema = modelSchema(model);
  if (!schema) return { prompt };
  const body: Record<string, unknown> = { prompt };
  for (const field of schema.fields) {
    const value = normalizeFieldValue(field, values[field.key] ?? field.default);
    if (value !== undefined) body[field.key] = value;
  }
  if (schema.acceptsImageUrls && inputs.imageUrls?.length) body.image_urls = inputs.imageUrls;
  if (schema.acceptsVideoUrl && inputs.videoUrl) body.video_url = inputs.videoUrl;
  return body;
}

export function isUnsupportedLegacyModel(mode: string): boolean {
  return /soul/i.test(mode);
}
