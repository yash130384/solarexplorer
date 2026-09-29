PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Alle App-Tickets (01-09) fertig, app laeuft lokal.

AUFGABE: Realistische Texturen — lokal erzeugt, keine CDN-Abhaengigkeit

WICHTIG: Die App muss vollstaendig offline lauffaehig sein. KEINE externen
URLs, KEINE NASA-Bilder im Repo (Lizenz unklar). Stattdessen: prozedural
generierte Texturen die physikalisch plausibel sind. Das ist robuster,
schneller und rechtlich unauffaellig.

ERSTELLE GENAU:
1. src/assets/textures/README.md
2. tools/generate_textures.py
3. src/assets/textures/  (die erzeugten PNGs)
4. src/scene/textures.ts

--- tools/generate_textures.py ---
Python-Skript, laeuft mit: python3 tools/generate_textures.py
- Nutzt NUR die Standardbibliothek + Pillow, falls vorhanden.
  Prüfe zuerst ob Pillow verfügbar ist:
    python3 -c "import PIL; print('ok')"
  Falls NICHT verfügbar: erzeuge PPM-Dateien (P6) und konvertiere sie
  mit einem eingebetteten Minimal-Weg oder dokumentiere die Konvertierung.
  WICHTIG: Das Skript muss ohne Netzwerk laufen.

Erzeuge pro Koerper eine Equirectangular-Map (2:1, z.B. 1024x512) als PNG:
  Sonne:    Orange/Weiss-G-Verlauf, Granulation, dunkle Sonnenflecken
  Merkur:   Grau, kraeterig, dunkle Einschlaege
  Venus:    Gelb-orange, wirbelnde Wolkenbander
  Erde:     Blau (Ozeane), gruen (Kontinente), weisse Polkappen, Wolken
  Mars:     Rostrot, dunkle Flecken, helle Polkappen
  Jupiter:  Wellige Braune/Beige/Weisse Streifen, Grosse Roter Fleck
  Saturn:   blass-gelbe, weiche Streifen
  Uranus:   blass-cyan, sehr gleichmaessig
  Neptun:   tiefblau, weisse Wirbel
  Titan:    orange, dunstig
  Io:       gelb-orange, sehr fuessig
  Europa:    beige-weiss, sehr glatt, rote Linien
  Ganymed:  grau mit hellen/dunklen Flecken
  Callisto: dunkel, stark krueterig
  Mond:     grau, krueterig, dunkle Maria
  Triton:   rosa-weiss, sehr glatt
  Mimas/Enceladus/Phobos/Deimos: schlichte graue Krater-Monste

Vorgehen pro Textur (MIT Zufall, aber mit festem Seed pro Koerper
=> reproduzierbar, NICHT Math.random):
  1. Noise-Feld erzeugen (Value-Noise mit mehreren Oktaven reicht)
  2. Koerper-spezifische Farbpalette
  3. Streifen/Sturm/Maria je nach Typ aufmalen
  4. Krater aufzeichnen (Vulkan-Profil: heller Rand, dunkler Schatten)
  5. Achsneigung beruecksichtigen? Nein — die Textur ist Aequator-parallel.
  Speichere als <bodyId>.png in src/assets/textures/

Das Skript muss:
  - Idempotent sein (zweimal laufen lassen = gleiche Dateien)
  - Einen Seed pro Koerper verwenden
  - Am Ende ausgeben: welche Dateien geschrieben wurden + Groessen
  - Ein --force Flag haben, um vorhandene Dateien zu ueberschreiben

--- src/scene/textures.ts ---
  export function textureUrl(bodyId: string): string
    gibt "./src/assets/textures/<id>.png" zurueck, mit Existenz-Check
  export function preloadTextures(bodyIds: string[]): Promise<void>
    laedt alle via THREE.TextureLoader vor, nutzt Promise.all
  export function disposeTextures(): void
  - Fallback: wenn eine Textur fehlt, wird die color aus bodies.json
    als Materialfarbe verwendet (kein harter Fehler)

--- src/assets/textures/README.md ---
- Warum prozedural statt NASA-Bilder: Lizenz, Groesse, Offline-Faehigkeit
- Wie man sie neu erzeugt (python3 tools/generate_textures.py)
- Liste aller Texturen mit Zweck

ACCEPTANCE CRITERIA:
- tools/generate_textures.py laeuft durch: python3 tools/generate_textures.py
- Es entstehen mindestens 16 PNG-Dateien in src/assets/textures/
- Alle PNGs sind gueltig (pruefe mit python3 oder file)
- Erde/Jupiter/Sonne sind deutlich als die jeweiligen Objekte erkennbar
  (Farbverteilung pruefen: Python-Ausgabe der Durchschnittsfarben zeigen)
- grep in src/ nach "http://" oder "https://" in Texture-URLs: KEINE Treffer
- npx tsc --noEmit: 0 Fehler

WICHTIG:
- KEIN git commit (die PNGs sind gross — der Reviewer entscheidet spaeter
  ueber .gitignore vs. Commit)
- KEINE externen Bilder herunterladen
- Zeige am Ende die echte Ausgabe von "python3 tools/generate_textures.py"
