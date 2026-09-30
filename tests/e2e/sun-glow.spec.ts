/**
 * Nachweis des Sonnen-Glanzes (Ticket 18) am **gerenderten Bild**.
 *
 * Der Effekt ist nur eine Eigenschaft des Bildes, nicht des Objektgraphen:
 * ein Bloom-Pass, der nirgends blutet, sieht in `snapshot()` und
 * `getStats()` identisch aus wie einer, der die halbe Bildflaeche
 * ueberstrahlt. Deshalb misst dieser Test Pixel.
 *
 * ## Warum der Nachweis ein *Vergleich* ist
 *
 * Ein einzelner Pixel-Schwellenwert taugt hier nicht als Beweis. Das Feld um
 * die Sonne enthaelt naemlich auch den Asteroidenguertel (3000 Instanzen,
 * Albedo-L 0.32) und Sterne — die liegen auch ohne Bloom ueber jeder noch so
 * niedrigen Schwelle (gemessen bei angehaltener Zeit: 96 bis 98 % des Feldes
 * "hell", wenn gar kein Bloom laeuft). Belastbar ist nur der **Unterschied
 * zweier Messungen**: dasselbe Feld mit und ohne Bloom. Der Tonemapper kappt
 * die Sonne auch ohne Bloom auf Weiss — der Hof aber entsteht ausschliesslich
 * durch den Hochpass, und genau der wird gemessen.
 *
 * ## Warum der Messpunkt im Bild liegt
 *
 * `readPixels` liest den Backbuffer — und ohne `preserveDrawingBuffer` ist der
 * nach dem Compositing nicht mehr auslesbar (liefert Nullen, ein haeufiger
 * Fehlschluss bei Bildmessungen im Browser). Deshalb nimmt `SceneManager` die
 * Messung im Renderframe selbst entgegen (`sampleFrame`), wo der Backbuffer
 * noch vollstaendig ist.
 *
 * ## Warum `?bloom=on`
 *
 * Der Test laeuft auf einem headless-Chromium, also auf einem
 * Software-Rasterisierer, auf dem `auto` den Glanz bewusst abschaltet.
 *
 * @module e2e/sun-glow
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Quadrat um die Sonne in Bildschirmmitte (Viewport 1280x800). */
const SUN_REGION = { x: 480, y: 250, width: 320, height: 320 };

/** Quadrat am linken oberen Bildrand — Weltraum mit Sternen. */
const CORNER_REGION = { x: 8, y: 8, width: 96, height: 96 };

/** Messwerte, wie der Debug-Haken `sampleFrame` sie liefert. */
interface FrameSample {
  maxLuminance: number;
  meanLuminance: number;
  brightPixels: number;
  corePixels: number;
  totalPixels: number;
}

/** Szenenstatistik inklusive Bloom-Parametern. */
interface Stats {
  drawCalls: number;
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number } | null;
}

/** Formatiert Messwerte lesbar fuer den Testbericht. */
function report(label: string, value: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${label}: ${value}`);
}

/** Kurzform einer Messung fuer den Bericht. */
function brief(s: FrameSample): string {
  return `max=${s.maxLuminance} mean=${s.meanLuminance.toFixed(1)} ` +
    `hell=${s.brightPixels}/${s.totalPixels} kern=${s.corePixels}`;
}

/** Laedt die App mit gegebenem Query und wartet auf den Debug-Haken. */
async function openApp(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  // Der erste Frame nach dem Aufbau geht fuer Shader-Kompilierung drauf.
  await page.waitForTimeout(2000);
  return errors;
}

/** Liest die Szenenstatistik aus dem Debug-Haken. */
async function readStats(page: Page): Promise<Stats> {
  return page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as {
      getStats: () => unknown;
    };
    return hook.getStats() as Stats;
  });
}

/**
 * Misst einen Bildausschnitt im naechsten gerenderten Bild.
 *
 * ## Warum der Mittelwert aus zwei Bildern
 *
 * Die Kamera folgt dem Schiff und gleitet auch bei angehaltener Zeit noch,
 * bis ihre Glaettung zur Ruhe kommt. Die Sonne wandert dabei im **festen**
 * Messfenster, wodurch sich der Kernanteil zwischen zwei Bildern aendert
 * (beobachtet ueber Laeufe hinweg: 1 550 bis 2 120 Pixel im selben Fenster
 * mit gleicher Bloom-Einstellung). Der Mittelwert ueber zwei Bilder halbiert
 * diese Restwanderung; `meanLuminance` waere auch ohne Mittelung stabil
 * (gemessen 48 ohne Bloom, 93 mit).
 *
 * @param page - Die Testseite.
 * @param region - Rechteck in CSS-Pixeln.
 * @returns Die gemittelten Messwerte beider Bilder.
 */
async function sample(page: Page, region: typeof SUN_REGION): Promise<FrameSample> {
  // `sampleFrame` erfuellt sein Promise aus dem Renderframe heraus — dort ist
  // der Backbuffer noch vollstaendig. Deshalb wird hier nichts selbst per
  // `readPixels` gelesen.
  const read = (): Promise<FrameSample> =>
    page.evaluate((box) => {
      const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as {
        sampleFrame: (region: unknown) => Promise<FrameSample>;
      };
      return hook.sampleFrame(box);
    }, region);
  const [a, b] = [await read(), await read()];
  return {
    maxLuminance: Math.round((a.maxLuminance + b.maxLuminance) / 2),
    meanLuminance: (a.meanLuminance + b.meanLuminance) / 2,
    brightPixels: Math.round((a.brightPixels + b.brightPixels) / 2),
    corePixels: Math.round((a.corePixels + b.corePixels) / 2),
    totalPixels: a.totalPixels,
  };
}

/**
 * Schaltet den Bloom zur Laufzeit um und wartet, bis ein Bild gezeichnet ist.
 *
 * @param page - Die Testseite.
 * @param mode - `"on"`, `"off"` oder `"auto"`.
 * @returns {void}
 */
async function setBloom(page: Page, mode: "on" | "off" | "auto"): Promise<void> {
  await page.evaluate((value) => {
    const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as {
      setBloomMode: (mode: string) => void;
    };
    hook.setBloomMode(value);
  }, mode);
  // Der neue Composer und seine Shader brauchen ein paar Bilder.
  await page.waitForTimeout(1200);
}

/**
 * Haelt die Simulation an (Debug-Haken `setPaused`).
 *
 * Ohne Pause wandert der Asteroidenguertel zwischen den beiden Messungen
 * weiter; unter Last ist die Simulationszeit je Frame laenger, also driftet
 * das Guertel messbar in den Ausschnitt hindein und verfaelscht den Vergleich
 * (beobachtet: Kern 1 581 gegen 1 550 Pixel bei identischer Bloom-Einstellung,
 * allein durch die Last des Testsystems).
 *
 * Die Pause haelt die Simulation an, **nicht** die Kamera: sie gleitet noch
 * weiter, bis ihre Glaettung zur Ruhe kommt. Deshalb mittelt {@link sample}
 * ueber zwei Bilder.
 *
 * @param page - Die Testseite.
 * @returns {void}
 */
async function pause(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as {
      setPaused: (value: boolean) => void;
    };
    hook.setPaused(true);
  });
  await page.waitForTimeout(400);
}

test.describe("Sonnen-Glanz (Bloom)", () => {
  test("1. der Bloom verbreitert und aufhellt den Sonnenkorpus", async ({ page }) => {
    // Beide Messungen kommen aus **derselben** Seiteninstanz und bei
    // **angehaltener Zeit**: nur der Bloom-Schalter aendert sich. Zwei Reloads
    // wuerden zwei Simulationszeitpunkte vergleichen, und selbst in einer
    // Instanz wandert der Guertel weiter — beides verraescht den Vergleich.
    const errors = await openApp(page, "?bloom=off");
    await pause(page);
    const off = await sample(page, SUN_REGION);
    await setBloom(page, "on");
    const on = await sample(page, SUN_REGION);
    const stats = await readStats(page);

    report("ohne Bloom, Sonne", brief(off));
    report("mit Bloom,  Sonne", brief(on));
    report("Schwelle", String(stats.bloom?.threshold));

    expect(stats.bloom?.enabled, "Bloom laeuft laut Debug-Haken").toBe(true);

    // Der Hof entsteht **ausschliesslich** durch den Hochpass: ohne ihn waere
    // das Bild bis auf Rauschen pixelgleich. Das belastbarste Mass ist die
    // mittlere Helligkeit des Feldes, weil sie ueber die ganze Flaeche summiert
    // statt ueber eine Schwelle zu zaehlen (sonst liefert der Guertel
    // szenenabhaengige Zaehlfehler).
    //
    // Gemessen bei angehaltener Zeit gegen das frisch gebaute Bundle,
    // 320x320-Feld, Mittelwert aus je zwei Bildern:
    //   off: mean 47.9 bis 48.3, kern 1 550 bis 1 594, max 253
    //   on:  mean 93.4 bis 93.7, kern 3 457 bis 3 575, max 239
    // Faktor 1.95 auf der mittleren Helligkeit, 2.2 auf der Kernflaeche. `max`
    // sinkt dabei (253 -> 239): die Spitze kann nach dem Tonemapping nicht
    // heller werden, der Hochpass verteilt ihre Energie nach aussen in die
    // Flaeche. Genau das ist die Verbreiterung — und genau deshalb ist der
    // Kernzaehler allein ein schwacher Nachweis, weil er zusaetzlich die
    // Wanderung der Sonne im festen Messfenster mitzaehlt (siehe `sample`).
    // Belastbar ueber beide Messwege (`off -> on` und `on -> off`) und ueber
    // Laeufe hinweg ist die mittlere Helligkeit.
    expect(off.meanLuminance, "Feld ohne Bloom").toBeGreaterThan(10);
    expect(on.meanLuminance, "Feld wird heller").toBeGreaterThan(off.meanLuminance * 1.5);
    expect(on.corePixels, "Kern plus Hof").toBeGreaterThan(off.corePixels * 1.2);
    // Energie wandert nach aussen, statt den Peak nur anzuheben.
    expect(on.maxLuminance, "Spitze wird nicht hoeher").toBeLessThanOrEqual(
      off.maxLuminance,
    );
    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
  });

  test("2. der Bloom bleibt ein lokaler Effekt", async ({ page }) => {
    // Die Sonne darf nicht das ganze Bild ueberstrahlen — Guertel, Planeten
    // und Himmel bleiben dunkel. Gemessen wird der Mittelwert, weil einzelne
    // helle Pixel hier Sterne sind.
    await openApp(page, "?bloom=on");
    const sun = await sample(page, SUN_REGION);
    const corner = await sample(page, CORNER_REGION);
    report("Sonne", brief(sun));
    report("Ecke (Himmel)", brief(corner));

    expect(sun.maxLuminance, "Sonnenkorpus").toBeGreaterThan(150);
    expect(corner.meanLuminance, "Himmel bleibt dunkel").toBeLessThan(3);
    expect(
      sun.meanLuminance,
      "Sonnenfeld ist um Groessenordnungen heller als der Himmel",
    ).toBeGreaterThan(corner.meanLuminance * 10);
  });

  test("3. der Glanz laesst sich zur Laufzeit umschalten", async ({ page }) => {
    await openApp(page, "");
    const auto = await readStats(page);
    // Auf dem Software-Rasterisierer des Tests ist `auto` = aus.
    report("auto auf dieser Hardware", `aktiv=${String(auto.bloom?.enabled)}`);

    await setBloom(page, "on");
    expect((await readStats(page)).bloom?.enabled).toBe(true);

    await setBloom(page, "off");
    expect((await readStats(page)).bloom?.enabled).toBe(false);
  });

  test("4. der Bloom zaehlt keine zusaetzlichen Szenen-Draw-Calls", async ({ page }) => {
    // Ohne Postprocessing zeichnet die Szene direkt in den Renderer, mit
    // Bloom zuerst der `RenderPass`. Beide muessen dieselbe Groessenordnung
    // liefern — sonst wuerde `getStats` mit Bloom die Vollbild-Quadse der
    // Bloom-Passes melden (`WebGLRenderer` setzt `info.reset()` am Anfang jedes
    // `render()`, und jeder Pass ist ein eigener `render()`-Aufruf).
    // `SunGlow` faengt die Zaehler deshalb direkt nach dem `RenderPass` ab.
    //
    // **Kein `toBe`, sondern eine Spanne.** Die Kamera gleitet, und mit ihr
    // schaltet die LOD einzelne Koerper um — dadurch wandert die
    // Szenen-Draw-Call-Zahl um bis zu 1 (beobachtet 30 bzw. 31 bei
    // identischer Bloom-Einstellung). Bei den Bloom-Quadse waere der
    // Unterschied dagegen rund 29 (30 gegen 1). Die Spanne von 2 trennt
    // beides sauber.
    await openApp(page, "?bloom=off");
    const off = await readStats(page);
    await setBloom(page, "on");
    const on = await readStats(page);
    report("Draw-Calls ohne Bloom", String(off.drawCalls));
    report("Draw-Calls mit Bloom", String(on.drawCalls));

    const delta = Math.abs(on.drawCalls - off.drawCalls);
    expect(
      delta,
      `Bloom aendert die Zeichenaufrufe der Szene nicht (${off.drawCalls} -> ${on.drawCalls})`,
    ).toBeLessThanOrEqual(2);
    // Und weiterhin unter der Strukturgrenze — mit einer Zahl, die nicht
    // 1 waere. Genau daran ist der Fehler aufgefallen.
    expect(on.drawCalls, "Szenenzahl, nicht der Vollbild-Quad des letzten Passes").toBeGreaterThan(10);
    expect(on.drawCalls).toBeLessThan(300);
  });

  test("5. parallele Bildmessungen kommen alle zurueck", async ({ page }) => {
    // `sampleFrame` registriert die Messung fuer das naechste Bild. Ein
    // zweiter Aufruf darf den ersten nicht verdraengen — sonst haengt dessen
    // `await` endlos, ohne jeden Fehler.
    await openApp(page, "?bloom=on");
    const settled = await page.evaluate(async (region) => {
      const hook = (window as unknown as Record<string, unknown>)["__solarExplorer"] as {
        sampleFrame: (box: unknown) => Promise<unknown>;
      };
      const first = hook.sampleFrame(region);
      const second = hook.sampleFrame(region);
      // 3 s sind auf einem Software-Rasterisierer reichlich fuer ein Bild.
      const both = await Promise.race([
        Promise.all([first, second]).then(() => "OK"),
        new Promise<string>((resolve) => setTimeout(() => resolve("HANGED"), 3000)),
      ]);
      return both;
    }, SUN_REGION);
    expect(settled, "beide Messungen werden beantwortet").toBe("OK");
  });
});
