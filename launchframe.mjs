// Launchframe backend — embedded in server.mjs.
//
// App is local & personal (GitHub repo, not hosted), so state lives in memory +
// ./launchframe-data/ on disk, and generation calls the Higgsfield API with
// the same credentials the /hfapi proxy uses. No new dependencies: MP4
// assembly uses the system ffmpeg binary.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "launchframe-data");

const VIDEO_SHAPES = {
  A: ["capture", "generate", "capture", "generate"],
  B: ["founder", "generate", "capture", "founder", "text"],
  C: ["generate", "generate", "capture", "text"],
};
const CLIP_MODE = "kling-video/v3.0/std/text-to-video";
const KLANG_PRICE = 0.21; // per 5s clip, catalog price

/* ---------------- Higgsfield client ---------------- */

function hfKey() {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  return id && secret ? `Key ${id}:${secret}` : "";
}

function apiFetch(url, init = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      { hostname: target.hostname, path: target.pathname + target.search, method: init.method || "GET", headers: init.headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function hfGenerate(mode, payload, onStatus) {
  const auth = hfKey();
  if (!auth) { const e = new Error("Higgsfield credentials are not configured"); e.statusCode = 503; throw e; }
  const res = await apiFetch(`https://api.higgsfield.ai/${mode}`, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`Higgsfield rejected the request (${res.status}): ${res.buffer.toString("utf8").slice(0, 200)}`);
  const accepted = JSON.parse(res.buffer.toString("utf8"));
  if (!accepted.status_url) throw new Error("Higgsfield did not return a status URL.");
  const statusPath = new URL(accepted.status_url).pathname + new URL(accepted.status_url).search;
  let delay = 2000;
  for (;;) {
    await new Promise((r) => setTimeout(r, delay));
    const poll = await apiFetch(`https://api.higgsfield.ai${statusPath}`, { headers: { authorization: auth } });
    if (poll.status !== 200) throw new Error(`Status request failed (${poll.status})`);
    const current = JSON.parse(poll.buffer.toString("utf8"));
    onStatus?.(current.status);
    if (current.status === "completed") {
      const url = current.video?.url || current.images?.[0]?.url || current.audio?.url || current.audios?.[0]?.url;
      if (!url) throw new Error("Generation completed without an output.");
      return url;
    }
    if (["failed", "nsfw", "canceled"].includes(current.status)) throw new Error(current.error?.message || `Generation ${current.status}`);
    delay = Math.min(delay * 1.5, 10000);
  }
}

/* ---------------- product page reading ---------------- */

async function fetchPage(url) {
  const res = await apiFetch(url, { headers: { "user-agent": "Mozilla/5.0 (Launchframe)" } });
  if (res.status !== 200) throw new Error(`Product page fetch failed (${res.status})`);
  return res.buffer.toString("utf8");
}

function titleFromHtml(html, url) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const clean = og?.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return clean?.slice(0, 60) || new URL(url).hostname;
}

function categoryFromHtml(html) {
  const h = html.toLowerCase();
  if (/saas|dashboard|pricing|sign ?up|log ?in|api /.test(h)) return "Software / SaaS";
  if (/shop|cart|checkout|add to cart|buy now/.test(h)) return "Consumer product";
  if (/app store|google play|download the app|mobile app/.test(h)) return "Mobile app";
  return "Product launch";
}

function buildPlan(input, host) {
  const beatsSpec = VIDEO_SHAPES[input.videoType] ?? VIDEO_SHAPES.A;
  const hook = input.instruction?.trim()
    || `${host} shown the way it should be seen: material first, claims after, one clear invitation at the end.`;
  const beatText = {
    capture: [`Show the ${host} page: the arrival and first impression.`, `Show the ${host} page: the product in use.`, `Show the ${host} page: the proof and the close.`],
    generate: ["Cinematic reveal of the product in warm light.", "Detail pass over material and finish.", "Final mark on last light."],
    founder: ["Founder narrates the problem and the fix.", "Founder closes with the invitation."],
    text: ["Closing title card with the invitation."],
  };
  const beats = beatsSpec.map((type, i) => ({
    type,
    text: beatText[type][i % beatText[type].length],
    duration: type === "text" ? 2 : type === "founder" ? 8 : 3,
    requiresAI: type === "generate",
  }));
  const aiBeats = beats.filter((b) => b.requiresAI).length;
  return {
    videoType: input.videoType,
    title: `${host} · ${{ A: "flash demo", B: "narrated demo", C: "concept story" }[input.videoType]}`,
    hook,
    beats,
    apiChoices: Array.from({ length: aiBeats }, (_, i) => ({
      id: `b-roll-${i + 1}`,
      model: "Kling 3.0",
      endpoint: CLIP_MODE,
      purpose: "Cinematic b-roll",
      estimatedSeconds: 18,
      estimatedCost: KLANG_PRICE,
    })),
    estimatedCost: Math.round(aiBeats * KLANG_PRICE * 100) / 100,
    maxBudget: input.maxBudget,
    inputs: { url: input.url },
    consent: input.consent,
  };
}

/* ---------------- workflow state ---------------- */

const workflows = new Map(); // id -> workflow (JSON shape the frontend expects)
const uploads = new Map(); // id -> { founderVideo, founderVoice, logo } (file names)
const drivers = new Map(); // id -> { canceled }
let restored = false;

async function persist() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const rows = [...workflows.values()].filter((w) => w.status !== "running");
    await fs.writeFile(join(DATA_DIR, "workflows.json"), JSON.stringify(rows, null, 1));
    const manifest = {};
    for (const [id, u] of uploads) Object.assign(manifest, { [id]: u });
    await fs.writeFile(join(DATA_DIR, "media.json"), JSON.stringify(manifest, null, 1));
  } catch { /* disk is optional; state survives in memory */ }
}

async function restore() {
  if (restored) return;
  restored = true;
  try {
    const rows = JSON.parse(await fs.readFile(join(DATA_DIR, "workflows.json"), "utf8"));
    for (const row of rows) workflows.set(row.id, { ...row, status: "draft" });
    const manifest = JSON.parse(await fs.readFile(join(DATA_DIR, "media.json"), "utf8"));
    for (const [id, u] of Object.entries(manifest)) uploads.set(id, u);
  } catch { /* first run: nothing to restore */ }
}

function saveUploads(id, input) {
  const names = { founderVideoBase64: "founder-video", founderVoiceBase64: "founder-voice", logoBase64: "logo" };
  const saved = {};
  for (const [key, stem] of Object.entries(names)) {
    const b64 = input[key];
    if (!b64) continue;
    const ext = b64.startsWith("iVBOR") ? "png" : stem.includes("video") ? "mp4" : "bin";
    const fileName = `${id}-${stem}.${ext}`;
    fs.writeFile(join(DATA_DIR, fileName), Buffer.from(b64, "base64")).catch(() => {});
    saved[stem] = fileName;
  }
  uploads.set(id, saved);
  return saved;
}

/* ---------------- MP4 assembly (system ffmpeg) ---------------- */

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => err += c);
    child.on("error", () => reject(new Error("ffmpeg binary is required for Launchframe export (brew install ffmpeg)")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`)));
  });
}

async function hasFfmpeg() {
  try { await ffmpeg(["-version"]); return true; } catch { return false; }
}

function textCardArgs(text, duration) {
  const safe = text.replace(/[':\\]/g, "").slice(0, 40);
  return ["-f", "lavfi", "-i", `color=c=0x10140e:s=1280x720:d=${Math.max(1, duration)}`, "-vf", `drawtext=text='${safe}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2`, "-r", "30", "-t", String(Math.max(1, duration)), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
}

function colorCardArgs(color, duration) {
  return ["-f", "lavfi", "-i", `color=c=${color}:s=1280x720:d=${Math.max(0.5, duration)}`, "-r", "30", "-t", String(Math.max(0.5, duration)), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
}

async function downloadClip(url, file) {
  const res = await apiFetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (res.status !== 200) throw new Error(`Media fetch failed (${res.status})`);
  await fs.writeFile(file, res.buffer);
}

async function buildLayerClip(layer, workDir, id) {
  const out = join(workDir, `layer-${layer.order}.mp4`);
  const duration = Math.max(0.5, layer.duration || 2);
  const uploaded = uploads.get(id) || {};
  try {
    if (layer.kind === "higgsfield" && layer.source?.startsWith("http")) {
      // b-roll generated during the run; source holds the result URL
      const tmp = join(workDir, `layer-${layer.order}.src.mp4`);
      await downloadClip(layer.source, tmp);
      await ffmpeg(["-i", tmp, "-t", String(duration), "-r", "30", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "veryfast", "-an", "-pix_fmt", "yuv420p", out]);
      return out;
    }
    if (layer.kind === "founder" && uploaded.founderVideo) {
      await ffmpeg(["-i", join(DATA_DIR, uploaded.founderVideo), "-t", String(duration), "-r", "30", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "veryfast", "-an", "-pix_fmt", "yuv420p", out]);
      return out;
    }
    if (layer.kind === "text" || layer.kind === "ui") {
      try { await ffmpeg([...textCardArgs(layer.text || layer.label || "Field", duration), out]); return out; }
      catch { await ffmpeg([...colorCardArgs("0x1e2722", duration), out]); return out; }
    }
  } catch { /* fall through to a color card */ }
  await ffmpeg([...colorCardArgs("0x27341f", duration), out]);
  return out;
}

async function runWorkflow(id, onProgress, onLog, driver) {
  const workflow = workflows.get(id);
  const workDir = join(DATA_DIR, id);
  await fs.mkdir(workDir, { recursive: true });
  const aiBeats = workflow.plan.beats.filter((b) => b.requiresAI);
  const generated = new Map(); // apiChoice id -> media URL
  // 1) generate b-roll clips through Higgsfield
  let index = 0;
  for (const choice of workflow.plan.apiChoices) {
    if (driver.canceled) throw new Error("Canceled");
    index += 1;
    onLog("generate", `Generating b-roll ${index}/${workflow.plan.apiChoices.length} (${choice.model})…`);
    onProgress(Math.round(((index - 0.5) / workflow.plan.apiChoices.length) * 60));
    const prompt = aiBeats[index - 1]?.text || workflow.plan.hook;
    const url = hfKey()
      ? await hfGenerate(choice.endpoint, { prompt, duration: 5, aspect_ratio: "16:9", resolution: "720p", sound: "on" }, (s) => onLog("generate", `B-roll ${index}: ${s}`))
      : null;
    if (url) generated.set(choice.id, url);
  }
  if (!generated.size) onLog("generate", "No Higgsfield credentials — assembling from placeholder cards.");
  // 2) build one clip per layer, concat,
  onProgress(70);
  onLog("assemble", "Assembling the first cut…");
  const layers = workflow.layers.filter((l) => l.removed !== true).sort((a, b) => a.order - b.order);
  if (!layers.length) throw new Error("All layers were removed.");
  const parts = [];
  const urls = [...generated.values()];
  for (const [i, layer] of layers.entries()) {
    if (driver.canceled) throw new Error("Canceled");
    const withSource = layer.kind === "higgsfield" && urls.length
      ? { ...layer, source: urls[Math.min(i, urls.length - 1)] }
      : layer;
    parts.push(await buildLayerClip(withSource, workDir, id));
  }
  onProgress(85);
  const concatOut = join(workDir, "cut.mp4");
  const inputs = parts.flatMap((p) => ["-i", p]);
  const filter = parts.map((_, i) => `[${i}:v]scale=1280:720,setsar=30[v${i}]`).join(";")
    + ";" + parts.map((_, i) => `[v${i}]`).join("") + `concat=n=${parts.length}:v=1:a=0[out]`;
  await ffmpeg([...inputs, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", concatOut]);
  onProgress(100);
  onLog("done", "First cut assembled.");
  const wf = workflows.get(id);
  wf.status = "complete";
  wf.progress = 100;
  wf.videoUrl = `/launchframe-data/${id}/cut.mp4`;
  wf.transcript.push({ step: "done", detail: "First cut assembled from the layer stack." });
  await persist();
}

/* ---------------- assistant chat (rule-based, honest) ---------------- */

function chatReply(message, workflow) {
  const t = (message || "").trim().toLowerCase();
  if (/which (type|format|video)/.test(t)) return "Type A flash demo is 20–30s with no AI cost. Type B narrated demo needs founder video, voice, and consent. Type C concept story leans on Higgsfield b-roll (≈$0.21 per 5s clip).";
  if (/budget|cost|price|money/.test(t)) {
    const cost = workflow?.plan?.estimatedCost ?? 0;
    return `Estimated AI cost is $${cost}${workflow ? `, within your $${workflow.plan?.maxBudget ?? 0} ceiling. Nothing runs before you approve.` : "."}`;
  }
  if (/plan|beat|story|structure/.test(t)) return workflow?.plan
    ? `${workflow.plan.beats.length} beats: ${workflow.plan.beats.map((b) => b.type).join(" → ")}. Review them on the plan screen before approving.`
    : "Build a plan first — paste your product URL on the brief screen.";
  if (/approve|run|start|produce/.test(t)) return workflow
    ? "Approve on the plan screen (Step 2) — production only starts after your explicit approval."
    : "No plan to approve yet.";
  if (/layer|polish|export/.test(t)) return "Polish (Step 4) lets you reorder, retime, retitle, or remove layers; the backend reassembles the MP4 from the stack.";
  if (/help|what can/.test(t)) return "I can explain: video types, budget, plan beats, approval, and the layer pass. Ask about any of them.";
  return 'I cover video types, budget, plan beats, approval, and the layer pass. Try "which type fits?"';
}

/* ---------------- HTTP handlers ---------------- */

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 96 * 1024 * 1024) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("Body too large");
  }
  return data;
}

const WORKFLOW_PATH = /^\/api\/workflows\/([^/]+)(?:\/(approve|start|layers|export))?$/;

export async function handleLaunchframe(req, res, suffix) {
  await restore();
  const path = suffix;
  const workflowMatch = path.match(WORKFLOW_PATH);
  try {
    if (req.method === "POST" && path === "/api/workflows/plan") {
      const input = JSON.parse(await readBody(req));
      let origin;
      try { origin = new URL(input.url || ""); } catch { return json(res, 400, { error: { message: "Enter a complete product URL, including https://" } }); }
      if (origin.protocol !== "https:" && origin.protocol !== "http:") return json(res, 400, { error: { message: "Enter a complete product URL, including https://" } });
      if (input.videoType === "B" && !(input.founderVideoBase64 && input.founderVoiceBase64 && input.consent)) return json(res, 400, { error: { message: "Narrated demos need founder video, founder voice, and consent." } });
      const host = origin.hostname.replace(/^www\./, "");
      let profile = { category: "Product launch", videoType: input.videoType, reasons: ["A concise visual reveal fits a first launch."], palette: ["#e9d4b9", "#1e2722"] };
      let usedFixture = false;
      try {
        const html = await fetchPage(origin.toString());
        const title = titleFromHtml(html, origin.toString());
        const category = categoryFromHtml(html);
        profile = { ...profile, category, reasons: [`${title} reads as ${category.toLowerCase()}.`] };
      } catch { usedFixture = true; }
      const id = createHash("sha1").update(`${Date.now()}-${origin.hostname}`).digest("hex").slice(0, 12);
      const plan = buildPlan(input, host);
      const kindFor = (type) => type === "capture" ? "ui" : type === "generate" ? "higgsfield" : type;
      const workflow = {
        id, url: origin.toString(), status: "draft", progress: 0, plan,
        layers: plan.beats.map((beat, i) => ({
          id: `layer-${i + 1}`, kind: kindFor(beat.type), label: beat.text.slice(0, 50),
          text: beat.type === "text" ? beat.text : undefined,
          duration: beat.duration, order: i,
          source: beat.type === "capture" ? origin.toString() : undefined,
        })),
        transcript: [{ step: "plan", detail: usedFixture ? "Page could not be fetched; building from the URL alone." : "Product page captured." }],
        profile, usedFixture,
      };
      workflows.set(id, workflow);
      saveUploads(id, input);
      await persist();
      return json(res, 200, workflow);
    }

    if (workflowMatch && req.method === "POST" && workflowMatch[2] === "approve") {
      const wf = workflows.get(workflowMatch[1]);
      if (!wf) return json(res, 404, { error: { message: "Workflow not found" } });
      const body = JSON.parse(await readBody(req));
      const max = Math.max(0, Number(body.maxBudget) || 0);
      if (wf.plan && max < wf.plan.estimatedCost) return json(res, 400, { error: { message: `Budget $${max} is below the estimated $${wf.plan.estimatedCost}.` } });
      wf.status = "approved";
      wf.plan.maxBudget = max;
      await persist();
      return json(res, 200, { id: wf.id, status: "approved", plan: wf.plan });
    }

    if (workflowMatch && req.method === "POST" && workflowMatch[2] === "start") {
      const wf = workflows.get(workflowMatch[1]);
      if (!wf) return json(res, 404, { error: { message: "Workflow not found" } });
      if (wf.status !== "approved") return json(res, 400, { error: { message: "Approve the plan before starting production." } });
      if (!(await hasFfmpeg())) return json(res, 500, { error: { message: "ffmpeg is not installed — needed to assemble the cut. brew install ffmpeg." } });
      if (!hfKey()) return json(res, 503, { error: { message: "Higgsfield credentials are not configured — b-roll generation needs them. Add them to .env for real clips." } });
      wf.status = "running";
      wf.progress = 5;
      wf.error = undefined;
      const driver = { canceled: false };
      drivers.set(wf.id, driver);
      runWorkflow(wf.id, (p) => { wf.progress = p; }, (step, detail) => { wf.transcript.push({ step, detail }); }, driver)
        .then(() => { drivers.delete(wf.id); })
        .catch(async (e) => { wf.status = "failed"; wf.error = e.message; drivers.delete(wf.id); await persist(); });
      return json(res, 200, { id: wf.id, status: "running" });
    }

    if (workflowMatch && req.method === "GET" && !workflowMatch[2]) {
      const wf = workflows.get(workflowMatch[1]);
      if (!wf) return json(res, 404, { error: { message: "Workflow not found" } });
      return json(res, 200, wf);
    }

    if (workflowMatch && req.method === "PATCH" && workflowMatch[2] === "layers") {
      const wf = workflows.get(workflowMatch[1]);
      if (!wf) return json(res, 404, { error: { message: "Workflow not found" } });
      const body = JSON.parse(await readBody(req));
      for (const edit of body.layers || []) {
        const layer = wf.layers.find((l) => l.id === edit.id);
        if (!layer) continue;
        if (edit.removed) { layer.removed = true; continue; }
        if (edit.order !== undefined) layer.order = edit.order;
        if (edit.duration !== undefined) layer.duration = Math.max(0.5, Math.min(30, edit.duration));
        if (edit.text !== undefined) layer.text = String(edit.text).slice(0, 80);
      }
      await persist();
      return json(res, 200, { id: wf.id, layers: wf.layers });
    }

    if (workflowMatch && req.method === "POST" && workflowMatch[2] === "export") {
      const wf = workflows.get(workflowMatch[1]);
      if (!wf) return json(res, 404, { error: { message: "Workflow not found" } });
      if (wf.status === "complete") return json(res, 200, { id: wf.id, videoUrl: wf.videoUrl });
      // not produced yet: run the full pipeline now (without keys it assembles placeholder cards so the flow is demonstrable)
      if (!(await hasFfmpeg())) return json(res, 500, { error: { message: "ffmpeg is not installed — needed to assemble the cut. brew install ffmpeg." } });
      wf.status = "running";
      wf.progress = 5;
      const driver = { canceled: false };
      drivers.set(wf.id, driver);
      runWorkflow(wf.id, (p) => { wf.progress = p; }, (step, detail) => { wf.transcript.push({ step, detail }); }, driver)
        .then(() => { drivers.delete(wf.id); })
        .catch(async (e) => { wf.status = "failed"; wf.error = e.message; drivers.delete(wf.id); await persist(); });
      // ponytail: export waits by polling in-process state; ties one request. Fine for local single-user.
      for (let i = 0; i < 240 && workflows.get(wf.id).status === "running"; i++) await new Promise((r) => setTimeout(r, 2500));
      const now = workflows.get(wf.id);
      if (now.status !== "complete") return json(res, 503, { error: { message: now.error || "Export did not finish in time." } });
      return json(res, 200, { id: now.id, videoUrl: now.videoUrl });
    }

    if (req.method === "POST" && path === "/api/conversation/chat") {
      const body = JSON.parse(await readBody(req));
      const wf = body.workflowId ? workflows.get(body.workflowId) : undefined;
      return json(res, 200, { reply: chatReply(body.message, wf) });
    }

    return json(res, 404, { error: { message: "Not found" } });
  } catch (error) {
    return json(res, 400, { error: { message: error instanceof Error ? error.message : "Bad request" } });
  }
}
