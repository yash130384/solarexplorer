PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer — alle Dateien dort.

VORAUSSETZUNG: tools/fetch_astronomy.py existiert und funktioniert
(nachgewiesen: Saturn-Radius 58232, Jupiter 69886, Erde-Masse 5.97e24 werden
korrekt geparst). Nutze dieses Skript, erfinde keine Zahlen.

AUFGABE: bodies.json auf alle 454 bestaetigten Monde erweitern + Physik korrigieren

HINTERGRUND (Stand 2026-09, aus Wikipedia):
  Sonne 0 Monde | Erde 1 | Mars 2 | Jupiter 115 | Saturn 293 | Uranus 29 | Neptune 16
  Summe: 456 inkl. Erde-Mond. Pluto (5) gehoert NICHT dazu, ist kein Planet.

SCHRITT 1 — Monde sammeln
  python3 tools/fetch_astronomy.py --moons Jupiter
  python3 tools/fetch_astronomy.py --moons Saturn
  python3 tools/fetch_astronomy.py --moons Uranus
  python3 tools/fetch_astronomy.py --moons Neptune
  python3 tools/fetch_astronomy.py --moons Mars
  Das schreibt src/data/moons_<planet>.json
  Pruefe die Anzahl je Datei. Erklaere im Bericht JEDE Abweichung von der
  Wikipedia-Zahl (z.B. Wikipedia 115, Datei hat 112 → welche 3 fehlen und warum).

SCHRITT 2 — bodies.json neu erzeugen
  ERSTELLE: src/data/build_bodies.py
    Ein Skript, das ALLE Quellen zusammenfuehrt und bodies.json schreibt:
      1. src/data/bodies.json (bestehende Handdaten: Sonne + 8 Planeten +
         bekannte Monde, Deutsche Namen, Farben, Kindtexte-Verweise)
      2. src/data/moons_*.json (aus Schritt 1)
      3. src/data/facts.json (nur fuer die bereits vorhandenen Koerper)
    Das Skript MUSS:
      - idempotent sein (zweimal laufen = identisches Ergebnis)
      - JEDEM Mond eine eindeutige id geben. Problem: Wikipedia-Artikel
        "S/2003 S 1" sind keine normalen Namen. Regel:
          normale Namen (Io, Europa, Titan)     -> "io", "europa", "titan"
          Saturn-Skuppe S/2003 S 1               -> "saturn-s2003s1"
      - parent korrekt setzen (Mond -> Planet, Planet -> Sonne)
      - Fuer NEUE Monde ohne eigene facts.json-Eintraege einen minimalen,
        kindgerechten Eintrag ERZEUGEN: summary "Ein kleiner Mond von X."
        KEINE erfundenen Details.
      - semiMajorAxisKm: wenn Wikipedia keinen Wert liefert, aus dem
        absoluten Bahnradius (a_km) umrechnen. Steht "a = 421800 km" als
        Eigenwert, ist das der BAHNRADIUS, nicht die Halbachse -> als
        semiMajorAxisKm uebernehmen, das ist fuer die Darstellung korrekt.
      - eccentricity: Default 0.0001 wenn unbekannt (Mondbahnen sind fast rund)
      - inclinationDeg: Default 0 wenn unbekannt
      - rotationPeriodH: eigene Rotation, meist ~ gleich der Umlaufzeit.
        Nimm die Umlaufzeit in Stunden als Default, wenn unbekannt.
      - Die Zahl der Monde im jeweiligen Planeten-Feld (moonsCount) muss der
        tatsaechlichen Anzahl in bodies.json entsprechen.

SCHRITT 3 — Rotationen pruefen
  Vergleiche fuer die 8 Planeten + Sonne die Werte in bodies.json mit
  src/data/wikipedia_planets.json (vorher erzeugen:
  python3 tools/fetch_astronomy.py )
  WICHTIG — diese Werte sind belegt und muessen stimmen:
    Sonne     ~609 h (25,4 Tage, Aequator)
    Merkur    1407,6 h (58,6 Tage)
    Venus     -5832,5 h (retrograd, 243 Tage)
    Erde      23,934 h
    Mars      24,623 h
    Jupiter   9,925 h
    Saturn    10,543 h
    Uranus    -17,24 h (retrograd)
    Neptune   16,11 h
  Wenn bodies.json davon abweicht, KORRIGIERE es und notiere die alte und
  die neue Zahl im Bericht.

SCHRITT 4 — Validierung
  ERSTELLE: tests/unit/astronomy.test.ts (Vitest)
    Mindestens 14 Tests:
    - bodies.json ist valides JSON, >= 456 Eintraege
    - JEDE id ist eindeutig
    - JEDER parent verweist auf eine existierende id
    - Genau 1 Sonne, genau 8 Planeten
    - Monde pro Planet >= Wikipedia-Zahl - 5 (Toleranz, aber dokumentiere die
      genaue Zahl im Testkommentar)
    - Jeder Radius > 0, jede Masse > 0
    - semiMajorAxisKm > radiusKm (Mond umkreist ausserhalb seines Planeten)
    - eccentricity zwischen 0 und 1
    - Die 9 Rotationszeiten aus Schritt 3 stimmen (Toleranz 1%)
    - Venus und Uranus haben NEGATIVE rotationPeriodH
    - facts.json hat fuer JEDEN Planeten einen Eintrag
    - Kein Mond verweist auf einen nicht existierenden Planeten
  Importiere bodies.json direkt (resolveJsonModule ist in tsconfig nicht
  aktiv -> nutze fs.readFileSync + JSON.parse).

ACCEPTANCE CRITERIA:
- python3 tools/build_bodies.py laeuft zweimal hintereinander und liefert
  byte-identisches bodies.json (zeige md5sum beider Laeufe)
- python3 -m json.tool src/data/bodies.json funktioniert
- npx tsc --noEmit: 0 Fehler
- npx vitest run tests/unit/astronomy.test.ts: ALLES gruen
- Bericht enthaelt: Koerperzahl, Mondezahl je Planet, Abweichungen zu
  Wikipedia, alle geaenderten Rotationszeiten

WICHTIG:
- KEIN git commit
- KEINE Aenderung an src/core/, src/scene/, src/ui/ — die gehoeren
  anderen Tickets. Nur Daten + Test.
- KEINE erfundenen Zahlen. Wenn etwas nicht belegbar ist, setze es auf 0
  und liste es im Bericht als "offen".
- Texte auf Deutsch, kindgerecht.
