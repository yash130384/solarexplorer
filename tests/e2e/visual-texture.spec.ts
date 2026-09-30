/**
 * Quelltext fuer den Sichtnachweis: laedt die gebaute App, fliegt die Venus
 * an und legt einen Screenshot unter `docs/` ab.
 *
 * Nur manuell zu starten (nicht Teil der Testsuite):
 *
 *     E2E_BASE_URL=http://localhost:4173 E2E_SERVER_COMMAND=true \
 *       ./node_modules/.bin/playwright test tests/e2e/visual-texture.spec.ts
 *
 * @module e2e/visual-texture
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Laedt die App, wartet auf die Texturen und haelt die Zeit an.
 *
 * @param page - Die Testseite.
 * @returns {Promise<void>}
 */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => {
      const hook = (window as unknown as Record<string, unknown>)[
        "__solarExplorer"
      ] as { getStats: () => { textured: number } } | undefined;
      return hook !== undefined && hook.getStats().textured >= 15;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>)[
      "__solarExplorer"
    ] as { setPaused: (value: boolean) => void };
    hook.setPaused(true);
  });
}

test.describe("Sichtnachweis (manuell)", () => {
  test("Screenshot der texturierten Venus", async ({ page }) => {
    await open(page);
    await page.locator('nav button[data-body-id="venus"]').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "docs/textur-venus.png" });

    await page.locator('nav button[data-body-id="jupiter"]').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "docs/textur-jupiter.png" });

    await page.locator('nav button[data-body-id="saturn"]').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "docs/textur-saturn.png" });

    expect(true).toBe(true);
  });
});
