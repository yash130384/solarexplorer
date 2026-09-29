/**
 * Smoke-Tests: Startet die gebaute App und prueft das Grundgeruest.
 *
 * Adressiert wird das echte Bundle aus `dist/` (siehe playwright.config.ts),
 * nicht der Dev-Server. Jeder Test laeuft gegen eine frisch geladene Seite.
 *
 * @module e2e/smoke
 */

import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/**
 * Haengt Konsolen- und Fehler-Listener an die Seite.
 *
 * Playwright sammelt Konsolenmeldungen erst ab dem Zeitpunkt, an dem der
 * Listener gesetzt wird. Deshalb wird `attachConsoleWatch` VOR `page.goto()`
 * aufgerufen — sonst verpassen wir die Fehler aus dem App-Start.
 *
 * @param page - Die Testseite.
 * @returns Die gesammelten Fehler-Console-Events als Textbausteine.
 */
function attachConsoleWatch(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(`${message.text()} (${message.location().url}:${message.location().lineNumber})`);
    }
  });
  page.on("pageerror", (error: Error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

/** Laedt die App und wartet, bis die Simulation wirklich laeuft. */
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  // Die Nav ist das letzte Bauteil, das `start()` anlegt. Sie ist damit ein
  // zuverlaessigeres Signal als `domcontentloaded` (das feuert vor den fetches).
  await expect(page.locator(".se-nav__button").first()).toBeVisible();
}

test.describe("Smoke — Grundgeruest", () => {
  test("1. Seite laedt ohne Konsolenfehler", async ({ page }) => {
    const errors = attachConsoleWatch(page);
    await openApp(page);
    // Ein paar Bilder laufen lassen, damit auch Fehler aus der Bildschleife
    // (WebGL, Kamera, HUD) erfasst werden.
    await page.waitForTimeout(1500);
    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
  });

  test("2. Titel enthaelt SolarExplorer", async ({ page }) => {
    const errors = attachConsoleWatch(page);
    await openApp(page);
    await expect(page).toHaveTitle(/SolarExplorer/);
    // Auch die sichtbare HUEBSchrift im HUD nennt den Namen.
    await expect(page.locator(".se-hud__title")).toHaveText("SolarExplorer");
    expect(errors).toEqual([]);
  });

  test("3. Canvas #scene ist sichtbar und hat Breite/Hoehe groesser 0", async ({ page }) => {
    await openApp(page);
    const canvas = page.locator("canvas#scene");
    await expect(canvas).toBeAttached();

    // Entscheidend: nicht per Screenshot, sondern per getBoundingClientRect().
    // Ein 0x0-Canvas ist im Screenshot praktisch unsichtbar, liefert aber
    // `toBeVisible()` oft True, weil das Element selbst eine Box hat. Erst
    // die gemessene Rechteckflaeche beweist, dass WebGL tats etwas malt.
    const box = await canvas.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        // Rueckgabe der WebGL-Zeichnenflaeche, nicht nur der CSS-Box.
        bitmapWidth: (element as HTMLCanvasElement).width,
        bitmapHeight: (element as HTMLCanvasElement).height,
        // Beweis, dass wirklich gerendert wurde und nicht nur eine leere
        // Textur anliegt: die Szene zeichnet Sterne und Planeten, also muss
        // im gelieferten Bild mindestens eine Farbe vorkommen, die nicht
        // rein schwarz ist. Ohne WebGL-Kontext ist readPixels unmoeglich.
        contextLost: (element as HTMLCanvasElement).getContext("webgl2") === null
          && (element as HTMLCanvasElement).getContext("webgl") === null,
      };
    });

    expect(box.width, "Canvas-Breite laut getBoundingClientRect()").toBeGreaterThan(0);
    expect(box.height, "Canvas-Hoehe laut getBoundingClientRect()").toBeGreaterThan(0);
    expect(box.bitmapWidth, "interne Zeichnenflaeche (canvas.width)").toBeGreaterThan(0);
    expect(box.bitmapHeight, "interne Zeichnenflaeche (canvas.height)").toBeGreaterThan(0);
    expect(box.contextLost, "WebGL-Kontext vorhanden").toBe(false);
  });

  test("4. Navigationsliste zeigt mindestens 9 Eintraege (Sonne + 8 Planeten)", async ({ page }) => {
    await openApp(page);
    const navButtons = page.locator(".se-nav__button");
    await expect(navButtons.first()).toBeVisible();
    expect(await navButtons.count()).toBeGreaterThanOrEqual(9);

    // Sonne und alle acht Planeten muessen namentlich auftauchen.
    for (const id of ["sonne", "merkur", "venus", "erde", "mars", "jupiter", "saturn", "uranus", "neptun"]) {
      await expect(page.locator(`.se-nav__button[data-body-id="${id}"]`)).toHaveCount(1);
    }
  });

  test("5. Info-Panel oeffnet fuer die Erde und zeigt Name und Radius 6371 km", async ({ page }) => {
    const errors = attachConsoleWatch(page);
    await openApp(page);

    await page.locator('.se-nav__button[data-body-id="erde"]').click();

    const panel = page.locator(".se-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator(".se-panel__title")).toHaveText("Erde");

    // Der Steckbrief traegt den Radius als Zeile "Radius" | "<wert> km".
    const radiusCell = page
      .locator(".se-spec tbody tr")
      .filter({ has: page.locator("th", { hasText: /^Radius$/ }) })
      .locator("td");
    await expect(radiusCell).toHaveCount(1);
    // Aequatorradius der Erde = 6371 km, im Deutschen als "6.371" formatiert.
    await expect(radiusCell).toHaveText(/6\.371\s*km/);
    await expect(radiusCell).not.toHaveText(/e\+/i);

    // Der Kindtext muss mit im Panel stehen (AGENTS.md: kein reiner Zahlenfriedhof).
    await expect(page.locator(".se-panel__text").first()).not.toBeEmpty();
    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
  });
});
