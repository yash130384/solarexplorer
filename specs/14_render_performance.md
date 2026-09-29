PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Ticket 13 (bodies.json mit 456 Koerpern) muss FERTIG sein.
Pruefe zuerst: grep -c '"type"' src/data/bodies.json  -> muss > 450 sein.
Wenn nicht, blockiere dich SELBST mit klarer Begruendung — nicht raten.

AUFGABE: 456 Koerper performant in der 3D-Szene darstellen

PROBLEM: Aktuell erzeugt BodyFactory fuer JEDEN Koerper eine SphereGeometry.
Mit 456 Koerpern und aktuell 64 Segmenten ist das ~466.000 Dreiecke allein
fuer die Sphären, plus 456 Draw-Calls. Das killt die Framerate.

LÖSUNGSANSATZ (du entscheidest die Details, diese Punkte sind Pflicht):

1. LEVEL OF DETAIL
   - Jeder Koerper braucht 3 Detailstufen: "high" (sichtbar/fokussiert),
     "medium" (in der Naehe), "low" (weit weg)
   - high: 48x32 Segmente, sichtbar wenn die Kamera nah ist
   - low:  12x8 Segmente, reicht fuer "da ist ein Punkt im Orbit"
   - Wechsle zur Stufe anhand der DISTANZ Kamera <-> Objekt, mit Hysterese
     (nicht bei jeder kleinen Bewegung die Geometrie tauschen — das
     erzeugt Flackern und GC-Druck)
   - WICHTIG: Geometrien pro Stufe EINST cachen und wiederverwenden, nicht
     pro Koerper neu erzeugen. Ein Planeten-Mesh darf die Sphäre teilen.

2. DRAW-CALLS SENKEN
   - Instancing (THREE.InstancedMesh) fuer die kleinen Monde: die grossen
     und bekannten (Mond, Io, Europa, Titan, Triton, Phobos, Deimos) als
     einzelne Meshes, den Rest instanziert
   - Oder: Cluster-Mesh fuer Monde, die nie einzeln angeklickt werden
   - Messen! getStats().drawCalls vor und nach der Umstellung berichten

3. RING-SYSTEME
   - Saturn hat Ringe, Jupiter/Saturn/Uranus/Neptun zarte Ringe
   - ERSTELLE: src/scene/Rings.ts
     - RingGeometry mit alpha-Textur (prozedural, keine NASA-Bilder)
     - Incidence: Ringe nur sichtbar aus dem richtigen Winkel
     - Fuer jeden der 4 Planeten mit Ringen
   - ERSTELLE: eine Ring-Textur in tools/generate_textures.py ergaenzen

4. ASTEROIDEN-GUERTEL UND KOMETEN
   - ERSTELLE: src/scene/Belt.ts
     - Asteroidenguertel zwischen Mars und Jupiter (2,1 - 3,3 AE)
     - >= 3000 kleine Instanzen, deterministic verteilt (SEED, kein Math.random)
     - Kometenbahn: 2-3 Kometen auf stark exzentrischen Bahnen (e = 0,9+)
   - Ausgabe der Statistik zeigen

5. LOD-UI
   - Ein Knopf "Details" im HUD: "Alle" / "Nur bekannte"
   - "Nur bekannte" blendet kleine Monde aus (die ohne Kindtext), damit die
     Szene fuer Kinder uebersichtlich bleibt

ACCEPTANCE CRITERIA:
- npx tsc --noEmit: 0 Fehler
- Es laufen 456 Koerper fluessig. NACHWEIS, keine Behauptung:
  - Der E2E-Test misst die Framerate ueber 3 Sekunden und gibt sie aus
  - ERSTELLE: tests/e2e/performance.spec.ts
      - laedt die Seite, wartet bis die Szene stabil ist
      - misst requestAnimationFrame ueber 3s -> mittlere FPS
      - prueft drawCalls ueber getStats() (ueber expose oder Debug-Hook)
      - ERWARTUNG: >= 30 FPS auf dem Testsystem, drawCalls < 300
  - Wenn die Zielwerte nicht erreicht werden, OPTIMIERE weiter. Erst wenn
    es nach 2 Optimierungsrunden nicht klappt, melde den Befund mit den
    gemessenen Zahlen — dann ist es eine ehrliche Grenze, kein Testfehler
- getStats() wird gefuellt: bodies, drawCalls, triangles
- Determinismus: Szene sieht bei 2 Aufrufen identisch aus (kein Math.random
  in der Szeneninitialisierung — grep pruefen)

WICHTIG:
- KEIN git commit
- AENDERE NICHT src/data/bodies.json (gehoert Ticket 13)
- AENDERE NICHT src/core/scale.ts oder orbital.ts — wenn die Physik nicht
  reicht, MELDEN statt umbauen
- Zeige die echten FPS- und drawCall-Zahlen im Bericht
