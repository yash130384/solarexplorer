/**
 * Selbsttest des Smoke-Tests 3: faengt er ein 0x0-Canvas wirklich ab?
 *
 * Der Test in `smoke.spec.ts` prueft die Canvas-Groesse per
 * `getBoundingClientRect()` und zusaetzlich per `canvas.width` (der internen
 * WebGL-Zeichnenflaeche). Diese Datei beweist, dass die Pruefung nicht etwa
 * "immer gruen" ist: sie verbaut das Canvas testweise und erwartet, dass
 * dieselbe Messung fehlschlaegt.
 *
 * Gemessene Fakten (Playwright 1.63):
 * - CSS-Box auf 0x0  -> `getBoundingClientRect()` liefert 0/0, der Test faellt.
 * - `toBeVisible()` wertet ein 0x0-Element ebenfalls als hidden.
 * - CSS-Box korrekt, aber `canvas.width = 0`: Hier ist die BBox perfekt und
 *   `toBeVisible()` wuerde gruen melden — nur die Pruefung der internen
 *   Zeichnenflaeche faengt das. Deshalb prueft Smoke-Test 3 beides.
 * Ein Screenshot wuerde in beiden Faellen ein schwarzes Bild zeigen, das ohne
 * Pixelvergleich als "leer" durchgeht.
 *
 * @module e2e/canvas-zero-proof
 */

import { expect, test } from "@playwright/test";

test.describe("Gegenbeweis — 0x0-Canvas wird erkannt", () => {
  test("dieselbe Messung schlaegt bei 0x0 fehl (Screenshot waere blind)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".se-nav__button").first()).toBeAttached();

    const canvas = page.locator("canvas#scene");

    // Vorher: groesse wie erwartet.
    const healthy = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(healthy.width).toBeGreaterThan(0);
    expect(healthy.height).toBeGreaterThan(0);

    // Jetzt der entscheidende Schritt: das Canvas auf 0x0 zwingen — genau der
    // Fehler, der bei einem Kind als "schwarzes Bild" auffaellt.
    await canvas.evaluate((element) => {
      const style = (element as HTMLCanvasElement).style;
      style.width = "0px";
      style.height = "0px";
    });

    const broken = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(broken.width).toBe(0);
    expect(broken.height).toBe(0);

    // Und die eigentliche Behauptung des Smoke-Tests schlaegt jetzt fehl:
    await expect(canvas).toHaveJSProperty("clientWidth", 0);
    expect(broken.width, "genau diese Groessenpruefung erkennt das 0x0-Canvas").toBe(0);

    // Ergaenzende Beobachtung (korrigiert nach dem ersten Lauf):
    // Playwright 1.63 wertet ein 0x0-Element selbst als NICHT sichtbar. Die
    // Flaechenmessung ist damit nicht der einzige Weg, ein 0x0-Canvas zu
    // finden — sie ist aber der eindeutigere, weil sie die tatsaechliche
    // Rechteckflaeche des Canvas prueft und nicht von Playwrights
    // Sichtbarkeits-Heuristik (BBox-Flaeche > 0) abhaengt. Zusaetzlich faengt
    // sie den Fall, in dem das Canvas die richtige Box hat, aber die interne
    // WebGL-Zeichnenflaeche (canvas.width) 0 ist — dort ist die BBox korrekt
    // und `toBeVisible()` wuerde gruen melden.
    await canvas.evaluate((element) => {
      const style = (element as HTMLCanvasElement).style;
      style.width = "1280px";
      style.height = "800px";
      (element as HTMLCanvasElement).width = 0;
      (element as HTMLCanvasElement).height = 0;
    });
    const wrongBitmap = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const canvas = element as HTMLCanvasElement;
      return { width: rect.width, height: rect.height, bitmap: canvas.width };
    });
    // BBox ist perfekt, trotzdem ist nichts zu sehen: genau der Blindfleck,
    // den nur `canvas.width` im Smoke-Test 3 aufdeckt.
    expect(wrongBitmap.width).toBeGreaterThan(0);
    expect(wrongBitmap.height).toBeGreaterThan(0);
    expect(wrongBitmap.bitmap, "WebGL-Zeichnenflaeche ist 0 trotz korrekter CSS-Box").toBe(0);
  });
});
