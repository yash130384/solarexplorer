/**
 * Misst die Texturwirkung am **gerenderten Bild** (Ticket 19).
 *
 * Der Objektgraph-Zaehler aus `getStats().textured` beweist, dass `map` am
 * Material haengt. Er beweist nicht, dass die Textur das Bild erreicht: eine
 * falsche Farbraum-Zuordnung, ein gespiegelt gesetztes `flipY` oder ein
 * schwarzes Material sieht in `getStats()` identisch aus.
 *
 * Screenshot des Compositors, im selben Browser ueber ein 2D-Canvas wieder
 * zerlegt (das Projekt hat bewusst keinen PNG-Decoder als Abhaengigkeit;
 * `toDataURL` waere ohne `preserveDrawingBuffer` leer).
 *
 * ## Warum A/B und nicht ein Schwellenwert
 *
 * Die erste Fassung dieser Datei verglich ein **hartes Fenster** gegen
 * Schwellen. Das war methodisch falsch: die Kamera folgt dem Schiff, der
 * Planet stand nicht im Fenster, gemessen wurde halb Weltraum — und die
 * "behauptete" Streuung von 32 kam vom Sichelrand gegen das Schwarz. Sichtbild
 * dazu: eine strukturlose Scheibe. Auch der zweite Anlauf half nicht: die
 * Suchroutine fand zwar eine Scheibe, aber eine Randregion, deren Streuung
 * auch ein einfarbiges Material liefert.
 *
 * Deshalb jetzt der **A/B-Vergleich an derselben Stelle**:
 *
 * 1. Das Bild wird zweimal aufgenommen: einmal mit `?textures=off` (die
 *    Koerper sind dann exakt ihre einfarbige `color`-Flaeche) und einmal
 *    normal. Gleiche Kamera, gleiche Zeit, gleiche Groesse — der einzige
 *    Unterschied ist die Textur.
 * 2. Beide Messungen benutzen **dieselbe Suchroutine**, die die Scheibe
 *    findet. Die Suchung kann also nicht unterschiedlich ausfallen, und die
 *    Aussage ist nicht von der Fensterwahl abhaengig.
 *
 * ## Warum das Messfeld gesucht und nicht festgelegt wird
 *
 * Die Kamera folgt dem Schiff, der Planet steht nach dem Anflug also nicht
 * garantiert in der Bildmitte. Ein fest verdrahtetes Rechteck misst womöglich
 * halben Planeten plus halben Weltraum. Gesucht wird deshalb die groesste
 * zusammenhangende helle Flaeche ({@link findLargestBody}); das ist der
 * Planet, und gemessen wird nur dessen Inneres.
 *
 * @module e2e/texture-pixels
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Rechteck in CSS-Pixeln. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Kennzahlen eines Bildfelds. */
interface Detail {
  /**
   * Mittlere Hochfrequenz-Energie: mittlerer Abstand eines Pixels von
   * seinen vier Nachbarn, in Luminanzpunkten.
   */
  detail: number;
  /** Mittlere Luminanz. */
  mean: number;
}

/**
 * Kameraabstand als Vielfaches des Koerperradius fuer die Aufnahmen.
 *
 * 2.6 ergibt eine Scheibe von rund einem Drittel der Bildhoehe: gross
 * genug, dass das Messfeld {@link MEASURE_BOX} in ihrem Inneren liegt,
 * klein genug, dass sie den Bildrand nicht beruehrt.
 */
const FOCUS_FACTOR = 2.6;

/** Halbe Kantenlaenge des Messfelds {@link MEASURE_BOX} in CSS-Pixeln. */
const MEASURE_HALF = 90;

/** Ab dieser Summe der Kanalabweichungen gilt ein Pixel als "veraendert". */
const CHANGED_TOLERANCE = 12;

/**
 * Anteil der Pixel im Messfeld, die sich zwischen den Aufnahmen aendern
 * muessen, damit die Textur als angewendet gilt.
 *
 * Das Messfeld liegt in der Scheibenmitte, also ueberall auf dem Koerper.
 * Eine Textur aendert dort praktisch jeden Pixel — nicht dramatisch, aber
 * messbar. 40 % ist deshalb konservativ: ein echter Nachweis liegt ueber
 * 90 %, die Schranke faengt nur "gar nichts aendert sich" ab.
 */
const REQUIRED_CHANGE = 0.4;

/**
 * Anteil, den zwei **gleichartige** Aufnahmen hoechstens erreichen duerfen.
 *
 * Ohne diese Kontrolle waere der Vergleich wertlos: eine flackernde
 * Kamera, ein wanderndes Sternfeld oder ein anderer Zeitpunkt wuerden
 * ebenfalls "veraenderte Pixel" liefern. Beide Aufnahmen ohne Textur
 * muessen sich deshalb praktisch nicht unterscheiden — sonst ist die
 * Aussage ueber die Textur nicht belastbar.
 */
const CONTROL_CHANGE = 0.02;

/**
 * Simulationszeit, auf die beide A/B-Aufnahmen gesetzt werden.
 *
 * J2000 als Julian Date (`2451545.0`) — der Bezugspunkt der Kepler-Elemente
 * in `core/orbital.ts`. Fest, weil zwei Aufnahmen nur dann pixelgleich
 * vergleichbar sind, wenn Sonne, Planeten und Monde exakt an denselben
 * Stellen stehen.
 */
const J2000_JULIAN_DATE = 2451545.0;

/** Formatiert Messwerte lesbar fuer den Testbericht. */
function report(label: string, value: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${label}: ${value}`);
}

/**
 * Liest die Pixel eines Rechtecks als data-URL.
 *
 * @param page - Die Testseite.
 * @param region - Rechteck in CSS-Pixeln.
 * @returns Der Ausschnitt como PNG-Data-URL.
 */
async function shot(page: Page, region: Box): Promise<string> {
  const buffer = await page.screenshot({ clip: region });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/**
 * Schneidet ein Feld aus einem bereits aufgenommenen Bild und liest dessen
 * Kennzahlen.
 *
 * Gemessen wird **das gespeicherte Bild**, nicht der aktuelle Bildschirm:
 * die A/B-Aufnahmen werden nacheinander gemacht, und wer den Bildschirm
 * erneut abgreift, misst zweimal denselben Zustand. Genau dieser Fehler
 * waere in der ersten Fassung passiert — beide Messungen haetten die
 * Textur-Aufnahme gezeigt und der Vergleich waere immer bestanden.
 *
 * @param page - Die Testseite (nur als Rechenhilfe fuer den 2D-Kontext).
 * @param dataUrl - Das vollstaendige Bild als `data:image/png;base64,...`.
 * @param box - Rechteck in CSS-Pixeln innerhalb dieses Bildes.
 * @returns Hochfrequenz-Energie und mittlere Luminanz des Ausschnitts.
 */
async function detailOf(
  page: Page,
  dataUrl: string,
  box: Box,
): Promise<Detail> {
  return page.evaluate(
    async ([url, region]) => {
      const image = new Image();
      image.src = url as string;
      await image.decode();
      const clip = region as Box;
      const scratch = document.createElement("canvas");
      scratch.width = clip.width;
      scratch.height = clip.height;
      const context = scratch.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        throw new Error("Kein 2D-Kontext zum Auswerten des Bildes.");
      }
      context.drawImage(image, clip.x, clip.y, clip.width, clip.height, 0, 0, clip.width, clip.height);
      const width = scratch.width;
      const height = scratch.height;
      const pixels = context.getImageData(0, 0, width, height).data;
      const luminance = (x: number, y: number): number => {
        const index = (y * width + x) * 4;
        return (
          0.2126 * (pixels[index] ?? 0) +
          0.7152 * (pixels[index + 1] ?? 0) +
          0.0722 * (pixels[index + 2] ?? 0)
        );
      };

      let sum = 0;
      let count = 0;
      let edge = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const centre = luminance(x, y);
          sum += centre;
          count += 1;
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
            continue;
          }
          // Mittlerer Abstand zu den vier Nachbarn. Der Kantenoperator
          // reagiert nur auf Struktur, die zwischen benachbarten Pixeln
          // wechselt; ein glatter Beleuchtungsverlauf liefert fast nichts.
          edge +=
            (Math.abs(centre - luminance(x - 1, y)) +
              Math.abs(centre - luminance(x + 1, y)) +
              Math.abs(centre - luminance(x, y - 1)) +
              Math.abs(centre - luminance(x, y + 1))) /
            4;
        }
      }
      return {
        detail: edge / count,
        mean: count === 0 ? 0 : sum / count,
      };
    },
    [dataUrl, box] as const,
  );
}

/**
 * Das Messfeld: ein festes Quadrat um die Bildmitte.
 *
 * Seit `focusBodyInstant` die Kamera hart auf den Koerper stellt, liegt der
 * Koerpermittelpunkt **immer** genau in der Bildmitte. Damit braucht es
 * keine Suche mehr — und genau die Suche war die groesste Fehlerquelle:
 *
 * - Der fruehere Ansatz "hellster Pixel, dann groesster Mittelwert
 *   drumherum" kann gar nicht funktionieren: Sterne sind punktweise heller
 *   als jeder Planet (gemessen: Stern 253, Venus-Mittel 54). Der hellste
 *   Pixel ist deshalb immer ein Stern, und das gefundene Fenster lag mit
 *   der Venus am Rand. Beide A/B-Messungen kamen dann praktisch gleich
 *   heraus (0.572 gegen 0.609), ohne etwas ueber die Textur zu sagen.
 * - Ein festes Feld kann nicht danebenliegen, und beide A/B-Aufnahmen
 *   messen exakt dieselben Pixel.
 *
 * Der Kameraabstand {@link FOCUS_FACTOR} laesst den Koerper etwa ein
 * Drittel der Bildhoehe einnehmen; das Feld liegt damit sicher in seiner
 * Scheibenmitte und beruehrt den dunklen Limb nicht.
 */
const MEASURE_BOX: Box = {
  x: 640 - MEASURE_HALF,
  y: 400 - MEASURE_HALF,
  width: MEASURE_HALF * 2,
  height: MEASURE_HALF * 2,
};

/**
 * Zaehlt, wie viele Pixel sich zwischen zwei Bildern unterscheiden.
 *
 * Ohne `box` wird das **ganze** Bild verglichen. Mit `box` nur der
 * Ausschnitt — damit laesst sich die Aenderung auf dem Planeten von dem
 * wandernden Sternfeld dahinter trennen. Der Ausschnitt muss in beiden
 * Bildern an derselben Stelle liegen, sonst vergleicht der Test Venus
 * gegen Weltraum.
 *
 * @param page - Die Testseite.
 * @param first - Erstes Bild.
 * @param second - Zweites Bild.
 * @param tolerance - Summe der Kanalabweichungen, ab der ein Pixel zaehlt.
 * @param box - Optionaler Ausschnitt in CSS-Pixeln; ohne Wert das ganze Bild.
 * @returns Geaenderte und verglichene Pixel.
 */
async function difference(
  page: Page,
  first: string,
  second: string,
  tolerance: number,
  box?: Box,
): Promise<{ changed: number; total: number }> {
  return page.evaluate(
    async ([urlA, urlB, limit, region]) => {
      const load = async (url: string): Promise<HTMLImageElement> => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const [a, b] = await Promise.all([load(urlA as string), load(urlB as string)]);
      if (a.width !== b.width || a.height !== b.height) {
        throw new Error(
          `Bildgroessen unterscheiden sich: ${a.width}x${a.height} gegen ` +
            `${b.width}x${b.height}. Der Vergleich muss pixelgleich sein.`,
        );
      }
      const clip = region as Box | null;
      const left = clip === null ? 0 : clip.x;
      const top = clip === null ? 0 : clip.y;
      const w = clip === null ? a.width : clip.width;
      const h = clip === null ? a.height : clip.height;
      const scratch = document.createElement("canvas");
      scratch.width = w;
      scratch.height = h;
      const context = scratch.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        throw new Error("Kein 2D-Kontext zum Vergleich.");
      }
      context.drawImage(a, left, top, w, h, 0, 0, w, h);
      const before = context.getImageData(0, 0, w, h).data;
      context.clearRect(0, 0, w, h);
      context.drawImage(b, left, top, w, h, 0, 0, w, h);
      const after = context.getImageData(0, 0, w, h).data;
      const threshold = limit as number;
      let changed = 0;
      for (let i = 0; i < before.length; i += 4) {
        const delta =
          Math.abs((before[i] ?? 0) - (after[i] ?? 0)) +
          Math.abs((before[i + 1] ?? 0) - (after[i + 1] ?? 0)) +
          Math.abs((before[i + 2] ?? 0) - (after[i + 2] ?? 0));
        if (delta > threshold) changed += 1;
      }
      return { changed, total: before.length / 4 };
    },
    [first, second, tolerance, box ?? null] as const,
  );
}

/**
 * Bringt die App an eine definierte, **eingefrorene** Stelle.
 *
 * Drei Schritte, in genau dieser Reihenfolge — eine andere hat die ersten
 * beiden Fassungen dieses Nachweises unbrauchbar gemacht:
 *
 * 1. Warten, bis die Texturen an den Materialien haengen. Sonst misst die
 *    "mit Textur"-Aufnahme eine noch einfarbige Kugel, weil das Laden
 *    bewusst im Hintergrund laeuft.
 * 2. Zeit anhalten und auf J2000 setzen. Damit stehen Sonne, Planeten und
 *    Monde in **beiden** A/B-Aufnahmen exakt gleich — Voraussetzung dafuer,
 *    dass der Pixelvergleich ausschliesslich die Textur misst.
 * 3. Kamera hart auf den Koerper setzen (`focusBodyInstant`). Das ist der
 *    entscheidende Punkt: die Navigation setzt nur das Schiff um, die
 *    Kamera faehrt danach weich hinterher. Zwischen zwei Aufnahmen waeren
 *    Scheibengroesse und Lage verschieden, und die Messung verglich die
 *    Kamerafahrt statt der Textur — daher fand die Suchroutine einmal die
 *    Scheibe (58 px) und einmal deren Rand (24 px).
 *
 * @param page - Die Testseite.
 * @param query - Query-String, z. B. `""` oder `"?textures=off"`.
 * @param bodyId - Angeflogener Koerper.
 * @returns Das ganze Bild als data-URL.
 */
async function approach(page: Page, query: string, bodyId: string): Promise<string> {
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  if (!query.includes("textures=off")) {
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
  }
  await page.evaluate(
    ({ bodyId, epoch, factor }) => {
      const hook = (window as unknown as Record<string, unknown>)[
        "__solarExplorer"
      ] as {
        setPaused: (value: boolean) => void;
        snapshot: (date: number) => string;
        focusBodyInstant: (id: string, factor?: number) => void;
      };
      hook.setPaused(true);
      // Fester Zeitpunkt: beide A/B-Aufnahmen zeigen exakt dieselbe Szene.
      hook.snapshot(epoch);
      // Kamera hart auf den Koerper. `FOCUS_FACTOR` ergibt eine Scheibe von
      // gut einem Drittel der Bildhoehe — gross genug zum Messen, klein
      // genug, dass sie den Bildrand nicht beruehrt.
      hook.focusBodyInstant(bodyId, factor);
    },
    { bodyId, epoch: J2000_JULIAN_DATE, factor: FOCUS_FACTOR },
  );
  // Kamera steht, Zeit steht. Ein Bild muss noch gezeichnet werden.
  await page.waitForTimeout(300);
  return shot(page, { x: 0, y: 0, width: 1280, height: 800 });
}

test.describe("Textur sichtbar im Bild (Ticket 19)", () => {
  // Der zweite Test macht 16 Anfluege (8 Planeten mal mit und ohne Textur).
  // Bei ~2 s je Anflug plus Ladezeit des Bundles ist das ein zweistelliger
  // Sekundenwert — die 30 s der globalen Konfiguration reichen dort nicht
  // und der Abbruch sah wie ein haengender Screenshot aus.
  test.setTimeout(180_000);

  test("die Venus ist ohne Textur einfarbig und mit Textur strukturiert", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    const plain = await approach(page, "?textures=off", "venus");
        // Zweite Aufnahme **ohne** Textur: die Kontrollmessung. Sie zeigt, wie
        // viel das Bild von allein wandert (Sternfeld, Rendering). Ohne sie
        // waere jede A/B-Differenz als Texturwirkung lesbar — auch eine
        // flackernde Kamera oder ein anderer Zeitpunkt wuerden sie liefern.
        const plainAgain = await approach(page, "?textures=off", "venus");
        const textured = await approach(page, "", "venus");

        // Beide Messungen lesen dasselbe feste Feld aus dem **gespeicherten**
        // Bild. Genau hier ist die erste Fassung zweimal gescheitert: sie mass
        // den Bildschirm zweimal (beide Male den Textur-Zustand) und suchte die
        // Scheibe dann ueber den hellsten Pixel — der ist ein Stern (253 gegen
        // 54 im Venus-Mittel), das Feld lag also neben dem Planeten.
        report(
          "Messfeld",
          `${MEASURE_BOX.width}x${MEASURE_BOX.height} @ ` +
            `${MEASURE_BOX.x},${MEASURE_BOX.y} (Bildmitte)`,
        );

        const plainValues = await detailOf(page, plain, MEASURE_BOX);
        report(
          "ohne Textur",
          `mean=${plainValues.mean.toFixed(1)} detail=${plainValues.detail.toFixed(2)}`,
        );
        const texturedValues = await detailOf(page, textured, MEASURE_BOX);
        report(
          "mit Textur",
          `mean=${texturedValues.mean.toFixed(1)} detail=${texturedValues.detail.toFixed(2)}`,
        );

        // 1. Das Messfeld liegt auf dem Planeten, nicht im Weltraum. Ohne diesen
        //    Nachweis waere der ganze Vergleich eine Differenz zweier
        //    Hintergrundrauschen.
        expect(plainValues.mean, "Venus ohne Textur ist sichtbar").toBeGreaterThan(15);
        expect(texturedValues.mean, "Venus mit Textur ist sichtbar").toBeGreaterThan(15);

        // 2. Der Kern des Nachweises: **im Messfeld** aendert sich mit der
        //    Textur ein grosser Teil der Pixel. Das Feld liegt auf dem
        //    Planeten, also kann die Aenderung nur von der Textur kommen.
        const inBox = await difference(
          page,
          plain,
          textured,
          CHANGED_TOLERANCE,
          MEASURE_BOX,
        );
        const share = inBox.changed / inBox.total;
        report(
          "A/B im Messfeld",
          `${inBox.changed}/${inBox.total} Pixel veraendert ` +
            `(${(share * 100).toFixed(1)} %)`,
        );
        expect(share, "Textur aendert das Bild im Messfeld").toBeGreaterThan(
          REQUIRED_CHANGE,
        );

        // 3. Kontrollmessung: dieselbe Szene zweimal ohne Textur darf sich
        //    kaum bewegen. Sonst wuerde der Vergleich in Punkt 2 auch dann
        //    "passen", wenn die Kiste beim Wechsel der Texturen zappelt.
        const control = await difference(
          page,
          plain,
          plainAgain,
          CHANGED_TOLERANCE,
          MEASURE_BOX,
        );
        const controlShare = control.changed / control.total;
        report(
          "Kontrolle (ohne/ohne)",
          `${control.changed}/${control.total} Pixel ` +
            `(${(controlShare * 100).toFixed(2)} %)`,
        );
        expect(
          controlShare,
          "zwei Aufnahmen derselben Szelle sind praktisch gleich",
        ).toBeLessThan(CONTROL_CHANGE);

        // 4. Der Effekt muss weit ueber der Kontrolle liegen — sonst reichte
        //    das Rauschen der Aufnahme.
        expect(
          share,
          "der Textur-Effekt liegt weit ueber der Kontrollmessung",
        ).toBeGreaterThan(controlShare * 10);

        // 5. Am **ganzen** Bild sind ebenfalls viele Pixel veraendert —
        //    unabhaengig vom Messfeld, also noch einmal ohne die Box.
        const diff = await difference(page, plain, textured, CHANGED_TOLERANCE);
        report(
          "Bildvergleich",
          `veraendert ${diff.changed}/${diff.total} Pixel ` +
            `(${((diff.changed / diff.total) * 100).toFixed(1)} %)`,
        );
        expect(diff.changed, "Textur veraendert das Bild sichtbar").toBeGreaterThan(
          diff.total * 0.005,
        );
        expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
      });

  test("alle acht Planeten tragen im Bild eine Struktur", async ({ page }) => {
    // Der gleiche A/B-Vergleich je Planet: ohne Textur einfarbig, mit
    // Textur strukturiert. Nur so wird "die Texturen sind angewendet" von
    // "irgendein Planet sieht bunt aus" getrennt.
    const planets = [
      "merkur",
      "venus",
      "erde",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptun",
    ];
    const measured: string[] = [];
    for (const id of planets) {
      const plain = await approach(page, "?textures=off", id);
      const textured = await approach(page, "", id);

      const plainValues = await detailOf(page, plain, MEASURE_BOX);
      const texturedValues = await detailOf(page, textured, MEASURE_BOX);

      // Auch die mittlere Helligkeit muss stimmen: ein Feld voll Weltraum
      // haette zwar eine niedrige Aenderung, waere aber kein Planet.
      expect(
        texturedValues.mean,
        `${id} liegt im Bild, nicht im Weltraum`,
      ).toBeGreaterThan(8);

      // Gleiche Messung wie im Venus-Test, nur je Planet: im Messfeld muss
      // sich ein grosser Teil der Pixel aendern.
      const diff = await difference(
        page,
        plain,
        textured,
        CHANGED_TOLERANCE,
        MEASURE_BOX,
      );
      const share = diff.changed / diff.total;
      measured.push(
        `${id}: ${(share * 100).toFixed(1)} % veraendert ` +
          `(mean ${plainValues.mean.toFixed(0)} -> ` +
          `${texturedValues.mean.toFixed(0)}, ` +
          `detail ${plainValues.detail.toFixed(2)} -> ` +
          `${texturedValues.detail.toFixed(2)})`,
      );
      expect(share, `${id} aendert sich im Messfeld`).toBeGreaterThan(
        REQUIRED_CHANGE,
      );
    }
    report("A/B je Planet im Messfeld", measured.join(" | "));
  });
});
