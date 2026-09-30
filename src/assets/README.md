# Assets (Ticket 17) — Texturen, Schiff, Sounds

Recherche-Ergebnis und Asset-Ablage fuer SolarExplorer. Alles ist **CC0 oder
prozedural** — keine NASA-Bilder, keine Laufzeit-CDN, keine Lizenzfragen.

## Ueberblick

| Bereich | Ergebnis | Ablage |
|---|---|---|
| Planeten-/Mondtexturen | **prozedural, 20 PNGs** (bereits vorhanden seit Ticket 10) | `public/media/textures/` |
| Ringtexturen | prozedural, 4 PNGs | `public/media/textures/rings/` |
| Raumschiff-Modell | **3 CC0-GLB** (Kenney Space Kit 2.0) | `public/media/models/` |
| Triebwerks-Loop | CC0 (Kenney Sci-Fi Sounds) als OGG + MP3 | `public/media/audio/` |
| UI-Klicktöne | CC0 (Kenney Interface Sounds) als OGG + MP3 | `public/media/audio/` |
| Sun-Glow | **kein Asset**, reines Three.js-Setup (siehe unten) | — |
| Gesamt | 4,4 MB (4,1 MB Texturen + 61 KB Modelle + 239 KB Audio) | — |

**Warum `public/media/` und nicht `src/assets/`:** Vite hasht nur *importierte*
Dateien aus `src/`. Assets, die zur Laufzeit über einen stabilen Pfad geladen
werden (Textur-URL, GLB, Audio), gehören in `publicDir`; sie landen dann 1:1
und ohne Hash in `dist/media/...`. Ein Import aus `src/assets/` würde zwar auch
funktionieren, produziert aber gehashte Namen und damit andere Pfade pro Build.

## 1. Texturen: keine Neuschaffung nötig

Der Bestand aus Ticket 10 deckt alle 8 Planeten, die Sonne und 11 benannte
Monde ab (Mond, Phobos, Deimos, Io, Europa, Ganymede, Kallisto, Titan,
Enceladus, Mimas, Triton), ist prozedural erzeugt (`tools/generate_textures.py`)
und bereits verifiziert:

```bash
python3 tools/verify_textures.py   # 20 PNGs, PNG-validiert, Plausibilitaet OK
```

Ergebnis der Verifikation (Auszug, echte Ausgabe):

```
deimos.png     40.9K  256x128   ( 93, 85, 76)
erde.png      258.6K 1024x512   (136,159,148)
jupiter.png   225.3K 1024x512   (198,157,123)
mars.png      507.6K 1024x512   (168,108, 76)
merkur.png    640.7K 1024x512   (107,103, 98)
neptun.png    122.5K 1024x512   ( 48, 87,182)
sonne.png     183.7K 1024x512   (254,210,107)
```

Plausibilitaet: Erde blau-dominiert, Jupiter beige-braun, Sonne orange-weiss,
Mars rostrot, Neptun tiefblau, Mond neutral grau — alle `[OK]`.

**Konsequenz für Ticket 19:** Es gibt nichts zu „besorgen". Ticket 19 ist reine
Anwendungsarbeit — `src/scene/textures.ts` existiert bereits mit
`textureUrl()` / `preloadTextures()` / `loadBodyTexture()`, aber
`BodyFactory.createMaterial()` (src/scene/BodyFactory.ts:87) setzt aktuell
**keine** Textur:

```ts
static createMaterial(body: SceneBody): THREE.Material {
  if (body.type === "star") return new THREE.MeshBasicMaterial({ color: SUN_COLOR });
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(body.color), ... });
}
```

`normalMap`/`roughnessMap` existieren nicht — prozedural erzeugte Farbkarten
brauchen keine, und die Äquator-Ausrichtung der Textur ist laut
`src/assets/README-texturen.md:65` bewusst Sache des Mesh-Achsenkippers, nicht
der Textur. UV-Mapping der geteilten LOD-Kugeln ist damit bereits korrekt.

### Textur-Auslieferung: `public/media/textures/`, nicht `dist/assets/`

Vite hasht nur *importierte* Dateien. Texturen werden zur Laufzeit über einen
stabilen Pfad geladen (`textures.ts:26` — `const TEXTURE_BASE = './media/textures'`),
also gehören sie in `publicDir`. Nach dem Build:

```bash
$ npm run build && find dist/media -name '*.png' | wc -l
20        # 20 Body-Texturen + 4 Ringtexturen unter dist/media/textures/rings/
$ ls dist/media/textures/erde.png
dist/media/textures/erde.png        # 1:1, ohne Hash
```

Das war zwischenzeitlich anders gelöst (Import aus `src/assets/textures/`, mit
Hash-Unterordner `dist/assets/`). Die Texturen liegen jetzt wieder flach in
`public/`, der Pfad ist damit stabil und `import.meta.glob` ist nicht nötig.

## 2. Sun-Glow: reines Three.js-Setup, kein Asset

Verifiziert gegen die installierte Version **three 0.180.0**
(`node_modules/three/package.json`). Alle benötigten Addons sind vorhanden:

```
node_modules/three/examples/jsm/postprocessing/EffectComposer.js
node_modules/three/examples/jsm/postprocessing/RenderPass.js
node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js
node_modules/three/examples/jsm/postprocessing/OutputPass.js
```

Signatur aus `UnrealBloomPass.js:46`:

```js
constructor( resolution, strength = 1, radius, threshold )
```

`OutputPass` liest `renderer.toneMapping` und `renderer.outputColorSpace`
(`OutputPass.js:88-90`) — beides ist in `SceneManager.init()` bereits gesetzt
(`SceneManager.ts:219-221`: `SRGBColorSpace`, `ACESFilmicToneMapping`,
Exposure 1.0). Der Doc-Kommentar in `UnrealBloomPass.js:31` sagt ausdrücklich
„When using pass, tone mapping must enabled in renderer settings" — die
Voraussetzung ist also erfüllt, es gibt keine Nacharbeit.

### Empfohlene Verdrahtung (3 Zeilen Änderung in `SceneManager`)

`SceneManager.render()` (src/scene/SceneManager.ts:619-628) ruft aktuell
`this.renderer.render(...)`. Ersetzen durch:

```ts
// in init() nach this.renderer = renderer:
this.composer = new EffectComposer(renderer);
this.composer.addPass(new RenderPass(this.scene, this.camera));
this.bloomPass = new UnrealBloomPass(
  new THREE.Vector2(width, height),  // strength 1.5, radius 0.4, threshold 0.85
  1.5, 0.4, 0.85,
);
this.composer.addPass(this.bloomPass);
this.composer.addPass(new OutputPass());

// in render():  this.composer.render();
// in resize():  this.composer.setSize(width, height);
//               this.composer.setPixelRatio(Math.min(devicePixelRatio, profile.maxPixelRatio));
```

`EffectComposer.setSize()` (EffectComposer.js:315) propagiert intern
`setPixelRatio` — die Aufrufreihenfolge ist also `setPixelRatio` **vor**
`setSize`.

### Wichtig: Bloom braucht HDR-Werte — und die Schwelle ist fast binär

`UnrealBloomPass` filtert per `LuminosityHighPassShader` gegen `threshold`.
Zwei Dinge, die in Ticket 18 den Unterschied zwischen „nichts passiert" und
„Sonne strahlt" machen — beide **gemessen**, nicht geraten:

```bash
node tools/bloom_luminance.mjs
# berechnet Luminanz (Rec.709, wie three sie im Shader tut) + Bloom-Alpha
```

**1. `smoothWidth` ist 0.01, nicht 1.0.** `UnrealBloomPass.js:137` überschreibt
den Shader-Default mit `0.01`. Die Schwelle ist damit praktisch binär: der
Übergang ist **0.01 breit**, nicht 1.0. Es gibt keinen weichen Verlauf, an dem
man „etwas" einstellen könnte — entweder Luminanz ≥ threshold oder nichts.

**2. Die Sonne liegt mit L = 0.523 unter jeder brauchbaren Schwelle.**

```
Sonne       #ffb000  linear=(1.000, 0.434, 0.000)  L=0.523
Glühhaelle  #ff8a1a  L=0.395 x 0.28 opacity      =  0.111
```

Bloom-Alpha `smoothstep(th, th+0.01, L)` für die **unveränderte** Sonne:

| threshold | Sonne (L 0.523) | hellster Planet (Uranus, L≈0.32 mit Licht) |
|---|---|---|
| 0.85 | 0.0000 | 0.0000 |
| 0.70 | 0.0000 | 0.0000 |
| 0.55 | 0.0000 | 0.0000 |
| 0.50 | **1.0000** | 0.0000 |
| 0.40 | 1.0000 | 0.0000 |
| 0.30 | 1.0000 | **1.0000** ← Uranus bluetet mit |

Aktuell ist die Sonne ein `MeshBasicMaterial({ color: 0xffb000 })` plus
additive BackSide-Glühhaelle mit `opacity: 0.28` (BodyFactory.ts:33-48, 141-161)
— beide unterhalb jeder brauchbaren Schwelle. Es würde **nichts** aufleuchten.

### Empfehlung für Ticket 18: Sonne auf HDR heben, dann Schwelle 0.85

Damit ist **beides** nötig, ein Parameter reicht nicht:

| Schritt | Änderung | Begründung |
|---|---|---|
| 1 | Sonnen-Material auf L > threshold bringen: `color.multiplyScalar(2.5)` (L 0.523 → 1.308) **oder** `MeshBasicMaterial({ color, toneMapped: false })` mit über 1.0 liegenden Kanälen | Sonne muss überhaupt erst über die Schwelle kommen |
| 2 | `UnrealBloomPass(resolution, strength 1.2, radius 0.5, threshold 0.85)` | Schwelle über der hellsten Planetenluminanz (0.32) → Planeten bleiben ruhig |

Ergebnis dieser Kombination, gemessen:

```
Sonne x2.5  L=1.308  → alpha 1.00 bei threshold 0.55, 0.85 und 1.00
Uranus      L=0.322  → alpha 0.00 bei threshold 0.55 und 0.85
```

`threshold: 0.55` allein (ohne Schritt 1) bringt **nichts** — die Sonne hat
L 0.523 und bliebe dunkel. `threshold: 0.30` allein bringt **das Falsche**:
Uranus und Saturn leuchten mit.

Zusätzlich sinnvoll: den Bloom-Pass auf hohe Qualitätsstufen beschränken
(`getQualityProfile(this.quality)`), sonst kostet er auf dem
Software-Rasterisierer im E2E-Lauf Bildrate. `src/scene/quality.ts` liefert
dafür bereits die Stufen.

## 3. Raumschiff-Modell

**Quelle:** Kenney *Space Kit* 2.0 — https://kenney.nl/assets/space-kit
Lizenz: **CC0 1.0 Universal** (Original-Lizenztext liegt als
`public/media/models/License-Kenney-SpaceKit.txt` bei, Wortlaut: „This content is
free to use in personal, educational and commercial projects. Support us by
crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)").

### Kandidatenauswahl

Aus dem Kit wurden 8 Raumschiffe geladen, vermessen (Größe, Dreiecke,
Materialien, Querschnittsprofil entlang Z, Silhouette aus 3 Blickrichtungen)
und nach Raumschiff-Tauglichkeit bewertet:

| Modell | KB | Dreiecke | Maße (X/Y/Z) | Materialien | Bewertung |
|---|---|---|---|---|---|
| **craft_speederA** | 20 | 280 | 2.00 / 0.80 / 2.10 | 4 | **Empfohlen** — schlanke Nase, breite Flügel in der Mitte, gut lesbare Triebwerksgondeln |
| craft_racer | 19 | 280 | 1.20 / 0.75 / 2.03 | 4 | Kandidat — schmal, flach, cockpit-artig |
| craft_speederD | 22 | 322 | 2.80 / 0.90 / 2.23 | 4 | Kandidat — sehr breite Flügel (2.8), flacher als speederA |
| craft_speederB/C | 19–20 | 270–292 | — | 4 | ähnlich, aber flacher (Y 0.60) |
| craft_miner | 26 | 384 | 1.80 / 0.70 / 2.60 | 4 | Frachter-Optik, zu lang |
| craft_cargoA/B | 19–26 | 264–380 | — | 4 | Frachter, Silhouette zu kompakt |

Alle drei liegen unter 23 KB, sind texturlos (4 PBR-Materialien mit
Vertexfarben-Basiswerten, keine Bilder) und kommen mit **4 Materialien**:
`metal` #edf0f5, `metalDark` #d6dbe4, `dark` #8f949e, `metalRed` #ffd07c.

Abgelegt:

```
public/media/models/schiff_speederA.glb   20496 B   <- empfohlen
public/media/models/schiff_racer.glb      19228 B   <- Alternative
public/media/models/schiff_speederD.glb   22876 B   <- Alternative
public/media/models/License-Kenney-SpaceKit.txt
```

**Integritätsnachweis:** die drei GLB wurden per SHA-256 gegen die Dateien im
offiziellen Kenney-ZIP (`kenney_space-kit.zip`, `Models/GLTF format/`) geprüft
— alle drei sind **byte-identisch**. Die GitHub-Kopie
(`shorepine/kenney`, ein CC0-Mirror) wurde nur zum Auffinden benutzt, nicht als
Quelle im Repo.

Prüfen lässt sich das jederzeit mit dem beiliegenden Werkzeug:

```bash
node tools/inspect_ship_model.mjs
# misst Bounding-Box, Dreiecke, Materialien, zeichnet ASCII-Silhouetten
node tools/inspect_ship_model.mjs public/media/models/schiff_racer.glb
```

### ⚠️ Wichtig für Ticket 21: Bug zeigt nach **-Z**, nicht +Z

`src/scene/Ship.ts:10-13` dokumentiert die Projekt-Konvention: „Das Modell
zeigt mit seiner lokalen **+Z-Achse** in Flugrichtung. Das Cockpit sitzt
deshalb vorne bei `+z`, die Triebwerks-Glows hinten bei `-z`."

**Die Kenney-Modelle zeigen mit -Z nach vorn.** Gemessen über das
Querschnittsprofil (Projektion auf XY, Tinte pro Z-Scheibe) und bestätigt im
Render aller drei Modelle: das spitze, schmale Ende liegt bei **minZ**, das
breite Heck mit den Triebwerksgondeln bei **maxZ**.

| Datei | `minZ` | `maxZ` | Bug | Heck/Triebwerke |
|---|---|---|---|---|
| schiff_speederA | 0.45 | 2.55 | **-Z** | +Z |
| schiff_racer | 0.4872 | 2.5128 | **-Z** | +Z |
| schiff_speederD | 0.3872 | 2.6128 | **-Z** | +Z |

Also zwei saubere Optionen für Ticket 21 — **keine** darf vergessen werden,
sonst fliegt das Schiff rückwärts:

1. `group.rotation.y = Math.PI` auf der Modellgruppe (empfohlen — die
   Ship-Konvention `+Z = Flugrichtung` bleibt unverändert gültig, danach
   stimmen auch die Triebwerks-Glows wieder bei `-z`)
2. Explizite Achsenumkehr im Loader, dann `SHIP` dreht sich selbst

### Einhängen: exakte Normalisierungskonstanten

Die GLB liegen **nicht** zentriert und nicht skaliert (Ursprung ist
`tmpParent` bei `(2, 0, 1.5)`). Werte für Ziel-Länge **1.0 Szeneneinheit**
entlang Z (aus `Box3` gemessen, `getSize().z` ist der Maßstab):

**schiff_speederA.glb** (empfohlen)
```
min    = (1.0000, 0.0000, 0.4500)
max    = (3.0000, 0.8000, 2.5500)
center = (2.0000, 0.4000, 1.5000)   scale = 0.476190   // 1.0 / 2.10 (Z)
group.scale.setScalar(0.476190);
group.position.set(-0.952381, -0.190476, -0.714286);
// zentriert: Nase (-Z) bei z = -0.500, Heck (+Z) bei z = +0.500
// -> NACH rotation.y = PI liegt die Nase bei +0.500 = Flugrichtung
```

**schiff_racer.glb**
```
center = (2.0000, 0.3750, 1.5000)   scale = 0.493664   // 1.0 / 2.025671 (Z)
group.scale.setScalar(0.493664);
group.position.set(-0.987327, -0.185124, -0.740496);
```

**schiff_speederD.glb**
```
center = (2.0000, 0.4500, 1.5000)   scale = 0.449303   // 1.0 / 2.225671 (Z)
group.scale.setScalar(0.449303);
group.position.set(-0.898606, -0.202186, -0.673954);
```

Anschließend die **bestehenden** Triebwerks-Glows und das
`triebwerks-licht` aus `Ship.buildModel()` (src/scene/Ship.ts:283-306) an das
Modellheck hängen statt an die Primitive — die `ENGINE_OFFSET`/`ENGINE_L`-`R`-
Konstanten dann auf das Modellmaß umrechnen (`0.5` Modell-Einheiten ab Heck).

Materialien übernehmen: `GLTFLoader` liefert `metal`, `metalDark`, `dark`,
`metalRed` als `MeshStandardMaterial` mit passenden `roughness`/`metalness`.
Falls die Szene zu hell wirkt, `metalness` auf 0.3 dämpfen — `metalRed` (#ffd07c)
ist der orange Akzent und passt zur bestehenden `ACCENT_COLOR` in Ship.ts:81.

## 4. Sounds

**Quellen** (beide Kenney, beide CC0 1.0, Original-Lizenztexte liegen bei):

- *Sci-Fi Sounds* — https://kenney.nl/assets/sci-fi-sounds
  → `public/media/audio/License-Kenney-SciFiSounds.txt`
- *Interface Sounds* — https://kenney.nl/assets/interface-sounds
  → `public/media/audio/License-Kenney-InterfaceSounds.txt`

### Loop-Auswahl nach Messung

Der Triebwerks-Loop muss am Anschluss pegelgleich sein, sonst klickt es im
Loop. Gemessen mit `ffmpeg … -af astats` (RMS über die ersten/letzten 200 ms
eines 5-Sekunden-Clips):

| Kandidat | RMS Anfang | RMS Ende (4.8 s) | Urteil |
|---|---|---|---|
| spaceEngine_000 | −8.03 dB | **−12.41 dB** | Level-Sprung, ungeeignet |
| **spaceEngine_001** | −8.60 dB | **−8.32 dB** | ✅ **0.3 dB Abweichung — loopt sauber** |
| spaceEngine_002 | −12.67 dB | −11.93 dB | brauchbar, aber leiser |
| spaceEngine_003 | −10.18 dB | −12.90 dB | Level-Sprung |
| spaceEngineSmall_001 | −17.83 dB | −17.33 dB | ✅ sauber, deutlich leiser (Kinder-Variante) |

### Ablage

```
public/media/audio/triebwerk.ogg         90057 B   5.000 s   Triebwerk-Loop (Hauptlast)
public/media/audio/triebwerk.mp3         50722 B   5.000 s
public/media/audio/triebwerk_leise.ogg   38908 B   5.000 s   ruhiger Loop
public/media/audio/triebwerk_leise.mp3   50722 B   5.000 s
public/media/audio/klick.ogg              4197 B   0.100 s   UI-Klick
public/media/audio/klick.mp3              1611 B
public/media/audio/bestaetigung.ogg       4522 B   0.290 s   Quiz/Moduswechsel
public/media/audio/bestaetigung.mp3       3701 B
```

Gesamt **ca. 290 KB** für alle acht Dateien. Neu erzeugbar mit:

```bash
sh tools/make_audio.sh /pfad/zu/den-entpackten-kits
# braucht ffmpeg mit libvorbis + libmp3lame; FFMPEG=/pfad/zu/ffmpeg überschreibt
# die ffmpeg-Suche, sonst wird `ffmpeg` aus PATH genommen
```

Das Skript nimmt **keine** festen Pfade mehr an — es sucht die beiden Kits
unter dem übergebenen Verzeichnis und läuft aus jedem Arbeitsverzeichnis
(`REPO` wird aus dem Skriptort abgeleitet).

> **Reproduzierbarkeit:** die MP3 sind byte-identisch bei jedem Lauf, die OGG
> **nicht** — libvorbis schreibt eine zufällige Ogg-Serial pro Stream, die
> MD5 ändert sich also bei jedem Lauf. Akustisch sind beide Läufe identisch.
> Geprüft über den MD5 des dekodierten PCM:
>
> ```bash
> ffmpeg -i a.ogg -f s16le -acodec pcm_s16le - | md5sum   # 7c4c3283a6ac3861df447983648a3788
> ffmpeg -i b.ogg -f s16le -acodec pcm_s16le - | md5sum   # 7c4c3283a6ac3861df447983648a3788
> ```
>
> Wer den Bit-Hash braucht, nimmt die MP3-Variante.

### Warum OGG **und** MP3

Safari auf iOS/macOS kann Ogg erst ab **18.4** (April 2025) dekodieren
(webkit.org: „Ogg container support for both Opus and Vorbis audio on macOS
Sequoia 15.4, iOS 18.4 …“). Ältere Safari-Versionen — und damit ein
nennenswerter Teil der Zielgruppe „Kinder, Tablet“ — würden stumm bleiben.
`THREE.AudioListener` kann kein Format-Fallback, also liegen beide Formate
parallel da; `<audio>` nimmt per `canPlayType` das erste passende. Beide
Dateien stammen aus derselben Quelle und klingen identisch.

`nginx.conf:51` cachet `.png … .glb|.gltf|.bin|.ktx2` mit einer Woche — `.ogg`,
`.mp3`, `.m4a` und `.wav` fehlten in dieser Liste. **Erledigt:** die
Audio-Endungen sind jetzt mit aufgenommen, sonst lädt jedes Start-up den
Loop erneut:

```nginx
location ~* \.(?:png|jpe?g|webp|avif|gif|ico|svg|woff2?|glb|gltf|bin|ktx2|ogg|mp3|m4a|wav)$ { ... }
```

### Anschluss-Hinweise für Ticket 21

- `THREE.AudioListener` an die Kamera hängen und `THREE.Audio` an das
  Triebwerks-Mesh; `sound.setLoop(true)`, `setVolume()` an `getThrustLevel()`
  koppeln (`getThrustLevel()` in src/scene/Ship.ts:404 liefert 0..1)
- Autoplay-Sperre: der Loop darf erst nach der ersten Nutzergeste starten
  (`userGesture`-Flag setzen), sonst bleibt er in Safari stumm
- `klick` an `Nav`/`Quiz` hängen, `bestaetigung` an richtige Quizantwort bzw.
  Moduswechsel
- Kinder-Vorgabe: Startvolumen niedrig (ca. 0.3–0.4), Loop nur bei Schub —
  ein dauerhaft brummendes Triebwerk über eine ganze Kindersitzung ist lästig

## 5. Nicht verwendet

- **NASA/ESA-Bilder**: bewusst nicht, Lizenz- und Attributionspflege wäre
  dauerhaft nötig und die Spec (`specs/10_textures.md:86`) verbietet es
- **Sketchfab / Freesound / OpenGameArt-Modelle**: nicht ausgewertet, die
  Kenney-Kits decken den Bedarf CC0 und ohne Wasserzeichen ab
- **Ogg-only**: Safari-Vor-18.4-Problem, siehe oben
- **Audio-Pakete von Freesound**: Lizenzlage gemischter als Kenney CC0

## 6. Prüfwerkzeuge

Alle drei Werkzeuge laufen offline und prüfen die Assets, nicht den Code.
Echte Ausgabe jeweils am 30.09.2026 erzeugt.

```bash
node tools/verify_assets.mjs    # GLB parsebar, texturlos, CC0-Texte vorhanden
node tools/bloom_luminance.mjs  # Luminanz + Bloom-Alpha je threshold
node tools/inspect_ship_model.mjs [datei.glb]   # Bounding-Box, Dreiecke, ASCII-Silhouette
node tools/ship_normalize.mjs [datei.glb]        # exakte scale/position-Konstanten
python3 tools/verify_textures.py                 # PNG-Check + Plausibilitaet
```

`verify_assets.mjs` ist das Sicherheitsnetz für Ticket 21: es schlägt an,
sobald ein Modell eine Bildtextur mitbringt (dann wächst der Download um
unbekannte KB) oder eine Lizenzdatei fehlt.

| Werkzeug | Ergebnis |
|---|---|
| `verify_assets.mjs` | `Alle Asset-Pruefungen bestanden.` (3 GLB, 8 Audio, 3 Lizenzen) |
| `verify_textures.py` | 20 PNGs, 6/6 Plausibilitäts-Checks `[OK]` |
| `bloom_luminance.mjs` | Sonne L 0.523, hellster Planet L≈0.32 (beleuchtet) |
| `inspect_ship_model.mjs` | 280–322 Dreiecke, 4 Materialien pro Schiff |
| `ship_normalize.mjs` | `scale`/`position` für alle drei Schiffe |
