#!/usr/bin/env python3
"""Holt astronomische Basisdaten aus Wikipedia/Wikidata fuer SolarExplorer.

Warum ein Skript statt Handarbeit:
- 454 bestaetigte Monde lassen sich nicht verlaesslich von Hand eintippen
- Felder aendern sich (Jupiter hatte 2024 noch 95 Monde, 2026 schon 115)
- jede Zahl soll nachpruefbar sein: das Skript speichert die Quelle mit

Quellen (bewusst zwei, sich ergaenzend):
- Wikipedia-Wikitext ueber ?action=raw  -> Infobox-Werte wie satellites,
  rotation_period, mean_radius, axial_tilt
- Wikidata (SPARQL)                       -> strukturierte Masse, Radius,
  Entdeckung fuer einzelne Monde

Aufruf:
    python3 tools/fetch_astronomy.py                 # Standard: Sonne+Planeten
    python3 tools/fetch_astronomy.py --moons Jupiter # Monde eines Planeten
    python3 tools/fetch_astronomy.py --verify        # nur pruefen, nichts schreiben

WICHTIG: Das Skript ist read-only gegenueber dem Repo, es schreibt nur nach
src/data/, und es braucht keine API-Schluessel.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "SolarExplorer/1.0 (educational 3D solar system; contact: local)"
WIKI_RAW = "https://en.wikipedia.org/w/index.php?title={title}&action=raw"
WDQS = "https://query.wikidata.org/sparql"
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
TIMEOUT = 30

# Die acht Planeten plus Sonne. Reihenfolge = distance from the Sun.
PLANETS = [
    ("Sun", "Sun"),
    ("Mercury", "Mercury"),
    ("Venus", "Venus"),
    ("Earth", "Earth"),
    ("Mars", "Mars"),
    ("Jupiter", "Jupiter"),
    ("Saturn", "Saturn"),
    ("Uranus", "Uranus"),
    ("Neptune", "Neptune"),
]


def _fetch(url: str, retries: int = 3) -> str:
    """Holt eine URL mit Backoff. Wirft bei endgueltigem Fehler.

    @param url Ziel-URL.
    @param retries Anzahl Wiederholungen bei Netzfehlern.
    @returns Der Antworttext.
    """
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
            # Backoff: 1s, 2s, 4s. Wikipedia drosselt aggressive Clients.
            time.sleep(2**attempt)
    raise RuntimeError(f"Abruf fehlgeschlagen: {url}") from last


def _clean_field(raw: str) -> str | None:
    """Normalisiert einen Wikitext-Infobox-Wert.

    Entfernt {{val|...}}, <ref>, Verweise und Einheiten-Marker, damit eine
    reine Zahl bzw. ein kurzer Text uebrig bleibt. Gibt None zurueck, wenn
    kein sinnvoller Wert erkennbar ist — das ist wichtig, weil ein still
    falscher Wert schlimmer ist als ein fehlender.

    @param raw Roher Wikitext-Fragment.
    @returns Bereinigter Wert oder None.
    """
    if not raw:
        return None
    text = raw
    # Verweise zuerst entfernen, danach Templates. Die Reihenfolge ist
    # wichtig: ein <ref> kann selbst Pipes enthalten, die sonst wie
    # Template-Argumente aussehen.
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    # {{val|58232|6|u=km}} -> 58232 : erstes Argument, Einheiten-Anhaenge weg.
    # {{val|5.97217|0.00028|e=24|u=kg}} -> "5.97217e=24" : der Exponent
    # "{{val|E|M|e=N|u=kg}}" ist die wissenschaftliche Schreibweise und MUSS
    # erhalten bleiben, sonst wird aus 5,97e24 kg die Zahl 5,97.
    text = re.sub(r"\{\{\s*val\s*\|([^|}]+)\|[^|}]*\|e\s*=\s*([^|}]+)(?:\|[^}]*)?\}\}",
                  r"\1e\2", text)
    # Einfaches {{val|58232|6|u=km}} -> 58232
    text = re.sub(r"\{\{\s*val\s*\|([^|}]+)(?:\|[^}]*)?\}\}", r"\1", text)
    text = re.sub(r"\{\{\s*nowrap\s*\|\s*(.+?)\}\}", r"\1", text, flags=re.S)
    text = re.sub(r"\{\{\s*fmt\s*=\s*commas\s*\|\s*([^|}]+)(?:\|[^}]*)?\}\}", r"\1", text)
    # Restliche Templates mehrfach aufloesen, innermost zuerst.
    for _ in range(4):
        new = re.sub(r"\{\{[^{}]*\}\}", "", text)
        if new == text:
            break
        text = new
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = text.replace("'''", "").replace("''", "").strip()
    text = re.sub(r"\s+", " ", text)
    if not text or text in {"?", "-", "–", "None", "None1"}:
        return None
    return text


def _field_block(wikitext: str, name: str) -> str | None:
    """Liest ein Infobox-Feld inkl. mehrzeiliger Werte.

    Wikipedia-Infoboxen brechen Werte ueber Zeilen um, vor allem bei
    {{plainlist |}} und {{val|...}}-Templates. Ein Regex auf eine einzige
    Zeile liefert dann nur die Template-Oeffnung und keine Zahl — daher wird
    hier bis zur naechsten Zeile, die mit "| " beginnt, gelesen.

    @param wikitext Ganzer Artikel-Wikitext.
    @param name Feldname ohne fuehrendes "| ".
    @returns Rohwert (kann mehrzeilig sein) oder None.
    """
    # Feld darf erst am Zeilenanfang stehen, sonst matcht es verschachtelte
    # Felder in plainlist-Tabellen.
    m = re.search(rf"^\|\s*{re.escape(name)}\s*=\s*(.*)$", wikitext, re.M)
    if not m:
        return None
    first = m.group(1)
    rest_start = m.end()
    lines = [first]
    pos = rest_start
    while pos < len(wikitext):
        nl = wikitext.find("\n", pos)
        if nl == -1:
            break
        line = wikitext[nl + 1:]
        if line.startswith("|"):
            # Ein neues Feld beginnt mit "| name =". Alles andere (z.B. "|}}"
            # als plainlist-Abschluss) gehoert noch zum aktuellen Feld.
            if re.match(r"^\|\s*[a-z_0-9]{3,30}\s*=", line):
                break
            if re.match(r"^\|\s*\}\}", line):  # plainlist beendet
                break
        lines.append(line)
        pos = nl + 1 + len(line)
    return "\n".join(lines)


def _first_value(raw: str | None) -> str | None:
    """Extrahiert den eigentlichen Wert aus einem Feldblock.

    Grundregel: der Wert steht in der ERSTEN Zeile. Alles danach ist fast
    immer Kontext ("<br/>9.1402 Earths", Folgefelder, plainlist-Fortsetzung).
    Deshalb wird bewusst nicht ueber Zeilen gesucht — genau das hat frueher
    "58232" mit dem Rotationsfeld "10" verwechselt.

    Sonderfall plainlist: dort ist die erste Zeile nur "{{plainlist |", die
    erste *Listenzeile* die nutzbare. Deshalb wird sie nur dann herangezogen,
    wenn die erste Zeile keine Zahl enthaelt.

    @param raw Rohwert aus _field_block.
    @returns Bereinigter Wert oder None.
    """
    if not raw:
        return None
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return None

    first = _clean_field(lines[0].strip().lstrip("*").strip())
    if first and re.search(r"\d", first):
        return first

    # plainlist: erste Listenzeile mit einer Zahl verwenden.
    for line in lines[1:]:
        cleaned = _clean_field(line.strip().lstrip("*").strip())
        if cleaned and re.search(r"\d", cleaned):
            return cleaned
    return None


def _number(raw: str | None) -> float | None:
    """Extrahiert die erste Zahl aus einem bereinigten Wert.

    @param raw Bereinigter Text.
    @returns Zahl als float, oder None wenn keine enthalten ist.
    """
    if not raw:
        return None
    # Wissenschaftliche Schreibweise aus Wikipedia: "5.97217e=24".
    em = re.search(r"([\d.]+)\s*e\s*=\s*([+-]?\d+)", raw)
    if em:
        try:
            return float(em.group(1)) * (10 ** int(em.group(2)))
        except ValueError:
            return None
    m = re.search(r"-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?", raw.replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "."))
    except ValueError:
        return None


def _satellite_count(wikitext: str) -> int | None:
    """Liest die Zahl der bestaetigten Monde aus dem satellites-Feld.

    @param wikitext Rohes Wikitext der Planeten-Seite.
    @returns Anzahl Monde, oder None wenn nicht angegeben.
    """
    m = re.search(r"\|\s*satellites\s*=\s*([^\n]+)", wikitext)
    if not m:
        return None
    # "293 with formal designations" oder "[[moons of Saturn|293]]"
    m2 = re.search(r"(\d[\d.]*)", _clean_field(m.group(1)) or "")
    return int(float(m2.group(1))) if m2 else None


def fetch_planet(title: str) -> dict:
    """Holt die Basiswerte eines Planeten aus der englischen Wikipedia.

    @param title Englischer Wikipedia-Titel.
    @returns Dict mit den Feldern, die gefunden wurden, plus 'missing'.
    """
    text = _fetch(WIKI_RAW.format(title=title))

    def field(*names: str) -> str | None:
        """Erstes vorhandenes Feld aus einer Kandidatenliste nehmen."""
        for n in names:
            val = _first_value(_field_block(text, n))
            if val:
                return val
        return None

    result: dict = {
        "wikipediaTitle": title,
        "satellites": _satellite_count(text),
        "meanRadiusKm": _number(field("mean_radius")),
        "axialTiltDeg": _number(field("axial_tilt")),
        "sourceUrl": f"https://en.wikipedia.org/wiki/{title}",
    }

    # Groesse und Masse stehen bei manchen Planeten in komplexen Templates.
    m = re.search(r"^\|\s*mass\s*=\s*(.*)$", text, re.M)
    mass_raw = _first_value(m.group(1)) if m else None
    if mass_raw:
        em = re.search(r"([\d.]+)\s*e\s*([+-]?\d+)", mass_raw)
        if em:
            try:
                result["massKg"] = float(em.group(1)) * (10 ** int(em.group(2)))
            except ValueError:
                result["massKg"] = _number(mass_raw)
        else:
            result["massKg"] = _number(mass_raw)

    # Rotation: Feld heisst je nach Planet "rotation" oder "rotational_period",
    # Wert kann "10 h 32 m 36 s", "9.925 h" oder "-243.02 d" sein.
    rot = field("rotation", "rotational_period", "sidereal_period")
    if rot:
        retro = bool(re.search(r"retrograde|retrograd", _field_block(text, "rotation") or ""))
        days = re.search(r"([\d.]+)\s*d\b", rot)
        hours = re.search(r"([\d.]+)\s*h\b", rot)
        secs = re.search(r"([\d.]+)\s*s\b", rot)
        mins = re.search(r"(\d+)\s*m\b", rot)
        if days:
            result["rotationHours"] = float(days.group(1)) * 24
        elif hours:
            result["rotationHours"] = float(hours.group(1))
        elif secs:
            result["rotationHours"] = float(secs.group(1)) / 3600
        if mins and hours:
            result["rotationHours"] = float(hours.group(1)) + int(mins.group(1)) / 60
        # "10 h 32 m 36 s" -> Sekundenanteil beruecksichtigen
        if secs and hours:
            result["rotationHours"] = float(hours.group(1)) + int(mins.group(1) if mins else 0) / 60 \
                                      + float(secs.group(1)) / 3600
        if result.get("rotationHours") is not None:
            result["rotationRetrograde"] = retro

    # Umlaufbahn
    a = field("semimajor_axis", "semimajor")
    if a:
        em = re.search(r"([\d.]+)\s*e\s*([+-]?\d+)", a)
        result["semiMajorAxisKm"] = (
            float(em.group(1)) * (10 ** int(em.group(2))) if em else _number(a)
        )
    result["eccentricity"] = _number(field("eccentricity"))
    result["inclinationDeg"] = _number(field("inclination"))
    result["periodDays"] = _number(field("orbital_period", "period"))

    result["missing"] = [
        k for k in ("meanRadiusKm", "massKg", "semiMajorAxisKm", "eccentricity",
                    "rotationHours", "inclinationDeg")
        if result.get(k) is None
    ]
    return result


def fetch_moons(planet: str) -> list[dict]:
    """Holt die Monde eines Planeten ueber die Wikipedia-Mondexliste.

    Nuetzt die Listenartikel ("Moons of Jupiter"), weil dort je Mond eine
    Tabelle mit Radius und Umlaufzeit steht. Robust gegen fehlende Seiten.

    @param planet Englischer Planetname.
    @returns Liste von Mond-Dicts.
    """
    pages = {
        "Jupiter": "List of moons of Jupiter",
        "Saturn": "Moons of Saturn",
        "Uranus": "Moons of Uranus",
        "Neptune": "Moons of Neptune",
        "Mars": "Moons of Mars",
        "Pluto": "Moons of Pluto",
    }
    title = pages.get(planet)
    if not title:
        return []
    try:
        text = _fetch(WIKI_RAW.format(title=urllib.parse.quote(title.replace(" ", "_"))))
    except RuntimeError as exc:
        print(f"  ! {planet}: {exc}", file=sys.stderr)
        return []

    moons: list[dict] = []
    # Tabellenzeilen: | Name || Radius || ... — robust genug fuer die
    # Struktur der englischen Mondeartikel.
    for line in text.splitlines():
        if not line.startswith("|") or line.startswith("!") or line.startswith("|-"):
            continue
        cells = [c.strip() for c in line.strip("|").split("||")]
        if len(cells) < 2:
            continue
        name = _clean_field(cells[0]) or ""
        if not name or name.startswith("~") or "{{" in name:
            continue
        radius = None
        for cell in cells[1:]:
            km = re.search(r"([\d.]+)\s*km", cell)
            if km:
                radius = float(km.group(1))
                break
        if radius is None:
            continue
        moons.append({
            "name": name,
            "radiusKm": radius,
            "parent": planet.lower(),
            "sourceUrl": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}",
        })
    return moons


def main() -> int:
    """CLI-Einstieg.

    @returns Exit-Code 0 bei Erfolg, 1 bei Datenluecken.
    """
    ap = argparse.ArgumentParser(description="Astronomie-Daten aus Wikipedia")
    ap.add_argument("--moons", help="Monde eines Planeten holen (z.B. Jupiter)")
    ap.add_argument("--verify", action="store_true", help="nur pruefen, nicht schreiben")
    ap.add_argument("--out", default=str(OUT_DIR), help="Zielverzeichnis")
    args = ap.parse_args()

    out_dir = Path(args.out)

    if args.moons:
        moons = fetch_moons(args.moons)
        print(f"{args.moons}: {len(moons)} Monde mit Radius gefunden")
        for m in moons[:5]:
            print(f"   {m['name']:24} {m['radiusKm']} km")
        if moons and not args.verify:
            (out_dir / f"moons_{args.moons.lower()}.json").write_text(
                json.dumps({"parent": args.moons.lower(), "moons": moons}, indent=2),
                encoding="utf-8",
            )
        return 0

    print("Hole Planetenbasisdaten aus Wikipedia ...")
    planets = []
    for _, title in PLANETS:
        try:
            data = fetch_planet(title)
            planets.append(data)
            flag = "!" if data["missing"] else " "
            print(f" {flag} {title:9} r={data.get('meanRadiusKm')} "
                  f"m={data.get('massKg')} a={data.get('semiMajorAxisKm')} "
                  f"monde={data.get('satellites')}")
            if data["missing"]:
                print(f"     fehlt: {', '.join(data['missing'])}")
            time.sleep(0.4)  # Wikipedia nicht ueberfahren
        except RuntimeError as exc:
            print(f" ! {title}: {exc}", file=sys.stderr)

    if args.verify:
        print(f"\n--verify: {len(planets)} Planeten geprueft, nichts geschrieben.")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "wikipedia_planets.json"
    target.write_text(
        json.dumps(
            {
                "_meta": {
                    "source": "Wikipedia (en) via action=raw",
                    "note": "Rohtreffer inkl. Quell-URL. Werte mit 'missing' "
                            "muessen von Hand aus bodies.json uebernommen werden.",
                    "generator": "tools/fetch_astronomy.py",
                },
                "planets": planets,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\ngeschrieben: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
