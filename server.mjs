import { createServer, request as proxyRequest } from "node:http";
import { request as proxyRequestTls } from "node:https";
import { createReadStream, promises as fs } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const id = process.env.HF_API_KEY_ID?.trim();
const secret = process.env.HF_API_KEY_SECRET?.trim();
const configured = Boolean(id && secret);
const routes = [
  ["/hfapi", "https://api.higgsfield.ai", ["GET", "POST"]],
  ["/hfdata", "https://dash.higgsfield.ai/api/v2", ["GET", "HEAD"]],
  ["/hfblob", "https://d28lhcrx5qdowv.cloudfront.net", ["GET", "HEAD"]],
  ["/launchframe-api", process.env.LAUNCHFRAME_URL || "http://localhost:3000", ["GET", "POST", "PATCH"]],
].map(([prefix, value, methods]) => {
  const target = new URL(value);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error(`Invalid upstream URL for ${prefix}`);
  }
  return { prefix, target, methods };
});
const mime = {
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".mp4": "video/mp4",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
  ".webm": "video/webm", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
};
const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"]);

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function proxy(req, res, route) {
  const { prefix, target, methods } = route;
  if (!methods.includes(req.method)) return send(res, 405, { error: "Method not allowed" });
  const [pathname, search = ""] = req.url.split("?", 2);
  const suffix = pathname.slice(prefix.length) || "/";
  const path = `${target.pathname.replace(/\/$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}${search ? `?${search}` : ""}`;
  const headers = { ...req.headers, host: target.host };
  for (const name of hopByHop) delete headers[name];
  if (prefix === "/hfapi") {
    delete headers.authorization;
    if (!configured) return send(res, 503, { error: "Higgsfield API is not configured" });
    headers.authorization = `Key ${id}:${secret}`;
  }
  const transport = target.protocol === "https:" ? proxyRequestTls : proxyRequest;
  const upstream = transport(target.origin, { method: req.method, path, headers }, (response) => {
    const responseHeaders = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined && !hopByHop.has(name.toLowerCase())) responseHeaders[name] = value;
    }
    res.writeHead(response.statusCode || 502, responseHeaders);
    response.pipe(res);
  });
  upstream.on("error", () => { if (!res.headersSent) send(res, 502, { error: "Upstream request failed" }); else res.destroy(); });
  req.pipe(upstream);
}

async function serve(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { return send(res, 400, { error: "Invalid path" }); }
  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: "Forbidden" });
  let actual = file;
  try {
    const info = await fs.stat(actual);
    if (info.isDirectory()) actual = resolve(actual, "index.html");
    await fs.access(actual);
  } catch {
    if (req.headers.accept?.includes("text/html")) actual = resolve(root, "index.html");
    else return send(res, 404, { error: "Not found" });
  }
  let info;
  try { info = await fs.stat(actual); }
  catch { return send(res, 404, { error: "Not found" }); }
  const type = mime[extname(actual).toLowerCase()] || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", info.size);
  if (type.startsWith("text/html")) {
    let html;
    try { html = await fs.readFile(actual, "utf8"); }
    catch { return send(res, 404, { error: "Not found" }); }
    html = html.replace(/<\/head>/i, `<script>window.__FIELD_HF_CONFIGURED__=${configured};</script></head>`);
    res.setHeader("Content-Length", Buffer.byteLength(html));
    if (req.method === "HEAD") res.end(); else res.end(html);
    return;
  }
  if (req.method === "HEAD") return res.end();
  createReadStream(actual).on("error", () => res.destroy()).pipe(res);
}

createServer((req, res) => {
  const route = routes.find(({ prefix }) => req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`));
  if (route) return void proxy(req, res, route);
  void serve(req, res);
}).listen(Number(process.env.PORT) || 3000, process.env.HOST || "0.0.0.0");
