PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer — alle Dateien dort, kein scratch.

VORAUSSETZUNG: Ticket 01 (Projektfundament) ist fertig, node_modules existiert.

AUFGABE: Physikalische Datenbasis — Sonne, 8 Planeten, Monde

ERSTELLE GENAU diese Datei:
- src/data/bodies.json

INHALT — mindestens diese Körper mit vollständigen Feldern:
Sonne, Merkur, Venus, Erde, Mars, Jupiter, Saturn, Uranus, Neptun
plus Monde: Mond (Erdmond), Phobos, Deimos, Io, Europa, Ganymed, Kallisto,
Titan, Enceladus, Mimas, Triton

FELDER je Körper (exakt diese Namen):
  id              string, eindeutig
  name            string, deutscher Name
  nameLatin       string
  type            "star" | "planet" | "moon"
  parent          string | null  (id des Parent-Koerpers; null fuer Sonne)
  radiusKm        number        (Aequatorradius in km)
  massKg          number        (in kg)
  semiMajorAxisKm number       (Bahnradius in km, fuer Sonne 0)
  eccentricity    number        (0..1)
  inclinationDeg  number        (Inklination gegen die Ekliptik)
  rotationPeriodH number        (Stunden, negativ = retrograde)
  axialTiltDeg    number
  surfaceTempC    {min, mean, max}  (in Celsius, min/max <= 0 bei der Sonne)
  gravityMs2      number
  atmosphere      string        ("" = keine, sonst kurze Beschreibung)
  moonsCount      number        (Anzahl bekannter Monde, 0 fuer die Sonne)
  color           string        (hex, fuer Representation ohne Textur)
  discovery       string        ("" = alt bekannt, sonst Jahr/Person)
  orderFromSun    number        (1 = Merkur ... 8 = Neptun, 0 = Sonne)

GENAUIGKEIT:
- Werte so genau wie du sie sicher weißt. Bei Unsicherheit: naeher am
  dokumentierten Wert als an einer runden Zahl. Erfinde keine Werte.
  Bsp: Erdradius 6371, Sonnenradius 695700, Erdmasse 5.972e24,
  Jupiterrotation 9.93h, Venusrotation -5832.5h (retrograd),
  Uranus axialTilt 97.77 Grad, Neptun 28.32 Grad.

STRUKTUR:
- Valides JSON, 2 Leerzeichen Einrueckung
- Als {"bodies": [...]} verpackt
- Sortiert: Sonne zuerst, dann Planeten nach orderFromSun, dann Monde

ACCEPTANCE CRITERIA:
- src/data/bodies.json existiert und ist valides JSON
- Enthaelt alle 9 genannten Planeten/Sonne
- Enthaelt mindestens die 11 genannten Monde
- Jeder Eintrag hat ALLE oben genannten Felder
- Pruefe selbst: python3 -m json.tool src/data/bodies.json > /dev/null
- Pruefe die Feldvollstaendigkeit selbst mit einem kleinen Skript und zeige
  die Ausgabe (z.B. Anzahl Eintraege, Anzahl fehlender Felder = 0)

WICHTIG:
- KEIN git commit
- Nur diese EINE Datei in diesem Ticket
- Zeige am Ende die echte Pruef-Ausgabe.
