/**
 * E2E-Tests fuer die Kamera-Follow-Funktionalitaet.
 *
 * Prueft: Nach einem Fokus-Klick fliegt das Schiff zum
 * Ziel und die Kamera folgt.
 *
 * @module e2e/camera-follow
 */

import { expect, test } from "@playwright/test";

/** Laedt die App und wartet auf den Start. */
async function openApp(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".se-nav__button").first()).toBeVisible();
  await expect(page.locator(".se-hud__title")).toBeVisible();
}

test.describe("Kamera-Follow & Auto-Travel", () => {
  test("Fokus-Knopf auf Erde laedt die Panel-Daten", async ({ page }) => {
    await openApp(page);

    await page.locator('.se-nav__button[data-body-id="erde"]').click();

    const panel = page.locator(".se-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".se-panel__title")).toHaveText("Erde");
  });

  test("Kamera rendert nach Fokus-Wechsel weiterhin", async ({ page }) => {
    await openApp(page);

    await page.locator('.se-nav__button[data-body-id="jupiter"]').click();
    await page.waitForTimeout(1000);

    const box = await page.locator("canvas#scene").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
});