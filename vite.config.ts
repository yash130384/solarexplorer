import { defineConfig } from "vite";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Vite config for SolarExplorer.
// base "./" is required because the built app is served from a sub path (nginx).
//
// publicDir bleibt auf dem Vite-Default `public`. Dort liegen die Assets aus
// Ticket 17 (Texturen, Schiffs-GLB, Audio) unter media/ — sie werden 1:1 nach
// dist/ kopiert, ohne Hash, und sind ueber ./media/... zur Laufzeit erreichbar.
//
// bodies.json/facts.json liegen in src/data und werden per fetch geladen
// (kein ES-Import, sonst laege die 400-KB-Datei im JS-Bundle). Vite kopiert
// aus publicDir nur Dateien, die im Wurzelverzeichnis liegen, deshalb laeuft
// nach dem public-Kopieren ein kurzer buildPlugin, der die beiden JSONs
// flach nach dist/ legt — genau das erwartet DATA_BASE_URLS in src/app.ts:47.
function copyDataJson() {
  return {
    name: "solarexplorer-copy-data-json",
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      mkdirSync(outDir, { recursive: true });
      for (const name of ["bodies.json", "facts.json"]) {
        cpSync(resolve(__dirname, "src/data", name), resolve(outDir, name));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyDataJson()],
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
