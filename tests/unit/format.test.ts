/**
 * Tests fuer die Kinder-Formatierung und die Datenqualitaet.
 *
 * Zwei Bereiche:
 * 1. `formatKm` / `formatDuration` aus `src/core/scale.ts` — die Zahlen, die
 *    Kinder tatsaechlich lesen. Sie duerfen niemals exponentiell werden und
 *    muessen mit negativen Werten (retrograde Rotation) umgehen.
 * 2. Die beiden JSON-Dateien werden gegen ihr eigenes Schema geprueft, damit
 *    ein Tippfehler in den Daten nicht erst beim Endbenutzer auffaellt.
 *
 * Die JSON-Dateien werden per `import` geladen (resolveJsonModule), nicht per
 * `fs` — so prueft Vitest exakt die Datei, die auch `vite build` einbindet.
 *
 * @module tests/unit/format.test
 */

import { describe, expect, it } from "vitest";

import bodiesFile from "../../src/data/bodies.json";
import factsFile from "../../src/data/facts.json";
import { formatDuration, formatKm } from "../../src/core/scale";
import type { BodyData, BodyFacts } from "../../src/ui/InfoPanel";
import { buildSpecRows } from "../../src/ui/InfoPanel";
import type { QuizQuestion } from "../../src/ui/Quiz";

/** Die Koerperliste aus bodies.json. */
const bodies = bodiesFile.bodies as readonly BodyData[];

/** Die Quizfragen aus facts.json. */
const questions = factsFile.quiz as readonly QuizQuestion[];

/**
 * Die Kindtexte aus facts.json, ueber die Koerper-ID indiziert.
 *
 * `facts.json` liefert die Objekte als Schluessel, der generierte Typ von
 * `import` erlaubt aber nur den Zugriff ueber bekannte Schluessel. Fuer Tests,
 * die ueber `bodies.json` iterieren, wird deshalb auf einen generischen
 * Record-Typ umgestellt.
 */
const factsById: Readonly<Record<string, BodyFacts | undefined>> = factsFile.bodies;

/** Exponentendarstellung, wie JavaScript sie von selbst liefert. */
const EXPONENT_PATTERN = /\de[+-]?\d/i;

/**
 * Koerper, fuer die Wikipedia weder Durchmesser noch Masse angibt ("?").
 * Ihre Werte bleiben 0 - eine Zahl zu erfinden waere geraten, nicht belegt.
 */
const BODIES_WITHOUT_MASS: ReadonlySet<string> = new Set(["saturn-s2009s2"]);

describe("formatKm — keine Exponenten-Notation", () => {
  it("formatiert den Erd-Durchmesser ausgeschrieben", () => {
    expect(formatKm(6371)).toBe("6.371 km");
  });

  it("formatiert den Bahnradius der Erde ohne Exponent", () => {
    const text = formatKm(149_597_870.7);
    expect(text).not.toMatch(EXPONENT_PATTERN);
    expect(text).toBe("149.597.871 km");
  });

  it("formatiert den Bahnradius des Neptun als Milliarden ohne Exponent", () => {
    const text = formatKm(4_495_060_000);
    expect(text).not.toMatch(EXPONENT_PATTERN);
    expect(text).toMatch(/Mrd\./);
    expect(text).toBe("4,495 Mrd. km");
  });

  it("haelt die Sonne als eindeutig lesbare Zahl", () => {
    // Genau der Fall aus der Anforderung: 1,496e+08 darf nicht erscheinen.
    const text = formatKm(149_600_000);
    expect(text).not.toContain("e+");
    expect(text).not.toContain("E+");
    expect(text).not.toMatch(EXPONENT_PATTERN);
  });

  it("liefert fuer jede reale Bahnhalbachse aus bodies.json exponentenfrei", () => {
    for (const body of bodies) {
      const text = formatKm(body.semiMajorAxisKm);
      expect(text, `semiMajorAxisKm von ${body.id}`).not.toMatch(EXPONENT_PATTERN);
      expect(text, `semiMajorAxisKm von ${body.id}`).toMatch(/km$/);
    }
  });

  it("behaelt das Vorzeichen bei negativen Werten", () => {
    expect(formatKm(-2439.7)).toBe("-2.440 km");
  });

  it("lehnt nicht-endliche Werte ab, statt 'NaN km' zu liefern", () => {
    expect(() => formatKm(Number.NaN)).toThrow(RangeError);
    expect(() => formatKm(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatDuration — negative und retrograde Werte", () => {
  it("formatiert null Tage", () => {
    expect(formatDuration(0)).toBe("0 Tage");
  });

  it("markiert negative Dauer als rueckwaerts", () => {
    expect(formatDuration(-3)).toBe("3 Tage rueckwaerts");
  });

  it("markiert eine retrograde Rotation in Jahren als rueckwaerts", () => {
    // Venus rotiert rueckwaerts: -5832,5 h = -243,02 Tage.
    const venus = bodies.find((body) => body.id === "venus");
    expect(venus).toBeDefined();
    const days = (venus as BodyData).rotationPeriodH / 24;
    expect(days).toBeLessThan(0);
    expect(formatDuration(days)).toMatch(/rueckwaerts$/);
  });

  it("liefert nie den Betrag mit negativem Vorzeichen", () => {
    for (const body of bodies) {
      const text = formatDuration(body.rotationPeriodH / 24);
      expect(text, `rotationPeriodH von ${body.id}`).not.toMatch(/-\d/);
      expect(text, `rotationPeriodH von ${body.id}`).not.toBe("");
    }
  });

  it("deckt die-retrograde und normale Rotation ab", () => {
    const retrograde = bodies.filter((body) => body.rotationPeriodH < 0);
    expect(retrograde.length).toBeGreaterThan(0);
    const normal = bodies.filter((body) => body.rotationPeriodH > 0);
    expect(normal.length).toBeGreaterThan(0);
  });

  it("lehnt nicht-endliche Werte ab", () => {
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe("facts.json — Quiz ist gueltig", () => {
  it("enthaelt mindestens 10 Fragen", () => {
    expect(questions.length).toBeGreaterThanOrEqual(10);
  });

  it("hat zu jeder Frage eine korrekte Antwort im Bereich der Optionen", () => {
    for (const question of questions) {
      const max = question.options.length - 1;
      expect(
        question.correctIndex,
        `correctIndex von ${question.id} liegt zwischen 0 und ${max}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        question.correctIndex,
        `correctIndex von ${question.id} liegt zwischen 0 und ${max}`,
      ).toBeLessThanOrEqual(max);
    }
  });

  it("hat zu jeder Frage Text, Optionen und eine Erklaerung", () => {
    for (const question of questions) {
      expect(question.question.length, `Frage ${question.id}`).toBeGreaterThan(10);
      expect(question.options.length, `Optionen von ${question.id}`).toBeGreaterThanOrEqual(2);
      expect(question.explanation.length, `Erklaerung von ${question.id}`).toBeGreaterThan(10);
      for (const option of question.options) {
        expect(option.trim().length, `Option in ${question.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("verwendet jede Frage-ID genau einmal", () => {
    const ids = questions.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("bodies.json — Koerper sind vollstaendig und verwaistfrei", () => {
  /** Felder, die die App zwingend braucht. */
  const REQUIRED_FIELDS = [
    "id",
    "name",
    "nameLatin",
    "type",
    "parent",
    "radiusKm",
    "massKg",
    "semiMajorAxisKm",
    "eccentricity",
    "inclinationDeg",
    "rotationPeriodH",
    "axialTiltDeg",
    "surfaceTempC",
    "gravityMs2",
    "atmosphere",
    "moonsCount",
    "color",
    "discovery",
    "orderFromSun",
  ] as const;

  it("enthaelt Sonne, 8 Planeten und mindestens 8 Monde", () => {
    const planets = bodies.filter((body) => body.type === "planet");
    const moons = bodies.filter((body) => body.type === "moon");
    const stars = bodies.filter((body) => body.type === "star");
    expect(stars).toHaveLength(1);
    expect(planets).toHaveLength(8);
    expect(moons.length).toBeGreaterThanOrEqual(8);
  });

  it("hat fuer jeden Koerper alle Pflichtfelder mit passendem Typ", () => {
    for (const body of bodies) {
      for (const field of REQUIRED_FIELDS) {
        expect(body[field], `${field} fehlt bei ${body.id}`).toBeDefined();
      }
      expect(typeof body.id, `id von ${body.id}`).toBe("string");
      expect(typeof body.name, `name von ${body.id}`).toBe("string");
      expect(body.name.length, `name von ${body.id}`).toBeGreaterThan(0);
      expect(["star", "planet", "moon"], `type von ${body.id}`).toContain(body.type);
      // Einzige Ausnahme: S/2009 S 2 fuehrt Wikipedia ohne Durchmesser und
      // ohne Masse ("?"). Der Wert bleibt 0, statt eine Zahl zu erfinden.
      if (BODIES_WITHOUT_MASS.has(body.id)) {
        expect(body.radiusKm, `radiusKm von ${body.id}`).toBe(0);
        expect(body.massKg, `massKg von ${body.id}`).toBe(0);
      } else {
        expect(body.radiusKm, `radiusKm von ${body.id}`).toBeGreaterThan(0);
        expect(body.massKg, `massKg von ${body.id}`).toBeGreaterThan(0);
      }
      expect(body.gravityMs2, `gravityMs2 von ${body.id}`).toBeGreaterThanOrEqual(0);
      expect(body.eccentricity, `eccentricity von ${body.id}`).toBeGreaterThanOrEqual(0);
      expect(body.eccentricity, `eccentricity von ${body.id}`).toBeLessThan(1);
      expect(body.massKg, `massKg von ${body.id}`).toBeLessThan(1e32);
      expect(body.massKg, `massKg von ${body.id}`).toBeLessThan(5.99e30);
    }
  });

  it("hat fuer jeden Koerper eine surfaceTempC mit min/mean/max", () => {
    for (const body of bodies) {
      const temp = body.surfaceTempC;
      expect(temp, `surfaceTempC von ${body.id}`).toBeDefined();
      expect(typeof temp.min, `surfaceTempC.min von ${body.id}`).toBe("number");
      expect(typeof temp.mean, `surfaceTempC.mean von ${body.id}`).toBe("number");
      expect(typeof temp.max, `surfaceTempC.max von ${body.id}`).toBe("number");
      expect(temp.min, `surfaceTempC.min <= max bei ${body.id}`).toBeLessThanOrEqual(temp.max);
    }
  });

  it("verweist bei jedem parent auf einen existierenden Koerper", () => {
    const ids = new Set(bodies.map((body) => body.id));
    for (const body of bodies) {
      if (body.parent === null) {
        expect(body.type, `${body.id} ohne parent muss die Sonne sein`).toBe("star");
        continue;
      }
      expect(ids.has(body.parent), `parent "${body.parent}" von ${body.id} existiert nicht`).toBe(true);
      expect(body.parent, `${body.id} darf nicht sein eigener parent sein`).not.toBe(body.id);
    }
  });

  it("hat genau eine Sonne und keinen Koerper ohne gueltige Sonne in der Kette", () => {
    const sun = bodies.find((body) => body.type === "star");
    expect(sun).toBeDefined();
    const sunId = (sun as BodyData).id;
    for (const body of bodies) {
      if (body.type === "star") {
        expect(body.id, "es gibt genau eine Sonne").toBe(sunId);
        expect(body.parent, "die Sonne hat keinen parent").toBeNull();
      } else if (body.type === "planet") {
        expect(body.parent, `Planet ${body.id} kreist um die Sonne`).toBe(sunId);
      } else {
        // Monde: ihr Planet muss wiederum die Sonne als parent haben.
        const parent = bodies.find((entry) => entry.id === body.parent);
        expect(parent, `parent von ${body.id} fehlt`).toBeDefined();
        expect((parent as BodyData).type, `parent von ${body.id} ist kein Planet`).toBe("planet");
      }
    }
  });

  it("verwendet jede Koerper-ID genau einmal", () => {
    const ids = bodies.map((body) => body.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("liefert fuer jeden Koerper einen Kindtext in facts.json", () => {
    for (const body of bodies) {
      const facts = factsById[body.id];
      expect(facts, `Kindtext fuer ${body.id} fehlt`).toBeDefined();
      const text = facts as { summary: string; funFact: string; kidQuestion: string; wouldYouSurvive: string };
      expect(text.summary.length, `summary von ${body.id}`).toBeGreaterThan(20);
      expect(text.funFact.length, `funFact von ${body.id}`).toBeGreaterThan(20);
      expect(text.kidQuestion.length, `kidQuestion von ${body.id}`).toBeGreaterThan(10);
      expect(text.wouldYouSurvive.length, `wouldYouSurvive von ${body.id}`).toBeGreaterThan(20);
    }
  });

  it("nutzt Groessenordnungen, die fuer Kinder sinnvoll sind", () => {
    const earth = bodies.find((body) => body.id === "erde");
    expect(earth).toBeDefined();
    expect((earth as BodyData).radiusKm).toBe(6371);

    // Wichtig ist die ANZEIGE, nicht die Schreibweise in der JSON-Datei:
    // `1.9885e+30` ist als Datenwert korrekt, "1,9885e+30 kg" im Datenpanel
    // waere ein Fehler. Deshalb wird hier die Ausgabe von `formatNumber`
    // geprueft, die das Panel tatsaechlich anzeigt.
    for (const body of bodies) {
      // So zeigt das Datenpanel die Masse an: "<kg> kg (<x> Erden)".
      const facts = factsById[body.id] as BodyFacts | undefined;
      const row = buildSpecRows(body, facts).find((entry) => entry.label === "Masse");
      expect(row, `Massenzeile von ${body.id}`).toBeDefined();
      const shown = (row as { label: string; value: string }).value;
      expect(shown, `angezeigte Masse von ${body.id}`).not.toMatch(EXPONENT_PATTERN);
      // Ohne belegte Masse (S/2009 S 2) zeigt das Panel ehrlich den
      // Platzhalter statt einer geratenen Erdenzahl.
      if (!BODIES_WITHOUT_MASS.has(body.id)) {
        expect(shown, `angezeigte Masse von ${body.id}`).toMatch(/ Erden\)$/);
      }
      const radiusRow = buildSpecRows(body, facts).find((entry) => entry.label === "Radius");
      expect((radiusRow as { value: string }).value, `Radius von ${body.id}`).not.toMatch(
        EXPONENT_PATTERN,
      );
    }
  });

  // Der Generator `src/data/build_facts.py` darf die acht Planeten nicht
  // wieder auf seinen Platzhalter zurueckfallen: das sind genau die Koerper,
  // die Kinder als Erstes anklicken. Ein Platzhalter hier waere ein stiller
  // Qualitaetsverlust in genau den Texten, die am wichtigsten sind.
  it("gibt jedem Planeten einen echten Kindtext statt des Platzhalters", () => {
    const planets = bodies.filter((body) => body.type === "planet");
    expect(planets).toHaveLength(8);
    for (const planet of planets) {
      const facts = factsById[planet.id] as BodyFacts;
      for (const field of ["summary", "funFact", "kidQuestion", "wouldYouSurvive"] as const) {
        expect(facts[field], `${field} von ${planet.id}`).not.toContain(
          "Daten noch nicht erfasst",
        );
      }
    }
  });

  it("nennt in jedem Mondtext den Koerper selbst statt 'undefined'", () => {
    // Absichtlich KEINE Pflicht auf das Wort "Mond": die handgeschriebenen
    // Texte der grossen Monde (Europa, Io, ...) beschreiben die Besonderheit,
    // ohne den generischen Satz "ist ein Mond von X" zu verwenden. Der Name
    // des Mondes muss aber vorkommen, damit der Text zum Koerper passt, und
    // "undefined" darf nie durchsickern.
    const moons = bodies.filter((body) => body.type === "moon");
    expect(moons.length).toBeGreaterThan(100);
    for (const moon of moons) {
      const facts = factsById[moon.id] as BodyFacts;
      expect(facts.summary, `summary von ${moon.id}`).toContain(moon.name.split(" ")[0]);
      expect(facts.summary, `summary von ${moon.id}`).not.toContain("undefined");
      expect(facts.funFact, `funFact von ${moon.id}`).not.toContain("undefined");
    }
  });

  it("haelt jede Quizfrage eindeutig", () => {
    const seen = new Set<string>();
    for (const question of questions) {
      expect(seen.has(question.question), `Doppelte Frage: ${question.question}`).toBe(false);
      seen.add(question.question);
    }
  });

  // Regression: Der Generator gab lange den Radius als "Breite" aus. Bei
  // Adrastea (Radius 8,2 km) stand dann "8,2 Kilometer breit" im Kindtext —
  // der Mond ist aber 16,4 km breit. Fuer Kinder ist genau diese Zahl der
  // Groessenvergleich, also muss sie der Durchmesser (= 2 x Radius) sein.
  //
  // Geprueft werden nur die Formulierungen des Generators (sie tragen immer
  // den Vergleichssatz "Kilometer breit — ..."). Die handgeschriebenen
  // Texte der grossen Monde nennen Breiten auf eigene Weise ("5.263 km
  // Durch"); die sind hier nicht Sache des Generators.
  it("nennt bei Mond-Groessenangaben den Durchmesser, nicht den Radius", () => {
    const generatedWidth = /([\d.,]+)\s*Kilometer breit\s+—/;
    let checked = 0;
    for (const body of bodies) {
      if (body.type !== "moon") continue;
      const radius = body.radiusKm ?? 0;
      if (!(radius > 0)) continue;
      const facts = factsById[body.id] as BodyFacts;
      const mentioned = generatedWidth.exec(facts.summary)?.[1];
      if (!mentioned) continue;
      // Deutsches Dezimalkomma -> Punkt, Tausenderpunkt entfernen.
      const value = Number(mentioned.replace(/\./g, "").replace(",", "."));
      checked += 1;
      // Ab 10 km Radius rundet der Generator auf ganze Kilometer
      // (Python round() = kaufmaennisch, 21,5 -> 22), darunter auf eine
      // Nachkommastelle. Beide Toleranzen liegen weit unter dem Radius
      // (= halber Durchmesser) — sonst koennte der Test den Fehler, den
      // er absichert, nicht mehr sehen.
      const tolerance = radius >= 10 ? 0.5 : 0.05;
      expect(
        Math.abs(value - radius * 2),
        `${body.id}: "${mentioned} Kilometer breit" passt nicht zum Durchmesser ${(radius * 2).toFixed(1)}`,
      ).toBeLessThanOrEqual(tolerance);
    }
    // Die Stichprobe muss wirksam sein: die generierten Gruppen decken
    // weit ueber 100 Monde ab.
    expect(checked).toBeGreaterThan(100);
  });
});
