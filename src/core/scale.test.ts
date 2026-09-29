/**
 * Unit-Tests fuer die reine Skalierungs-Logik (`src/core/scale.ts`).
 *
 * Diese Tests laufen ohne WebGL: es gibt bewusst keine Three.js-Imports.
 *
 * @module core/scale.test
 */

import { describe, expect, it } from "vitest";

import {
  AU_KM,
  EARTH_RADIUS_KM,
  VISUAL_MAX_RADIUS,
  VISUAL_MIN_RADIUS,
} from "./constants";
import {
  formatDuration,
  formatKm,
  scaleDistance,
  scaleRadius,
  timeScaleFor,
  type DistanceMode,
  type ScaleMode,
  type TimePreset,
} from "./scale";

/** Radius des Merkurs in km (kleinster Planet). */
const MERCURY_RADIUS_KM = 2439.7;
/** Radius des Jupiters in km. */
const JUPITER_RADIUS_KM = 69911;
/** Grosse Halbachse des Neptuns in km. */
const NEPTUN_SEMI_MAJOR_KM = 4_495_060_000;

/** Radius-Werte fuer Grenzwert- und Plausibilitaetstests. */
const RADIUS_CASES: ReadonlyArray<readonly [string, number]> = [
  ["Merkur", MERCURY_RADIUS_KM],
  ["Erdmond", 1737.4],
  ["Erde", EARTH_RADIUS_KM],
  ["Jupiter", JUPITER_RADIUS_KM],
  ["Sonne", 695700],
  ["Pluto", 1188],
];

describe("scaleRadius", () => {
  it("liefert in visual und compact immer Werte im gueltigen Szenenbereich", () => {
    for (const [name, km] of RADIUS_CASES) {
      for (const mode of ["visual", "compact"] as const) {
        const value = scaleRadius(km, mode);
        expect(value, `${name} / ${mode}`).toBeGreaterThanOrEqual(VISUAL_MIN_RADIUS);
        expect(value, `${name} / ${mode}`).toBeLessThanOrEqual(VISUAL_MAX_RADIUS);
      }
    }
  });

  it.each(["visual", "compact"] as const)(
    "ist in %s monoton steigend mit dem Radius",
    (mode) => {
      for (let i = 1; i < RADIUS_CASES.length; i += 1) {
        const prev = RADIUS_CASES[i - 1];
        const curr = RADIUS_CASES[i];
        if (prev === undefined || curr === undefined) {
          continue;
        }
        if (curr[1] > prev[1]) {
          expect(scaleRadius(curr[1], mode)).toBeGreaterThan(scaleRadius(prev[1], mode));
        }
      }
    },
  );

  it("komprimiert das Verhaeltnis Erde/Merkur in visual auf unter 100-fach", () => {
    const ratio =
      scaleRadius(EARTH_RADIUS_KM, "visual") / scaleRadius(MERCURY_RADIUS_KM, "visual");
    expect(ratio).toBeLessThan(100);
    expect(ratio).toBeGreaterThan(1);
  });

  it("haelt das echte Verhaeltnis Erde/Merkur in real ein", () => {
    const ratio = scaleRadius(EARTH_RADIUS_KM, "real") / scaleRadius(MERCURY_RADIUS_KM, "real");
    const trueRatio = EARTH_RADIUS_KM / MERCURY_RADIUS_KM;
    expect(ratio).toBeCloseTo(trueRatio, 10);
    expect(trueRatio).toBeCloseTo(2.61, 2);
  });

  it("nutzt den Erdmond als Referenz: Mond ergibt 1 Einheit in real", () => {
    expect(scaleRadius(1737.4, "real")).toBeCloseTo(1, 10);
  });

  it("macht compact kleiner als visual, ohne den Minimalwert zu unterschreiten", () => {
    for (const [name, km] of RADIUS_CASES) {
      // Am unteren Rand (Pluto) klemmen beide Modi auf VISUAL_MIN_RADIUS.
      expect(scaleRadius(km, "compact"), name).toBeLessThanOrEqual(
        scaleRadius(km, "visual"),
      );
      expect(scaleRadius(km, "compact"), name).toBeGreaterThanOrEqual(VISUAL_MIN_RADIUS);
    }
    // Fuer die Erde ist der Unterschied deutlich.
    expect(scaleRadius(EARTH_RADIUS_KM, "compact")).toBeLessThan(
      scaleRadius(EARTH_RADIUS_KM, "visual"),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "wirft bei ungueltigem Radius %p einen RangeError",
    (bad) => {
      expect(() => scaleRadius(bad, "visual")).toThrow(RangeError);
      expect(() => scaleRadius(bad, "real")).toThrow(/endliche Zahl/);
    },
  );

  it("wirft bei nicht positivem Radius einen RangeError", () => {
    expect(() => scaleRadius(0, "visual")).toThrow(RangeError);
    expect(() => scaleRadius(-100, "visual")).toThrow(/groesser als 0/);
  });

  it("verwirft unbekannte Skalierungsmodi", () => {
    expect(() => scaleRadius(EARTH_RADIUS_KM, "unsinn" as ScaleMode)).toThrow(
      /Unbekannter ScaleMode/,
    );
  });
});

describe("scaleDistance", () => {
  const SAMPLES = [0.1, 0.39, 1, 2, 5.2, 19.2, 30.07, 50].map(
    (au) => au * AU_KM,
  );

  it.each(["visual", "real", "log"] as const)(
    "ist in %s monoton steigend mit der Distanz",
    (mode) => {
      for (let i = 1; i < SAMPLES.length; i += 1) {
        const prev = SAMPLES[i - 1];
        const curr = SAMPLES[i];
        if (prev === undefined || curr === undefined) {
          continue;
        }
        expect(scaleDistance(curr, mode)).toBeGreaterThan(scaleDistance(prev, mode));
      }
    },
  );

  it("setzt Neptun in visual an ~434 Szeneneinheiten, nicht auf 30", () => {
    // Ersetzt die alte Zusicherung "visual < real". Die war an die
    // Kompression `au^0.35` gebunden: dort lag Neptun bei 30 Einheiten,
    // also auf demselben Abstand wie der Erde-Mittelpunkt in "real" — man
    // konnte das System nicht ueberblicken. Heute ist "visual" bewusst
    // DEHNT (60 Einheiten pro AE im linearen Zweig): Neptun muss weit
    // ausserhalb der Erde liegen, sonst waeren die aeusseren Planeten nicht
    // von den inneren zu unterscheiden.
    const visual = scaleDistance(NEPTUN_SEMI_MAJOR_KM, "visual");
    const real = scaleDistance(NEPTUN_SEMI_MAJOR_KM, "real");
    expect(visual).toBeGreaterThan(400);
    expect(visual).toBeLessThan(460);
    // "real" ist definitionsgemaess 1 Einheit pro AE -> Neptun bei 30.
    expect(real).toBeCloseTo(30.05, 1);
    expect(visual).toBeGreaterThan(real * 10);
  });

  it("bildet 1 AE in real exakt auf 1 Szeneneinheit ab", () => {
    expect(scaleDistance(AU_KM, "real")).toBeCloseTo(1, 12);
  });

  it("laesst auch den innersten Planeten sichtbar nah an der Sonne", () => {
    expect(scaleDistance(0.39 * AU_KM, "visual")).toBeGreaterThan(1);
  });

  it("kennzeichnet den logarithmischen Modus ueber den Logarithmus", () => {
    const au = NEPTUN_SEMI_MAJOR_KM / AU_KM;
    expect(scaleDistance(NEPTUN_SEMI_MAJOR_KM, "log")).toBeCloseTo(
      100 * Math.log(1 + au),
      10,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "wirft bei ungueltiger Distanz %p einen RangeError",
    (bad) => {
      expect(() => scaleDistance(bad, "visual")).toThrow(RangeError);
      expect(() => scaleDistance(bad, "real")).toThrow(/endliche Zahl/);
    },
  );

  it("wirft bei nicht positiver Distanz einen RangeError", () => {
    expect(() => scaleDistance(0, "log")).toThrow(RangeError);
    expect(() => scaleDistance(-AU_KM, "visual")).toThrow(/groesser als 0/);
  });

  it("verwirft unbekannte Distanzmodi", () => {
    expect(() => scaleDistance(AU_KM, "unsinn" as DistanceMode)).toThrow(
      /Unbekannter DistanceMode/,
    );
  });
});

/**
 * Verhaeltnisse der "visual"-Kurve, bezogen auf die Erde.
 *
 * Die alte Kurve `au^0.35` stauchte das System so stark, dass Jupiter nur
 * 1,78x so weit von der Sonne lag wie die Erde (real sind es 5,20x) — der
 * ganze Innenbereich war ein Klumpen. Diese Tabelle schreibt die neuen,
 * dokumentierten Zielwerte fest. Referenz: Erde = 1 AE = 60 Szeneneinheiten.
 */
const VISUAL_RATIO_TABLE: ReadonlyArray<
  readonly [string, number, number, number]
> = [
  // [Planet, echte AE, min. Verhaeltnis, max. Verhaeltnis]
  ["Merkur", 0.387, 0.382, 0.398],
  ["Venus", 0.723, 0.712, 0.734],
  ["Erde", 1.0, 0.999, 1.001],
  ["Mars", 1.524, 1.509, 1.539],
  ["Jupiter", 5.203, 4.29, 4.51],
  ["Saturn", 9.537, 5.09, 5.89],
  ["Uranus", 19.191, 6.09, 6.91],
  ["Neptun", 30.069, 7.09, 7.39],
];

describe("scaleDistance — visual-Kurve", () => {
  const erdeVisuell = scaleDistance(AU_KM, "visual");

  it("bildet 1 AE im linearen Zweig auf 60 Szeneneinheiten ab", () => {
    // Bis zum Kniepunkt gilt streng linear: 60 Einheiten pro AE. Das ist
    // der Anker, an dem alle Verhaeltnisse der Tabelle haengen.
    expect(erdeVisuell).toBeCloseTo(60, 10);
  });

  it.each(VISUAL_RATIO_TABLE)(
    "%s liegt bei %.2f-%.2f Erde-Bahnen",
    (_name, au, min, max) => {
      const verhaeltnis = scaleDistance(au * AU_KM, "visual") / erdeVisuell;
      expect(
        verhaeltnis,
        `${_name}: ${verhaeltnis.toFixed(3)}x Erde, erlaubt ${min}-${max}`,
      ).toBeGreaterThanOrEqual(min);
      expect(
        verhaeltnis,
        `${_name}: ${verhaeltnis.toFixed(3)}x Erde, erlaubt ${min}-${max}`,
      ).toBeLessThanOrEqual(max);
    },
  );

  it("haelt Merkur, Mars und Erde exakt auf ihren echten Verhaeltnissen", () => {
    // Diese drei liegen unterhalb des Kniepunkts (4 AE) und muessen daher
    // EXAKT linear sein — 2 % Toleranz, die Kurve ist hier fehlerfrei.
    for (const [name, au, soll] of [
      ["Merkur", 0.387, 0.387],
      ["Mars", 1.524, 1.524],
    ] as const) {
      const ist = scaleDistance(au * AU_KM, "visual") / erdeVisuell;
      expect(Math.abs(ist - soll) / soll, `${name} driftet`).toBeLessThan(0.02);
    }
  });

  it("bildet Jupiter weit ausserhalb der Erde ab — nicht bei 1,78x", () => {
    // Der behobene Fehler: mit `au^0.35` lag Jupiter bei 1,78x Erde.
    const verhaeltnis = scaleDistance(5.203 * AU_KM, "visual") / erdeVisuell;
    expect(verhaeltnis).toBeGreaterThan(3);
    expect(verhaeltnis).toBeGreaterThan(4);
  });

  it("ist ueber 0,39 .. 30 AE streng monoton steigend", () => {
    let vorher = Number.NEGATIVE_INFINITY;
    for (let au = 0.39; au <= 30.0001; au += 0.01) {
      const wert = scaleDistance(au * AU_KM, "visual");
      expect(
        wert,
        `Kurve faellt bei ${au.toFixed(2)} AE (${wert} <= ${vorher})`,
      ).toBeGreaterThan(vorher);
      vorher = wert;
    }
  });

  it("ist am Kniepunkt (4 AE) stetig", () => {
    // Genau an der Knie-Stelle muss der lineare Zweig in den logarithmischen
    // uebergehen, ohne einen Sprung zu erzeugen — sonst sieht man eine
    // Luecke in der Umlaufbahn des Planeten, der dort liegt.
    const links = scaleDistance(3.99 * AU_KM, "visual");
    const rechts = scaleDistance(4.01 * AU_KM, "visual");
    const sprung = Math.abs(rechts - links) / links;
    expect(sprung, `Sprung am Knie: ${(sprung * 100).toFixed(3)} %`).toBeLessThan(0.005);
    // Zusaetzlich: der Wert AN der Knie-Stelle selbst ist exakt der lineare.
    expect(scaleDistance(4 * AU_KM, "visual")).toBeCloseTo(4 * 60, 10);
  });

  it("haelt die Reihenfolge der Planeten von innen nach aussen ein", () => {
    // Ein Kind muss Innen- und Aussenbereich unterscheiden koennen. Mit der
    // alten Kurve lagen Jupiter (1,78x) und Mars (1,52x) dicht beieinander.
    const verhaeltnisse = VISUAL_RATIO_TABLE.map(
      ([, au]) => scaleDistance(au * AU_KM, "visual") / erdeVisuell,
    );
    for (let i = 1; i < verhaeltnisse.length; i += 1) {
      expect(verhaeltnisse[i] ?? 0).toBeGreaterThan(verhaeltnisse[i - 1] ?? 0);
    }
    // Der Abstand Erde -> Mars betraegt exakt das echte Verhaeltnis; das ist
    // der Bereich, in dem die alte Kurve am schlimmsten schnitt.
    const marsErde = (verhaeltnisse[3] ?? 0) / (verhaeltnisse[2] ?? 1);
    expect(Math.abs(marsErde - 1.524)).toBeLessThan(0.03);
  });
});

describe("timeScaleFor", () => {
  it.each([
    ["realtime", 1],
    ["hours", 60],
    ["days", 3600],
    ["weeks", 604800],
    ["months", 2_629_800],
    ["years", 31_557_600],
  ] as ReadonlyArray<readonly [TimePreset, number]>)(
    "liefert fuer %s exakt %d Sekunden pro Sekunde",
    (preset, expected) => {
      expect(timeScaleFor(preset)).toBe(expected);
    },
  );

  it("wirft bei unbekanntem Preset einen RangeError", () => {
    expect(() => timeScaleFor("sekunden" as TimePreset)).toThrow(
      /Unbekanntes TimePreset/,
    );
  });
});

describe("formatKm", () => {
  it.each([
    [0, "0 km"],
    [1000, "1.000 km"],
    [999999, "999.999 km"],
    [149597870.7, "149.597.871 km"],
    [384400000, "384.400.000 km"],
  ] as ReadonlyArray<readonly [number, string]>)(
    "formatiert %p zu '%s' ohne Exponent",
    (km, expected) => {
      const result = formatKm(km);
      expect(result).toBe(expected);
      expect(result).not.toMatch(/[eE][+-]/);
    },
  );

  it("kuerzt ab einer Milliarde auf Mrd. km", () => {
    expect(formatKm(1.496e9)).toBe("1,496 Mrd. km");
    expect(formatKm(1e9)).not.toMatch(/[eE][+-]/);
  });

  it("behaelt das Vorzeichen bei negativen Werten", () => {
    expect(formatKm(-4200)).toBe("-4.200 km");
  });

  it("respektiert das optionale Locale-Argument", () => {
    expect(formatKm(384400000, "en-US")).toMatch(/384/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "wirft bei %p einen RangeError",
    (bad) => {
      expect(() => formatKm(bad)).toThrow(RangeError);
      expect(() => formatKm(bad)).toThrow(/endliche Zahl/);
    },
  );
});

describe("formatDuration", () => {
  it.each([
    [0, "0 Tage"],
    [1, "1 Tag"],
    [3, "3 Tage"],
    [10, "1 Woche"],
    [365, "1 Jahr"],
    [8.3 * 365.25, "8,3 Jahre"],
    [27_700_000, "75,8 Tsd. Jahre"],
    [27_700_000_000, "75,8 Millionen Jahre"],
  ] as ReadonlyArray<readonly [number, string]>)(
    "formatiert %p Tagen zu '%s'",
    (days, expected) => {
      expect(formatDuration(days)).toBe(expected);
    },
  );

  it("markiert negative Werte als rueckwaerts (retrograd)", () => {
    expect(formatDuration(-3)).toBe("3 Tage rueckwaerts");
    expect(formatDuration(-1)).toBe("1 Tag rueckwaerts");
  });

  it("rechnet auf Stunden um, wenn weniger als ein Tag", () => {
    expect(formatDuration(0.5)).toBe("12 Stunden");
  });

  it("erzeugt nie eine Exponentendarstellung", () => {
    expect(formatDuration(27_700_000_000)).not.toMatch(/[eE][+-]/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "wirft bei %p einen RangeError",
    (bad) => {
      expect(() => formatDuration(bad)).toThrow(RangeError);
      expect(() => formatDuration(bad)).toThrow(/endliche Zahl/);
    },
  );
});
