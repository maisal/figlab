import { defineConfig } from "vite";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  // WebKit blocks the worker script under require-corp without this.
  "Cross-Origin-Resource-Policy": "same-origin",
};

// The page lives in web/. The wasm modules are read from ../pkg (built by
// scripts/build-wasm.mjs), so the server may read one level above the root.
export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2023",
  },
  // Cross-origin isolation gives performance.now() a finer resolution
  // (5 µs instead of 100 µs in Chrome).
  server: {
    fs: { allow: [".."] },
    headers: isolation,
  },
  preview: {
    headers: isolation,
  },
  worker: {
    format: "es",
  },
});
