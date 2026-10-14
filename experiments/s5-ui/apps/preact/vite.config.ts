import { defineConfig } from "vite";

// No @preact/preset-vite: Vite's own JSX transform reads "jsxImportSource" from tsconfig.json.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
