/**
 * Erzeugt den Screenshot fuer die README.
 *
 * Laeuft nicht ueber `npx playwright test`, sondern als eigenes Skript, weil
 * es kein Test ist sondern ein Doku-Artefakt. Aufruf:
 *
 *     node tools/make_screenshot.mjs
 *
 * Voraussetzung: ein Server auf http://127.0.0.1:8090, der `dist/` ausliefert.
 * Das Ergebnis landet in `docs/solarexplorer.png`.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const PAGE_URL = process.env.SE_SCREENSHOT_URL ?? "http://127.0.0.1:8090/";
const DOCS_DIR = new URL("../docs/", import.meta.url).pathname;
const OUT = `${DOCS_DIR}solarexplorer.png`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(PAGE_URL, { waitUntil: "load" });
// Auf die Simulation warten, damit Planeten und Bahnen im Bild sind.
await page.locator(".se-nav__button").first().waitFor({ state: "attached" });
await page.waitForTimeout(4000);
await mkdir(DOCS_DIR, { recursive: true });
await page.screenshot({ path: OUT });
await browser.close();
console.log(`Screenshot geschrieben: ${OUT}`);
