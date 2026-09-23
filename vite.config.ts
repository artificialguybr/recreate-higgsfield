import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Higgsfield's API and feed expose no CORS headers, so the browser talks to
// them through two dev proxies. In production a real server does this job.
// /hfblob proxies the media CDN (also no CORS) so the editor can export
// generated clips.
const CLOUDFRONT = "https://d28lhcrx5qdowv.cloudfront.net";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const launchframeTarget = env.LAUNCHFRAME_URL || "http://localhost:3000";
  return {
    plugins: [react()],
    optimizeDeps: {
      // @ffmpeg/ffmpeg loads a sibling worker.js via new URL(...); the dep
      // optimizer bundles the lib but not that worker, so the worker 404s
      // and load() hangs. Serve it unbundled instead.
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },
    server: {
      port: 5174,
      proxy: {
        "/launchframe-api": {
          target: launchframeTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/launchframe-api/, ""),
        },
        "/hfapi": {
          target: "https://api.higgsfield.ai",
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/hfapi/, ""),
        },
        "/hfdata": {
          target: "https://dash.higgsfield.ai/api/v2",
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/hfdata/, ""),
        },
        "/hfblob": {
          target: CLOUDFRONT,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/hfblob/, ""),
        },
      },
    },
  };
});
