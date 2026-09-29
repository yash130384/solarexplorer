/**
 * SolarExplorer — Einstiegspunkt. Reiner Bootstrap: Canvas holen, App
 * starten und `dispose` registrieren. Die gesamte Verdrahtung liegt in
 * `src/app.ts`.
 */

import { SolarExplorerApp } from "./app";

/** Zeigt eine freundliche deutsche Fehlermeldung, wenn der Start scheitert. */
function showStartError(message: string): void {
  const root = document.querySelector<HTMLElement>("#app") ?? document.body;
  const alert = document.createElement("div");
  alert.className = "se-fatal";
  alert.setAttribute("role", "alert");
  alert.dataset["testid"] = "app-error";
  const heading = document.createElement("h1");
  heading.textContent = "SolarExplorer konnte nicht starten";
  const text = document.createElement("p");
  text.textContent = message;
  alert.append(heading, text);
  root.replaceChildren(alert);
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) {
  showStartError("Im HTML fehlt das Canvas mit der id 'scene'.");
} else {
  const app = new SolarExplorerApp(canvas);
  window.addEventListener("beforeunload", () => app.dispose());
  app.start().catch((cause: unknown) => {
    const why = cause instanceof Error ? cause.message : "unbekannter Fehler";
    showStartError(`Bitte lade die Seite neu. Grund: ${why}.`);
  });
}
