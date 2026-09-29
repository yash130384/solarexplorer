PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Tickets 13 (Daten) und 14 (Performance) FERTIG.

AUFGABE: Kindtexte und Navigation fuer die vielen Monde + Live-Pruefung

TEIL A — facts.json erweitern
  ERSTELLE: src/data/build_facts.py
    Ein Skript, das facts.json um Eintraege fuer ALLE Koerper erweitert:
    - Bestehende Eintraege (Sonne, 8 Planeten, ~11 bekannte Monde) BLEIBEN
      unveraendert — die Texte sind handgeschrieben und gut
    - Fuer jeden FEHLENDEN Mond: einen echten, kurzen, KINDERGERECHTEN Text
      erzeugen. Kein leeres "Ein Mond von X" fuer alles — sondern Gruppen:
      * Grosse Monde der Riesenplaneten (Ganymed, Callisto, Titan,
        Enceladus, Rhea, Iapetus, Miranda, Ariel, Umbriel, Titania,
        Oberon, Triton, Charon): je EIGENEN Text mit der Besonderheit
        Beispiele:
          - Ganymed: groesster Mond im Sonnensystem, groesser als Merkur
          - Titan: hat Fluesse und Seen aus fluessigem Methan
          - Enceladus: schiesst Wasserfontaenen in den Weltraum
          - Triton: umkreust Neptun rueckwaerts (retrograd)
          - Iapetus: eine Seite hell, die andere schwarz
          - Charon: fast halb so gross wie Pluto
      * Kleine, regelmaessige Monde: Kategorie-Vergleichstext
        "Aehnlich wie die anderen kleinen Monde von Saturn: rund, grau
         und viel kleiner als unser Mond."
      * Irregulaere Monde (S/2003 S 1 etc.): "Ein kleiner, unregelmaessiger
        Mond, den die Astronomen erst 2003 entdeckt haben." NUR wenn das
        Entdeckungsjahr belegbar ist, sonst ohne Jahreszahl.
    - Der Gruppen-Vergleichstext wird per Python-Funktion erzeugt, nicht
      440mal hart kopiert — mit leichten Variationen (Radius, Bahnradius)
    - quiz: mindestens 5 NEUE Fragen zu den Monden (z.B. "Wie viele Monde
      hat der groesste Planet?", "Welcher Mond ist groesser als Merkur?")
    - glossary: 5 neue Begriffe (Retrograde Bahn, Umlaufzeit, Gravitationsfeld,
      Atmosphaere, Ringe)

  Validiere: jede id aus bodies.json hat einen facts-Eintrag.
  Ausnahme erlaubt: NUR wenn ein Koerper kein Radius hat (Datenluecke) —
  dann im Bericht auflisten.

TEIL B — Navigation mit vielen Koerpen
  AENDERE: src/ui/Nav.ts
  - 456 Eintraege in einer flachen Liste sind fuer Kinder unbrauchbar
  - Baum-Struktur: Sonne > Planeten > Monde
  - Jeder Planet ist aufklappbar, zeigt seine Monde
  - Suche/Live-Filter: Tippen erlaubt "io", "titan", "erde"
    (EREIGNIS: input -> sofort filtern, ohne Wartezeit)
  - Standard: nur die 8 Planeten + Sonne offen, Monde eingeklappt
  - "Zeige alle" / "Nur bekannte"-Umschalter (zieht auf Ticket 14 zu)
  - Bei 456 Elementen: KEIN DOM-Rendering von allem am Anfang.
    Erst rendern, was sichtbar/expanded ist. Sonst wird die Seite zaeh.
    (EREIGNIS: Nutze ein schlankes Muster, z.B. <details>/<summary> oder
     Template-Fragmente + DocumentFragment)

TEIL C — InfoPanel robust
  AENDERE: src/ui/InfoPanel.ts
  - Fehlende Daten (kein Radius, kein Text) duerfen NICHT zu "undefined"
     oder einem kaputten Layout fuehren. Zeige "Daten noch nicht erfasst"
  - Der Grossevergleich darf bei 456 Koerpen keine Billionen anzeigen —
    begrenzen und erklaeren

TEIL D — Abnahme und Live-Gang
  1. npx tsc --noEmit: 0 Fehler
  2. npx vitest run: ALLES gruen
  3. npx playwright test: ALLES gruen
  4. sudo docker compose build
  5. sudo docker compose up -d, warte auf healthy
  6. Pruefe die LOKALE Instanz: curl -s http://localhost:8090/ | grep SolarExplorer
  7. Pruefe die OEFFENTLICHE Instanz:
     curl -s https://space.pimmel.site/ | grep SolarExplorer
     (Falls nicht erreichbar: melden, nicht als Erfolg verbuchen)
  8. Pruefe, dass die neuen Monde wirklich ausgeliefert werden:
     curl -s https://space.pimmel.site/bodies.json | python3 -c "import json,sys; print(len(json.load(sys.stdin)['bodies']),'Koerper')"

WICHTIG:
- KEIN git commit
- Zeige JEDE Kommando-Ausgabe echt, inkl. Fehlschlaegen. Erfinde keine.
- Wenn Schritt 7 fehlschlaegt, ist das ein BEFUND, kein Grund zu behaupten,
  es laeuft. Dann sag es klar.
- Bestehende Tests nicht weichzeichnen. Wenn ein Test scheitert, melde es.
