PROJEKT: SolarExplorer
ZIEL: Sammle Texturen für alle 8 Planeten, recherchiere Three.js Sun-Glow (Bloom/ShaderMaterial), suche ein Star-Wars-artiges 3D-Schiff (GLTF/OBJ) und Sounds (Triebwerk, Klick).
REGEL: Nur frei nutzbare Assets (CC0) oder prozedural.
OUTPUT: Assets im `public/`-Ordner ablegen, Quellen dokumentieren.

ERGEBNIS: Die Recherche steht in `src/assets/README.md` (Ablage, Lizenzen,
gemessene Zahlen, Anschluss-Hinweise fuer die Folgetickets). Die Textur-Doku
liegt in `src/assets/README-texturen.md`. Kurzfassung:

- **Texturen** waren bereits vorhanden und prozedural erzeugt (Ticket 10) —
  nichts zu beschaffen. 20 Body-PNGs + 4 Ring-PNGs unter
  `public/media/textures/`. Prüfung: `python3 tools/verify_textures.py`.
- **Schiff:** 3 CC0-GLB (Kenney *Space Kit* 2.0, SHA-256 gegen das offizielle
  ZIP geprueft) unter `public/media/models/`. Wichtig für Ticket 21: die Modelle
  zeigen nach **-Z**, nicht +Z — `group.rotation.y = Math.PI` ist Pflicht.
- **Sounds:** 4 Clips als OGG + MP3 (CC0, Kenney Sci-Fi + Interface Sounds)
  unter `public/media/audio/`.
- **Sun-Glow:** kein Asset, sondern Three.js-Setup. Messung zeigt: die
  unveränderte Sonne liegt mit L = 0.523 *unter* jeder brauchbaren
  Bloom-Schwelle, `threshold: 0.55` allein bewirkt also nichts. Ticket 18
  braucht beides: Sonne auf L > threshold heben **und** Schwelle 0.85.
