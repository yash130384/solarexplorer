PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Ticket 01 (Fundament) fertig, src/core/ existiert noch nicht.

AUFGABE: Kern-Mathematik — Größen- und Distanz-Skalierung (ohne Three.js!)

WICHTIG: src/core/* darf KEIN Three.js importieren. Nur reine Mathematik.
Das ist die Basis fuer testbare Logik ohne WebGL.

ERSTELLE GENAU diese Dateien:
1. src/core/constants.ts
2. src/core/scale.ts
3. src/core/scale.test.ts

--- src/core/constants.ts ---
Exportiere:
  AU_KM                  = 149597870.7   (Astronomische Einheit in km)
  EARTH_RADIUS_KM        = 6371
  SUN_RADIUS_KM          = 695700
  SECONDS_PER_DAY        = 86400
  J2000_UNIX             = 946728000000  (2000-01-01T12:00:00Z in ms)
  VISUAL_MIN_RADIUS      = 0.4          (min. Darstellungsradius in Szeneneinheiten)
  VISUAL_MAX_RADIUS      = 6.0
  DISTANCE_NEAR          = 30          (near plane)
  DISTANCE_FAR           = 5_000_000   (far plane, braucht large camera range)
Jedes mit einem Docstring der die Einheit erklaert.

--- src/core/scale.ts ---
Exportiere Funktionen, ALLE mit Docstring + @param/@returns:

  scaleRadius(radiusKm: number, mode: ScaleMode): number
    ScaleMode = "visual" | "real" | "compact"
    - "visual": logarithmische Skalierung. sqrt/ratio-basiert, sodass Merkur
      und Neptun beide sichtbar sind. Kleine Koerper werden vergroessert,
      grosse verkleinert. Ergebnis im Bereich [VISUAL_MIN_RADIUS, VISUAL_MAX_RADIUS]
    - "real": echtes Verhaeltnis zum Erdmond als Referenz
      (MOND_RADIUS_KM = 1737.4)
    - "compact": etwas kleiner als visual, fuer Uebersichten

  scaleDistance(semiMajorAxisKm: number, mode: DistanceMode): number
    DistanceMode = "visual" | "real" | "log"
    - "visual": komprimiert, damit Innen- und Aussenplaneten sichtbar sind
    - "real": echte AE
    - "log": rein logarithmisch

  timeScaleFor(preset: TimePreset): number
    TimePreset = "realtime" | "hours" | "days" | "weeks" | "months" | "years"
    gibt Sekunden pro Echtzeit-Sekunde zurueck.
    - realtime: 1
    - hours: 60
    - days: 3600
    - weeks: 604800
    - months: 2_629_800
    - years: 31_557_600

  formatKm(km: number, locale?: string): string
    Kinder-taugliche Formatierung: "384.400.000 km", "1.496 Mrd. km",
    "7.000 km". Kein "1.496E+08 km" — das ist fuer Kinder unlesbar.
    Nutzt Intl.NumberFormat wenn verfuegbar, sonst manuelles Grouping.

  formatDuration(days: number): string
    "3 Tage", "8,3 Jahre", "27,7 Millionen Jahre"
    Behandle negative Werte (retrograd) korrekt.

--- src/core/scale.test.ts ---
Nutze vitest (import { describe, it, expect } from "vitest").
Mindestens 18 Testfaelle:
  - scaleRadius: alle 3 Modi, Monotyp: Verhaeltnis Erde/Merkur ist in
    "visual" kleiner als 100-fach, in "real" ungefaehr dem echten Verhaeltnis
  - scaleRadius: Ergebnis liegt immer in [VISUAL_MIN_RADIUS, VISUAL_MAX_RADIUS]
  - scaleDistance: "visual" ist monoton steigend mit dem Abstand
  - scaleDistance: Neptun ist in "visual" naeher dran als in "real"
  - timeScaleFor: alle 6 Presets, Werte exakt pruefen
  - formatKm: 0, 1000, 999999, 149597870.7, 384400000 -> kein Exponent
  - formatDuration: negativ, 0, 1, 365, 27700000
  - Edge cases: NaN und Infinity werfen einen klaren Fehler
  Nutze it.each fuer tabellengetriebene Faelle.

ACCEPTANCE CRITERIA:
- Die drei Dateien existieren unter den EXAKTEN Namen
- npx tsc --noEmit: 0 Fehler
- npx vitest run src/core: ALLE Tests gruen, >= 18 Tests, zeige die echte Ausgabe
- src/core/scale.ts enthaelt KEINEN "three"-Import (pruefe selbst mit grep)
- Jede exportierte Funktion hat einen Docstring

WICHTIG:
- KEIN git commit
- KEINE anderen Dateien aendern oder anlegen
- NaN/Infinity: wirf RangeError mit klarer Nachricht
