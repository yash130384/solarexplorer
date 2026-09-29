PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

KONTEXT — die Aenderungen sind BEREITS VORHANDEN, du musst sie nicht bauen:
Ich (jennifer) habe zwei Fehler in der Darstellung behoben. Deine Aufgabe
ist es, das zu VERIFIZIEREN, die Tests nachzuziehen und die Korrektheit zu
belegen. Aendere nur dort etwas, wo du einen echten Fehler findest.

FEHLER 1 — Umlaufbahnen waren stark verzerrt
  Ursache: scaleDistance() rechnete im Modus "visual" mit au^0.35.
  Folge: Jupiter lag nur 1,78x so weit von der Sonne wie die Erde
  (echt sind es 5,20x), der ganze Innenbereich war ein Klumpen.
  Loesung (schon drin): neue Kurve visualDistance() in src/core/scale.ts
    - bis 4 AE streng linear (Merkur 0,39x, Mars 1,52x, beide exakt)
    - darueber logarithmisch (Jupiter 4,42x, Neptun 7,23x)
  Ausserdem: Kamera-Startposition von [0,140,320] auf [0,220,1050],
  weil Neptun jetzt bei ~434 Szeneneinheiten liegt.

FEHLER 2 — Nav zeigte "464 von 465 Koerpern"
  Ursache: isKnownBody() verlangte radiusKm > 0. Der bestaetigte Mond
  S/2009 S 2 hat in der Fachliteratur keinen gemessenen Radius und fiel
  dadurch aus der Liste.
  Loesung (schon drin): "bekannt" haengt jetzt an semiMajorAxisKm > 0.

DEINE AUFGABEN

1. TESTS NACHZIEHEN
   a) src/core/scale.test.ts: Die alten Tests pruefen vermutlich noch die
      alte Potenz-Kurve. Ergaenze bzw. korrigiere:
      - Merkur liegt bei 0,39x Erde (Toleranz 2 %)
      - Mars liegt bei 1,52x Erde (Toleranz 2 %)
      - Jupiter liegt bei 4,3x-4,6x Erde (Toleranz 5 %)
      - Neptun liegt bei 7,0x-7,5x Erde
      - Die Kurve ist monoton steigend ueber 0,39 .. 30 AE
      - Am Kniepunkt (4 AE) ist die Kurve stetig: der Wert bei 3,99 AE und
        bei 4,01 AE unterscheidet sich um weniger als 0,5 %
      - Das Verhaeltnis Mars/Erde ist NAHER an der Realitaet (1,52) als
        vorher: pruefe, dass der Test die echte Reihenfolge abbildet
      Nutze it.each fuer die Planetentabelle.

   b) src/ui/*.test.ts (Navigation): Ein Test erwartet vermutlich, dass
      Koerper ohne Radius NICHT als bekannt gelten. Das ist jetzt anders.
      Aktualisiere ihn und ergaenze:
      - isKnownBody liefert true fuer einen Mond mit semiMajorAxisKm > 0
        und radiusKm = 0
      - isKnownBody liefert false fuer die Sonne (type "star")
      - isKnownBody liefert false bei semiMajorAxisKm = 0

   c) Ein NEUER Test in tests/unit/scale-ratios.test.ts:
      Prueft die Verhaeltnisse direkt aus bodies.json gegen scaleDistance().
      Fuer jeden der 8 Planeten: das Verhaeltnis der dargestellten Bahn zur
      Erde-Bahn muss dem Dokumentationsziel entsprechen:
        Merkur ~0,39 | Venus ~0,72 | Erde 1,00 | Mars ~1,52
        Jupiter 4,0-4,6 | Saturn 5,0-5,8 | Uranus 6,0-7,0 | Neptun 7,0-7,5
      Und: Jupiter muss im Verhaeltnis ERDE-JUPITER deutlich ueber 3x
      liegen (vorher war es 1,78x — genau der Fehler, den wir beheben).

2. VERIFIKATION MIT ECHTEN ZAHLEN
   Erzeuge einen kleinen Beleg, keine Behauptung:
   - Ein Skript oder Test, das fuer jeden Planeten die DARGESTELLTE
     Distanz (scaleDistance(..., "visual")) ausgibt
   - Als Tabelle: Planet | echte AE | dargestellte Einheiten | /Erde
   - Diese Zahlen kommen in deinen Bericht

3. GEGENPRUEFEN, DASS NICHTS KAPUTT IST
   - npx tsc --noEmit -> 0 Fehler
   - npx vitest run -> ALLES gruen, und MEHR Tests als vorher (276)
   - Pruefe: Sind die bestehenden Tests ueberhaupt noch gueltig? Wenn ein
     alter Test die alte Kurve festzuschreibt, war er falsch — passe ihn an
     und ERKLAERE die Aenderung im Bericht. Schwache Tests sind schlimmer
     als keine.

4. SICHTPRUEFUNG
   - npx playwright test (alle) -> gruen
   - Der Navigationszaehler muss jetzt "465 von 465" anzeigen.
     ERSTELLE: tests/e2e/body-count.spec.ts
       - laedt die Seite, wartet auf __solarExplorer
       - liest den Koerperzaehler aus dem DOM
       - ERWARTUNG: 465 von 465
       - Wenn dort etwas anderes steht, ist das ein BEFUND, kein Testfehler

WICHTIG:
- KEIN git commit
- Baue die Skalierung NICHT neu. Sie ist fertig. Du verifizierst.
- AENDERE NICHT src/core/constants.ts-Konstanten, um Tests gruen zu kriegen.
  Wenn eine Konstante falsch getuned ist, SAG ES im Bericht mit deinen
  gemessenen Zahlen, statt sie eigenmaechtig zu verschieben.
- Wenn etwas nicht stimmt, melde es. Ein roter Test mit Begruendung ist
  mehr wert als ein gruener, der nichts aussagt.
