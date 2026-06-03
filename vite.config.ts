import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    ...(mode === 'development' ? [basicSsl()] : []),
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
}));