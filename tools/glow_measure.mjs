/**
 * Misst den Sonnen-Glanz am **Bildfeld** um die Sonne — die einzige Messung,
 * die der Software-Rasterisierer zuverlaessig liefert.
 *
 * Aufruf:
 *   SE_SCAN_URL=http://127.0.0.1:4173/ node tools/glow_measure.mjs
 *   SE_GLOW_SHOT=docs/glow-on.png node tools/glow_measure.mjs
 *
 * Warum ein Feld und keine Linie durch die Sonne: die Kamera folgt dem Schiff
 * und gleitet auch bei angehaltener Simulationszeit noch, bis ihre Glaettung
 * zur Ruhe kommt. Ein Linienprofil durch den Scheitel misst dann an
 * unterschiedlichen Bildpunkten und liefert Scheinwerte (beobachtet:
 * Scheitelversatz 84 px zwischen zwei Durchgaengen derselben Seite).
 * Das Feld um die Sonne liegt dagegen in festen Bildkoordinaten, und die
 * Simulation wird vorher angehalten — die Messung ist damit wiederholbar.
 *
 * Jede Messung wird zweimal genommen: die zweite liegt im identischen Zustand
 * und weist die Restwanderung aus, statt sie stillschweigend wegzulassen.
 *
 * @module tools/glow_measure
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

/** Basis-URL des Servers, der `dist/` ausliefert. */
const URL = process.env["SE_SCAN_URL"] ?? "http://127.0.0.1:4173/";
/** Query-String des Messlaufs. */
const QUERY = process.env["SE_SCAN_QUERY"] ?? "?bloom=on";
/** Optionaler Screenshot-Pfad (sonst keiner). */
const SHOT = process.env["SE_GLOW_SHOT"] ?? "";

/** Feldfenster um die Sonne (Viewport 1280x800). */
const FIELD = { x: 480, y: 250, width: 320, height: 320 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (error) => console.log("pageerror:", error.message));
await page.goto(`${URL}${QUERY}`);
await page.waitForFunction(() => window.__solarExplorer !== undefined, undefined, {
  timeout: 20_000,
});
await page.waitForTimeout(4000);

const out = await page.evaluate(async (field) => {
  const hook = window.__solarExplorer;
  hook.setPaused(true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const read = () => hook.sampleFrame(field);
  const on1 = await read();
  hook.setBloomMode("off");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const off = await read();
  const off2 = await read();
  hook.setBloomMode("on");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const on2 = await read();
  return { on1, off, off2, on2, settings: hook.getStats().bloom };
}, FIELD);

const brief = (s) =>
  `mean ${s.meanLuminance.toFixed(1)}  kern ${s.corePixels}  max ${s.maxLuminance}`;

console.log(`query=${QUERY}  Bloom ${JSON.stringify(out.settings)}`);
console.log(`  ohne Bloom  ${brief(out.off)}  (Kontrolle: ${brief(out.off2)})`);
console.log(`  mit Bloom   ${brief(out.on1)}   (Kontrolle: ${brief(out.on2)})`);
console.log(
  `  Faktor mean ${(out.on1.meanLuminance / Math.max(out.off.meanLuminance, 0.1)).toFixed(2)}` +
    `, kern ${(out.on1.corePixels / Math.max(out.off.corePixels, 1)).toFixed(2)}`,
);
if (SHOT !== "") {
  // Der Screenshot muss den Zustand zeigen, den `QUERY` benennt. Die Messung
  // endet auf `on` (der zweite Durchgang), also wird der Modus aus dem
  // Query-String erst hier wieder eingestellt — sonst hiesse "glow-off.png"
  // zwar so, zeigte aber den Glanz.
  const wantsOff = /bloom=off/.test(QUERY);
  await page.evaluate((off) => window.__solarExplorer.setBloomMode(off ? "off" : "on"), wantsOff);
  await page.waitForTimeout(1500);
  await writeFile(SHOT, await page.screenshot());
  console.log(`geschrieben: ${SHOT} (bloom=${wantsOff ? "off" : "on"})`);
}
await browser.close();
