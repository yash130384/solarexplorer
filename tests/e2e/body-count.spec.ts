/**
 * Koerperzaehler in der Navigation (Ticket 16).
 *
 * Regression: Die Navigations-Statuszeile meldete "464 von 465 Koerpern",
 * obwohl alle 465 Koerper aus bodies.json belegt sind. Ursache war
 * `isKnownBody()`: es verlangte `radiusKm > 0`, wodurch der bestaetigte
 * Saturnmond S/2009 S 2 (kein gemessener Radius in der Fachliteratur)
 * aus der Liste fiel. Zaehler ist der Ort, an dem ein Kind die Vollstaendigkeit
 * des Datensatzes sieht — eine falsche Zahl faellt hier zuerst auf.
 *
 * @module tests/e2e/body-count
 */

import { expect, test, type Page } from "@playwright/test";

/**
 * Laedt die Seite und wartet, bis die App vollstaendig gestartet ist.
 *
 * @param page Playwright-Seite.
 */
async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  // Die Nav-Statuszeile wird beim Rendern der Koerperliste geschrieben.
  await expect(page.locator(".se-nav__status")).toBeVisible();
}

/**
 * Liest den Koerperzaehler aus der Statuszeile.
 *
 * @param page Playwright-Seite.
 * @returns Der vollstaendige Text der Statuszeile.
 */
async function readStatus(page: Page): Promise<string> {
  return (await page.locator(".se-nav__status").innerText()).trim();
}

test.describe("Koerperzaehler", () => {
  test("zeigt alle 465 Koerper als bekannt an", async ({ page }) => {
    await ready(page);
    const status = await readStatus(page);
    console.log(`Statuszeile: "${status}"`);

    // 1 Sonne + 8 Planeten + 456 Monde = 465. Jeder dieser Koerper hat in
    // bodies.json eine berechenbare Umlaufbahn, alle sind also "bekannt".
    expect(status, `Statuszeile meldet nicht alle Koerper: "${status}"`).toBe(
      "465 von 465 Körpern — Mond-Resten mit „Zeige alle“.",
    );
  });

  test("die Sonne bleibt auch im Filter-Nachweis sichtbar", async ({ page }) => {
    // Zweiter Teil derselben Regression: `isKnownBody` liefert fuer die
    // Sonne false (type "star"). Haette `isVisible` die Sonne mitgefiltert,
    // waere der Baum ohne Wurzel — und der Zaehler stuende wieder bei 464.
    await ready(page);
    await expect(
      page.locator('.se-nav__button[data-body-id="sonne"]'),
      "Sonne fehlt im Baum",
    ).toHaveCount(1);
  });

  test("S/2009 S 2 ohne gemessenen Radius zaehlt mit", async ({ page }) => {
    // Der konkrete Koerper, der den Zaehler vorher auf 464 drueckte.
    await page.goto("/");
    await page.waitForSelector(".se-nav__input", { timeout: 20_000 });
    await page.locator(".se-nav__input").first().fill("S/2009 S 2");
    await page.waitForTimeout(500);

    const status = await readStatus(page);
    console.log(`Suche "S/2009 S 2": "${status}"`);
    expect(status, "S/2009 S 2 wird nicht gefunden").toMatch(/1 passende Körper/);
    await expect(
      page.locator('.se-nav__button[data-body-id="saturn-s2009s2"]'),
      "Mond ohne Radius fehlt in der Navigation",
    ).toBeVisible();
  });

  test('"Zeige alle" zaehlt ebenfalls 465', async ({ page }) => {
    // Gegenprobe: der Filter darf durch nichts hindurch einen Koerper
    // verschlucken. Auch ohne den Filter "Nur bekannte" sind es 465.
    await ready(page);
    await page.locator(".se-nav__filter").selectOption("all");
    await page.waitForTimeout(500);
    const status = await readStatus(page);
    console.log(`Statuszeile "Zeige alle": "${status}"`);
    expect(status).toBe("465 Körper.");
  });
});
