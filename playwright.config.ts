/**
 * Playwright-Konfiguration fuer die End-to-End-Tests.
 *
 * Die Tests laufen gegen das fertig gebaute Bundle aus `dist/` — also genau
 * gegen die Dateien, die auch der nginx-Container im Docker-Image ausliefert.
 * Standardmaessig startet `webServer` den Container:
 *
 *     docker compose up -d
 *
 * Auf Systemen ohne Docker-Zugriff (z. B. wenn der Nutzer nicht in der Gruppe
 * `docker` ist) kann ein beliebiger statischer Server auf Port 8090 benutzt
 * werden. Dafuer reicht eine Umgebungsvariable, damit die Tests nicht
 * umgebaut werden muessen:
 *
 *     E2E_SERVER_COMMAND="npx vite preview --port 8090" npx playwright test
 *
 * `reuseExistingServer: true` sorgt dafuer, dass ein bereits laufender Server
 * auf 8090 wiederverwendet wird und der Befehl gar nicht erst laeuft.
 *
 * @module playwright.config
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * Basis-URL des gebauten Bundles (Port 8090 laut AGENTS.md).
 *
 * Ueber `E2E_BASE_URL` uebersteuerbar: auf Rechnern, auf denen Port 8090
 * schon von einem anderen Container belegt ist, laesst sich sonst nicht
 * gegen den frischen `dist/`-Stand messen (ein `reuseExistingServer`
 * wuerde still den alten Server nehmen und veraltete Zahlen liefern).
 */
const BASE_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:8090";

/** Befehl zum Starten des Servers; ueber `E2E_SERVER_COMMAND` uebersteuerbar. */
const SERVER_COMMAND = process.env["E2E_SERVER_COMMAND"] ?? "docker compose up -d && sleep 8";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  // `baseURL` steht in `use`, nicht auf oberster Ebene: in Playwright 1.63
  // akzeptiert der Config-Typ `baseURL` nur dort, und ein hoeher gesetztes
  // `baseURL` wird beim Starten kommentarlos verworfen — `page.goto("/")`
  // scheitert dann mit "Cannot navigate to invalid URL".
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
