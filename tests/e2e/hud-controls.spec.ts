/**
 * E2E-Tests fuer die HUD-Steuerung: Skalierungs-Wechsel und
 * Sichtbarkeits-Filter.
 *
 * Diese Tests laufen gegen das gebaute Bundle auf Port 8090.
 * Sie pruefen, dass die HUD-Knöpfe die Skalierungsmodi und
 * den Sichtbarkeitsfilter korrekt umschalten.
 *
 * @module e2e/hud-controls
 */

import { expect, test } from "@playwright/test";

/** Laedt die App und wartet auf den Start. */
async function openApp(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".se-nav__button").first()).toBeVisible();
  await expect(page.locator(".se-hud__title")).toBeVisible();
}

test.describe("HUD — Skalierungs-Wechsel", () => {
  test("Size-Toggle: visual <-> real", async ({ page }) => {
    await openApp(page);

    const visualBtn = page.locator(
      '.se-toggle__button[data-kind="size"][data-mode="visual"]',
    );
    const realBtn = page.locator(
      '.se-toggle__button[data-kind="size"][data-mode="real"]',
    );

    await expect(visualBtn).toHaveAttribute("aria-pressed", "true");
    await expect(realBtn).toHaveAttribute("aria-pressed", "false");

    await realBtn.click();
    await expect(realBtn).toHaveAttribute("aria-pressed", "true");
    await expect(visualBtn).toHaveAttribute("aria-pressed", "false");

    await visualBtn.click();
    await expect(visualBtn).toHaveAttribute("aria-pressed", "true");
    await expect(realBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("Distance-Toggle: visual <-> real", async ({ page }) => {
    await openApp(page);

    const visualBtn = page.locator(
      '.se-toggle__button[data-kind="distance"][data-mode="visual"]',
    );
    const realBtn = page.locator(
      '.se-toggle__button[data-kind="distance"][data-mode="real"]',
    );

    await expect(visualBtn).toHaveAttribute("aria-pressed", "true");
    await expect(realBtn).toHaveAttribute("aria-pressed", "false");

    await realBtn.click();
    await expect(realBtn).toHaveAttribute("aria-pressed", "true");
    await expect(visualBtn).toHaveAttribute("aria-pressed", "false");

    await visualBtn.click();
    await expect(visualBtn).toHaveAttribute("aria-pressed", "true");
    await expect(realBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("HUD zeigt Modus-Beschriftung nach Wechsel", async ({ page }) => {
    await openApp(page);

    await page.locator(
      '.se-toggle__button[data-kind="size"][data-mode="real"]',
    ).click();
    await expect(page.locator(".se-hud__mode")).toContainText("Echt");

    await page.locator(
      '.se-toggle__button[data-kind="size"][data-mode="visual"]',
    ).click();
    const modeText = await page.locator(".se-hud__mode").textContent();
    expect(modeText).not.toContain("Echt");
  });
});

test.describe("HUD — Sichtbarkeits-Filter", () => {
  test("Detail-Toggle: all <-> known", async ({ page }) => {
    await openApp(page);

    const allBtn = page.locator(
      '.se-toggle__button[data-kind="detail"][data-mode="all"]',
    );
    const knownBtn = page.locator(
      '.se-toggle__button[data-kind="detail"][data-mode="known"]',
    );

    await expect(allBtn).toHaveAttribute("aria-pressed", "true");
    await expect(knownBtn).toHaveAttribute("aria-pressed", "false");

    await knownBtn.click();
    await expect(knownBtn).toHaveAttribute("aria-pressed", "true");
    await expect(allBtn).toHaveAttribute("aria-pressed", "false");

    await allBtn.click();
    await expect(allBtn).toHaveAttribute("aria-pressed", "true");
    await expect(knownBtn).toHaveAttribute("aria-pressed", "false");
  });
});