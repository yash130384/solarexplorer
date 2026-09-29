#!/usr/bin/env python3
"""Holt die Mond-Daten aus den englischen Wikipedia-Listenartikeln.

Warum ein eigener Parser (statt des generischen Tabellenlesers in
fetch_astronomy.py): die Mondeartikel nutzen stark strukturierte
wikitable-Zeilen mit {{val}}, {{dsv}}, {{sort}}, {{convert}} und
{{e}} - Templates. Ein Zeilen-Split auf "||" liefert dort nur
unbrauchbare Fragmente.

Aufruf:
    python3 tools/fetch_moons.py --planet Jupiter
    python3 tools/fetch_moons.py --all

Schreibt: src/data/moons_<planet>.json
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "SolarExplorer/1.0 (educational 3D solar system; contact: local)"
WIKI_RAW = "https://en.wikipedia.org/w/index.php?title={title}&action=raw"
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "wiki"
TIMEOUT = 30

# planet -> Wikipedia-Artikel
PAGES = {
    "Jupiter": "Moons of Jupiter",
    "Saturn": "Moons of Saturn",
    "Uranus": "Moons of Uranus",
    "Neptune": "Moons of Neptune",
    "Mars": "Moons of Mars",
}

# Untergrenze je Spaltenname. Der Header wird normalisiert (lower, ohne
# Wikilinks/Refn) und dann auf diese Schluessel geprueft.
COLUMN_KEYS: list[tuple[str, tuple[str, ...]]] = [
    ("name", ("name",)),
    ("diameterKm", ("diameter", "radius")),
    ("mass", ("mass",)),
    ("semiMajorAxisKm", ("semi-major axis", "semimajor", "orbital radius")),
    ("orbitalPeriod", ("orbital period", "period")),
    ("inclination", ("inclination",)),
    ("eccentricity", ("eccentricity",)),
    ("discoveryYear", ("discovery",)),
    ("discoverer", ("discoverer",)),
]


def _fetch(title: str) -> str:
    """Holt den Artikel-Wikitext, mit Datei-Cache zur Wiederholbarkeit.

    @param title Wikipedia-Titel mit Unterstrichen.
    @returns Wikitext.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / (title.replace(" ", "_") + ".txt")
    if cache.exists():
        return cache.read_text(encoding="utf-8")
    url = WIKI_RAW.format(title=urllib.parse.quote(title.replace(" ", "_")))
    last: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            cache.write_text(text, encoding="utf-8")
            return text
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Abruf fehlgeschlagen: {url}") from last


def _strip_refs(text: str) -> str:
    """Entfernt <ref>, <refn> und deren Inhalt.

    @param text Wikitext-Fragment.
    @returns Fragment ohne Verweise.
    """
    text = re.sub(r"<ref[^>]*?/>", "", text)
    text = re.sub(r"<refn[^>]*?/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<refn[^>]*>.*?</refn>", "", text, flags=re.S)
    return text


def _flatten_templates(text: str) -> str:
    """Ersetzt Zahl-Templates durch ihren Wert.

    {{val|43.0|4.0}} -> 43.0, {{convert|9,377|km|mi}} -> 9,377,
    {{dsv|62}}|62 -> 62, {{sort|0.47|+0.47}} -> 0.47, 1.07{{e|16}} -> 1.07e16.

    @param text Wikitext-Fragment.
    @returns Fragment mit ausgewerteten Zahlen.
    """
    text = re.sub(r"\{\{\s*val\s*\|([^|}]+)(?:\|[^|}]*)*\|?\s*\}\}", r"\1", text)
    text = re.sub(r"\{\{\s*convert\s*\|([^|}]+)(?:\|[^|}]*)*\|?\s*\}\}", r"\1", text)
    text = re.sub(r"\{\{\s*sort\s*\|([^|}]+)(?:\|[^|}]*)*\|?\s*\}\}", r"\1", text)
    text = re.sub(r"\{\{\s*dsv\s*\|([^|}]+)(?:\|[^|}]*)*\|?\s*\}\}", r"\1", text)
    text = re.sub(r"\{\{\s*e\s*\|\s*(\d+)\s*\}\}", r"e\1", text)
    text = re.sub(r"\{\{\s*nowrap\s*\|(.*?)\}\}", r"\1", text, flags=re.S)
    # {{shy|Dia|meter}} -> "Diameter": shy trennt nur die Darstellung.
    text = re.sub(r"\{\{\s*shy\s*\|((?:[^{}|]*\|)*[^{}|]*)\}\}",
                  lambda m: re.sub(r"\|", "", m.group(1)), text)
    for _ in range(6):
        new = re.sub(r"\{\{[^{}]*\}\}", "", text)
        if new == text:
            break
        text = new
    return text


def _clean(raw: str) -> str:
    """Normalisiert eine Tabellenzelle zu lesbarem Text.

    @param raw Rohe Zelle.
    @returns Bereinigter Text (kann leer sein).
    """
    text = _strip_refs(raw).lstrip("|!").strip()
    text = _flatten_templates(text)
    text = re.sub(r"^(?:[a-zA-Z-]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^|\s]*)\s*\|)+", "", text)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"</?(?:br|small|sup|sub|span|supp|Abbr|abbr)[^>]*>", " ", text)
    text = text.replace("'''", "").replace("''", "")
    text = text.replace("\u2212", "-").replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"&thinsp;|&nbsp;|&#160;", " ", text)
    text = re.sub(r"&[a-z]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _number(raw: str | None) -> float | None:
    """Erste Zahl eines bereinigten Textes, scientific notation erlaubt.

    @param raw Bereinigter Text.
    @returns Zahl oder None.
    """
    if not raw:
        return None
    text = raw.replace(" ", "").replace("−", "-")
    # "9,377" ist in Wikipedia-Mondtabellen ein Tausenderpunkt (km),
    # kein Dezimalkomma. Die 3-Stellen-Regel trennt die Faelle sauber.
    m = re.search(r"[-+]?\d{1,3}(?:,\d{3})+(?!\d)", text)
    if m:
        try:
            return float(m.group(0).replace(",", ""))
        except ValueError:
            return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "."))
    except ValueError:
        return None


def _mass_factor(header: str) -> float:
    """Ermittelt den Massen-Skalierungsfaktor aus der Header-Zelle.

    Faelle aus den aktuellen Artikeln:
      "Mass(× 10 15 kg)"  (Jupiter)  -> 1e15
      "Mass (e15 kg)"     (Saturn)  -> 1e15
      "Mass (× 10 16 kg)" (Uranus)  -> 1e16
      "Mass (×10 Eg)"     (Neptun)  -> 1e16   (10 Exagramm)
      "Mass"              (Mars)    -> 1      (Einheit steht in Folgezeile)

    @param header Bereinigter Header-Text der Massenspalte.
    @returns Faktor in kg.
    """
    text = header.replace("\u00a0", " ")
    low = text.lower()
    # Einheitenfaktor: Eg = Exagramm = 1e18 g = 1e15 kg.
    if re.search(r"(?<![a-z])eg(?![a-z])", low):
        unit = 1e15
    elif re.search(r"(?<![a-z])mg(?![a-z])", low):
        unit = 1e-3
    elif re.search(r"(?<![a-z])g(?![a-z])", low) and "kg" not in low:
        unit = 1e3
    else:
        unit = 1.0
    # Exponent: "10 15", "10^15", "e15" oder ein nacktes "×10" (= 10^1).
    exp = re.search(r"10\s*(?:\^|<sup>)?\s*(\d+)", low) or re.search(r"(?<![a-z0-9])e\s*(\d+)(?![a-z0-9])", low)
    if exp:
        exponent = int(exp.group(1))
    else:
        exponent = 1 if re.search(r"(?:×|x)\s*10\b", low) else 0
    return unit * (10.0 ** exponent)


def _tables(text: str) -> list[list[str]]:
    """Schneidet alle wikitable-Bloecke aus dem Wikitext.

    @param text Artikel-Wikitext.
    @returns Liste von Zeilenlisten (jede Zeile = Liste von Zellen).
    """
    tables: list[list[str]] = []
    current: list[str] | None = None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("{|"):
            current = []
            continue
        if s.startswith("|}"):
            if current:
                tables.append(current)
            current = None
            continue
        if current is None:
            continue
        if s.startswith("|-") or s.startswith("||-"):
            # "||- style=..." ist in den grossen Tabellen die Zeilengrenze.
            current.append("\x00ROW")
        elif s.startswith("!") or s.startswith("|"):
            current.append(s)
    return tables


def _cells(line: str) -> list[str]:
    """Zerlegt eine Wikitext-Zeile in Zellen.

    Beruecksichtigt, dass Zellen auch ueber mehrere Zeilen umbrechen
    duerfen (Mars-Tabelle) und Attribute wie 'style="..."|' vorangestellt
    sein koennen.

    @param line Eine Zeile, die mit '|' oder '!' beginnt.
    @returns Liste von Zellen.
    """
    body = line.lstrip("|!")
    body = re.sub(r"^(?:[a-zA-Z-]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^|\s]*)\s*\|)+", "", body)
    inline = "||" in body
    if not inline:
        # Eine Zeile pro Zelle (Mars/Jupiter-Stil): auch leere Zellen
        # sind echte Zellen und duerfen nicht wegfallen.
        return [body]
    parts = re.split(r"\|\|", body)
    while parts and parts[-1].strip() == "":
        parts.pop()
    while parts and parts[0].strip() == "":
        parts.pop(0)
    return parts


def _rows(lines: list[str]) -> list[list[str]]:
    """Gruppiert Zeilen zu Tabellenzeilen.

    @param lines Flache Liste aus _tables.
    @returns Liste von Zeilen (Listen von Zellen).
    """
    rows: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if line == "\x00ROW":
            if current:
                rows.append(current)
            current = []
            continue
        current.extend(_cells(line))
    if current:
        rows.append(current)
    return rows


def _expand_colspans(header: list[str]) -> list[str]:
    """Rechnet colspan-Headerzellen zu echten Spalten auf.

    Die Mars-Tabelle nutzt 'colspan=2|Name and pronunciation', dadurch
    waeren alle folgenden Spalten um eins verschoben.

    @param header Rohe Header-Zellen.
    @returns Header-Zellen mit gleicher Breite wie die Datenzeilen.
    """
    out: list[str] = []
    for cell in header:
        m = re.match(r"\s*colspan\s*=\s*\"?(\d+)\"?\s*\|(.*)", cell, re.S)
        if m:
            out.extend([m.group(2)] * int(m.group(1)))
        else:
            out.append(cell)
    return out


def _header_index(header: list[str]) -> dict[str, int]:
    """Ordnet die gewuenschten Felder den Header-Spalten zu.

    @param header Bereinigte Header-Zellen.
    @returns Mapping Feld -> Spaltenindex.
    """
    norm = [h.lower() for h in header]
    found: dict[str, int] = {}
    for key, needles in COLUMN_KEYS:
        for needle in needles:
            for i, h in enumerate(norm):
                if needle in h:
                    found.setdefault(key, i)
                    break
            if key in found:
                break
    return found


def _moon_name(raw: str) -> str | None:
    """Extrahiert den Mondnamen aus der Namenszelle.

    @param raw Rohe Namenszelle (wikilink, evtl. mit 'hid'-Template).
    @returns Name oder None.
    """
    text = _strip_refs(raw)
    # {{hid|Pan}} wird entfernt, der eigentliche Link bleibt.
    text = re.sub(r"\{\{\s*hid\s*\|[^|}]*\}\}", "", text)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    m = re.findall(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", text)
    name = _clean(m[-1]) if m else _clean(text)
    name = name.strip("* ")
    if not name or name in {"—", "-", "?"}:
        return None
    if name.lower().startswith("file:"):
        return None
    return name


def _designation(name: str) -> str:
    """Erkennt provisorische Bezeichnungen wie S/2003 S 1.

    @param name Mondname.
    @returns Ob die Bezeichnung dem Muster S/2003 S 1 entspricht.
    """
    return bool(re.match(r"^[A-Z]/\d{4}\s+[A-Z]{1,3}\s+\d+$", name))


def parse_moons(planet: str) -> list[dict]:
    """Parst die Mondtabelle eines Planeten.

    @param planet Englischer Planetname.
    @returns Liste von Mond-Dicts.
    """
    title = PAGES[planet]
    text = _fetch(title)
    # (Spaltenindex, Zeilen, Headerzellen, Position des Headers)
    best: tuple[dict[str, int], list[list[str]], list[str], int] | None = None
    for table in _tables(text):
        rows = _rows(table)
        if len(rows) < 3:
            continue
        for pos, row in enumerate(rows):
            header = [_clean(c) for c in _expand_colspans(row)]
            low = [h.lower() for h in header]
            if not any(h.startswith("name") for h in low):
                continue
            if not any(("diameter" in h or "radius" in h) for h in low):
                continue
            idx = _header_index(header)
            if "name" not in idx or "diameterKm" not in idx:
                continue
            if best is None or len(rows) > len(best[1]):
                best = (idx, rows, header, pos)
            break
    if best is None:
        return []
    idx, rows, header, header_pos = best
    mass_header = header[idx["mass"]] if "mass" in idx and idx["mass"] < len(header) else ""
    mass_scale = _mass_factor(mass_header)

    moons: list[dict] = []
    width = max(idx.values()) + 1
    for pos, row in enumerate(rows):
        if pos == header_pos:
            continue  # Kopfzeile ist kein Mond
        if len(row) < width:
            # Kopfzeilen-Splitter (Mars) und Bild-/Bildunterschriftzeilen
            # koennen kuerzer sein; die sind keine Monde.
            continue
        cells = [_clean(c) for c in row]

        def cell(key: str) -> str:
            i = idx.get(key, -1)
            return cells[i] if 0 <= i < len(cells) else ""

        name = _moon_name(row[idx["name"]])
        if not name:
            continue
        diameter = _number(cell("diameterKm"))
        mass_raw = _number(cell("mass"))
        semi_major = _number(cell("semiMajorAxisKm"))
        period = _number(cell("orbitalPeriod"))
        moons.append({
            "name": name,
            "designation": _designation(name),
            "parent": planet.lower(),
            "radiusKm": round(diameter / 2.0, 4) if diameter and diameter > 0 else None,
            "diameterKm": diameter,
            "massKg": mass_raw * mass_scale if mass_raw is not None else None,
            "semiMajorAxisKm": semi_major if semi_major and semi_major > 0 else None,
            "orbitalPeriodDays": period,
            "inclinationDeg": _number(cell("inclination")),
            "eccentricity": _number(cell("eccentricity")),
            "discoveryYear": _number(cell("discoveryYear")),
            "discoverer": cell("discoverer") or None,
            "sourceUrl": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
        })
    return moons


def main() -> int:
    """CLI-Einstieg.

    @returns Exit-Code 0 bei Erfolg.
    """
    ap = argparse.ArgumentParser(description="Monde aus Wikipedia holen")
    ap.add_argument("--planet", help="Planet, z.B. Jupiter")
    ap.add_argument("--all", action="store_true", help="alle Planeten mit Monden")
    args = ap.parse_args()

    planets = list(PAGES) if args.all else ([args.planet] if args.planet else [])
    if not planets:
        ap.error("--planet oder --all angeben")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for planet in planets:
        moons = parse_moons(planet)
        target = OUT_DIR / f"moons_{planet.lower()}.json"
        target.write_text(
            json.dumps({"parent": planet.lower(), "moons": moons}, indent=2,
                       ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        with_radius = sum(1 for m in moons if m["radiusKm"])
        with_axis = sum(1 for m in moons if m["semiMajorAxisKm"])
        with_mass = sum(1 for m in moons if m["massKg"])
        print(f"{planet:8} {len(moons):4} Monde -> {target.name} "
              f"(r={with_radius} a={with_axis} m={with_mass})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
