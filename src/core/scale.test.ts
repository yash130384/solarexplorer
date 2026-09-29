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

  it("setzt Neptun in visual naeher an die Sonne als in real", () => {
    const visual = scaleDistance(NEPTUN_SEMI_MAJOR_KM, "visual");
    const real = scaleDistance(NEPTUN_SEMI_MAJOR_KM, "real");
    expect(visual).toBeLessThan(real);
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
