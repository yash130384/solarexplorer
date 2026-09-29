"""Prueft src/data/facts.json gegen bodies.json und die Acceptance-Kriterien."""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"

bodies = json.loads((DATA / "bodies.json").read_text(encoding="utf-8"))["bodies"]
facts = json.loads((DATA / "facts.json").read_text(encoding="utf-8"))

ids = [b["id"] for b in bodies]
entries = facts["bodies"]
missing = [i for i in ids if i not in entries]
extra = [k for k in entries if k not in ids]

print(f"bodies.json ids:            {len(ids)}")
print(f"facts.json bodies-Eintraege: {len(entries)}")
print(f"fehlende ids:               {missing if missing else 'LEER'}")
print(f"ueberzaehlige ids:          {extra if extra else 'LEER'}")

# Pflichtfelder je Eintrag
required = ["summary", "funFact", "kidQuestion", "wouldYouSurvive"]
field_errors = []
for bid, entry in entries.items():
    for field in required:
        if not isinstance(entry.get(field), str) or not entry[field].strip():
            field_errors.append(f"{bid}.{field}")
    comps = entry.get("comparisons")
    if comps is not None:
        for key in ("earths", "yearLength", "dayLength"):
            if key not in comps:
                field_errors.append(f"{bid}.comparisons.{key}")
        e = comps.get("earths")
        if e is not None and not isinstance(e, (int, float)):
            field_errors.append(f"{bid}.comparisons.earths (keine Zahl)")
print(f"Pflichtfelder fehlend:      {field_errors if field_errors else 'LEER'}")

# Quiz
quiz = facts["quiz"]
quiz_errors = []
diffs = {"leicht": 0, "mittel": 0, "schwer": 0}
seen_ids = set()
for q in quiz:
    qid = q.get("id")
    if not qid:
        quiz_errors.append("Frage ohne id")
    elif qid in seen_ids:
        quiz_errors.append(f"doppelte id {qid}")
    else:
        seen_ids.add(qid)
    opts = q.get("options")
    if not isinstance(opts, list) or len(opts) != 4:
        quiz_errors.append(f"{qid}: {len(opts) if isinstance(opts, list) else '?'} Optionen")
    ci = q.get("correctIndex")
    if not isinstance(ci, int) or not 0 <= ci <= 3:
        quiz_errors.append(f"{qid}: correctIndex={ci}")
    elif isinstance(opts, list) and len(opts) == ci:
        quiz_errors.append(f"{qid}: correctIndex zeigt ins Leere")
    if not isinstance(q.get("explanation"), str) or not q["explanation"].strip():
        quiz_errors.append(f"{qid}: explanation fehlt")
    d = q.get("difficulty")
    if d in diffs:
        diffs[d] += 1
    else:
        quiz_errors.append(f"{qid}: difficulty={d!r}")

print(f"Quizfragen:                {len(quiz)} (>=15: {'OK' if len(quiz) >= 15 else 'FEHLT'})")
print(f"  leicht/mittel/schwer:    {diffs['leicht']}/{diffs['mittel']}/{diffs['schwer']}")
print(f"  (min 3/8/4):             "
      f"{'OK' if diffs['leicht'] >= 3 and diffs['mittel'] >= 8 and diffs['schwer'] >= 4 else 'FEHLT'}")
print(f"Quiz-Fehler:               {quiz_errors if quiz_errors else 'LEER'}")

# Glossar
gloss = facts["glossary"]
gloss_errors = []
for g in gloss:
    for key in ("term", "definition", "example"):
        if not isinstance(g.get(key), str) or not g[key].strip():
            gloss_errors.append(f"{g.get('term', '?')}.{key}")
print(f"Glossar-Eintraege:         {len(gloss)} (>=12: {'OK' if len(gloss) >= 12 else 'FEHLT'})")
print(f"Glossar-Fehler:            {gloss_errors if gloss_errors else 'LEER'}")

# Keine chinesischen/kyrillischen Zeichen in den Texten
bad = []
for bid, entry in entries.items():
    for key, value in entry.items():
        if isinstance(value, str) and any("\u4e00" <= c <= "\u9fff" for c in value):
            bad.append(f"{bid}.{key}")
for q in quiz:
    for key in ("question", "explanation"):
        if any("\u4e00" <= c <= "\u9fff" for c in q.get(key, "")):
            bad.append(f"quiz {q.get('id')}.{key}")
for g in gloss:
    for key in ("term", "definition", "example"):
        if any("\u4e00" <= c <= "\u9fff" for c in g.get(key, "")):
            bad.append(f"glossary {g.get('term')}.{key}")
print(f"Fremdschriftige Zeichen:   {bad if bad else 'LEER'}")

failed = bool(missing or extra or field_errors or quiz_errors or gloss_errors or bad)
print()
print("ERGEBNIS:", "FEHLGESCHLAGEN" if failed else "ALLE PRUEFUNGEN BESTANDEN")
sys.exit(1 if failed else 0)
