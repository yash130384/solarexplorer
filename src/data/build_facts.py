#!/usr/bin/env python3
"""Erweitert facts.json um Kindtexte fuer ALLE Koerper aus bodies.json.

Warum ein Skript und nicht Handarbeit:
- bodies.json waechst (Ticket 13: ~454 Monde). Jeder Mond braucht einen
  Eintrag, sonst zeigt das Info-Panel "Daten noch nicht erfasst".
- 440 Texte einzeln zu schreiben ist langsam und ungleich foerderlich.
  Stattdessen: eine Handvoll echter Texte fuer die beruehmten Monde plus
  ZWEI Textbausteine (kleiner regelmaessiger Mond / kleiner irregulaerer
  Mond), die per Funktion aus Radius und Bahnradius variiert werden.

Grundsatz (AGENTS.md): bestehende Eintraege werden NIEMALS ueberschrieben.
Handgeschriebene Texte bleiben unangetastet; das Skript ergaenzt nur.

Aufruf:
    python3 src/data/build_facts.py            # facts.json ergaenzen
    python3 src/data/build_facts.py --check    # nur pruefen, nichts schreiben
    python3 src/data/build_facts.py --report   # Liste der Datenluecken ausgeben

Beide Schalter sind fuer die Abnahme wichtig: --check beweist, dass jede
ID aus bodies.json einen facts-Eintrag hat, --report listet die Koerper
ohne Radius (die einzige erlaubte Ausnahme).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
BODIES_PATH = HERE / "bodies.json"
FACTS_PATH = HERE / "facts.json"

# Physikalische Referenzwerte (siehe src/core/constants.ts).
EARTH_RADIUS_KM = 6371.0
EARTH_MASS_KG = 5.972e24
EARTH_YEAR_DAYS = 365.25

# Platzhalter, den InfoPanel und Tests wiedererkennen.
MISSING_TEXT = "Daten noch nicht erfasst"


# --------------------------------------------------------------- Hilfsmittel ---


def clean_name(raw: object) -> str:
    """Entfernt fachliche Markierungen aus einem Anzeigenamen.

    Wikipedia-traegt bei provisional benannten Monden ein Rautezeichen
    (Beispiel: "S/2021 J 3♦"). Das ist eine Markierung fuer die
    Astronomie-Fachliteratur, fuer ein Kind ist es ein unerklaertes
    Zeichen mitten im Satz. Der Generator entfernt es deshalb an EINER
    Stelle, damit kein Textweg sie wieder einschleust.

    @param raw Rohwert aus bodies.json.
    @returns Bereinigter Anzeigename, nie leer.
    """
    name = str(raw or "").strip()
    # Raute, Stern und Dagger: die drei Markierungen, die Wikipedia in
    # Satelliten-Tabellen vor den Namen setzt.
    name = re.sub(r"[♦✦*†‡]+", "", name).strip()
    # Doppelpunkte und Bindestriche am Rand sind nach dem Entfernen
    # haeufig zurueckgeblieben.
    name = name.strip(" -–—:")
    return name or "Dieser Mond"


def german_number(value: float, digits: int = 1) -> str:
    """Formatiert eine Zahl mit deutschem Dezimalkomma.

    @param value Zahl.
    @param digits Nachkommastellen (maximal).
    @returns Formatierte Zeichenkette, z.B. "1.234,5".
    """
    if not math.isfinite(value):
        return "–"
    text = f"{value:,.{digits}f}"
    return text.replace(",", "§").replace(".", ",").replace("§", ".")


def parse_discovery_year(discovery: str) -> int | None:
    """Liest das Entdeckungsjahr aus einem Freitextfeld.

    Erwartet Formen wie "1877, Asaph Hall" oder "2003, ...". Wird nichts
    gefunden, kommt None zurueck — dann darf laut Ticket kein Jahr erfunden
    werden, der Text bleibt jahreslos.

    @param discovery Rohwert aus bodies.json.
    @returns Jahreszahl oder None.
    """
    match = re.match(r"\s*(\d{4})\b", discovery)
    if match is None:
        return None
    year = int(match.group(1))
    if 1600 <= year <= 2100:
        return year
    return None


def orbital_period_days(semi_major_km: float, parent_mass_kg: float) -> float | None:
    """Berechnet die Umlaufzeit mit dem dritten Keplerschen Gesetz.

    T = 2*pi*sqrt(a^3 / (G*M)). Wird der_parent fehlt, rechnet das Skript
    mit der Erdmasse und markiert das Ergebnis spaeter als geschaetzt.

    @param semi_major_km Grosse Halbachse in km.
    @param parent_mass_kg Masse des umkreisten Koerpers in kg.
    @returns Umlaufzeit in Tagen oder None bei unbrauchbaren Eingaben.
    """
    if semi_major_km <= 0 or parent_mass_kg <= 0:
        return None
    gravitational_constant = 6.674e-20  # km^3 / (kg * s^2)
    a = semi_major_km
    seconds = 2.0 * math.pi * math.sqrt(a**3 / (gravitational_constant * parent_mass_kg))
    return seconds / 86400.0


def human_period(days: float) -> str:
    """Formuliert eine Umlaufzeit als deutschen Kindertext.

    @param days Umlaufzeit in Tagen.
    @returns Kurzbeschreibung, z.B. "rund 27 Tage".
    """
    if days < 1.0:
        hours = days * 24.0
        return f"rund {german_number(hours, 0)} Stunden"
    if days < 400.0:
        return f"rund {german_number(days, 0)} Tage"
    years = days / EARTH_YEAR_DAYS
    if years < 100.0:
        return f"rund {german_number(years, 1)} Jahre"
    return f"rund {german_number(years, 0)} Jahre"


# --------------------------------------------------------- Handgeschrieben ---
# Eigener Text je grosser Mond der Riesenplaneten. Der Wert ist ein
# (summary, funFact, kidQuestion, wouldYouSurvive)-Tupel in Kindersprache.
# Diese Koerper sind die, die Kinder im Unterricht kennenlernen — die
# Besonderheit ist jeweils das Argument, nicht eine Datentabelle.

FEATURED_MOONS: dict[str, tuple[str, str, str, str]] = {
    "ganymede": (
        "Ganymed ist der größte Mond im ganzen Sonnensystem — er ist sogar "
        "größer als der Planet Merkur. Er umkreist den Jupiter und ist "
        "bunter als unser Mond: helle Eisflächen liegen neben dunklen, "
        "alten Kraterfeldern.",
        "Ganymed ist so groß, dass alle anderen Monde unseres Sonnensystems "
        "zusammengenommen in ihn hineinpassen würden. Ganz oben hat es "
        "sogar eine eigene Magnetosphere wie ein Planet.",
        "Wie kann ein Mond größer sein als ein Planet?",
        "Nein — Ganymed hat zwar eine dünne Atmosphäre mit Sauerstoff, aber "
        "keinen Sauerstoff zum Atmen und keine Wärme. Ohne Raumanzug "
        "würdest du sofort einfrieren.",
    ),
    "kallisto": (
        "Kallisto ist der zweitgrößte Mond des Sonnensystems und umkreist "
        "den Jupiter ganz außen. Seine Oberfläche ist übersät von Kratern — "
        "er sieht aus wie unser Mond, nur viermal so groß.",
        "Kallistos Krater sind so tief, dass dort Eis liegen könnte. "
        "Weltweit nennt man diese eigenartige Landschaft „Chaostische "
        "Terrassen“.",
        "Warum ist Kallisto so voller Krater?",
        "Nein — dort ist es eisig kalt, es gibt kaum Luft und der Boden ist "
        "so zerklüftet, dass du nicht sicher landen könntest.",
    ),
    "titan": (
        "Titan ist der größte Mond des Saturns und der einzige Mond im "
        "Sonnensystem mit einer dicken Atmosphäre. Auf ihm ist es neblig "
        "und orange wie beim Sonnenuntergang.",
        "Auf Titan gibt es Flüsse, Seen und Meere — aber sie sind nicht aus "
        "Wasser, sondern aus flüssigem Methan und Ethan, ganz wie bei "
        "unserem Erdöl. Es ist die einzige Welt außer der Erde mit "
        "Seen an der Oberfläche.",
        "Wie können auf einem Mond Flüsse sein, wenn es dort so kalt ist?",
        "Nein — Titan ist kälter als bei uns im Winter, und seine Luft "
        "enthält fast keinen Sauerstoff. Zum Atmen bräuchtest du eine "
        "Druckanzüge.",
    ),
    "enceladus": (
        "Enceladus ist ein kleiner, glänzender Mond des Saturns. Seine "
        "Oberfläche ist so hell und glatt wie frischer Schnee.",
        "Enceladus schießt aus Spalten an seinem Südpol Fontänen aus Wasser "
        "und Eis direkt in den Weltraum. Diese Fontänen speisen den Ring "
        "des Saturn — sie sind der schönste Beweis dafür, dass es "
        "Durchbrüche unter der Eiskruste gibt.",
        "Wohin kommt das Wasser, das aus Enceladus herausschießt?",
        "Nein — ohne Druckanzug wärst du in Sekunden eingefroren. Der "
        "Sprühnebel aus Eiswürfeln ist zugleich die Kältequelle der "
        "Saturnringe.",
    ),
    "rhea": (
        "Rhea ist der zweitgrößte Mond des Saturns und fast so hell wie "
        "unser Mond. Sie ist ein Eis-Klumpen mit vielen alten Kratern und "
        "hellen Streifen, die wie eingefrorene Flüsse aussehen.",
        "Rhea hat eine eigene, sehr dünne Atmosphäre aus Sauerstoff und "
        "Kohlenstoffdioxid — fast wie bei unserem Mond, nur noch dünner.",
        "Kann ein Mond eine eigene Luft haben?",
        "Nein — die Atmosphäre ist so dünn, dass es dort im Prinzip wie im "
        "Weltraum ist: kein Atmen, kein Überleben.",
    ),
    "iapetus": (
        "Iapetus ist der Mond des Saturns mit der seltsamsten Oberfläche "
        "im ganzen Sonnensystem: Die eine Seite ist blitzend weiß, die "
        "andere fast schwarz.",
        "Iapetus läuft auf seiner Bahn um den Saturn auf dem Kopf — wie ein "
        "Kreisel, der kippt. Deshalb ist seine Achse stark geneigt und die "
        "helle Seite weist mal zur Sonne, mal davon weg.",
        "Warum ist die eine Seite von Iapetus weiß und die andere schwarz?",
        "Nein — Iapetus hat fast keine Atmosphäre und liegt sehr weit vom "
        "Sonnenlicht entfernt. Die dunkle Seite ist fast völlig ausgekühlt.",
    ),
    "miranda": (
        "Miranda ist der kleinste der fünf großen Monde des Uranus, aber "
        "der eigenartigste: Sie sieht aus, als hätte jemand einen Riesenkegel "
        "auf ihren Kopf gestellt.",
        "An den Klippen der Miranda gibt es nur 20 Kilometer hohe Wände — "
        "die höchsten bekannten auf einem Mond. Niemand weiß genau, wie "
        "sie entstanden sind.",
        "Wie kann es auf einem Mond so hohe Klippen geben?",
        "Nein — Miranda ist winzig, kalt und ohne Luft. Sie hat kaum "
        "Schwerkraft, du würdest nicht einmal richtig laufen können.",
    ),
    "ariel": (
        "Ariel ist der hellste und jüngste der großen Monde des Uranus. "
        "Seine Oberfläche ist auffällig glatt — dort gab es Flüsse aus "
        "Wassereis, die große Ebenen geschliffen haben.",
        "Auf Ariel hat man die hellen, glatten Gebiete Valley-Systeme "
        "genannt. Sie ähneln den Kanälen auf dem Mars und einem "
        "Gletschertal auf der Erde.",
        "Wodurch sind die glatten Täler auf Ariel entstanden?",
        "Nein — Ariel ist fast so kalt wie Uranus selbst und hat keine "
        "Atmosphäre. Ohne Anzug geht es nicht.",
    ),
    "umbriel": (
        "Umbriel ist der dunkelste Mond des Uranus. Er ist rund und grau "
        "wie ein Kiesel und genau deshalb der unscheinbarste der fünf "
        "großen Uranus-Monde.",
        "Am Rand von Umbriel liegt ein leuchtend heller Ring namens "
        "Wunda. Niemand weiß genau, was dieser Ring aus bunten Gesteinsbrocken "
        "eigentlich ist.",
        "Warum ist Umbriel so dunkel?",
        "Nein — seine Oberfläche ist fast schwarz, es gibt keine Luft, und "
        "Umbriel ist von der Sonne weit entfernt. Es ist stockdunkel und "
        "eiskalt.",
    ),
    "titania": (
        "Titania ist der größte Mond des Uranus — knapp 800 Kilometer "
        "Durchmesser. An ihm kann man große Täler erkennen, die durch das "
        "Auseinanderreißen seiner Eiskruste entstanden sind.",
        "Titania war einmal näher an Uranus und ist mit dem Planeten "
        "mitgewandert. Ihre Landschaft ist wie ein Puzzle, das man "
        "auseinandergeschoben und wieder zusammengesetzt hat.",
        "Wie entstehen riesige Täler auf einem Mond?",
        "Nein — auf Titania ist es bitterkalt und es gibt keine Luft. "
        "Außerdem dreht sie sich einmal in fast 9 Tagen um ihre Achse.",
    ),
    "oberon": (
        "Oberon ist der äußerste große Mond des Uranus und ähnlich groß wie "
        "Titania. Seine Oberfläche ist voller Krater, unter denen "
        "Einschläge helleren Stoff aufgeworfen haben.",
        "An einer Kraterwand des Oberon hat man helle Berge entdeckt, die "
        "niemand richtig erklären kann — bis heute streiten die Forscher "
        "darüber.",
        "Was könnten die hellen Berge auf Oberon sein?",
        "Nein — Oberon liegt sehr weit draußen und ist eiskalt. Es gibt "
        "kaum Atmosphäre, du bräuchtest einen warmen Druckanzug.",
    ),
    "triton": (
        "Triton ist der größte Mond des Neptuns — und etwas ganz "
        "Besonderes: Er umkreist seinen Planeten rückwärts, also gegen die "
        "Drehrichtung, in der die meisten Monde laufen.",
        "Man glaubt, dass Triton früher ein eigener Planet war und dem "
        "Neptun einst viel näher kam. Als der Riese ihn einfing, wurde er "
        "auf diese seltsame Bahn gezwungen. Auf Triton gibt es sogar "
        "Eisvulkane, die Stickstoff ausstoßen.",
        "Warum läuft der Triton rückwärts um den Neptun?",
        "Nein — Triton ist −235 °C kalt, das ist rund um den absoluten "
        "Nullpunkt. Es gibt keine Luft zum Atmen, nur eine ganz dünne.",
    ),
    "charon": (
        "Charon ist der größte Mond des Zwergplaneten Pluto und fast halb "
        "so groß wie Pluto selbst. Die beiden liegen so dicht beieinander, "
        "dass sie eigentlich ein Doppelkörper-Team sind.",
        "Beide kreisen um einen gemeinsamen Punkt in der Mitte — Charon ist "
        "also nicht nur um Pluto herum unterwegs, sondern Pluto kreist "
        "ein bisschen um Charon mit.",
        "Wie kann ein Mond fast so groß sein wie sein Planet?",
        "Nein — Pluto und Charon liegen so weit von der Sonne weg, dass es "
        "dort ungefähr −230 °C ist. Ohne Druckanzug wärst du sofort "
        "erfroren.",
    ),
}


# Eigener Text je Planet. Ohne diese Texte bekommen die acht Planeten — also
# genau die Koerper, die jedes Kind zuerst kennenlernt — nur den Platzhalter
# "Daten noch nicht erfasst". Das ist der wichtigste Inhalt der ganzen App,
# deshalb steht er hier handgeschrieben und nicht generiert.
FEATURED_PLANETS: dict[str, tuple[str, str, str, str]] = {
    "merkur": (
        "Merkur ist der kleinste Planet und steht am nächsten an der Sonne. "
        "Er ist nur wenig größer als unser Mond — und sieht ihn auch ein "
        "bisschen ähnlich: grau, voller Krater, ohne Luft.",
        "Ein Merkur-Jahr dauert nur 88 Erdentage, ein Merkur-Tag sogar noch "
        "weniger. Die Sonne steht für die ganze Reise einmal am Himmel und "
        "dann 176 Tage lang gar nicht mehr.",
        "Warum ist es auf dem Merkur so heiß und so kalt zugleich?",
        "Nein — auf der Sonnenseite werden es 430 °C, auf der Schattenseite "
        "−170 °C. Dazwischen liegt kein Ort zum Wohnen. Außerdem gibt es "
        "keine Luft zum Atmen.",
    ),
    "venus": (
        "Venus ist unser Nachbarplanet und sieht fast so aus wie die Erde. "
        "Nur ist er viel heißer: Unter dicken Wolken aus Schwefelsäure "
        "schwitzt es nicht — es ist heißer als auf dem Merkur.",
        "Venus dreht sich langsam rückwärts um die Sonne. Auf der Venus geht "
        "die Sonne deshalb im Westen auf und im Osten unter.",
        "Wie kann es auf der Venus heißer sein als auf dem Merkur?",
        "Nein — dort ist es rund 460 °C heiß und der Luftdruck ist so hoch, "
        "wie er 900 Meter tief im Ozean wäre. Dein Körper würde sofort "
        "zerfallen wie eine Tiefseequalle.",
    ),
    "erde": (
        "Die Erde ist unser Zuhause — der einzige Planet, auf dem es "
        "Leben gibt. Hier ist Wasser flüssig, die Luft zum Atmen und der "
        "Abstand zur Sonne genau richtig.",
        "Die Erde hat ein eigenes Magnetfeld, das den Sonnenwind abwehrt. "
        "Deshalb kann hier etwas leben, während der Mars fast keinen "
        "Luftschild mehr hat.",
        "Warum gibt es gerade auf der Erde Leben?",
        "Ja — hier kannst du leben, weil es Luft, Wasser und passende "
        "Wärme gibt. Der Trick ist aber: genug davon gibt es nur auf der "
        "Erde. Anderswo musst du deinen Raumanzug tragen.",
    ),
    "mars": (
        "Mars ist unser zweiter Nachbar und sieht aus wie eine rostrote "
        "Wüste. Er trägt den Namen des Kriegsgottes und ist trotzdem einer "
        "der schönsten Planeten am Nachthimmel.",
        "Auf dem Mars steht der höchste Vulkan des Sonnensystems: der "
        "Olympus Mons ist fast dreimal so hoch wie der Mount Everest. Er "
        "ist nicht durch Eruptionen gewachsen, sondern weil sich über "
        "Millionen Jahre Lava Schicht für Schicht abgelagert hat.",
        "Warum ist der Mars so rot?",
        "Nein — die Luft besteht fast nur aus Kohlendioxid und ist viel zu "
        "dünn zum Atmen. Außerdem ist es nachts −60 °C. Ein Marsanzug mit "
        "Sauerstoff und Heizung wäre Pflicht.",
    ),
    "jupiter": (
        "Jupiter ist der größte Planet im Sonnensystem — so groß, dass mehr "
        "als 1.300 Erden in ihn hineinpassen würden. Er ist ein Gasriese: "
        "oben Wolken, unten flüssiger Wasserstoff.",
        "Der große rote Fleck auf dem Jupiter ist ein Sturm, der seit "
        "mindestens 100 Jahren wütet — er ist nicht kleiner geworden, "
        "sondern nur von der Erde aus schwerer zu sehen.",
        "Wie viele Erden passen in den Jupiter?",
        "Nein — Jupiter besteht fast nur aus Gas, es gibt keine feste "
        "Oberfläche zum Landen. In seiner Atmosphäre zerreißt es dich und "
        "du würdest im Stern verschwinden.",
    ),
    "saturn": (
        "Saturn ist der zweitgrößte Planet und der mit den schönsten "
        "Ringen. Die Ringe sind keine Scheibe, sondern Milliarden einzelne "
        "Eis- und Gesteinsstücke — wie ein ganzer Schneesturm in Ringform.",
        "Saturn ist so leicht, dass er auf genug Wasser schwimmen würde. "
        "Seine Ringe sind trotzdem nur rund 10 bis 1000 Meter dick — "
        "flacher als ein Blatt Papier, dafür aber 280.000 Kilometer breit.",
        "Woraus bestehen die Ringe des Saturn?",
        "Nein — kein Mensch, kein Roboter und kein Raumschiff ist bisher "
        "durch die Ringe geflogen. Dafür sind die kleinen Eisstücke viel "
        "zu dicht.",
    ),
    "uranus": (
        "Uranus kippt auf die Seite. Sein Nordpol zeigt fast direkt auf das "
        "All, und er rollt wie ein liegender Ball um die Sonne. Deshalb "
        "hat er auch die seltsamste Jahreszeit von allen Planeten.",
        "Der Uranus ist der erste Planet, den man mit einem Teleskop "
        "entdeckt hat — 1781, über 200 Jahre nach Galileo. Bis dahin "
        "kannten die Menschen nur sechs Planeten.",
        "Warum liegt der Uranus auf der Seite?",
        "Nein — auf dem Uranus ist es −195 °C kalt. In seiner Atmosphäre "
        "gibt es Methan, und das ist bei Kälte flüssig wie eine Flut von "
        "flüssigem Leuchtgas.",
    ),
    "neptun": (
        "Neptun ist der am weitesten entfernte Planet und liegt fast so "
        "weit von der Sonne weg wie 30 Erden aneinander gereiht. Er ist ein "
        "eisblauer Gasriese mit dem stärksten Wind im Sonnensystem.",
        "Auf dem Neptun wehen Wind mit über 2.000 km/h — das ist mehr als "
        "Schallgeschwindigkeit und rund fünfmal schneller als der "
        "stärkste Wind auf der Erde.",
        "Warum ist der Neptun so blau?",
        "Nein — Neptun hat keine Oberfläche zum Landen, nur eine eisige "
        "Atmosphäre, die im Stern-Umkreis permanent tobt.",
    ),
}


# --------------------------------------------------------- Textbausteine ---


def is_irregular(moon: dict[str, Any]) -> bool:
    """Entscheidet, ob ein Mond ein unregelmaessiger Kleinmond ist.

    Irregulaere Monde sind klein (< 200 km), stark exzentrisch oder haben
    eine sehr schiefe Bahn. Sie stammen wahrscheinlich aus eingefangenen
    Asteroiden, die nie zu einem regelmaessigen System wurden.

    @param moon Mond-Eintrag aus bodies.json.
    @returns True, wenn der Mond als irregulaer gilt.
    """
    radius = float(moon.get("radiusKm") or 0.0)
    eccentricity = float(moon.get("eccentricity") or 0.0)
    inclination = float(moon.get("inclinationDeg") or 0.0)
    if radius > 200.0:
        return False
    if eccentricity >= 0.2 or inclination >= 30.0:
        return True
    # Namen der Form "S/2003 S 1" sind per Definition Kleinmonde aus
    # stammigen Umlaufbahnen.
    return bool(re.match(r"^[A-Z]/\d{4}\s", str(moon.get("id") or "")))


def small_moon_text(
    moon: dict[str, Any], planet_name: str, parent_mass_kg: float
) -> tuple[str, str, str, str]:
    """Erzeugt den Kategorie-Text fuer einen kleinen regelmaessigen Mond.

    Der Text variiert mit Radius und Bahnradius, damit nicht 200 gleiche
    Saetze in facts.json stehen: grosse kleine Monde werden anders
    beschrieben als staubkorngrosse, weiter draussen stehende anders als
    erdnahe.

    @param moon Mond-Eintrag aus bodies.json.
    @param planet_name Deutscher Name des umkreisten Planeten.
    @param parent_mass_kg Masse des umkreisten Planeten in kg.
    @returns (summary, funFact, kidQuestion, wouldYouSurvive).
    """
    radius = float(moon.get("radiusKm") or 0.0)
    axis = float(moon.get("semiMajorAxisKm") or 0.0)
    name = clean_name(moon.get("name"))
    orbit_days = orbital_period_days(axis, parent_mass_kg)

    if radius >= 100.0:
        size_word = "Einer der größten kleinen Monde"
    elif radius >= 10.0:
        size_word = "Ein gut sichtbarer Mond"
    else:
        size_word = "Ein kleiner Mond"

    if axis < 200_000.0:
        distance_part = " ganz nah an seinem Planeten"
    elif axis < 2_000_000.0:
        distance_part = " nicht weit von seinem Planeten entfernt"
    else:
        distance_part = " weit draußen, dort wo der Planet im Sonnenlicht nur noch ein Punkt ist"

    if radius <= 0:
        size_part = " Seine genaue Größe kennen die Astronomen noch nicht"
    elif radius >= 1000.0:
        # bodies.json liefert den Radius. Für Kinder vergleichen wir die
        # Breite (= Durchmesser), denn "8 Kilometer breit" meint die
        # Strecke von einer Seite zur anderen, nicht den Radius.
        size_part = (
            f" Er ist {german_number(radius * 2, 0)} Kilometer breit — "
            f"so groß wie unser Mond oder sogar größer"
        )
    elif radius >= 10.0:
        size_part = (
            f" Er ist {german_number(radius * 2, 0)} Kilometer breit — nur etwa "
            f"{german_number(radius / 1737.4 * 100, 0)} Prozent so breit wie unser Mond"
        )
    elif radius * 2 >= 2.0:
        # Unser Mond ist 3.474 km breit. Ein Mond von 2-20 km Breite passt
        # gut in den Vergleich "einmal quer durch unsere Heimatstadt".
        size_part = (
            f" Er ist nur {german_number(radius * 2, 1)} Kilometer breit — "
            f"das ist etwa so weit, als würdest du deine Heimatstadt einmal "
            f"quer durchlaufen"
        )
    else:
        size_part = (
            f" Er ist nur {german_number(radius * 2, 1)} Kilometer breit — "
            f"das ist weniger als ein großer Stadtplatz"
        )

    if radius <= 0:
        # Datenluecke: ueber die Groesse wissen wir nichts. Der Satz darf
        # nicht behaupten, der Mond sei "rund und grau" — das waere eine
        # erfundene Angabe.
        summary = (
            f"{name} ist ein Mond von {planet_name}{distance_part}. "
            f"Über seine Größe wissen die Astronomen noch nicht Bescheid — "
            f"er ist so klein, dass man ihn nur mit sehr großen Teleskopen "
            f"finden kann."
        )
    else:
        summary = (
            f"{name} ist ein Mond von {planet_name}{distance_part}. {size_word}, rund und grau, "
            f"und aus Eis und Gestein.{size_part}."
        )
    if orbit_days is not None:
        fun_fact = (
            f"{name} braucht {human_period(orbit_days)} für einen Umlauf um {planet_name}. "
            f"Stell dir vor, du läufst die ganze Strecke — dafür bräuchtest du viel mehr "
            f"als ein ganzes Menschenleben."
        )
    else:
        fun_fact = (
            f"Von {name} weiß man noch nicht allzu viel. Sogar seine Umlaufzeit um "
            f"{planet_name} ist noch nicht genau berechnet."
        )
    question = f"Was ist anders an einem Mond wie {name} und unserem Mond?"
    survive = (
        f"Nein — auf {name} gibt es keine Luft zum Atmen. Je nachdem, wie weit er von der "
        f"Sonne entfernt ist, ist es dort gefroren oder verbrannt. Ohne Druckanzug "
        f"geht es jedenfalls nicht."
    )
    return summary, fun_fact, question, survive


def irregular_moon_text(
    moon: dict[str, Any], planet_name: str, year: int | None
) -> tuple[str, str, str, str]:
    """Erzeugt den Kategorie-Text fuer einen kleinen irregulaeren Mond.

    @param moon Mond-Eintrag aus bodies.json.
    @param planet_name Deutscher Name des umkreisten Planeten.
    @param year Belegbares Entdeckungsjahr oder None.
    @returns (summary, funFact, kidQuestion, wouldYouSurvive).
    """
    name = clean_name(moon.get("name"))
    radius = float(moon.get("radiusKm") or 0.0)
    if year is not None:
        found = f"Den haben die Astronomen erst {year} entdeckt"
    else:
        found = "Wann genau man ihn entdeckt hat, weiß niemand so genau"
    if radius <= 0:
        shape = (
            "Er ist winzig und fliegt auf einer schiefen Bahn um den Planeten. "
            "Wie groß er genau ist, weiß noch niemand."
        )
    else:
        shape = (
            f"Er ist winzig — nur {german_number(radius * 2, 1)} Kilometer breit — "
            f"und fliegt auf einer schiefen Bahn um den Planeten."
        )
    summary = (
        f"{name} ist ein kleiner, unregelmäßiger Mond von {planet_name}. "
        f"{shape} {found} — vorher hat ihn niemand gesehen, "
        f"weil er so klein ist."
    )
    fun_fact = (
        f"Das Wichtigste an {name} ist, dass wir ihn nur mit ganz "
        f"großen Teleskopen finden. Ein Schulfernrohr zeigt davon keinen "
        f"einzigen Punkt."
    )
    question = f"Warum ist es so schwer, {name} zu entdecken?"
    survive = (
        f"Nein — {name} ist winzig und hat keinerlei Atmosphäre. Dort "
        f"kann niemand leben, nicht einmal Bakterien."
    )
    return summary, fun_fact, question, survive


# ------------------------------------------------------- Feste Zusatzinhalte ---
# Mindestens fuenf NEUE Quizfragen zu den Monden. Die IDs (q20..) sind
# neu, damit bestehende Fragen unangetastet bleiben.

MOON_QUIZ: list[dict[str, Any]] = [
    {
        "id": "q20",
        "question": "Welcher Mond ist größer als der Planet Merkur?",
        "options": ["Der Mond", "Ganymed", "Titan", "Triton"],
        "correctIndex": 1,
        "explanation": (
            "Ganymed ist mit 2634 km Radius nicht nur der größte Mond, "
            "sondern auch größer als der Merkur (2440 km). Ein Mond, der "
            "größer ist als ein Planet — das gibt es im ganzen "
            "Sonnensystem nur hier."
        ),
        "difficulty": "mittel",
    },
    {
        "id": "q21",
        "question": "Auf welchem Mond schießen Fontänen aus Wasser in den Weltraum?",
        "options": ["Europa", "Titan", "Enceladus", "Mimas"],
        "correctIndex": 2,
        "explanation": (
            "Enceladus hat Spalten am Südpol, aus denen Wasserfontänen "
            "herausschießen. Dieses Wasser umkreist den Saturn und legt "
            "sich als Eis auf seine Ringe."
        ),
        "difficulty": "mittel",
    },
    {
        "id": "q22",
        "question": "Welcher Mond dreht sich um seinen Planeten rückwärts?",
        "options": ["Der Mond", "Titan", "Ganymed", "Triton"],
        "correctIndex": 3,
        "explanation": (
            "Triton umkreist den Neptun im Uhrzeigersinn, während alle "
            "anderen Monde gegen den Uhrzeigersinn laufen. Man glaubt, "
            "dass Triton ein eingefangener Klon-Planet ist."
        ),
        "difficulty": "mittel",
    },
    {
        "id": "q23",
        "question": "Was ist der Unterschied zwischen einem Mond und einem Planeten?",
        "options": [
            "Ein Mond leuchtet selbst, ein Planet nicht",
            "Ein Mond kreist um einen Planeten, ein Planet um die Sonne",
            "Monde sind immer viel kleiner als der Merkur",
            "Planeten können gar keine Monde haben",
        ],
        "correctIndex": 1,
        "explanation": (
            "Planeten kreisen um die Sonne und sind groß genug, dass ihre "
            "Schwerkraft sie rundet. Monde kreisen um einen Planeten — sie "
            "sind viel kleiner und leuchten nicht selbst."
        ),
        "difficulty": "leicht",
    },
    {
        "id": "q24",
        "question": "Welcher Mond ist fast so groß wie der Zwergplanet Pluto?",
        "options": ["Triton", "Charon", "Oberon", "Umbriel"],
        "correctIndex": 1,
        "explanation": (
            "Charon hat 1212 km Radius, Pluto nur 1188 km. Beide kreisen "
            "um einen gemeinsamen Punkt — sie sind fast ein Doppelkörper."
        ),
        "difficulty": "mittel",
    },
    {
        "id": "q25",
        "question": "Warum ist die eine Seite des Mondes Iapetus hell und die andere schwarz?",
        "options": [
            "Er dreht sich zu schnell",
            "Eine Seite wird ständig von dunklem Staub zugedeckt",
            "Die helle Seite hat Eis",
            "Das ist nur eine schlechte Aufnahme",
        ],
        "correctIndex": 1,
        "explanation": (
            "Iapetus ist den Schwefel aus dem benachbarten Phoebe-Gürtel "
            "eingefangen. Die schwarze Seite ist mit diesem dunklen Staub "
            "bedeckt, die helle Seite ist fast reines Eis."
        ),
        "difficulty": "schwer",
    },
    {
        "id": "q26",
        "question": "Wie viele Monde hat der Planet mit den meisten Monden?",
        "options": ["Die Erde", "Der Jupiter", "Der Saturn", "Der Mars"],
        "correctIndex": 2,
        "explanation": (
            "Der Saturn hat die meisten Monde — deutlich mehr als der "
            "Jupiter. Er zählt aber ständig neue kleine Monde dazu, weil "
            "das Teleobjektiv immer tiefer sehen kann."
        ),
        "difficulty": "mittel",
    },
]

GLOSSARY_ADDITIONS: list[dict[str, str]] = [
    {
        "term": "Retrograde Bahn",
        "definition": (
            "Eine Bahn, auf der ein Körper gegen die Drehrichtung läuft. "
            "Fast alle Monde drehen sich gegen den Uhrzeigersinn um ihren "
            "Planeten — Triton macht es genau anders herum."
        ),
        "example": (
            "Triton umkreist den Neptun im Uhrzeigersinn. Er ist vermutlich "
            "ein Planet, den der Neptun eingefangen hat."
        ),
    },
    {
        "term": "Umlaufzeit",
        "definition": (
            "Die Zeit, die ein Körper für einen vollen Rundflug braucht. "
            "Je weiter ein Mond vom Planeten entfernt ist, desto länger "
            "dauert das."
        ),
        "example": (
            "Unser Mond braucht 27 Tage für eine Umlaufzeit, der ferne "
            "Zwergmond des Pluto fast 50 Jahre."
        ),
    },
    {
        "term": "Gravitationsfeld",
        "definition": (
            "Die Anziehungskraft eines Körpers. Sie ist nicht nur auf der "
            "Oberfläche spürbar, sondern nimmt mit der Entfernung langsam ab."
        ),
        "example": (
            "Auf dem Titan ziehst du nur in die Höhe 0,6 Meter, auf der "
            "Erde wärst du 80 Zentimeter groß."
        ),
    },
    {
        "term": "Ringe",
        "definition": (
            "Bänder aus Millionen von Eiskörnern, die einen Planeten "
            "umkreisen. Die Körner sind oft nur so groß wie Sandkörner und "
            "fliegen wie ein winziger Schwarm um die Erde herum."
        ),
        "example": (
            "Die Ringe des Saturn sind nur rund 10 Meter dick, aber fast "
            "300.000 Kilometer breit."
        ),
    },
    {
        "term": "Atmosphäre",
        "definition": (
            "Eine Gasschicht, die einen Körper umgibt. Sie entsteht durch "
            "einen Vulkanausbruch oder Gase, die der Körper selbst abgibt. "
            "Nur mit Sauerstoff darin kann jemand atmen."
        ),
        "example": (
            "Der Titan hat eine dichte Atmosphäre, unser Mond hat nur eine "
            "Spur davon. Der Mars hat ebenfalls Luft, aber viel zu dünn."
        ),
    },
]


# ----------------------------------------------------------------- Logik ---


def is_generated_entry(entry: dict[str, Any]) -> bool:
    """Prueft, ob ein facts-Eintrag vom Generator stammt.

    Nur Eintraege, die der Generator selbst geschrieben hat, darf er
    ueberschreiben. Handgeschriebene Texte (Ticket 05) und die
    FEATURED_MOONS-Texte bleiben tabu, auch wenn ihre ID in bodies.json
    gerade fehlt — sonst verliert man bei einer Umbenennung Inhalte.

    Kriterium: der Generator schreibt den yearLength-Text NIE mit einem
    Planetennamen ("16,7 Tage um Jupiter"), die handgeschriebenen Eintraege
    aus Ticket 05 dagegen schon. Nur Eintraege ohne dieses " um " sind
    Generator-Werk.

    @param entry facts-Eintrag.
    @returns true, wenn der Generator diesen Eintrag erzeugt haben kann.
    """
    comparisons = entry.get("comparisons")
    if not isinstance(comparisons, dict):
        return False
    if "yearLength" not in comparisons or "dayLength" not in comparisons:
        return False
    # Handgeschriebene Eintraege aus Ticket 05 tragen im yearLength-Text
    # den Planeten ("16,7 Tage um Jupiter"); der Generator niemals.
    return " um " not in str(comparisons.get("yearLength", ""))


def build_facts(
    bodies: list[dict[str, Any]], facts: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Ergaenzt facts.json um fehlende Koerpertexte, Quiz und Glossar.

    @param bodies Koerperliste aus bodies.json.
    @param facts Bereits geladener Inhalt von facts.json.
    @returns (neue facts, Liste der ergaenzten IDs, Liste der Datenluecken).
    """
    result = json.loads(json.dumps(facts))  # tiefe Kopie, Eingabe bleibt unberuehrt
    result.setdefault("bodies", {})
    result.setdefault("quiz", [])
    result.setdefault("glossary", [])

    by_id = {body["id"]: body for body in bodies}
    mass_of = {body["id"]: float(body.get("massKg") or 0.0) for body in bodies}
    name_of = {body["id"]: str(body.get("name") or body["id"]) for body in bodies}

    added: list[str] = []
    missing_data: list[str] = []
    # Facts-Eintraege, deren Koerper es in bodies.json nicht (mehr) gibt.
    # Sie werden NICHT geloescht: der Text koennte handgeschrieben sein und
    # bodies.json koennte nur falsch benannt haben. Stattdessen meldet das
    # Skript sie, damit ein Mensch die Sache entscheidet.
    known_ids = {body["id"] for body in bodies}
    orphaned = sorted(key for key in result["bodies"] if key not in known_ids)

    for body in bodies:
        body_id = body["id"]
        existing = result["bodies"].get(body_id)

        if existing is not None and not is_generated_entry(existing):
            # Handgeschriebener Text (Ticket 05): unangetastet lassen.
            continue

        if not body.get("radiusKm"):
            missing_data.append(body_id)

        parent = body.get("parent")
        parent_name = name_of.get(parent, "einem Planeten") if parent else "der Sonne"
        radius = float(body.get("radiusKm") or 0.0)
        axis = float(body.get("semiMajorAxisKm") or 0.0)
        name = name_of.get(body_id, body_id)
        year = parse_discovery_year(str(body.get("discovery") or ""))

        if body_id in FEATURED_MOONS:
            summary, fun_fact, question, survive = FEATURED_MOONS[body_id]
        elif body.get("type") == "moon" and is_irregular(body):
            summary, fun_fact, question, survive = irregular_moon_text(body, parent_name, year)
        elif body.get("type") == "moon":
            summary, fun_fact, question, survive = small_moon_text(
                body, parent_name, mass_of.get(parent, 0.0)
            )
        elif body.get("type") == "planet" and body_id in FEATURED_PLANETS:
            summary, fun_fact, question, survive = FEATURED_PLANETS[body_id]
        elif body.get("type") == "planet":
            summary = (
                f"{name} ist ein Planet unseres Sonnensystems und kreist um "
                f"die Sonne. {MISSING_TEXT} — bald gibt es auch hier einen "
                f"richtigen Kindtext."
            )
            fun_fact = f"{MISSING_TEXT}."
            question = f"Was möchtest du über {name} wissen?"
            survive = f"{MISSING_TEXT}."
        else:
            summary = f"{name} leuchtet selbst — es ist ein Stern. {MISSING_TEXT}."
            fun_fact = f"{MISSING_TEXT}."
            question = f"Was möchtest du über {name} wissen?"
            survive = f"{MISSING_TEXT}."

        # Vergleiche nur berechnen, wenn die Rohdaten dafuer ausreichen.
        comparisons: dict[str, Any] = {}
        if radius > 0:
            earths = radius / EARTH_RADIUS_KM
            # Auf 6 Stellen runden statt auf 4: ein Mond mit 0,15 km Radius
            # ergaebe sonst 0.0 und wuerde als "unbekannt" erscheinen, obwohl
            # die Zahl belastbar ist. Der InfoPanel-Text kuerzt ohnehin.
            comparisons["earths"] = round(earths, 6) if earths > 0 else earths
        if axis > 0 and body.get("type") != "star":
            period = orbital_period_days(axis, mass_of.get(parent, 0.0))
            if period is not None:
                comparisons["yearLength"] = human_period(period)
        if body.get("rotationPeriodH"):
            hours = float(body["rotationPeriodH"])
            if abs(hours) >= 48:
                comparisons["dayLength"] = f"rund {german_number(abs(hours) / 24.0, 1)} Tage"
            else:
                comparisons["dayLength"] = f"rund {german_number(abs(hours), 1)} Stunden"

        result["bodies"][body_id] = {
            "summary": summary,
            "funFact": fun_fact,
            "kidQuestion": question,
            "comparisons": comparisons,
            "wouldYouSurvive": survive,
        }
        added.append(body_id)

    # Quiz und Glossar: nur ergaenzen, was es noch nicht gibt.
    known_quiz = {q.get("id") for q in result["quiz"]}
    for question in MOON_QUIZ:
        if question["id"] not in known_quiz:
            result["quiz"].append(question)
    known_terms = {g.get("term") for g in result["glossary"]}
    for entry in GLOSSARY_ADDITIONS:
        if entry["term"] not in known_terms:
            result["glossary"].append(entry)

    return result, added, missing_data + orphaned


def prune_orphans(
    bodies: list[dict[str, Any]], facts: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    """Entfernt Generator-Eintraege fuer Koerper, die es nicht (mehr) gibt.

    @param bodies Koerperliste aus bodies.json.
    @param facts Inhalt von facts.json.
    @returns (facts ohne die Eintraege, Liste der entfernten IDs).
    """
    result = json.loads(json.dumps(facts))
    known_ids = {body["id"] for body in bodies}
    removed: list[str] = []
    for key in sorted(result.get("bodies", {})):
        if key in known_ids:
            continue
        entry = result["bodies"][key]
        if isinstance(entry, dict) and is_generated_entry(entry):
            del result["bodies"][key]
            removed.append(key)
    return result, removed


def check(bodies: list[dict[str, Any]], facts: dict[str, Any]) -> list[str]:
    """Findet Koerper ohne facts-Eintrag.

    @param bodies Koerperliste aus bodies.json.
    @param facts Inhalt von facts.json.
    @returns Liste der IDs ohne Eintrag (leer heisst: alles abgedeckt).
    """
    entries = facts.get("bodies", {})
    return [body["id"] for body in bodies if body["id"] not in entries]


def main(argv: list[str]) -> int:
    """Kommandozeile: --check prueft nur, --report listet Datenluecken.

    @param argv Argumente ohne Programmnamen.
    @returns Prozess-Rueckgabewert.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="nur pruefen, nichts schreiben")
    parser.add_argument("--report", action="store_true", help="Datenluecken ausgeben")
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Generator-Eintraege fuer Koerper entfernen, die es nicht mehr gibt",
    )
    args = parser.parse_args(argv)

    bodies = json.loads(BODIES_PATH.read_text(encoding="utf-8"))["bodies"]
    facts = json.loads(FACTS_PATH.read_text(encoding="utf-8"))

    if args.prune:
        facts, removed = prune_orphans(bodies, facts)
        FACTS_PATH.write_text(
            json.dumps(facts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Entfernt: {', '.join(removed) if removed else 'nichts'}")
        return 0

    if args.report:
        for body in bodies:
            if not body.get("radiusKm"):
                print(f"Ohne Radius: {body['id']} ({body.get('name')})")
        return 0

    if args.check:
        gaps = check(bodies, facts)
        print(f"Koerper: {len(bodies)}  facts-Eintraege: {len(facts.get('bodies', {}))}")
        if gaps:
            print("FEHLT:", ", ".join(gaps))
            return 1
        print("OK: fuer jeden Koerper gibt es einen facts-Eintrag.")
        return 0

    result, added, missing_data = build_facts(bodies, facts)
    FACTS_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Ergänzt: {len(added)} Koerpertexte")
    print(f"Quiz: {len(result['quiz'])} Fragen, Glossar: {len(result['glossary'])} Begriffe")
    if missing_data:
        print(f"Ohne Radius (erlaubte Ausnahme): {', '.join(missing_data)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
