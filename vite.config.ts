import { defineConfig } from "vite";

// Vite config for SolarExplorer.
// base "./" is required because the built app is served from a sub path (nginx).
// publicDir zeigt auf src/data, damit bodies.json/facts.json automatisch nach
// dist/ wandern — die App laedt sie per fetch("./data/..."), und Vite kopiert
// aus publicDir nur Dateien, die im Wurzelverzeichnis liegen.
export default defineConfig({
  base: "./",
  publicDir: "src/data",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 5173,
    host: true,
  },
});
