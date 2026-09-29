/**
 * Orbital mechanics — pure math, no rendering dependencies.
 *
 * This module deliberately contains **no** Three.js imports so that it stays
 * unit-testable without a WebGL context. All angles are in degrees on the
 * public API (kid-friendly, matches the JSON body data), radians only inside
 * the numerical solvers.
 *
 * Physical model (documented approximations):
 * - Orbits are treated as **elliptical Kepler orbits** (no perturbations,
 *   no precession of the ellipse shape).
 * - The gravitational parameter of the parent is approximated by the solar
 *   value GM_SUN for every body (correct for planets; moons are then
 *   slightly off, which is acceptable for a visualisation).
 * - The orientation of the orbital plane is derived from the body's
 *   `rotationPeriodH`: the completed revolutions since the J2000 epoch rotate
 *   the node of the orbit, giving a time-dependent orientation.
 */

/** Julian Date of the J2000.0 epoch (2000-01-01 12:00 TT). */
export const J2000_JULIAN_DATE = 2451545.0;

/** Number of milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

/** Seconds in one day. */
const SECONDS_PER_DAY = 86_400;

/** Gravitational parameter of the Sun in km^3/s^2 (IAU nominal value). */
const GM_SUN = 1.32712440018e11;

/** Two PI, the full circle in radians. */
const TAU = Math.PI * 2;

/** Degrees per radian. */
const DEG_PER_RAD = 180 / Math.PI;

/**
 * Scale mode selected by the user.
 *
 * NOTE: the naming follows ticket 03 (`src/core/scale.ts`); this local
 * definition keeps `orbital.ts` dependency-free until that module is merged.
 */
export type ScaleMode = 'visual' | 'real' | 'compact';

/** The mode used when no explicit (or no valid) choice is given. */
export const DEFAULT_SCALE_MODE: ScaleMode = 'visual';

/** All scale modes accepted by {@link getScaleModeFromUrl}. */
export const SCALE_MODES: readonly ScaleMode[] = ['visual', 'real', 'compact'] as const;

/** A vector in kilometres (position) or km/s (velocity). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Minimal set of orbital elements needed to place a body on its orbit. */
export interface Body {
  /** Stable identifier, e.g. `earth`. */
  id: string;
  /** Identifier of the parent body, `null` for the Sun. */
  parent: string | null;
  /** Semi-major axis of the ellipse in kilometres. */
  semiMajorAxisKm: number;
  /** Orbital eccentricity, `0` = circular, `< 1` = closed ellipse. */
  eccentricity: number;
  /** Inclination of the orbital plane in degrees. */
  inclinationDeg: number;
  /** Sidereal rotation period in hours. */
  rotationPeriodH: number;
}

/** The instantaneous state of a body relative to its parent. */
export interface OrbitalState {
  /** Position relative to the parent, in km. */
  position: Vec3;
  /** Velocity relative to the parent, in km/s. */
  velocity: Vec3;
  /** True anomaly in degrees, normalised to `[0, 360)`. */
  trueAnomalyDeg: number;
  /** Distance to the parent in km. */
  distanceKm: number;
}

/**
 * Normalise an angle in degrees to the interval `[0, 360)`.
 *
 * @param deg - Angle in degrees, may be any finite value.
 * @returns The same angle reduced into `[0, 360)`.
 * @throws RangeError if `deg` is not a finite number.
 */
function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) {
    throw new RangeError(`Winkel muss eine endliche Zahl sein, ist aber: ${deg}`);
  }
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Reject non-finite input with a human-readable German error.
 *
 * @param value - The value to check.
 * @param name - Name of the parameter, used in the message.
 * @throws RangeError if `value` is not a finite number.
 */
function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} muss eine endliche Zahl sein, ist aber: ${value}`);
  }
}

/**
 * Subtract two vectors.
 *
 * @param a - Minuend vector.
 * @param b - Subtrahend vector.
 * @returns `a - b` as a new vector.
 * @throws RangeError if a component is not finite.
 */
export function vecs(a: Vec3, b: Vec3): Vec3 {
  assertFinite(a.x, 'a.x');
  assertFinite(a.y, 'a.y');
  assertFinite(a.z, 'a.z');
  assertFinite(b.x, 'b.x');
  assertFinite(b.y, 'b.y');
  assertFinite(b.z, 'b.z');
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Euclidean length of a vector.
 *
 * @param v - Input vector.
 * @returns `sqrt(x^2 + y^2 + z^2)`.
 * @throws RangeError if a component is not finite.
 */
export function vecLen(v: Vec3): number {
  assertFinite(v.x, 'v.x');
  assertFinite(v.y, 'v.y');
  assertFinite(v.z, 'v.z');
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Normalise a vector to unit length.
 *
 * @param v - Input vector, must not be the zero vector.
 * @returns A new unit vector pointing in the same direction.
 * @throws RangeError if the vector has length 0 or a non-finite component.
 */
export function vecNormalize(v: Vec3): Vec3 {
  const len = vecLen(v);
  if (len === 0) {
    throw new RangeError('vecNormalize: Der Nullvektor kann nicht normiert werden');
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Kepler's third law: orbital period from the semi-major axis.
 *
 * `T = 2*pi*sqrt(a^3 / GM)`, with `a` in km and `GM = GM_SUN`, converted to days.
 *
 * @param a - Semi-major axis in km, must be > 0.
 * @param e - Eccentricity (does not change the period, only the shape).
 * @returns The period in days.
 * @throws RangeError for `a <= 0`, `e < 0` or `e >= 1` (no closed ellipse).
 */
export function keplerOrbitalPeriodDays(a: number, e: number): number {
  assertFinite(a, 'semiMajorAxisKm (a)');
  assertFinite(e, 'eccentricity (e)');
  if (a <= 0) {
    throw new RangeError(`Halbgroße Achse a muss groesser als 0 sein, ist aber: ${a}`);
  }
  if (e < 0) {
    throw new RangeError(`Exzentrizitaet e darf nicht negativ sein, ist aber: ${e}`);
  }
  if (e >= 1) {
    throw new RangeError(
      `Exzentrizitaet e muss kleiner als 1 sein (geschlossene Ellipse), ist aber: ${e}`,
    );
  }
  return (TAU * Math.sqrt((a * a * a) / GM_SUN)) / SECONDS_PER_DAY;
}

/**
 * Solve Kepler's equation `M = E - e*sin(E)` with Newton's method.
 *
 * Newton iteration: `E_{n+1} = E_n - (E_n - e*sin(E_n) - M) / (1 - e*cos(E_n))`.
 * Starting value is `E = M`; at most 50 iterations, converged when the step
 * is below `1e-10` rad. For `e` close to 1 the derivative can get small near
 * the apocentre, so the iteration is additionally protected by a bounded
 * damping step and a hard iteration cap (never an endless loop).
 *
 * @param M_deg - Mean anomaly in degrees.
 * @param e - Eccentricity, `0 <= e < 1`.
 * @returns The eccentric anomaly `E` in degrees, normalised to `[0, 360)`.
 * @throws RangeError for `e < 0`, `e >= 1` or non-finite input.
 */
export function meanAnomalyToTrue(M_deg: number, e: number): number {
  assertFinite(M_deg, 'M (mean anomaly)');
  assertFinite(e, 'eccentricity (e)');
  if (e < 0) {
    throw new RangeError(`Exzentrizitaet e darf nicht negativ sein, ist aber: ${e}`);
  }
  if (e >= 1) {
    throw new RangeError(
      `Exzentrizitaet e muss kleiner als 1 sein (geschlossene Ellipse), ist aber: ${e}`,
    );
  }

  const M = (normalizeDeg(M_deg) * Math.PI) / 180;
  // Circular orbit: the eccentric anomaly equals the mean anomaly.
  if (e === 0) {
    return normalizeDeg(M_deg);
  }

  // Start value M (bounded to avoid a huge first step).
  let E = Math.max(-Math.PI, Math.min(Math.PI, M));
  const MAX_ITER = 50;
  const TOL = 1e-10;

  for (let i = 0; i < MAX_ITER; i++) {
    const f = E - e * Math.sin(E) - M;
    if (Math.abs(f) < TOL) {
      return normalizeDeg(E * DEG_PER_RAD);
    }
    const fp = 1 - e * Math.cos(E);
    if (Math.abs(fp) < 1e-14) {
      // Derivative practically zero (e ~ 1 near the apocentre): take a small
      // damped step instead of dividing by ~0.
      E += e < 0 ? 0 : 1e-6;
      continue;
    }
    let step = f / fp;
    // Damping keeps the iteration stable for very eccentric orbits.
    if (step > Math.PI) step = Math.PI;
    if (step < -Math.PI) step = -Math.PI;
    E -= step;
  }

  // Ran out of iterations without reaching the tolerance: report the last
  // (finite) estimate rather than looping forever.
  return normalizeDeg(E * DEG_PER_RAD);
}

/**
 * Convert a Unix timestamp in milliseconds to a Julian Date.
 *
 * `JD = ms / 86400000 + 2440587.5` (JD 0 = 1970-01-01 00:00 UTC).
 *
 * @param ms - Milliseconds since the Unix epoch.
 * @returns The corresponding Julian Date.
 * @throws RangeError if `ms` is not finite.
 */
export function julianDateFromUnix(ms: number): number {
  assertFinite(ms, 'Unix-Zeitstempel (ms)');
  return ms / MS_PER_DAY + 2440587.5;
}

/**
 * Convert a Julian Date back to a Unix timestamp in milliseconds.
 *
 * Inverse of {@link julianDateFromUnix}.
 *
 * @param jd - Julian Date.
 * @returns Milliseconds since the Unix epoch.
 * @throws RangeError if `jd` is not finite.
 */
export function unixFromJulianDate(jd: number): number {
  assertFinite(jd, 'Julian Date');
  return (jd - 2440587.5) * MS_PER_DAY;
}

/**
 * Read the scale mode from a URL query string.
 *
 * Parses `?scale=visual|real|compact`; anything else (missing, unknown,
 * non-finite garbage) falls back to {@link DEFAULT_SCALE_MODE}.
 *
 * @param search - A query string, with or without the leading `?`.
 * @returns The requested scale mode, or `'visual'`.
 */
export function getScaleModeFromUrl(search: string): ScaleMode {
  if (typeof search !== 'string') {
    return DEFAULT_SCALE_MODE;
  }
  const query = search.startsWith('?') ? search.slice(1) : search;
  for (const part of query.split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    if (key !== 'scale') continue;
    const value = decodeURIComponent(part.slice(eq + 1)).trim().toLowerCase();
    const match = SCALE_MODES.find((mode) => mode === value);
    return match ?? DEFAULT_SCALE_MODE;
  }
  return DEFAULT_SCALE_MODE;
}

/**
 * Rotate an in-plane vector by the orbital inclination and the node angle.
 *
 * The inclination tilts the orbital plane around the x axis; the node angle
 * (derived from the body's rotation since J2000) rotates the result around
 * the z axis, so the orbit orientation changes with time.
 *
 * @param v - Vector in the orbital plane (km or km/s).
 * @param inclinationRad - Inclination in radians.
 * @param nodeRad - Node angle in radians.
 * @returns The rotated vector.
 */
function toSceneSpace(v: Vec3, inclinationRad: number, nodeRad: number): Vec3 {
  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  // Inclination: fold the in-plane y axis around the x axis.
  const xi = v.x;
  const yi = v.y * cosI - v.z * sinI;
  const zi = v.y * sinI + v.z * cosI;
  // Node rotation around the z axis.
  const cosN = Math.cos(nodeRad);
  const sinN = Math.sin(nodeRad);
  return { x: xi * cosN - yi * sinN, y: xi * sinN + yi * cosN, z: zi };
}

/**
 * Compute the instantaneous orbital state of a body relative to its parent.
 *
 * Steps:
 * 1. Period `T` from Kepler's third law, mean motion `n = 360/T` deg/day.
 * 2. Mean anomaly `M = n * (JD - JD_J2000)`, i.e. the epoch angle is 0 at
 *    J2000 and advances with the orbital period.
 * 3. Eccentric anomaly `E` from {@link meanAnomalyToTrue}, true anomaly
 *    `nu = 2*atan2(sqrt(1+e)*sin(E/2), sqrt(1-e)*cos(E/2))`.
 * 4. Position in the orbital plane `x = a*(cos E - e)`, `y = a*sqrt(1-e^2)*sin E`,
 *    then inclination and node rotation.
 * 5. Velocity from the vis-viva equation
 *    `v = sqrt(GM*(2/r - 1/a))`, directed perpendicular to the radius
 *    (in-plane components `-sqrt(GM*a)/r * sin E` and
 *    `sqrt(GM*a)/r * sqrt(1-e^2) * cos E`), same rotation applied.
 *
 * @param elements - The body's orbital elements.
 * @param julianDate - The current Julian Date.
 * @returns Position (km), velocity (km/s), true anomaly (deg) and distance (km).
 * @throws RangeError for invalid elements or a non-finite Julian Date.
 */
export function orbitalPosition(elements: Body, julianDate: number): OrbitalState {
  assertFinite(julianDate, 'julianDate');
  assertFinite(elements.semiMajorAxisKm, 'semiMajorAxisKm');
  assertFinite(elements.eccentricity, 'eccentricity');
  assertFinite(elements.inclinationDeg, 'inclinationDeg');
  assertFinite(elements.rotationPeriodH, 'rotationPeriodH');
  if (elements.semiMajorAxisKm <= 0) {
    throw new RangeError(
      `Halbgroesse Achse muss groesser als 0 sein, ist aber: ${elements.semiMajorAxisKm}`,
    );
  }
  const e = elements.eccentricity;
  if (e < 0) {
    throw new RangeError(`Exzentrizitaet darf nicht negativ sein, ist aber: ${e}`);
  }
  if (e >= 1) {
    throw new RangeError(
      `Exzentrizitaet muss kleiner als 1 sein (geschlossene Ellipse), ist aber: ${e}`,
    );
  }

  const a = elements.semiMajorAxisKm;
  const periodDays = keplerOrbitalPeriodDays(a, e);
  const meanMotionDegPerDay = 360 / periodDays;
  const daysSinceJ2000 = julianDate - J2000_JULIAN_DATE;
  const M = normalizeDeg(meanMotionDegPerDay * daysSinceJ2000);

  // Eccentric anomaly in radians (Newton solver returns degrees).
  const E = (meanAnomalyToTrue(M, e) * Math.PI) / 180;
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);

  // Position in the orbital plane.
  const planePosition: Vec3 = { x: a * (cosE - e), y: b * sinE, z: 0 };

  // Distance to the parent (radius vector) — computed before rotation, since
  // rotations preserve length.
  const distanceKm = Math.hypot(planePosition.x, planePosition.y);

  // Velocity in the orbital plane, perpendicular to the radius vector
  // (vis-viva in its component form).
  const k = Math.sqrt(GM_SUN * a) / distanceKm;
  const planeVelocity: Vec3 = { x: -k * sinE, y: k * b / a * cosE, z: 0 };

  // Node angle: how many revolutions the body completed since J2000,
  // derived from its rotation period.
  const rotationPeriodH =
    elements.rotationPeriodH === 0 ? 0 : elements.rotationPeriodH;
  const nodeDeg = rotationPeriodH === 0
    ? 0
    : (360 * (daysSinceJ2000 * 24) / rotationPeriodH) % 360;

  const inclinationRad = (elements.inclinationDeg * Math.PI) / 180;
  const nodeRad = (nodeDeg * Math.PI) / 180;

  const trueAnomalyDeg = normalizeDeg(
    (2 *
      Math.atan2(
        Math.sqrt(1 + e) * Math.sin(E / 2),
        Math.sqrt(1 - e) * Math.cos(E / 2),
      ) *
      DEG_PER_RAD),
  );

  return {
    position: toSceneSpace(planePosition, inclinationRad, nodeRad),
    velocity: toSceneSpace(planeVelocity, inclinationRad, nodeRad),
    trueAnomalyDeg,
    distanceKm,
  };
}
