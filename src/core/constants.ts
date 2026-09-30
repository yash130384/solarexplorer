/**
 * Physikalische und grafische Grundkonstanten des SolarExplorers.
 *
 * Diese Datei ist bewusst frei von Logik und Abhaengigkeiten: sie enthaelt
 * ausschliesslich reine Zahlenwerte mit dokumentierter Einheit, damit die
 * gesamte Core-Logik (`src/core/*`) ohne Three.js und ohne WebGL testbar bleibt.
 *
 * @module core/constants
 */

/**
 * Astronomische Einheit (AE) in Kilometern.
 *
 * Exaktwert nach IAU 2012 Definition. Dient als Referenzmass fuer alle
 * Umlaufbahn-Distanzen im Sonnensystem.
 */
export const AU_KM = 149597870.7;

/** Mittlerer Erdradius in Kilometern (Referenzradius). */
export const EARTH_RADIUS_KM = 6371;

/** Radius der Sonne in Kilometern. */
export const SUN_RADIUS_KM = 695700;

/** Mittlerer Radius des Erdmondes in Kilometern — Referenz der "real"-Groessenskalierung. */
export const MOND_RADIUS_KM = 1737.4;

/** Sekunden in einem Tag (24 * 60 * 60). Zeitbasis aller Umlaufrechnungen. */
export const SECONDS_PER_DAY = 86400;

/**
 * Zeitstempel der J2000-Epoche (2000-01-01T12:00:00Z) in Unix-Millisekunden.
 * Startzeitpunkt der Simulation und Bezugspunkt der Kepler-Elemente.
 */
export const J2000_UNIX = 946728000000;

/** Kleinster Darstellungsradius eines Koerpers in Szeneneinheiten (Modus "visual"). */
export const VISUAL_MIN_RADIUS = 0.4;

/** Groesster Darstellungsradius eines Koerpers in Szeneneinheiten (Modus "visual"). */
export const VISUAL_MAX_RADIUS = 6.0;

/**
 * Kleinster realer Koerperradius (in km), der in die logarithmische
 * Radius-Skalierung eingeht — Pluto als kleinster dargestellter Körper.
 */
export const SCALE_MIN_RADIUS_KM = 1188;

/** Groesster realer Koerperradius (in km) der logarithmischen Radius-Skalierung — die Sonne. */
export const SCALE_MAX_RADIUS_KM = 695700;

/**
 * Szeneneinheiten pro Astronomischer Einheit im Distanzmodus "real":
 * 1 AE entspricht exakt 1 Szeneneinheit.
 */
export const SCENE_UNITS_PER_AU = 1;

/**
 * Kniepunkt der Distanzskalierung, in Astronomischen Einheiten.
 *
 * Bis hierher wird streng linear skaliert, damit die inneren Planeten ihre
 * echten Verhaeltnisse behalten (Mars liegt genau 1,52x so weit draussen
 * wie die Erde). Ab dem Knie wird die Kurve sanft abgeflacht, damit Neptun
 * bei 30 AE die Szene nicht verlaesst.
 */
export const DISTANCE_KNEE_AU = 4.0;

/**
 * Szeneneinheiten pro AE im linearen Abschnitt der Distanzskalierung.
 *
 * Gewaehlt, damit Neptun (30 AE) bei rund 430 Einheiten liegt: gross genug
 * fuer die aeusseren Monde, klein genug fuer intakte Float-Praezision.
 */
export const SCENE_UNITS_PER_AU_VISUAL = 60;

/**
 * Waechstumsrate der Distanzkurve jenseits des Kniepunkts.
 *
 * Bestimmt, wie stark die aeusseren Planeten gestaucht werden:
 * Jupiter (5,2 AE) landet bei ~4,4x Erde, Neptun (30 AE) bei ~7,2x.
 */
export const DISTANCE_TAIL_RATE = 1.6;

/** Faktor des Distanzmodus "log" in Szeneneinheiten. */
export const LOG_DISTANCE_SCALE = 100;

/** Kompressionsfaktor des Radiusmodus "compact" relativ zu "visual". */
export const COMPACT_RADIUS_FACTOR = 0.6;

/** Near Plane der Kamera in Szeneneinheiten. */
export const DISTANCE_NEAR = 30;

/**
 * Faktor fuer den dynamischen Maßstab: ab dieser Distanz (in Szeneneinheiten,
 * relativ zum visualen Radius) wird der Planet in Echtgroesse dargestellt.
 *
 * Ein Wert von 25 bedeutet: bei einem Erdradius von 0.5 Einheiten schaltet
 * die Kamera bei 12.5 Einheiten Entfernung auf Echtmaßstab um.
 */
export const DYNAMIC_SCALE_OVERVIEW_FACTOR = 25;

/**
 * Faktor fuer den dynamischen Maßstab: innerhalb dieser Distanz (relativ zum
 * visualen Radius) wird immer Echtmaßstab verwendet.
 *
 * Ein Wert von 4 bedeutet: sehr nah am Planeten, realistische Groesse.
 */
export const DYNAMIC_SCALE_TRAVEL_FACTOR = 4;

/**
 * Maximale Distanz (in Vielfachen des Parent-Radius), ab der Monde
 * ausgeblendet werden. Wenn die Kamera weiter als dieser Faktor * Parent-Radius
 * entfernt ist, sind die Monde des Planeten unsichtbar.
 *
 * Ringe bleiben davon unberuehrt — sie bleiben immer sichtbar.
 */
export const MOON_VISIBILITY_PARENT_FACTOR = 8;

/**
 * Far Plane der Kamera in Szeneneinheiten.
 * Bewusst sehr gross, damit auch die aeusseren Umlaufbahnen noch gerendert werden.
 */
export const DISTANCE_FAR = 5_000_000;
