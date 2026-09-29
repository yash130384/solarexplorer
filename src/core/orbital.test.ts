import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCALE_MODE,
  J2000_JULIAN_DATE,
  getScaleModeFromUrl,
  julianDateFromUnix,
  keplerOrbitalPeriodDays,
  meanAnomalyToTrue,
  orbitalPosition,
  unixFromJulianDate,
  vecLen,
  vecNormalize,
  vecs,
  type Body,
  type Vec3,
} from './orbital';

/** One astronomical unit in km (IAU 2012 definition). */
const AU_KM = 149_597_870.7;

/** Unix timestamp of the J2000.0 epoch in milliseconds. */
const J2000_UNIX_MS = 946_728_000_000;

/** Earth-like test body with slightly elliptical orbit. */
const EARTH_LIKE: Body = {
  id: 'earth',
  parent: 'sun',
  semiMajorAxisKm: AU_KM,
  eccentricity: 0.0167,
  inclinationDeg: 0,
  rotationPeriodH: 23.9345,
};

describe('meanAnomalyToTrue', () => {
  it('e=0 liefert M unveraendert zurueck', () => {
    for (const m of [0, 45, 90, 180, 270, 359.5]) {
      expect(meanAnomalyToTrue(m, 0)).toBeCloseTo(m, 10);
    }
  });

  it('e=0.5, M=0 ergibt 0', () => {
    expect(meanAnomalyToTrue(0, 0.5)).toBeCloseTo(0, 9);
  });

  it('e=0.5, M=90 ergibt groesser als 90 (Perigee erreicht)', () => {
    const nu = meanAnomalyToTrue(90, 0.5);
    expect(nu).toBeGreaterThan(90);
    expect(nu).toBeLessThan(120);
  });

  it('normalisiert negative Winkel in [0, 360)', () => {
    const nu = meanAnomalyToTrue(-90, 0.1);
    expect(nu).toBeGreaterThanOrEqual(0);
    expect(nu).toBeLessThan(360);
  });

  it('e=0.9: Ergebnis liegt fuer M in [0,360) immer in [0,360)', () => {
    for (let m = 0; m < 360; m += 7) {
      const nu = meanAnomalyToTrue(m, 0.9);
      expect(nu).toBeGreaterThanOrEqual(0);
      expect(nu).toBeLessThan(360);
    }
  });

  it('konvergiert fuer randnahe e=0.99 ohne Endlosschleife (Endlichkeit)', () => {
    for (const m of [0, 45, 90, 180, 270, 359]) {
      const nu = meanAnomalyToTrue(m, 0.99);
      expect(Number.isFinite(nu)).toBe(true);
      expect(nu).toBeGreaterThanOrEqual(0);
      expect(nu).toBeLessThan(360);
    }
  });

  it('erfuellt Keplers Gleichung M = E - e*sin(E) numerisch', () => {
    const e = 0.4;
    for (const m of [10, 80, 170, 260, 350]) {
      const E = (meanAnomalyToTrue(m, e) * Math.PI) / 180;
      const lhs = ((E - e * Math.sin(E)) * 180) / Math.PI;
      expect(normalize(lhs)).toBeCloseTo(normalize(m), 6);
    }
  });

  it('wirft RangeError bei NaN und e >= 1', () => {
    expect(() => meanAnomalyToTrue(Number.NaN, 0.1)).toThrow(RangeError);
    expect(() => meanAnomalyToTrue(10, 1)).toThrow(RangeError);
    expect(() => meanAnomalyToTrue(10, 1.5)).toThrow(RangeError);
    expect(() => meanAnomalyToTrue(10, -0.1)).toThrow(RangeError);
  });
});

describe('julianDateFromUnix / unixFromJulianDate', () => {
  it('J2000 (946728000000 ms) ergibt JD 2451545.0', () => {
    expect(julianDateFromUnix(J2000_UNIX_MS)).toBeCloseTo(2451545.0, 9);
    expect(J2000_JULIAN_DATE).toBe(2451545.0);
  });

  it('Unix-Nullpunkt ergibt JD 2440587.5', () => {
    expect(julianDateFromUnix(0)).toBeCloseTo(2440587.5, 9);
  });

  it('Roundtrip julianDateFromUnix(unixFromJulianDate(jd)) ~ jd', () => {
    for (const jd of [2440587.5, 2451545.0, 2460000.25, 1721424.5]) {
      expect(julianDateFromUnix(unixFromJulianDate(jd))).toBeCloseTo(jd, 6);
    }
  });

  it('wirft RangeError bei nicht-endlichen Werten', () => {
    expect(() => julianDateFromUnix(Number.NaN)).toThrow(RangeError);
    expect(() => unixFromJulianDate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('orbitalPosition', () => {
  it('Erde: Abstand liegt zwischen 0.98 und 1.02 AE', () => {
    for (const jd of [J2000_JULIAN_DATE, J2000_JULIAN_DATE + 100, J2000_JULIAN_DATE + 300]) {
      const state = orbitalPosition(EARTH_LIKE, jd);
      expect(state.distanceKm / AU_KM).toBeGreaterThan(0.98);
      expect(state.distanceKm / AU_KM).toBeLessThan(1.02);
    }
  });

  it('Position aendert sich mit der Zeit', () => {
    const a = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE);
    const b = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE + 30);
    const delta = vecLen(vecs(b.position, a.position));
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeGreaterThan(1_000_000);
  });

  it('eccentricity 0 ergibt konstante Distanz (Kreis)', () => {
    const circular: Body = { ...EARTH_LIKE, eccentricity: 0 };
    const distances = [0, 45, 137, 250, 359].map(
      (d) => orbitalPosition(circular, J2000_JULIAN_DATE + d).distanceKm,
    );
    for (const d of distances) {
      expect(d).toBeCloseTo(AU_KM, 3);
    }
  });

  it('eccentricity > 0 erzeugt eine Ellipse, kein Kreis', () => {
    const distances = [0, 90, 180, 270].map(
      (d) => orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE + d).distanceKm,
    );
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    expect(max - min).toBeGreaterThan(AU_KM * 0.01);
    // Halbachsenverhaeltnis einer Ellipse: min/max = (1-e)/(1+e)
    expect(min / max).toBeCloseTo((1 - EARTH_LIKE.eccentricity) / (1 + EARTH_LIKE.eccentricity), 2);
  });

  it('inclination 0: z bleibt 0, Position liegt in der Ebene', () => {
    const state = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE + 42);
    expect(state.position.z).toBeCloseTo(0, 6);
  });

  it('eccentricity 0: Distanz konstant ueber ein ganzes Jahr', () => {
    const circular: Body = { ...EARTH_LIKE, eccentricity: 0 };
    const first = orbitalPosition(circular, J2000_JULIAN_DATE).distanceKm;
    const later = orbitalPosition(circular, J2000_JULIAN_DATE + 365.25).distanceKm;
    expect(later).toBeCloseTo(first, 3);
  });

  it('trueAnomalyDeg liegt immer in [0,360)', () => {
    for (let d = 0; d < 400; d += 13) {
      const state = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE + d);
      expect(state.trueAnomalyDeg).toBeGreaterThanOrEqual(0);
      expect(state.trueAnomalyDeg).toBeLessThan(360);
    }
  });

  it('Geschwindigkeit folgt vis-viva und ist ~30 km/s fuer die Erde', () => {
    const state = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE);
    const v = vecLen(state.velocity);
    expect(v).toBeGreaterThan(28);
    expect(v).toBeLessThan(32);
  });

  it('vis-viva gilt: |v|^2 = GM*(2/r - 1/a)', () => {
    const GM = 1.32712440018e11;
    for (const d of [0, 77, 200, 360]) {
      const state = orbitalPosition(EARTH_LIKE, J2000_JULIAN_DATE + d);
      const a = EARTH_LIKE.semiMajorAxisKm;
      const vSquared = vecLen(state.velocity) ** 2;
      expect(vSquared).toBeCloseTo(GM * (2 / state.distanceKm - 1 / a), 3);
    }
  });

  it('Nur bei e=0 steht die Geschwindigkeit senkrecht auf dem Radiusvektor', () => {
    const circular: Body = { ...EARTH_LIKE, eccentricity: 0 };
    const state = orbitalPosition(circular, J2000_JULIAN_DATE + 77);
    const dot =
      state.position.x * state.velocity.x +
      state.position.y * state.velocity.y +
      state.position.z * state.velocity.z;
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });

  it('inklination 23.4 Grad hebt die Bahn aus der Ebene', () => {
    const tilted: Body = { ...EARTH_LIKE, inclinationDeg: 23.4 };
    const state = orbitalPosition(tilted, J2000_JULIAN_DATE + 30);
    expect(Math.abs(state.position.z)).toBeGreaterThan(0);
  });

  it('wirft RangeError bei NaN und physikalisch unmoeglichen Elementen', () => {
    expect(() => orbitalPosition(EARTH_LIKE, Number.NaN)).toThrow(RangeError);
    expect(() =>
      orbitalPosition({ ...EARTH_LIKE, semiMajorAxisKm: -1 }, J2000_JULIAN_DATE),
    ).toThrow(RangeError);
    expect(() =>
      orbitalPosition({ ...EARTH_LIKE, semiMajorAxisKm: 0 }, J2000_JULIAN_DATE),
    ).toThrow(RangeError);
    expect(() =>
      orbitalPosition({ ...EARTH_LIKE, eccentricity: 1.2 }, J2000_JULIAN_DATE),
    ).toThrow(RangeError);
    expect(() =>
      orbitalPosition({ ...EARTH_LIKE, eccentricity: Number.NaN }, J2000_JULIAN_DATE),
    ).toThrow(RangeError);
  });
});

describe('vecs / vecLen / vecNormalize', () => {
  it('vecs zieht Komponentenweise ab', () => {
    const a: Vec3 = { x: 5, y: -2, z: 7 };
    const b: Vec3 = { x: 1, y: 3, z: 2 };
    expect(vecs(a, b)).toEqual({ x: 4, y: -5, z: 5 });
  });

  it('vecLen berechnet die euklidische Laenge', () => {
    expect(vecLen({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(vecLen({ x: 2, y: 3, z: 6 })).toBe(7);
    expect(vecLen({ x: 0, y: 0, z: 0 })).toBe(0);
  });

  it('vecNormalize liefert einen Einheitsvektor', () => {
    const n = vecNormalize({ x: 0, y: 0, z: -9 });
    expect(n).toEqual({ x: 0, y: 0, z: -1 });
    expect(vecLen(vecNormalize({ x: 1, y: 2, z: 2 }))).toBeCloseTo(1, 12);
  });

  it('vecNormalize(0,0,0) wirft RangeError', () => {
    expect(() => vecNormalize({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });

  it('vec-Funktionen werfen bei NaN', () => {
    expect(() => vecLen({ x: Number.NaN, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => vecs({ x: Number.NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });
});

describe('keplerOrbitalPeriodDays', () => {
  it('Erde ergibt ~365.25 Tage (1% Toleranz)', () => {
    const period = keplerOrbitalPeriodDays(AU_KM, 0.0167);
    expect(period).toBeGreaterThan(365.25 * 0.99);
    expect(period).toBeLessThan(365.25 * 1.01);
  });

  it('Hauptachse^3/2-Gesetz: 4x Halbachse -> 8x Periode', () => {
    const p1 = keplerOrbitalPeriodDays(AU_KM, 0);
    const p2 = keplerOrbitalPeriodDays(AU_KM * 4, 0);
    expect(p2 / p1).toBeCloseTo(8, 6);
  });

  it('Exzentrizitaet beeinflusst die Periode nicht', () => {
    expect(keplerOrbitalPeriodDays(AU_KM, 0.9)).toBeCloseTo(
      keplerOrbitalPeriodDays(AU_KM, 0),
      6,
    );
  });

  it('wirft RangeError bei a <= 0, e >= 1 und NaN', () => {
    expect(() => keplerOrbitalPeriodDays(0, 0)).toThrow(RangeError);
    expect(() => keplerOrbitalPeriodDays(-1, 0)).toThrow(RangeError);
    expect(() => keplerOrbitalPeriodDays(AU_KM, 1)).toThrow(RangeError);
    expect(() => keplerOrbitalPeriodDays(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe('getScaleModeFromUrl', () => {
  it.each([
    ['?scale=real', 'real'],
    ['?scale=visual', 'visual'],
    ['?scale=compact', 'compact'],
    ['scale=real', 'real'],
    ['?foo=1', 'visual'],
    ['?scale=quatsch', 'visual'],
    ['', 'visual'],
    ['?', 'visual'],
    ['?scale=', 'visual'],
    ['?size=real&scale=compact', 'compact'],
  ])('Query %j ergibt %j', (search, expected) => {
    expect(getScaleModeFromUrl(search)).toBe(expected);
  });

  it('Default-Modus ist visual', () => {
    expect(DEFAULT_SCALE_MODE).toBe('visual');
  });
});

/**
 * Helper: reduce an angle to [0, 360) for periodic comparisons.
 *
 * @param deg - Angle in degrees.
 * @returns The angle reduced into [0, 360).
 */
function normalize(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}
