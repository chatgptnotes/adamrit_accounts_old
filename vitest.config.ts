/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Unit tests only. Deliberately separate from vite.config.ts, which builds the
 * dev server (proxies, mail polling, PWA) — none of that should spin up to run
 * a pure function.
 *
 * Scope is src/ on purpose. e2e/ holds two other kinds of file that must NOT be
 * collected here:
 *   - *.test.ts  standalone vite-node scripts with their own pass/fail counters
 *   - *.spec.ts  Playwright specs that drive a real browser
 * Both are run by their own npm scripts.
 *
 * Run: npm test
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
