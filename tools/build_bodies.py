#!/usr/bin/env python3
"""Erzeugt src/data/bodies.json aus allen Datenquellen.

Quellen (in dieser Reihenfolge):
  1. src/data/bodies_seed.json  - kuratierte Handdaten (Sonne, 8 Planeten,
     bekannte Monde mit deutschen Namen, Farben, Temperaturen)
  2. src/data/moons_*.json      - Wikipedia-Rohdaten aller bestaetigten Monde
  3. src/data/facts.json        - nur zur Vollstaendigkeitspruefung, wird
     nicht veraendert

Idempotenz: Das Skript liest bodies_seed.json, NIEMALS die previously
erzeugte bodies.json. Ein zweiter Lauf liefert daher byte-identisches
Ergebnis.

Aufruf:  python3 tools/build_bodies.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
SEED = DATA / "bodies_seed.json"
FACTS = DATA / "facts.json"
TARGET = DATA / "bodies.json"

# Moons-Dateien, die in dieser Reihenfolge eingelesen werden.
MOON_FILES = ["mars", "jupiter", "saturn", "uranus", "neptune"]

# Wikipedia-Dateiname -> id des Planeten in bodies.json
PLANET_IDS = {
    "mars": "mars",
    "jupiter": "jupiter",
    "saturn": "saturn",
    "uranus": "uranus",
    "neptune": "neptun",
}

# Umkehrung: id in bodies.json -> Wikipedia-Dateiname (z.B. neptun -> neptune)
WIKI_TO_BODY_ID = {v: k for k, v in PLANET_IDS.items()}

# Deutsche Planetennamen fuer die generierten Kindtexte.
PLANET_DE = {
    "mars": "Mars",
    "jupiter": "Jupiter",
    "saturn": "Saturn",
    "uranus": "Uranus",
    "neptun": "Neptun",
}

# Belegte Rotationszeiten in Stunden (Quelle: Wikipedia-Infoboxen,
# Stand 2026-09). Negative Werte = retrograde Rotation. Tolerance 1 %:
# der Seed darf eine praezisere Angabe behalten, aber keinen anderen Wert.
REFERENCE_ROTATION_H = {
    "sonne": 609.0,      # 25,4 Tage am Aequator
    "merkur": 1407.6,    # 58,6 Tage
    "venus": -5832.5,    # retrograd, 243 Tage
    "erde": 23.934,      # siderischer Tag
    "mars": 24.623,
    "jupiter": 9.925,
    "saturn": 10.543,
    "uranus": -17.24,    # retrograd
    "neptun": 16.11,
}

# Relative Toleranz, in der der Seedwert vom Sollwert abweichen darf.
ROTATION_TOLERANCE = 0.01

# Monde, die Wikipedia ohne Durchmesser fuehrt ("?" in der Tabelle). Fuer sie
# waere jede Radiusangabe erfunden, deshalb bekommen sie laut Ticket-Vorgabe
# radiusKm/massKg = 0. Die Szene (src/scene/types.ts) behandelt das ueber
# safeRenderRadius mit einem Minimalradius, der Koerper bleibt also sichtbar.
MOONS_WITHOUT_RADIUS: dict[str, str] = {
    "saturn-s2009s2": "S/2009 S 2",
}

# Farbe fuer neu generierte Monde: ein ruhiger Ton je Planet, damit die
# Kleinmonde in der 3D-Szene nicht wie weisse Punkte verschwinden.
# Schluessel sind die Wikipedia-Dateinamen, nicht die bodies.json-ids.
MOON_COLOR = {
    "mars": "#A89684",
    "jupiter": "#C9A882",
    "saturn": "#D8CBAC",
    "uranus": "#A8C6D0",
    "neptune": "#8C9CD0",
}

# Deutsche Namen im Seed, die auf einen englischen Wikipedia-Namen
# abbilden. Ohne diese Zuordnung wuerde Kallisto als zweiter Jupiter-Mond
# neben Callisto im Ergebnis stehen.
SEED_ID_ALIASES = {
    "kallisto": "callisto",
}

# Umkehrung fuer den Abgleich: Wikipedia-id -> deutsche Seed-id.
WIKI_TO_SEED_ID = {v: k for k, v in SEED_ID_ALIASES.items()}

# Fuer nicht belegte Werte: Vorgabe laut Ticket.
DEFAULT_ECCENTRICITY = 0.0001
DEFAULT_INCLINATION_DEG = 0.0

_ID_SAFE = re.compile(r"[^a-z0-9]+")


def moon_id(name: str, parent: str) -> str:
    """Bildet eine eindeutige, URL-sichere id aus einem Mondnamen.

    Normale Namen werden zu Kleinbuchstaben-Slug (Io -> "io").
    Provisorische Bezeichnungen wie "S/2003 S 1" bekommen den Planeten
    als Prefix: "saturn-s2003s1".

    @param name Name oder Bezeichnung aus Wikipedia.
    @param parent Id des Planeten (ohne "saturn-" Prefix).
    @returns Eindeutige id.
    """
    if re.match(r"^[A-Z]/\d{4}\s+[A-Z]{1,3}\s+\d+$", name):
        slug = _ID_SAFE.sub("", name.lower())
        return f"{parent}-{slug}"
    slug = _ID_SAFE.sub("-", name.lower()).strip("-")
    return slug or f"{parent}-mond"


def rotation_hours_from_period(period_days: float | None) -> float:
    """Rechnet eine Umlaufzeit in Stunden um (Default: 0 wenn unbekannt).

    @param period_days Umlaufzeit in Tagen, negativ bei retrograder Bahn.
    @returns Stundenwert.
    """
    if period_days is None:
        return 0.0
    return round(period_days * 24.0, 4)


def build_moon(moon: dict, parent_id: str, order: int) -> dict:
    """Erzeugt einen bodies.json-Eintrag aus einem Wikipedia-Mond.

    Fehlende Werte werden NICHT erfunden, sondern auf 0 gesetzt und in
    der Ausgabe als "offen" gemeldet.

    @param moon Mond-Dict aus moons_<planet>.json.
    @param parent_id id des Planeten.
    @param order Laufnummer des Planeten (1-8) fuer orderFromSun.
    @returns (bodies.json-Eintrag, Liste offener Felder).
    """
    name = moon["name"]
    # Wikipedia-Sternchen-Kuerzel, z.B. "saturn" statt "neptun": die
    # Bezeichnungen der Kleinmonde folgen dem Sternnamen.
    parent_key = WIKI_TO_BODY_ID[parent_id]
    open_fields: list[str] = []

    radius = moon.get("radiusKm") or 0.0
    mass = moon.get("massKg") or 0.0
    semi_major = moon.get("semiMajorAxisKm") or 0.0
    if not radius:
        open_fields.append("radiusKm")
    if not mass:
        open_fields.append("massKg")
    if not semi_major:
        open_fields.append("semiMajorAxisKm")

    eccentricity = moon.get("eccentricity")
    if eccentricity is None:
        eccentricity = DEFAULT_ECCENTRICITY
        open_fields.append("eccentricity")
    inclination = moon.get("inclinationDeg")
    if inclination is None:
        inclination = DEFAULT_INCLINATION_DEG
        open_fields.append("inclinationDeg")

    # Erdgebundene Rotation: fast alle Monde zeigen ihrem Planeten dieselbe
    # Seite, ihre Rotationsperiode entspricht also der Umlaufzeit.
    rotation = moon.get("orbitalPeriodDays")
    if rotation is None:
        rotation_h = 0.0
        open_fields.append("rotationPeriodH")
    else:
        rotation_h = rotation_hours_from_period(rotation)

    discovery = ""
    year = moon.get("discoveryYear")
    if year:
        who = moon.get("discoverer")
        discovery = f"{int(year)}" + (f", {who}" if who else "")
    else:
        open_fields.append("discovery")

    entry = {
        "id": moon_id(name, parent_key),
        "name": name,
        "nameLatin": name,
        "type": "moon",
        "parent": parent_id,
        "radiusKm": radius,
        "massKg": mass,
        "semiMajorAxisKm": semi_major,
        "eccentricity": round(eccentricity, 6),
        "inclinationDeg": round(inclination, 4),
        "rotationPeriodH": rotation_h,
        "axialTiltDeg": 0,
        "surfaceTempC": {"min": 0, "mean": 0, "max": 0},
        "gravityMs2": 0,
        "atmosphere": "",
        "moonsCount": 0,
        "color": MOON_COLOR[parent_key],
        "discovery": discovery,
        "orderFromSun": order,
    }
    return entry, open_fields


def main() -> int:
    """Baut bodies.json und gibt eine Zusammenfassung aus.

    @returns Exit-Code 0 bei Erfolg, 1 bei Datenproblemen.
    """
    seed = json.loads(SEED.read_text(encoding="utf-8"))["bodies"]
    facts = json.loads(FACTS.read_text(encoding="utf-8"))["bodies"]

    bodies: list[dict] = []
    seen: set[str] = set()
    for entry in seed:
        if entry["id"] in seen:
            print(f"FEHLER: doppelte id im Seed: {entry['id']}", file=sys.stderr)
            return 1
        seen.add(entry["id"])
        bodies.append(dict(entry))

    order_of = {b["id"]: b["orderFromSun"] for b in bodies}
    wiki_ids: dict[str, set[str]] = {key: set() for key in MOON_FILES}
    open_report: list[tuple[str, list[str]]] = []
    no_radius: list[str] = []

    for key in MOON_FILES:
        path = DATA / f"moons_{key}.json"
        if not path.exists():
            print(f"FEHLER: {path.name} fehlt - erst tools/fetch_moons.py --all",
                  file=sys.stderr)
            return 1
        parent_id = PLANET_IDS[key]
        moons = json.loads(path.read_text(encoding="utf-8"))["moons"]
        for moon in moons:
            entry, open_fields = build_moon(moon, parent_id, order_of[parent_id])
            if entry["id"] in MOONS_WITHOUT_RADIUS:
                # Ohne Durchmesser: radiusKm/massKg bleiben 0 (nicht erfunden).
                # Der Koerper wird trotzdem gefuehrt, die Szene gibt ihm einen
                # Minimalradius. Er zaehlt also als Mond.
                no_radius.append(MOONS_WITHOUT_RADIUS[entry["id"]])
            if entry["id"] in seen or WIKI_TO_SEED_ID.get(entry["id"]) in seen:
                # Bereits im Seed (z.B. Io) -> Handdaten gewinnen.
                continue
            if entry["id"] in wiki_ids[key]:
                print(f"FEHLER: Mond-id doppelt: {entry['id']} "
                      f"({moon['name']} von {key})", file=sys.stderr)
                return 1
            wiki_ids[key].add(entry["id"])
            if open_fields:
                open_report.append((entry["id"], open_fields))
            seen.add(entry["id"])
            bodies.append(entry)
        print(f"{key:8} {len(moons):4} Monde aus Wikipedia")

    # moonsCount = tatsaechliche Anzahl der Monde im Ergebnis. Der Erdmond
    # und Phobos/Deimos/Io/... liegen nur im Seed, sie zaehlen mit.
    for body in bodies:
        if body["type"] == "planet":
            body["moonsCount"] = sum(
                1 for b in bodies
                if b["type"] == "moon" and b["parent"] == body["id"]
            )
        if body["type"] == "moon":
            continue
        reference = REFERENCE_ROTATION_H.get(body["id"])
        if reference is None:
            continue
        current = body["rotationPeriodH"]
        if abs(current - reference) > abs(reference) * ROTATION_TOLERANCE:
            print(f"Rotation korrigiert: {body['name']:10} "
                  f"{current} h -> {reference} h")
            body["rotationPeriodH"] = reference

    # facts.json gehoert einem anderen Ticket (Kindtexte). Dieses Skript
    # prueft nur die Vollstaendigkeit und schreibt es NICHT.
    missing_facts = [b["id"] for b in bodies if b["id"] not in facts]
    if missing_facts:
        print(f"HINWEIS: {len(missing_facts)} Koerper ohne facts.json-Eintrag, "
              f"z.B. {', '.join(missing_facts[:5])}", file=sys.stderr)

    TARGET.write_text(
        json.dumps({"bodies": bodies}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    total_moons = sum(1 for b in bodies if b["type"] == "moon")
    print(f"\nKoerper gesamt: {len(bodies)} (davon {total_moons} Monde)")
    for body in bodies:
        if body["type"] == "planet":
            print(f"  {body['name']:10} {body['moonsCount']:4} Monde")
    if open_report:
        print(f"\noffene Felder (auf 0 gesetzt): {len(open_report)} Koerper")
        for body_id, fields in open_report[:10]:
            print(f"  {body_id}: {', '.join(fields)}")
    if no_radius:
        print("\nohne belegbaren Durchmesser (Radius/Masse = 0, in der Szene "
              "mit Minimalradius dargestellt):")
        for name in no_radius:
            print(f"  {name}")
    print(f"\ngeschrieben: {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
