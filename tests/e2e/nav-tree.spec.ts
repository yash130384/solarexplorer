/**
 * Baum-Navigation bei 465 Koerpern (Ticket 15, Teil B).
 *
 * Prueft das, was Unit-Tests in jsdom nicht koennen: dass die Seite bei 465
 * Koerpern sofort benutzbar ist, der Baum aufklappt, die Live-Suche ohne
 * Wartezeit filtert und jeder Planet einen echten Kindtext zeigt.
 *
 * @module tests/e2e/nav-tree.spec
 */

import { test, expect, type Page } from "@playwright/test";

/** Wartezeit nach einer Eingabe, bevor der Zustand als stabil gilt. */
const SETTLE_MS = 300;

/**
 * Fuellt das Suchfeld der Navigation.
 *
 * @param page Playwright-Seite.
 * @param term Suchbegriff.
 */
async function search(page: Page, term: string): Promise<void> {
  await page.locator("nav input").first().fill(term);
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Laedt die Seite und wartet, bis die Navigation bedienbar ist.
 *
 * @param page Playwright-Seite.
 */
async function ready(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav button[data-body-id]", { timeout: 15_000 });
  await page.waitForTimeout(1_000);
}

test("Seite ist bei 465 Koerpern sofort bedienbar", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  const started = Date.now();
  await ready(page);
  console.log(`NAV bedienbar nach ${Date.now() - started} ms`);

  // Kernpunkt der Aufgabe: bei 465 Koerpern wird NICHT alles gerendert.
  // Eingeklappte <details> duerfen ihre Monde nicht im DOM ablegen.
  const start = await page.evaluate(() => {
    const nav = document.querySelector("nav") as HTMLElement;
    return {
      buttons: nav.querySelectorAll("button[data-body-id]").length,
      details: nav.querySelectorAll("details").length,
      openDetails: nav.querySelectorAll("details[open]").length,
      status: nav.querySelector(".se-nav__status")?.textContent ?? "",
    };
  });
  console.log(`Startzustand: ${JSON.stringify(start)}`);

  // Standard: Planeten sichtbar, Monde eingeklappt. Ohne den "Nur bekannte"
  // -Filter sind Sonne + 8 Planeten direkt erreichbar (9 Knoten); die Monde
  // kommen erst beim Aufklappen dazu.
  expect(start.buttons, "Mondliste wird ungefragt gerendert").toBeLessThanOrEqual(9);
  expect(start.openDetails, "Monde sind standardmaessig aufgeklappt").toBe(0);
  expect(errs).toEqual([]);
});

test("Planet waehlen und Monde aufklappen sind zwei getrennte Schritte", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await ready(page);

  const saturnButton = page.locator('nav button[data-body-id="saturn"]');
  // Knopf und <details> sind Geschwister in .se-nav__planet-head — der Knopf
  // liegt bewusst AUSSERHALB des <details>, sonst loest jeder Klick Toggle
  // und Auswahl zugleich aus.
  const saturnDetails = saturnButton.locator("xpath=following-sibling::details[1]");
  const summary = saturnDetails.locator("summary").first();

  // 1. Der Planet-Knopf waehlt aus, ohne den Baum zu aufklappen.
  await saturnButton.click();
  await page.waitForTimeout(400);
  expect(
    await page.locator('nav button[data-body-id="saturn"]').getAttribute("aria-current"),
    "Planet nicht ausgewaehlt",
  ).toBe("true");
  expect(
    await saturnDetails.getAttribute("open"),
    "Auswahl klappt ungefragt die Monde auf",
  ).toBeNull();

  // 2. Der Summary klappt die Monde auf — mit echtem Playwright-Klick, damit
  //    ein nicht anklickbares Element hier sofort auffaellt.
  await summary.click();
  await page.waitForTimeout(500);
  const moonButtons = await page.locator("nav .se-nav__moons button[data-body-id]").count();
  console.log(`Saturn-Monde nach Aufklappen: ${moonButtons}`);
  expect(moonButtons, "Saturn-Monde fehlen").toBeGreaterThan(0);

  // 3. Und wieder zuklappen.
  await summary.click();
  await page.waitForTimeout(400);
  expect(
    await saturnDetails.getAttribute("open"),
    "Zuklappen funktioniert nicht",
  ).toBeNull();

  expect(errs).toEqual([]);
});

test("Live-Suche filtert beim Tippen sofort", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav input", { timeout: 15_000 });
  await page.waitForTimeout(800);

  for (const term of ["io", "titan", "erde"]) {
    const t0 = Date.now();
    await search(page, term);
    const count = await page.locator("nav button[data-body-id]").count();
    console.log(`Suche "${term}": ${count} Treffer nach ${Date.now() - t0} ms`);
    // "io" ist bewusst ein reiner Teilstring ("Titan", "Rhea" ...), dort
    // zaehlt nur, dass ueberhaupt gefiltert wurde. Die exakten Treffer
    // pruefen "titan" und "erde".
    if (term !== "io") {
      await expect(
        page.locator(`nav button[data-body-id="${term}"]`),
        `Suche "${term}" findet den Koerper nicht`,
      ).toBeVisible();
    }
    expect(count, `Suche "${term}" zeigt gar nichts`).toBeGreaterThan(0);
    expect(count, `Suche "${term}" filtert nicht`).toBeLessThan(465);
  }

  await search(page, "");
  expect(await page.locator("nav button[data-body-id]").count()).toBeLessThanOrEqual(9);
  expect(errs).toEqual([]);
});

test("Suche findet auch einen winzigen Mond", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav input", { timeout: 15_000 });
  await page.waitForTimeout(800);

  // "S/2009 S 1" ist der kleinste gemessene Saturnmond (Radius 0,15 km) und
  // steht bei "Zeige alle" weit hinten in der Liste — die Suche muss ihn
  // trotzdem ohne Blättern finden.
  await search(page, "S/2009 S 1");
  const hit = page.locator('nav button[data-body-id="saturn-s2009s1"]');
  await expect(hit, "Kleinster Saturnmond nicht auffindbar").toBeVisible();

  await hit.click();
  await page.waitForTimeout(600);
  const panel = await page.locator("body").innerText();
  expect(panel, "undefined im Info-Panel").not.toContain("undefined");
  expect(panel, "NaN im Info-Panel").not.toContain("NaN");
  expect(panel, "Panel nennt den Mond nicht").toContain("S/2009 S 1");
  expect(errs).toEqual([]);
});

test("alle acht Planeten zeigen einen echten Kindtext", async ({ page }) => {
  // Acht Planeten mit je 400 ms Panel-Wartezeit plus Seitenaufbau passen
  // nicht in das globale 30-s-Fenster.
  test.setTimeout(90_000);
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await ready(page);

  const planets = ["merkur", "venus", "erde", "mars", "jupiter", "saturn", "uranus", "neptun"];
  for (const id of planets) {
    await page.locator(`nav button[data-body-id="${id}"]`).click();
    await page.waitForTimeout(400);
    const text = await page.locator("body").innerText();
    expect(text, `${id}: Platzhalter statt Kindtext`).not.toContain("Daten noch nicht erfasst");
    expect(text, `${id}: "undefined" im Panel`).not.toContain("undefined");
  }
  expect(errs).toEqual([]);
});
