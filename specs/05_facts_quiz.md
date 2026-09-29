PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Ticket 02 (bodies.json) fertig.

AUFGABE: Lerninhalte — Kindtexte, Vergleiche, Quizfragen

ERSTELLE GENAU diese Datei:
- src/data/facts.json

STRUKTUR:
{
  "bodies": {
    "<bodyId>": {
      "summary": "2-3 Saetze fuer Kinder, deutsch, warm und verstaendlich",
      "funFact": "Eine ueberraschende, einpraegsame Tatsache",
      "kidQuestion": "Eine Frage, die ein Kind beim Lesen denken koennte",
      "comparisons": {
        "earths": 1.0,          // Vielfaches des Erdvolumens/-radius
        "yearLength": "88 Tage", // verstaendliche Dauer
        "dayLength": "58,6 Stunden"
      },
      "wouldYouSurvive": string  // kurze, kindgerechte Antwort
    }
  },
  "quiz": [ ... ],
  "glossary": [ ... ]
}

ANFORDERUNGEN an bodies:
- Ein Eintrag fuer JEDEN Koerper aus src/data/bodies.json
- summary: max. 3 Saetze, keine Fachbegriffe ohne Erklaerung
  Kein "Aequatorradius" — das gehoert in die Zahlenansicht, nicht hier.
- funFact: wirklich interessant. Beispiele:
  Jupiter hat mehr als 90 Monde. Venus ist heisser als Merkur, obwohl es
  weiter von der Sonne entfernt ist (dicke Atmosphaere).
  Ein Tag auf der Venus dauert laenger als sein Jahr.
  Der Eisriese Uranus "rollt" fast auf der Seite.
  Auf dem Titan gibt es Fluss-Seen aus flüssigem Methan.

ANFORDERUNGEN an quiz (mindestens 15 Fragen):
  [
    { "id": "q1", "question": "...",
      "options": ["a","b","c","d"],
      "correctIndex": 0,
      "explanation": "Warum ist das richtig — kindgerecht",
      "difficulty": "leicht"|"mittel"|"schwer" }
  ]
- Jede Frage hat genau 4 Antwortoptionen
- correctIndex liegt immer zwischen 0 und 3
- Themen: Groessenvergleich, Reihenfolge, Monde, Sonne, Besonderheiten
- Mindestens 3 leichte, 8 mittlere, 4 schwere
- Erklaerungen in Kindersprache

ANFORDERUNGEN an glossary (mindestens 12 Eintraege):
  [ { "term": "Umlaufbahn", "definition": "...",
      "example": "Die Erde braucht 365 Tage fuer eine Umlaufbahn." } ]
- Begriffe: Umlaufbahn, Rotation, Achsneigung, Schwerkraft, Atmosphaere,
  Mond, Asteroid, Komet, Sonne, Planet, Erdachse, Bahnebene,
  Roche-Grenze, Megaparsek (falls passend)
- Auch eine Einheit mit einem Beispiel: "Wie lang ist eine Erde?"

ACCEPTANCE CRITERIA:
- Valides JSON (pruefe mit python3 -m json.tool)
- bodies enthaelt einen Eintrag fuer ALLE ids aus bodies.json
- >= 15 Quizfragen, alle mit gueltigem correctIndex und 4 Optionen
- >= 12 Glossary-Eintraege
- Pruefe selbst und zeige die Ausgabe: Anzahl bodies-Eintraege vs Anzahl
  bodies.json-ids, Quizfrage-Anzahl, Glossar-Anzahl, fehlende ids = LEER

WICHTIG:
- KEIN git commit
- Nur diese EINE Datei
- Sprache durchgehend Deutsch, freundlich, fuer 8-14 Jaehrige
- Keine erfundenen Fakten. Wenn du eine Zahl nicht sicher kennst, lass sie weg.
