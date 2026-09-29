/**
 * Determinismus-Nachweis (Ticket 14).
 *
 * Die Szene muss bei zwei Aufrufen identisch aussehen. Geprueft wird das
 * nicht per grep, sondern indem zweimal hintereinander dieselben
 * Koerperpositionen, Groessen und der Asteroidenguertel verglichen werden —
 * inklusive der Zahl der Sterne und der Reihenfolge der Instanzen.
 */
import { expect, test } from "@playwright/test";

test.describe("Determinismus", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1200);
  });

  test("zwei Seitenaufrufe liefern dieselbe Szene", async ({ page }) => {
    // Fester Simulationszeitpunkt (J2000). Ohne ihn misst der Vergleich die
    // Zeitraffer-Geschwindigkeit — die Szene laeuft weiter, zwei Aufrufe
    // koennen nie gleich sein. Geprueft wird die Struktur der Szene,
    // nicht der Zeitfortschritt.
    const snapshot = async (): Promise<string> =>
      await page.evaluate(() => {
        const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as
          | { snapshot: (atJulianDate?: number) => string }
          | undefined;
        if (hook === undefined) {
          throw new Error("window.__solarExplorer fehlt — Debug-Hook nicht aktiv.");
        }
        return hook.snapshot(2451545);
      });

    const first = await snapshot();
    // Seite komplett neu laden — zweite "Aufruf" der Szene.
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1200);
    const second = await snapshot();

    console.log(`SNAPSHOT-Laenge: ${first.length} Zeichen`);
    expect(first.length, "Snapshot-Hook liefert Daten").toBeGreaterThan(100);
    expect(
      second,
      `Szene ist nicht deterministisch!\n  #1: ${first.slice(0, 300)}\n  #2: ${second.slice(0, 300)}`,
    ).toBe(first);
  });
});
