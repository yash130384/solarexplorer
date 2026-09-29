#!/usr/bin/env python3
"""Debug: Mond-Tabellenstruktur der englischen Wikipedia ansehen."""
import urllib.request, sys, pathlib
UA = "SolarExplorer/1.0 (educational; local)"
out = pathlib.Path(__file__).resolve().parent.parent / "tools" / "_debug_tables"
out.mkdir(exist_ok=True)
for title, fn in [("Moons_of_Saturn", "saturn"), ("List_of_moons_of_Jupiter", "jupiter"),
                  ("Moons_of_Uranus", "uranus"), ("Moons_of_Neptune", "neptune"),
                  ("Moons_of_Mars", "mars")]:
    url = f"https://en.wikipedia.org/w/index.php?title={title}&action=raw"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    (out / f"{fn}.txt").write_text(t, encoding="utf-8")
    print(fn, len(t))
