import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// Higgsfield credentials stay on the server. The public catalog and media CDN
// are proxied too because their responses do not allow browser CORS requests.
const CLOUDFRONT = "https://d28lhcrx5qdowv.cloudfront.net";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const launchframeTarget = env.LAUNCHFRAME_URL || "http://localhost:3000";
  const hasHiggsfieldCredentials = Boolean(env.HF_API_KEY_ID && env.HF_API_KEY_SECRET);
  const higgsfieldApi: ProxyOptions = {
    target: "https://api.higgsfield.ai",
    changeOrigin: true,
    secure: true,
    configure(proxy) {
      proxy.on("proxyReq", (request) => {
        request.removeHeader("Authorization");
        if (hasHiggsfieldCredentials) {
          request.setHeader("Authorization", `Key ${env.HF_API_KEY_ID}:${env.HF_API_KEY_SECRET}`);
        }
      });
    },
    rewrite: (path) => path.replace(/^\/hfapi/, ""),
  };
  const proxies = {
    "/launchframe-api": {
      target: launchframeTarget,
      changeOrigin: true,
      secure: false,
      rewrite: (path: string) => path.replace(/^\/launchframe-api/, ""),
    },
    "/hfapi": higgsfieldApi,
    "/hfdata": {
      target: "https://dash.higgsfield.ai/api/v2",
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/hfdata/, ""),
    },
    "/hfblob": {
      target: CLOUDFRONT,
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/hfblob/, ""),
    },
  };

  return {
    plugins: [react()],
    define: {
      // A boolean capability flag is safe to expose; the key values never are.
      "import.meta.env.VITE_HF_CONFIGURED": JSON.stringify(hasHiggsfieldCredentials),
    },
    optimizeDeps: {
      // The ffmpeg library loads sibling worker.js via new URL(...); Vite's dep
      // optimizer omits it, causing load() to hang.
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
    server: { port: 5174, proxy: proxies },
    preview: { proxy: proxies },
  };
});
