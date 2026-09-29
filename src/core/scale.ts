/**
 * Kern-Skalierung: Groessen, Distanzen, Zeitraffer und kinderfreunde Formatierung.
 *
 * Diese Logik ist bewusst frei von Three.js und DOM. Alle Funktionen sind rein
 * und damit ohne WebGL testbar (siehe `scale.test.ts`).
 *
 * @module core/scale
 */

import {
  AU_KM,
  COMPACT_RADIUS_FACTOR,
  LOG_DISTANCE_SCALE,
  MOND_RADIUS_KM,
  SCALE_MAX_RADIUS_KM,
  SCALE_MIN_RADIUS_KM,
  VISUAL_DISTANCE_EXPONENT,
  VISUAL_DISTANCE_FACTOR,
  VISUAL_MAX_RADIUS,
  VISUAL_MIN_RADIUS,
} from "./constants";

/** Modus der Radius-Skalierung. */
export type ScaleMode = "visual" | "real" | "compact";

/** Modus der Distanz-Skalierung. */
export type DistanceMode = "visual" | "real" | "log";

/** Voreingestellter Zeitraffer/-lupe. */
export type TimePreset =
  | "realtime"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

/**
 * Secunden simulierter Zeit pro Sekunde Echtzeit, je Preset.
 *
 * @type {Readonly<Record<TimePreset, number>>}
 */
const TIME_SCALES: Readonly<Record<TimePreset, number>> = Object.freeze({
  realtime: 1,
  hours: 60,
  days: 3600,
  weeks: 604800,
  months: 2_629_800,
  years: 31_557_600,
});

/**
 * Wirft einen RangeError, wenn eine Zahl nicht endlich ist.
 *
 * @param value - Zu pruefende Zahl.
 * @param label - Name des Parameters fuer die Fehlermeldung.
 * @returns {void}
 * @throws {RangeError} Wenn `value` NaN oder Infinity ist.
 */
function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${label} muss eine endliche Zahl sein, ist aber ${String(value)}.`,
    );
  }
}

/**
 * Klemmt eine Zahl auf einen Bereich.
 *
 * @param value - Zu klemmender Wert.
 * @param min - Untere Grenze.
 * @param max - Obere Grenze.
 * @returns {number} Der auf den Bereich geklemmte Wert.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Skaliert den Radius eines Koerpers auf Szeneneinheiten.
 *
 * - `visual`: logarithmische Abbildung des realen Radiusbereichs
 *   (Pluto bis Sonne) auf `[VISUAL_MIN_RADIUS, VISUAL_MAX_RADIUS]`, damit
 *   Merkur und Neptun gleichzeitig sichtbar sind.
 * - `real`: echtes Verhaeltnis zum Erdmond (Erdmond = 1 Szeneneinheit).
 * - `compact`: `visual`, um {@link COMPACT_RADIUS_FACTOR} verkleinert, fuer
 *   Uebersichten. Ergebnis bleibt im gleichen Bereich wie `visual`.
 *
 * @param radiusKm - Realer Radius in Kilometern (muss > 0 sein).
 * @param mode - Gewaehlter Skalierungsmodus.
 * @returns {number} Radius in Szeneneinheiten. `visual`/`compact` liegen
 *   garantiert in `[VISUAL_MIN_RADIUS, VISUAL_MAX_RADIUS]`.
 * @throws {RangeError} Wenn `radiusKm` nicht endlich oder nicht positiv ist.
 */
export function scaleRadius(radiusKm: number, mode: ScaleMode): number {
  assertFinite(radiusKm, "radiusKm");
  if (radiusKm <= 0) {
    throw new RangeError(`radiusKm muss groesser als 0 sein, ist aber ${radiusKm}.`);
  }

  if (mode === "real") {
    return radiusKm / MOND_RADIUS_KM;
  }
  if (mode !== "visual" && mode !== "compact") {
    throw new RangeError(`Unbekannter ScaleMode: ${String(mode)}.`);
  }

  const logMin = Math.log(SCALE_MIN_RADIUS_KM);
  const logSpan = Math.log(SCALE_MAX_RADIUS_KM) - logMin;
  const t = clamp((Math.log(radiusKm) - logMin) / logSpan, 0, 1);
  const visual =
    VISUAL_MIN_RADIUS + t * (VISUAL_MAX_RADIUS - VISUAL_MIN_RADIUS);

  if (mode === "compact") {
    return clamp(visual * COMPACT_RADIUS_FACTOR, VISUAL_MIN_RADIUS, VISUAL_MAX_RADIUS);
  }
  return visual;
}

/**
 * Skaliert die grosse Halbachse einer Umlaufbahn auf Szeneneinheiten.
 *
 * - `visual`: komprimiert mit Exponent {@link VISUAL_DISTANCE_EXPONENT}, damit
 *   Innen- und Aussenzonen im selben Bild sichtbar bleiben.
 * - `real`: echte Astronomische Einheiten (1 AE = 1 Szeneneinheit).
 * - `log`: rein logarithmisch, `ln(1 + a/AU)`.
 *
 * @param semiMajorAxisKm - Grosse Halbachse in Kilometern (muss > 0 sein).
 * @param mode - Gewaehlter Distanzmodus.
 * @returns {number} Distanz in Szeneneinheiten. In allen Modi monoton
 *   steigend mit `semiMajorAxisKm`.
 * @throws {RangeError} Wenn `semiMajorAxisKm` nicht endlich oder nicht positiv ist.
 */
export function scaleDistance(semiMajorAxisKm: number, mode: DistanceMode): number {
  assertFinite(semiMajorAxisKm, "semiMajorAxisKm");
  if (semiMajorAxisKm <= 0) {
    throw new RangeError(
      `semiMajorAxisKm muss groesser als 0 sein, ist aber ${semiMajorAxisKm}.`,
    );
  }

  const au = semiMajorAxisKm / AU_KM;
  switch (mode) {
    case "real":
      return au;
    case "log":
      return LOG_DISTANCE_SCALE * Math.log(1 + au);
    case "visual":
      return VISUAL_DISTANCE_FACTOR * Math.pow(au, VISUAL_DISTANCE_EXPONENT);
    default:
      throw new RangeError(`Unbekannter DistanceMode: ${String(mode)}.`);
  }
}

/**
 * Liefert den Zeitraffer-Faktor fuer ein Preset.
 *
 * @param preset - Name des Voreinstellungs-Werts.
 * @returns {number} Simulierte Sekunden pro Echtzeit-Sekunde.
 * @throws {RangeError} Wenn das Preset unbekannt ist.
 */
export function timeScaleFor(preset: TimePreset): number {
  const scale = TIME_SCALES[preset];
  if (scale === undefined) {
    throw new RangeError(`Unbekanntes TimePreset: ${String(preset)}.`);
  }
  return scale;
}

/**
 * Formatiert eine Zahl mit deutschem Tausenderpunkt und Dezimalkomma.
 *
 * @param value - Zu formatierende Zahl.
 * @param fractionDigits - Maximale Anzahl Nachkommastellen (Standard 3).
 * @returns {string} Formatierter Zahlenstring ohne Exponentendarstellung.
 */
function formatNumberDe(
  value: number,
  fractionDigits: number,
  locale = "de-DE",
): string {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    // Manuelles Grouping als Fallback, falls Intl nicht verfuegbar ist.
    return value.toFixed(fractionDigits).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}

/**
 * Formatiert eine Distanz in Kilometern kinderfreundlich.
 *
 * Kleine Werte bleiben ausgeschrieben (`"7.000 km"`), Werte bis eine Milliarde
 * km werden mit Punkt gruppiert (`"384.400.000 km"`), darueber wird auf
 * Milliarden abgekuerzt (`"1,496 Mrd. km"`). Exponentendarstellung wie
 * `1.496E+08` wird niemals erzeugt.
 *
 * @param km - Distanz in Kilometern.
 * @param locale - Optionale Locale-Kennung (Standard `"de-DE"`).
 * @returns {string} Formatierter String mit Einheit `"km"`.
 * @throws {RangeError} Wenn `km` nicht endlich ist.
 */
export function formatKm(km: number, locale = "de-DE"): string {
  assertFinite(km, "km");
  const sign = km < 0 ? "-" : "";
  const abs = Math.abs(km);
  const group = (value: number, digits: number): string =>
    formatNumberDe(value, digits, locale);
  let body: string;

  if (abs < 1e9) {
    body = group(roundTo(abs, 0), 0);
  } else {
    body = `${group(roundTo(abs / 1e9, 3), 3).replace(/,?0+$/, "")} Mrd.`;
  }

  return `${sign}${body} km`;
}

/**
 * Rundet auf `digits` Nachkommastellen und beseitigt Fliesskomma-Artefakte.
 *
 * @param value - Zu rundender Wert.
 * @param digits - Anzahl Nachkommastellen.
 * @returns {number} Gerundeter Wert.
 */
function roundTo(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

/** Tage pro Jahr (365,25 — Julianisches Jahr). */
const DAYS_PER_YEAR = 365.25;

/**
 * Formatiert eine Dauer in Tagen lesbar fuer Kinder.
 *
 * Es wird automatisch auf die passendste Einheit umgerechnet: Stunden, Tage,
 * Wochen, Monate, Jahre, Tausend Jahre und Millionen Jahre. Negative Werte
 * (retrograde Umlaufrichtung) erhalten das Suffix `" rueckwaerts"`.
 *
 * @param days - Dauer in Tagen (darf negativ sein).
 * @returns {string} Lesbare Dauer, z. B. `"3 Tage"` oder `"8,3 Jahre"`.
 * @throws {RangeError} Wenn `days` nicht endlich ist.
 */
export function formatDuration(days: number): string {
  assertFinite(days, "days");
  if (days === 0) {
    return "0 Tage";
  }

  const backwards = days < 0;
  const abs = Math.abs(days);
  /** Baut den Zahlenteil inkl. Einheit. */
  const withUnit = (value: number, singular: string, pluralForm: string): string =>
    `${formatNumberDe(value, 1)} ${plural(value, singular, pluralForm)}`;

  let body: string;
  if (abs < 1) {
    body = withUnit(roundTo(abs * 24, 0), "Stunde", "Stunden");
  } else if (abs < 7) {
    body = withUnit(roundTo(abs, 0), "Tag", "Tage");
  } else if (abs < 30) {
    body = withUnit(roundTo(abs / 7, 0), "Woche", "Wochen");
  } else if (abs < DAYS_PER_YEAR && abs < 365) {
    body = withUnit(roundTo(abs / 30, 0), "Monat", "Monate");
  } else {
    const years = abs / DAYS_PER_YEAR;
    if (years < 1e3) {
      body = withUnit(trimDecimal(years), "Jahr", "Jahre");
    } else if (years < 1e6) {
      body = withUnit(trimDecimal(years / 1e3), "Tsd. Jahr", "Tsd. Jahre");
    } else {
      body = withUnit(trimDecimal(years / 1e6), "Millionen Jahr", "Millionen Jahre");
    }
  }

  return backwards ? `${body} rueckwaerts` : body;
}

/**
 * Schneidet ueberfluessige Nullen am Ende einer Zahl ab (1.0 -> 1, 1.5 -> 1.5).
 *
 * @param value - Zu kuerzende Zahl.
 * @returns {number} Zahl ohne ueberfluessige Dezimalstellen.
 */
function trimDecimal(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Waehlt Einzahl- oder Mehrzahlform.
 *
 * @param count - Anzahl (bereits gerundet).
 * @param singular - Einzahlform.
 * @param pluralForm - Mehrzahlform.
 * @returns {string} Die passende Form.
 */
function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
