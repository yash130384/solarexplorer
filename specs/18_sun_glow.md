# Ticket 18 — Sonne zum Strahlen bringen

PROJEKT: SolarExplorer
ZIEL: Die Sonne soll strahlen und echt aussehen.
UMSETZUNG: Three.js `ShaderMaterial` **oder** `EffectComposer` (`UnrealBloomPass`) fuer einen starken, realistischen Glow.
TICKETS: Baut auf 17 auf.

Status: umgesetzt. Geprueft mit 333/333 Unit-Tests, 31/31 E2E-Tests und
zwei Sichtpruefungen (`docs/glow-on.png` gegen `docs/glow-off.png`).

## Umgesetzt in

| Datei | Inhalt |
|---|---|
| `src/scene/SunGlow.ts` | HDR-Hebung, Parameter-Aufloesung, Pass-Kette, Szenen-Zaehler |
| `src/scene/BodyFactory.ts` | `boostSunSurface` beim Bau des Sonnen-Meshes |
| `src/scene/SceneManager.ts` | Composer-Aufbau, `setBloomMode`, `sampleFrame` |
| `src/scene/types.ts` | `BloomMode`, `FrameSample`/`FrameRegion`, `emptyFrameSample`, Luminanzschwellen |
| `src/app.ts` | `?bloom=auto|on|off`, Debug-Haken `setBloomMode`/`setPaused`/`sampleFrame` |
| `tests/unit/sun-glow.test.ts` | 14 Tests: Schwellenlogik, Hebung, Parameter |
| `tests/e2e/sun-glow.spec.ts` | 5 Tests: Nachweis am gerenderten Bild |
| `tools/glow_measure.mjs` | Bildmessung + Vergleichs-Screenshots |

## Die beiden Haelften des Effekts

`UnrealBloomPass` ist ein Helligkeits-Hochpass (`LuminosityHighPassShader`):
er blutet nur, was **heller als `threshold`** ist, und der Uebergang ist mit
`smoothWidth = 0.01` praktisch binaer.

Die Sonne liegt im Klartext-Farbraum bei **L = 0.523** — unter jeder brauchbaren
Schwelle. Eine gesenkte Schwelle allein bewirkt also **nichts**; wird sie tief
genug gesenkt (0.30), blueten Uranus und Saturn mit (L ~ 0.32). Deshalb zwei
Massnahmen:

1. **Sonne auf HDR heben** — `color.multiplyScalar(2.5)`, ergibt L = 1.308.
   Erlaubt, weil ohne Tone-Mapping in ein HalfFloat-Rendertarget gezeichnet
   wird; three wendet Tone-Mapping nur beim Zeichnen **auf den Bildschirm** an
   (`OutputPass`).
2. **Schwelle 1.0** — ueber jedem Nicht-Sonnen-Bildpunkt: hellste
   Planetenfarbe (Uranus, Albedo-L 0.633) erreicht mit dem Hemisphaerenlicht
   1.6 nur L ~ 0.32, die hellsten Sterne 0.95, das Triebwerksgluehen 0.53.

Pass-Kette: `RenderPass` -> `UnrealBloomPass(0.35, 0.2, 1.0)` -> `OutputPass`.
Die Reihenfolge ist bindend; ohne `OutputPass` waere das Bild doppelt
tonemapped.

## Gewaehlte Staerke: 0.35 / Radius 0.2 (nicht die Three-Defaults)

Der Three-Beispielwert 1.2 / 0.5 ist fuer kleine gluehende Punkte gedacht.
Hier sitzt ein **ausgedehntes** HDR-Objekt in der Bildmitte. Alle vier Ecken
der Matrix sind gemessen (`tools/glow_measure.mjs`, Bildfeld 320x320 um die
Sonne, Kern = Pixel mit L >= 150, jeweils ohne Bloom als Basis):

| Staerke / Radius | Kernpixel | Faktor | Hof |
|---|---|---|---|
| 0.35 / 0.2 (gewählt) | ~3 500 | 2.3x | weiche Korona am Kern |
| 1.2 / 0.2 | ~20 700 | 13.5x | breites oranges Feld |
| 1.2 / 0.5 (Three-Defaults) | ~23 900 | 16.0x | breite, flache Wolke |

(Jedes Bild einzeln gemessen; der ueber zwei Bilder gemittelte Wert liegt bei
~2 950, siehe Abschnitt Nachweis.)

Die **Staerke** ist die bestimmende Achse: schon die reine Erhoehung von 0.35
auf 1.2 (Radius konstant 0.2) vervielfacht die Kernflaeche auf das Siebenfache.
Der Radius wirkt daneben nur noch leicht (13.5x -> 16.0x). Wer den Hof also
begrenzt, muss die Staerke zurueckdrehen.

Sichtpruefung (`docs/glow-on.png` und `docs/glow-off.png`): bei 0.35/0.2 steht
der Hof als klar abgegrenzte Korona um den Kern, die beiden im Bild sichtbaren
inneren Planeten bleiben schattierte Kugeln mit eigener Farbe. Bei 1.2/0.5
liegt dieselbe Szene als diffuse orange Wolke ueber Guertel und Planeten —
die Kugeln sind dann zwar noch erkennbar, aber nur noch als schwach
abgesetzte Flecken. Fuer eine Kind-App ist das der Unterschied zwischen
"guck mal, die Sonne glüht" und "guck mal, hier ist irgendwas Orange".

Der Kompromiss ist bewusst: ein Hof, der die **naechstgelegenen** Planeten
verschluckt, ist fuer eine Kind-App wertlos. Wer den Effekt groesser will,
dreht `BLOOM_STRENGTH` in `src/scene/SunGlow.ts` hoch.

## Qualitaetsstufen

Der Bloom kostet 11 zusaetzliche Vollbild-Durchgaenge (5 Mip-Stufen,
horizontal + vertikal, Composite, Blend). Auf einem Software-Rasterisierer
(headless-Chromium, VM) ist genau die Fuellrate der Engpass. Deshalb:

- `auto` (Standard): Bloom ab Qualitaetsstufe `medium`, auf `low` aus.
- `on` / `off`: erzwingen. `?bloom=on` macht den Effekt auch ohne GPU sichtbar.
- `SceneManager.setBloomMode` schaltet zur Laufzeit um, ohne Szenenneubau.

## Nachweis

Der Effekt ist eine Eigenschaft des **Bildes**, nicht des Objektgraphen — ein
Bloom, der nirgends blutet, sieht in `snapshot()` und `getStats()` identisch
aus wie einer, der die halbe Flaeche ueberstrahlt. Der E2E-Test misst daher
Pixel (`SceneManager.sampleFrame`).

Drei Fallstricke, die dabei echte Fehlschluesse erzeugt haben und jetzt im
Test dokumentiert sind:

1. **`readPixels` nach dem Frame liefert Nullen.** Ohne
   `preserveDrawingBuffer` ist der Backbuffer nach dem Compositing nicht mehr
   auslesbar. Deshalb nimmt `SceneManager` die Messung am Ende von `render()`
   entgegen, wo er noch vollstaendig ist.
2. **Absolute Pixel-Schwellen sind hier kein Beweis.** Das Feld um die Sonne
   enthaelt auch den Asteroidenguertel (3000 Instanzen, Albedo-L 0.32) und
   Sterne — **ohne** Bloom liegen dort rund 96 bis 98 % der Pixel ueber der
   Schwelle L 25 (gemessen 96 243 von 102 400 mit sofortigem Pausieren,
   100 000 von 102 400 im E2E-Lauf). Belastbar ist nur der Vergleich
   `bloom=on` gegen `bloom=off` auf **derselben** Seiteninstanz (zwei Reloads
   vergleichen zwei Simulationszeitpunkte; der Guertel wandert weiter).
3. **Die Kamera gleitet auch bei angehaltener Zeit.** `setPaused` haelt die
   Simulation an, nicht die Kamera — sie folgt dem Schiff weiter, bis ihre
   Glaettung zur Ruhe kommt. Die Sonne wandert dabei im **festen**
   Messfenster, und die Kernflaeche schwankt dadurch ueber Laeufe hinweg
   zwischen rund 1 550 und 2 900 Pixeln, ohne dass sich die Bloom-Einstellung
   geaendert haette. Deshalb mittelt der E2E-Test ueber zwei Bilder, und
   deshalb wird die **mittlere** Helligkeit zum eigentlichen Nachweis
   genommen: sie ist stabil (48 bis 50 ohne Bloom, 90 bis 94 mit), waehrend
   die Kernflaeche es nicht ist.

Gemessen (identische Seiteninstanz, `?bloom=off` geladen, dann zur Laufzeit auf
`on` geschaltet, 320x320-Feld um die Sonne, Mittelwert aus je zwei Bildern):

| | mean L | Pixel >= L 150 ("Kern") | max L |
|---|---|---|---|
| `bloom=off` | 47.9 | 1 550 | 253 |
| `bloom=on` | 93.4 | 3 457 | 239 |

Faktor **1.95** auf der mittleren Helligkeit, **2.2** auf der Kernflaeche.
Der E2E-Lauf im selben Test meldet 49.7 -> 90.2 (Faktor 1.8) und Kern
2 084 -> 2 913 (Faktor 1.4). `max` **sinkt** mit Bloom (253 -> 239) in beiden
Laeufen: die Spitze kann nach dem Tonemapping nicht heller werden, der
Hochpass verteilt ihre Energie nach aussen in die Flaeche. Genau das ist die
Verbreiterung. Bildrand (Himmel) bleibt bei mean L 0.1.

Die Gegenprobe laeuft ueber den anderen Weg (`?bloom=on` geladen, dann auf
`off`): sie landet bei mean 93.7 / 48.3 und Kern 3 575 / 1 594, also im
Rahmen derselben Groessenordnung. Damit ist ausgeschlossen, dass der Effekt
nur beim Umschalten in eine Richtung auftritt.

**Die Kernflaeche ist kein verlaessliches Mass, die mittlere Helligkeit
schon.** Sie haengt an der Restwanderung der Kamera und schwankt ueber
Laeufe hinweg (Faktor 1.4 bis 2.2 bei identischer Bloom-Einstellung);
`tools/glow_measure.mjs` (Einzelbild direkt nach der Pause) kommt auf einen
dritten Wert. Deshalb wird im Test die **mittlere** Helligkeit als Nachweis
gefuehrt; sie liegt ueber beide Messwege, drei Laeufe und zwei Werkzeuge
hinweg stabil bei Faktor 1.8 bis 1.95.

## Draw-Calls: was der Bloom zaehlt und was nicht

`WebGLRenderer` setzt `info.reset()` am **Anfang** jedes `render()`. Jeder
Composer-Pass ist aber ein eigener `render()`-Aufruf mit einem
Vollbild-Quad — der **letzte** gewinnt. Gelesen wuerde also nicht die Szene,
sondern ein Quad (gemessen vorher: `drawCalls` 30 ohne Bloom, **1** mit Bloom).

Deshalb steht ein `SceneStatsPass` direkt hinter dem `RenderPass`: er merkt
sich `info.render.calls`/`triangles`, solange sie noch die der Szene sind.
`SceneManager.getStats()` liest von dort, wenn ein Composer laeuft.

Gemessen am frisch gebauten Bundle, Port 4173:

| | `drawCalls` | `triangles` |
|---|---|---|
| `?bloom=off` | 30 | 40 496 |
| `?bloom=on` | 30 | 41 600 |

Ohne Bloom kommt die Szene direkt in den Renderer, mit Bloom ueber den
`RenderPass` — beide Wege melden dieselbe Szenenzahl. (Die Dreiecke
differieren leicht, weil der Asteroidenguertel zwischen den Messungen weiterwandert;
die Draw-Call-Zahl schwankt dabei um hoechstens 1, wenn die LOD der
wandernden Kamera folgt. Ein Bloom-Pass wuerde die Zahl dagegen auf 1
gedrueckt — der Abstand von rund 30 zu 1 ist der Nachweis.)

Die Alternative waere `renderer.info.autoReset = false` mit eigenem `reset()`
pro Bild (three dokumentiert das als Muster). Die laesst aber
`info.render.calls` zur Summe aus Szene **und** Passes werden — und die
Draw-Call-Grenzen des Projekts (`performance.spec.ts`, Grenze 300) beschreiben
die Szene, nicht Szene plus 12 Vollbild-Quadse.

Deshalb prueft `performance.spec.ts` die Grenzen jetzt in **beiden** Zustaenden:
auf dem Software-Rasterisierer ist `auto` = Bloom aus, auf normaler
Entwickler-Hardware (`medium`/`high`) laeuft er. Ohne den Fix waere die
Grenzpruefung dort eine Vakuumpruefung und `after.drawCalls < before.drawCalls`
schaeg fehl, weil beide Seiten auf 1 stuenden.

## Was nicht drin ist

- **Kein `ShaderMaterial` fuer die Sonne.** Der HDR-Hochpass des
  Bloom-Passes ist der kuerzere Weg: die Sonne ist ein
  `MeshBasicMaterial` mit gehobener Farbe, und die Klebhaelle
  (`BodyFactory`, 1.45x Radius, additiv) wirkt auch dann, wenn kein
  Postprocessing laeuft.
- **Kein HDR-Environment.** `PMREMGenerator` + `RoomEnvironment` wuerde die
  Planeten mit einem fremden Raumlicht aufhellen — hier leuchtet nur die
  Sonne.
- **Kein Animation der Korona.** Der Hof ist statisch. Ein pulsierender
  Shader waere ein eigener Effekt mit eigenem Performance-Budget.
- **Kein Bloom fuer das Triebwerksgluehen des Schiffs.** Es liegt mit L 0.53
  unter der Schwelle 1.0; bei 0.30 wuerde es mitbluten.
