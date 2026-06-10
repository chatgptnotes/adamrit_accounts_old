import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

// Dev-only Slack relay. The browser can't POST to a Slack webhook directly
// (no CORS), so the page POSTs { text } to same-origin /api/slack and this
// middleware forwards it server-side to SLACK_WEBHOOK_URL (kept in .env.local,
// gitignored). The Slack Workflow webhook variable key is literally "t-e-x-t"
// (with dashes), so the forwarded body MUST use that key. In production the same
// /api/slack path is handled by the Vercel function api/slack.ts — so one URL
// works in both; this middleware only runs under `npm run dev`.
function slackProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: "slack-proxy-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/slack", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }
        const webhook = env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (!webhook) {
          send(500, { error: "SLACK_WEBHOOK_URL not set in .env.local" });
          return;
        }
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          try {
            const { text } = JSON.parse(raw || "{}");
            const r = await fetch(webhook, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "t-e-x-t": text ?? "" }),
            });
            send(r.ok ? 200 : 502, { ok: r.ok, status: r.status });
          } catch (e) {
            send(500, { error: e instanceof Error ? e.message : String(e) });
          }
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load non-VITE_ env (e.g. SLACK_WEBHOOK_URL) for server-side dev use only.
  const env = loadEnv(mode, process.cwd(), "");
  return {
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    ...(mode === 'development' ? [basicSsl(), slackProxyPlugin(env)] : []),
    react(),
    // Service worker for installability + instant app-shell launch. We keep the
    // hand-written public/manifest.webmanifest (manifest: false) and only let the
    // plugin generate/register the SW. No data caching — offline data is out of
    // scope; this exists so Chrome/Android offers "Install" and the installed
    // app launches without a blank screen.
    VitePWA({
      // autoUpdate (not "prompt"): the new service worker activates and the page
      // reloads automatically when a deploy ships, so users never get stuck on a
      // stale cached bundle (which caused 404s on newly-added routes). Pairs with
      // skipWaiting + clientsClaim below.
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false,
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon.png",
        "splash/*.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        navigateFallback: "/index.html",
        // Never serve the SPA shell for API/auth requests.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Allow the larger vendor chunks (pdf/ckeditor) into the precache so the
        // installed app launches fully offline-capable for its shell.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['jspdf', '@ckeditor/ckeditor5-build-classic']
  },
  build: {
    target: 'es2015',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // NOTE: Manual chunk splitting removed entirely. Previous config caused
      // runtime crashes: react-router "Cannot read createContext", recharts
      // "Cannot access 'S' before initialization". Rollup's automatic code
      // splitting handles module initialization order correctly.
      onwarn(warning, warn) {
        if (warning.code === 'UNRESOLVED_IMPORT' ||
            warning.code === 'MISSING_EXPORT') {
          return;
        }
        warn(warning);
      }
    }
  }
  };
});