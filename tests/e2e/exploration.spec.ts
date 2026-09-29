/**
 * Exploration-Tests: Die App bedienen, nicht nur starten.
 *
 * Geprueft werden Skalierungsmodus per URL, das Lernquiz, die Tastatursteuerung
 * des Raumschiffs und das Verhalten auf einem Mobil-Viewport.
 *
 * @module e2e/exploration
 */

import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/** Laedt die App mit optionalem Query-String und wartet auf die Navigation. */
async function openApp(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(`${message.text()} (${message.location().url}:${message.location().lineNumber})`);
    }
  });
  page.on("pageerror", (error: Error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  await page.goto(`/${query}`);
  // Auf kleinen Bildschirmen ist die Navigationsliste absichtlich eingeklappt.
  // Deshalb wird auf "im DOM" gewartet, nicht auf Sichtbarkeit.
  await expect(page.locator(".se-nav__button").first()).toBeAttached();
  await expect(page.locator(".se-hud__title")).toBeVisible();
  return errors;
}

test.describe("Exploration — Bedienung", () => {
  test("1. Skalierungsmodus ?scale=real startet fehlerfrei und schaltet den Modus", async ({ page }) => {
    const errors = await openApp(page, "?scale=real");
    await page.waitForTimeout(1200);

    // Kein Konsolenfehler und die App hat nicht ihre Fehlerseite gezeigt.
    await expect(page.locator('[data-testid="app-error"]')).toHaveCount(0);
    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);

    // Der HUD-Schalter fuer die echten Groessenverhaeltnisse muss aktiv sein.
    const realButton = page.locator('.se-toggle__button[data-kind="size"][data-mode="real"]');
    await expect(realButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".se-hud__mode")).toContainText("Echt");

    // Und die Szene rendert weiterhin (Canvas nicht 0x0).
    const box = await page.locator("canvas#scene").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test("2. Quiz starten, Frage beantworten, Feedback ist sichtbar", async ({ page }) => {
    const errors = await openApp(page);

    const quiz = page.locator(".se-quiz");
    await expect(quiz).toBeHidden();

    // Startknopf (von der Integration erzeugt) anklicken.
    await page.locator("button.se-quiz-toggle").click();
    await expect(quiz).toBeVisible();

    const question = page.locator(".se-quiz__question");
    await expect(question).not.toBeEmpty();

    const answers = page.locator(".se-quiz__answer");
    expect(await answers.count()).toBeGreaterThanOrEqual(2);

    // Die als korrekt markierte Antwort klicken — der Test prueft damit, dass
    // das Feedback unabhaengig von der Frage stimmt.
    await page.locator('.se-quiz__answer[data-correct="true"]').click();

    const explanation = page.locator(".se-quiz__explanation");
    await expect(explanation).toBeVisible();
    await expect(page.locator(".se-quiz__verdict")).toHaveText(/Richtig/);
    await expect(page.locator(".se-quiz__reason")).not.toBeEmpty();
    // Nach der Antwort ist der Folgeteig sichtbar.
    await expect(page.locator(".se-quiz__next")).toBeVisible();
    await expect(page.locator(".se-quiz__progress-text")).toHaveText(/Frage 1 von \d+/);

    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
  });

  test("3. Taste W beschleunigt das Raumschiff messbar", async ({ page }) => {
    await openApp(page);

    // Die Steuerung haengt am Canvas (nicht am Body), also bekommt das Canvas
    // den Tastaturfokus. Ohne das bleiben alle Tastendruecke folgenlos.
    const canvas = page.locator("canvas#scene");
    await canvas.focus();
    await expect(canvas).toBeFocused();

    const speed = page.locator(".se-hud__ship-value").first();
    const thrust = page.locator('.se-meter[aria-label="Schublevel"]');
    await expect(speed).toHaveText(/0([.,]0+)? km\/s/);
    await expect(thrust).toHaveAttribute("aria-valuenow", "0");

    // W gedrueckt halten: die Taste ist ein Zustaendigkeitsschalter, erst
    // keydown erzeugt dauerhaften Schub.
    await page.keyboard.down("w");
    await page.waitForTimeout(700);
    const thrustDuring = Number(await thrust.getAttribute("aria-valuenow"));
    const speedDuring = await speed.textContent();
    await page.keyboard.up("w");

    // Schublevel und Geschwindigkeit muessen sich beide bewegt haben —
    // das beweist, dass das Schiff in der Simulation wirklich fliegt.
    expect(thrustDuring, "Schublevel waehrend des Tastendrucks").toBeGreaterThan(0);
    expect(speedDuring ?? "").not.toMatch(/^0([.,]0+)? km\/s$/);

    // Nach dem Loslassen faellt der Schub wieder auf 0.
    await expect(thrust).toHaveAttribute("aria-valuenow", "0", { timeout: 5000 });
  });

  test("4. Mobil 375x812: Navigation bedienbar, kein horizontales Scrollen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    await page.waitForTimeout(500);

    // Kein waagerechtes Scrollen: die Seite darf nicht breiter sein als das
    // Fenster, sonst muss ein Kind auf einer Kleinigkeit quer scrollen.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, "documentElement.scrollWidth").toBeLessThanOrEqual(overflow.innerWidth);

    // Das Canvas fuellt den Bildschirm.
    const box = await page.locator("canvas#scene").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(box.width).toBeGreaterThan(300);
    expect(box.height).toBeGreaterThan(700);

    // Navigation: der Menue-Knopf muss sichtbar und klickbar sein.
    const toggle = page.locator(".se-nav__toggle");
    await expect(toggle).toBeVisible();

    // Auf dem kleinen Bildschirm ist die Liste eingeklappt; der Knopf oeffnet
    // sie, und danach ist ein Koerper auswaehlbar.
    const firstEntry = page.locator(".se-nav__button").first();
    await toggle.click();
    await expect(firstEntry).toBeVisible();
    await firstEntry.click();
    await expect(page.locator(".se-panel")).toBeVisible();
    await expect(page.locator(".se-panel__title")).not.toBeEmpty();
  });
});
