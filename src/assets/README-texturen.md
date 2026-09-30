# Texturen (prozedural)

Alle Oberflächen-Texturen in SolarExplorer sind **prozedural erzeugt** — es
gibt keine heruntergeladenen NASA-/ESA-Bilder im Repo und keine CDN-Abhängigkeit
zur Laufzeit.

## Warum prozedural statt echter Aufnahmen?

| Grund | Prozedural | NASA-Bilder |
|---|---|---|
| **Lizenz** | Kein fremdes Material, keine Lizenzfragen | Public Domain, aber Nachweis/Attribution muss gepflegt werden |
| **Größe** | 20 PNGs, ca. 5 MB gesamt, exakt auf die benötigte Auflösung | Oft 2–20 MB pro Einzelbild in voller Auflösung |
| **Offline** | `docker compose up` funktioniert ohne Netz | CDN-Ausfall = kaputte App |
| **Reproduzierbarkeit** | `python3 tools/generate_textures.py` erzeugt byte-identische Dateien | Binär-Download bei jedem Setup |
| **Konsistenz** | Farbpalette & Stil für alle Körper einheitlich | Fotos wirken je nach Missionszeitpunkt uneinheitlich |

Der Nachteil: Die Texturen sind *plausibel*, nicht fotorealistisch. Für ein
Lernprojekt für Kinder ist das der richtige Kompromiss.

## Neu erzeugen

```bash
cd /home/cb/Projects/SolarExplorer

# nur fehlende Dateien erzeugen (idempotent)
python3 tools/generate_textures.py

# alles neu schreiben
python3 tools/generate_textures.py --force

# nur einzelne Körper
python3 tools/generate_textures.py --force --only erde --only jupiter

# Übersicht aller Körper
python3 tools/generate_textures.py --list
```

Prüfen (PNG-Validität, CRC, Größen, mittlere Farben, Plausibilitäts-Checks):

```bash
python3 tools/verify_textures.py
```

Das Skript läuft **offline**. Es nutzt nur die Standardbibliothek; ist Pillow
installiert, wird es als PNG-Encoder benutzt (schneller/kleiner), sonst greift
ein eingebetteter `zlib`-PNG-Writer — es wird **nichts installiert und nichts
heruntergeladen**.

Determinismus: Jeder Körper hat einen festen Seed (`CRC32(bodyId)`), es wird
kein globaler `random.seed()`-Zustand verwendet. Zwei Läufe auf derselben
Python-Version erzeugen identische Dateien.

## Technik

|- **Format:** Equirectangular 2:1 (1024×512 für Planeten/Sonne, 512×256 für
|  größere Monde, 256×128 für Phobos/Deimos).
|  Jeder Koerper hat drei Dateien:
|  `<id>.png` (Farbe, sRGB), `<id>_roughness.png` (Rauheit, linear),
|  `<id>_normal.png` (Normalen, linear).
|  8-Bit pro Kanal, RGB bzw. Graustufe.
- **Noise:** Value-Noise mit 4–6 Oktaven, in X-Richtung kachelbar, damit die
  Equirectangular-Naht bei 0°/360° nicht sichtbar kachelt. Die V-Koordinate wird
  über `0.5 - 0.5·cos(lat)` gestreckt, damit Features an den Polen nicht
  gestaucht werden.
- **Krater:** eigener Vulkankrater-Stempel (dunkler Boden, heller Rand, schräg
  gestellter Schatten), mit Pol-Verdichtung, damit beide Kappen dichter wirken.
- **Bänder:** Gasriesen nutzen domain-warped Sinusbänder (Zonen/Belter),
  Jupiter zusätzlich den Großen Roten Fleck bei ~22° S.
- Die Textur ist **äquatorparallel** — die Achsneigung aus `bodies.json` wird
  vom Mesh/Szenencode (Rotationsachsen) behandelt, nicht von der Textur.

## Verwendung im Code

`src/scene/textures.ts` löst die Dateien über Vites `import.meta.glob` auf:

```ts
import { textureUrl, preloadTextures, disposeTextures } from './scene/textures';

preloadTextures(['erde', 'mars']);           // lädt parallel vor
const url = textureUrl('erde');               // lokaler Asset-Pfad oder null
disposeTextures();                            // gibt den WebGL-Speicher frei
```

Fehlt eine Textur (Datei nicht im Build), liefert `textureUrl` `null` und der
Aufrufer nutzt die `color` aus `src/data/bodies.json` — es gibt keinen harten
Fehler, der Körper bleibt sichtbar.

## Übersicht aller Texturen

| Datei | Körper | Zweck / Charakter |
|---|---|---|
| `sonne.png` | Sonne | Orange-Weiß-Verlauf, Granulation, dunkle Sonnenflecken mit weichem Rand |
| `merkur.png` | Merkur | Grau, dicht kraterig (~900 Krater), dunkle Einschläge |
| `venus.png` | Venus | Gelb-orange, wirbelnde Wolkenbänder, helle Polkappen |
| `erde.png` | Erde | Tiefblau-Ozeane, grüne Kontinente, Wüsten, weiße Polkappen, Wolkenbänder |
| `mars.png` | Mars | Rostrot, dunkle Albedo-Flecken, helle Polkappen, Krater |
| `jupiter.png` | Jupiter | Wellige Zonen/Belter, heller Südäquatorstreifen, Großer Roter Fleck |
| `saturn.png` | Saturn | Blass-gelbe, weiche Streifen |
| `uranus.png` | Uranus | Blass-cyan, sehr gleichmäßig, kaum Kontrast |
| `neptun.png` | Neptun | Tiefblau, weiße Wolkenwirbel, dunkler Sturm |
| `mond.png` | Erdmond | Grau, helles Hochland, dunkle Maria, ~700 Krater |
| `phobos.png` | Phobos | Dunkles graues Krater-Monster (256×128) |
| `deimos.png` | Deimos | Graues Krater-Monster, heller als Phobos (256×128) |
| `io.png` | Io | Gelb-orange, flüssige Schwefel-Flecken, dunkle Vulkan-Pits |
| `europa.png` | Europa | Beige-weiß, sehr glatt, rote Risslinien (Chaos + Linea) |
| `ganymede.png` | Ganymede | Grau mit hellen und dunklen Flecken, mittlere Kraterdichte |
| `kallisto.png` | Kallisto | Dunkel, sehr stark und dicht kraterig (~1100 Krater) |
| `titan.png` | Titan | Orange, dicker Dunstschleier, kaum Strukturen |
| `enceladus.png` | Enceladus | Sehr helle Eisoberfläche, Krater + bläuliche Bruchlinien |
| `mimas.png` | Mimas | Schlichtes graues Krater-Monster |
| `triton.png` | Triton | Rosa-weiß, sehr glatt, geringe Kontraste |

20 Koerper × 3 Dateien = 60 Body-PNGs + 4 Ring-PNGs = 64 Dateien.
IDs entsprechen exakt der `id` in `src/data/bodies.json`.

## Git

Die 60 Body-PNGs (Farbe + Rauheit + Normal) und 4 Ring-PNGs sind zusammen
ca. 8 MB Binärdaten und **sind im Repo committet**
(`git ls-files public/media/textures` listet 64 Pfade). Grund: der
Docker-Build kopiert nur das Repository — ohne die PNGs wäre
`docker compose up --build` eine leere Szene.
Neu erzeugbar jederzeit mit `python3 tools/generate_textures.py`, byte-identisch
(fester Seed pro Körper).

Die Texturen liegen unter `public/media/textures/`, nicht unter `src/assets/`:
sie werden zur Laufzeit über den stabilen Pfad `./media/textures/<id>.png`
geladen (`src/scene/textures.ts:26`) und von Vite ohne Hash nach `dist/` kopiert.

Gesamtgröße aktuell: ca. 4,1 MB (genaue Zahlen: `python3 tools/verify_textures.py`).
