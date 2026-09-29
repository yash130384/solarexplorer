import { test, expect } from "@playwright/test";
// Der Test laedt die Seite ueber das oeffentliche Internet und wartet auf
// `networkidle`, bis alle 465 Koerper geladen sind. Das dauert je nach
// Internetlage knapp ueber dem globalen 30-s-Timeout, deshalb eigens 90 s.
test("extern erreichbar", async ({ page }) => {
  test.setTimeout(90_000);
  const errs: string[] = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto("https://space.pimmel.site/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(6000);
  const gl = await page.evaluate(() => {
    const c = document.querySelector("#scene") as HTMLCanvasElement;
    const x = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    return x ? "WebGL aktiv" : "kein WebGL";
  });
  const nav = await page.locator("nav, [class*=nav] button").count();
  const box = await page.locator("#scene").evaluate(el => {
    const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`;
  });
  console.log(`REMOTE gl=${gl} canvas=${box} nav=${nav} errors=${errs.length}`);
  if (errs.length) console.log("ERR: " + (errs[0] ?? "").slice(0, 150));
  expect(errs.length).toBe(0);
});
