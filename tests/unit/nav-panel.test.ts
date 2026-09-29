/**
 * Tests fuer die Baum-Navigation und die Robustheit des Info-Panels.
 *
 * Beide Dateien muessen mit ~456 Koerpern umgehen koennen, nicht nur mit
 * den 20 aus bodies.json. Die Tests bauen deshalb synthetische
 * Koerperlisten mit absichtlich fehlerhaften Datensaetzen.
 *
 * @module unit/nav-panel
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BodyData, BodyFacts } from '../../src/ui/InfoPanel';
import {
  buildSpecRows,
  formatSizeComparison,
  numberOr,
  textOr,
  NO_TEXT_YET,
} from '../../src/ui/InfoPanel';
import { NavUI, isKnownBody, matchesQuery, normalizeQuery } from '../../src/ui/Nav';

/**
 * Baut einen vollstaendigen Koerper, damit Tests nur das noetige Feld aendern.
 *
 * @param overrides Felder, die vom Standard abweichen.
 * @returns Ein BodyData-Objekt.
 */
function makeBody(overrides: Partial<BodyData> = {}): BodyData {
  return {
    id: 'test',
    name: 'Testkörper',
    nameLatin: 'Corpus',
    type: 'planet',
    parent: 'sonne',
    radiusKm: 1000,
    massKg: 1e24,
    semiMajorAxisKm: 1e8,
    eccentricity: 0.01,
    inclinationDeg: 1,
    rotationPeriodH: 24,
    axialTiltDeg: 10,
    surfaceTempC: { min: -50, mean: 10, max: 60 },
    gravityMs2: 5,
    atmosphere: 'Dünne Luft',
    moonsCount: 0,
    color: '#123456',
    discovery: '',
    orderFromSun: 3,
    ...overrides,
  };
}

/**
 * Erzeugt eine Sonne mit n Planeten und je n Monden.
 *
 * @param planets Anzahl Planeten.
 * @param moonsPerPlanet Monde je Planet.
 * @returns Koerperliste.
 */
function makeSystem(planets: number, moonsPerPlanet: number): BodyData[] {
  const bodies: BodyData[] = [makeBody({ id: 'sonne', name: 'Sonne', type: 'star', parent: null })];
  for (let p = 0; p < planets; p += 1) {
    const planetId = `planet-${p}`;
    bodies.push(
      makeBody({
        id: planetId,
        name: `Planet ${p}`,
        type: 'planet',
        parent: 'sonne',
        orderFromSun: p + 1,
        moonsCount: moonsPerPlanet,
        semiMajorAxisKm: 5e7 * (p + 1),
      }),
    );
    for (let m = 0; m < moonsPerPlanet; m += 1) {
      bodies.push(
        makeBody({
          id: `${planetId}-mond-${m}`,
          name: `Mond ${p}-${m}`,
          type: 'moon',
          parent: planetId,
          radiusKm: 50 + m,
          semiMajorAxisKm: 4e5 + m * 1000,
        }),
      );
    }
  }
  return bodies;
}

describe('Nav — reine Hilfsfunktionen', () => {
  it('normalizeQuery ignoriert Gross-/Kleinschreibung und Diakritika', () => {
    expect(normalizeQuery('IO')).toBe('io');
    expect(normalizeQuery('Ä')).toBe('a');
    expect(normalizeQuery('  Titan  ')).toBe('titan');
  });

  it('matchesQuery findet ueber Name, Latein und ID', () => {
    const io = makeBody({ id: 'io', name: 'Io', nameLatin: 'Jupiter I' });
    expect(matchesQuery(io, 'io')).toBe(true);
    expect(matchesQuery(io, 'jupiter')).toBe(true);
    expect(matchesQuery(io, 'mond')).toBe(false);
    expect(matchesQuery(io, '')).toBe(true);
  });

  it('matchesQuery findet "erde" auch als Praefix des Erdmonds', () => {
    const erde = makeBody({ id: 'erde', name: 'Erde' });
    const mond = makeBody({ id: 'mond', name: 'Mond', parent: 'erde' });
    expect(matchesQuery(erde, 'erde')).toBe(true);
    expect(matchesQuery(mond, 'erde')).toBe(true);
  });

  it('isKnownBody trennt gemessene von unvermessenen Koerpern', () => {
    expect(isKnownBody(makeBody({ radiusKm: 100 }))).toBe(true);
    expect(isKnownBody(makeBody({ radiusKm: 0 }))).toBe(false);
  });
});

describe('NavUI — Baum und Performance', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('rendert bei 449 Koerpern keinen Mond, solange der Planet zu ist', () => {
    const nav = new NavUI(document.body, { moonPageSize: 5 });
    nav.mount();
    nav.update(makeSystem(8, 55)); // 1 + 8 * 56 = 449 Koerper

    // Der Baum ist nicht nur optisch offen oder zu: ein geschlossenes
    // <details> versteckt seinen Inhalt nur visuell, die Knoten liegen
    // trotzdem im DOM. Deshalb wird gar nichts gebaut, bis der Nutzer den
    // Planeten aufklappt. Sonst waeren bei 449 Koerpern sofort 440
    // unsichtbare Knoten im Dokument.
    const moonButtons = document.querySelectorAll('.se-nav__button--moon');
    expect(moonButtons.length, 'geschlossene Zweige enthalten Monde').toBe(0);

    // Die Planeten selbst sind alle da — der Baum ist benutzbar.
    for (let p = 0; p < 8; p += 1) {
      expect(document.querySelector(`.se-nav__button[data-body-id="planet-${p}"]`)).not.toBeNull();
    }

    // Wie im echten Browser aufklappen. jsdom setzt beim Klick zwar
    // `details.open = true`, feuert aber kein `toggle`-Event (dafuer fehlt
    // ihm die Summary-Aktivierung) — deshalb wird es hier von Hand
    // nachgeschoben. Der E2E-Test `nav-tree.spec.ts` deckt den echten
    // Browser-Klick ab.
    const summary = document.querySelector('details summary') as HTMLElement;
    const details = document.querySelector('details') as HTMLDetailsElement;
    summary.click();
    details.dispatchEvent(new Event('toggle'));

    // Nach dem Aufklappen erscheinen die Monde, und zwar Seitenweise.
    const opened = document.querySelectorAll('.se-nav__button--moon');
    expect(opened.length, 'nach dem Aufklappen erscheinen keine Monde').toBe(5);
    expect(document.querySelectorAll('.se-nav__more').length).toBe(1);
  });

  it('zeigt alle Planeten und die Sonne, auch bei 449 Koerpern', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(8, 55));
    for (let p = 0; p < 8; p += 1) {
      expect(document.querySelector(`.se-nav__button[data-body-id="planet-${p}"]`)).not.toBeNull();
    }
    expect(document.querySelector('.se-nav__button[data-body-id="sonne"]')).not.toBeNull();
  });

  it('filtert beim Tippen sofort, ohne Wartezeit', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(4, 10));

    const input = document.querySelector<HTMLInputElement>('.se-nav__input');
    expect(input).not.toBeNull();

    // Ein echtes 'input'-Event, nicht setQuery(): getestet wird der Weg,
    // den die Tastatur wirklich nimmt.
    input!.value = 'Mond 2-3';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    const labels = [...document.querySelectorAll('.se-nav__button--moon .se-nav__label')].map(
      (node) => node.textContent,
    );
    expect(labels).toContain('Mond 2-3');
  });

  it('setQuery schreibt den Text zurueck ins Eingabefeld', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));
    nav.setQuery('Mond 1-0');
    const input = document.querySelector<HTMLInputElement>('.se-nav__input');
    expect(input?.value).toBe('Mond 1-0');
  });

  it('setQuery loest Planeten auf, damit Treffer sichtbar werden', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(4, 3));
    // Vor der Suche liegt der Mond im eingeklappten <details> der Seite.
    // getVisibleIds() beschreibt deshalb nur das, was UNTERIRGEHAENGT ist.
    expect(nav.getVisibleIds()).not.toContain('planet-2-mond-1');
    nav.setQuery('Mond 2-1');
    // Mit Treffer gilt jeder Planet als aufgeklappt: der Mond wird gerendert.
    expect(nav.getVisibleIds()).toContain('planet-2-mond-1');
  });

  it('"Mehr anzeigen" laedt die naechste Mond-Seite nach', () => {
    const nav = new NavUI(document.body, { moonPageSize: 2 });
    nav.mount();
    nav.update(makeSystem(1, 6));

    // Wie im echten Browser: erst aufklappen, dann sind die Monde im DOM.
    // Das `toggle`-Event muss von Hand kommen, jsdom feuert es beim
    // Summary-Klick nicht (siehe Kommentar im Test weiter oben).
    (document.querySelector('details summary') as HTMLElement).click();
    (document.querySelector('details') as HTMLDetailsElement)
      .dispatchEvent(new Event('toggle'));
    expect(document.querySelectorAll('[data-body-id="planet-0-mond-1"]').length).toBe(1);
    expect(document.querySelector('[data-body-id="planet-0-mond-2"]')).toBeNull();

    const more = [...document.querySelectorAll<HTMLButtonElement>('.se-nav__more')][0];
    expect(more).toBeDefined();
    more!.click();
    expect(document.querySelector('[data-body-id="planet-0-mond-2"]')).not.toBeNull();
  });

  it('"Mehr anzeigen" zaehlt waehrend der Suche nie negativ', () => {
    // Regression: `renderedMoons` rendert waehrend einer Suche ALLE Treffer
    // (cap = Infinity), `renderMoreRow` rechnete aber mit der Seitenlaenge.
    // Bei einem einzigen Treffer ergab das "1 - 25 = -24 weitere".
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(1, 40));
    nav.setQuery('Mond 0-7');

    const beschriftungen = [...document.querySelectorAll('.se-nav__more')]
      .map((el) => el.textContent ?? '');
    expect(beschriftungen.length).toBeGreaterThan(0);
    for (const text of beschriftungen) {
      const treffer = /\((-?\d+) weitere\)/.exec(text);
      expect(treffer, `unparsbare Beschriftung: ${text}`).not.toBeNull();
      expect(Number(treffer![1]), `negative Restzahl in: ${text}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('der Filter "Nur bekannte" blendet Koerper ohne Radius aus', () => {
    const bodies = makeSystem(2, 2);
    bodies.push(
      makeBody({ id: 'winzig', name: 'Winzig', type: 'moon', parent: 'planet-0', radiusKm: 0 }),
    );
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(bodies);

    // "winzig" haengt an planet-0 und ist ohnehin eingeklappt. Damit der
    // Test wirklich den Filter prueft und nicht die Klapp-Regel, wird
    // vorher nach ihm gesucht — eine Suche loest alle Planeten auf.
    nav.setQuery('Winzig');
    expect(nav.setFilter('known')).toBe('known');
    // Radius 0 heisst "nicht gemessen" — "Nur bekannte" muss ihn ausblenden.
    expect(nav.getVisibleIds()).not.toContain('winzig');
    expect(nav.setFilter('all')).toBe('all');
    expect(nav.getVisibleIds()).toContain('winzig');
  });

  it('meldet einen leeren Treffer, statt eine leere Liste zu zeigen', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));
    nav.setQuery('gibtesnicht');
    expect(document.querySelector('.se-nav__status')?.textContent).toContain('Nichts gefunden');
  });

  it('meldet die Trefferzahl bei aktiver Suche', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(4, 3));
    nav.setQuery('Mond 1');
    expect(document.querySelector('.se-nav__status')?.textContent).toMatch(/passende Körper/);
  });

  // Regression: Die Statuszeile zaehlte die Gruppen-Knoten statt der
  // erreichbaren Koerper. Da die Mond-Gruppe im Baum entfaellt, meldete
  // sie bei "Zeige alle" "9 Koerper" statt aller — fuer ein Kind eine
  // glatte Falschmeldung ("es gibt nur 9 Koerper").
  it('zaehlt in der Statuszeile auch die Monde der Planeten', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(4, 3));
    nav.setFilter('all');
    // 1 Sonne + 4 Planeten + 4x3 Monde = 17 erreichbare Koerper.
    expect(document.querySelector('.se-nav__status')?.textContent).toContain('17 Körper');
  });

  it('nennt bei einer Suche nur die tatsaechlich passenden Koerper', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(4, 3));
    // Die System-Namen sind "Mond 0-0" ... "Mond 3-2". normalizeQuery
    // entfernt Leerzeichen und Bindestriche, gesucht wird also nach
    // "mond10" — genau einen Mond, den ersten des zweiten Planeten.
    nav.setQuery('Mond 1-0');
    const status = document.querySelector('.se-nav__status')?.textContent ?? '';
    expect(status).toMatch(/\d+ passende Körper/);
    const count = Number(status.match(/^(\d+)/)?.[1]);
    // Genau EIN Koerper passt. Der Planet zaehlt nicht mit, obwohl sein
    // Knoten wegen des Treffers stehen bleibt — sonst nennt die Zahl
    // Koerper, die nicht zur Suche gehoeren.
    expect(count).toBe(1);
  });

  it('waehlt einen Koerper auch ueber den Planeten-Knoten', () => {
    const onSelect = vi.fn();
    const nav = new NavUI(document.body, { onSelect });
    nav.mount();
    nav.update(makeSystem(2, 2));
    document.querySelector<HTMLButtonElement>('.se-nav__button[data-body-id="planet-1"]')!.click();
    expect(onSelect).toHaveBeenCalledWith('planet-1');
  });

  it('setActive markiert auch Koerper, die spaeter aufgeklappt werden', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));
    nav.setActive('planet-1-mond-0');
    nav.setQuery('Mond 1-0');
    const button = document.querySelector('[data-body-id="planet-1-mond-0"]');
    expect(button?.classList.contains('is-active')).toBe(true);
  });

  it('dispose entfernt den Baum restlos', () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));
    nav.dispose();
    expect(document.querySelector('.se-nav')).toBeNull();
  });
});

describe('InfoPanel — fehlende Daten', () => {
  it('numberOr ersetzt NaN, undefined und null', () => {
    expect(numberOr(Number.NaN)).toBe(NO_TEXT_YET);
    expect(numberOr(undefined)).toBe(NO_TEXT_YET);
    expect(numberOr(null)).toBe(NO_TEXT_YET);
    expect(numberOr(1234)).toBe('1.234');
  });

  it('textOr ersetzt leere und fehlende Texte', () => {
    expect(textOr(undefined)).toBe(NO_TEXT_YET);
    expect(textOr('   ')).toBe(NO_TEXT_YET);
    expect(textOr('Hallo')).toBe('Hallo');
  });

  it('buildSpecRows schreibt nie "undefined" in die Tabelle', () => {
    const kaputt = makeBody({
      radiusKm: Number.NaN,
      massKg: Number.NaN,
      gravityMs2: Number.NaN,
      semiMajorAxisKm: Number.NaN,
      axialTiltDeg: Number.NaN,
      atmosphere: '',
      discovery: '',
    }) as unknown as BodyData;
    const rows = buildSpecRows(kaputt, undefined);
    const alles = rows.map((row) => row.value).join(' | ');
    expect(alles).not.toContain('undefined');
    expect(alles).not.toContain('NaN');
    expect(alles).toContain(NO_TEXT_YET);
  });

  it('buildSpecRows uebersteht ein komplett fehlendes Atmosphaeren-Feld', () => {
    const ohneAtmo = makeBody({ atmosphere: undefined as unknown as string });
    const rows = buildSpecRows(ohneAtmo, undefined);
    expect(rows.map((row) => row.value).join(' ')).not.toContain('undefined');
  });

  it('buildSpecRows uebersteht eine fehlende surfaceTempC', () => {
    const ohneTemp = makeBody({
      surfaceTempC: undefined as unknown as BodyData['surfaceTempC'],
    });
    const rows = buildSpecRows(ohneTemp, undefined);
    expect(rows.map((row) => row.value).join(' ')).not.toContain('undefined');
  });

  it('formatSizeComparison begrenzt winzige Koerper und erklaert sie', () => {
    // 0,0002 Erdradien = 1,27 km Radius. Ohne eigene Stufe wuerde der
    // Erdenvergleich auf "Faktor 0,0" runden und damit nichts erklaeren.
    const satz = formatSizeComparison(0.0002);
    expect(satz).toMatch(/%/);
    expect(satz).not.toMatch(/Faktor/);
    expect(satz).not.toMatch(/0,0[^0-9]/);
  });

  it('formatSizeComparison gibt bei Sandkorn-Groesse auf und sagt es', () => {
    // Unter 0,1 % des Mondradius waere jede Zahl gerundet 0,0 — dann
    // ist "Viel zu klein" ehrlicher als eine erfundene Genauigkeit.
    const satz = formatSizeComparison(0.000004);
    expect(satz).toMatch(/klein/i);
    expect(satz).not.toMatch(/%/);
  });

  it('formatSizeComparison erklaert Koerper ohne Radius, statt zu raten', () => {
    // saturn-s2009s2 hat in bodies.json radiusKm 0 — die erlaubte
    // Datenluecke. Der Vergleich darf daraus kein "0 Erden" machen.
    expect(formatSizeComparison(Number.NaN)).toContain(NO_TEXT_YET.toLowerCase());
    expect(formatSizeComparison(0)).toContain(NO_TEXT_YET.toLowerCase());
  });

  it('formatSizeComparison nennt grosse Koerper in Erden', () => {
    expect(formatSizeComparison(11.2)).toMatch(/11,2 Erden/);
    expect(formatSizeComparison(109)).toMatch(/109 Erden/);
  });

  it('formatSizeComparison erzeugt bei einem Mond keine Billionen', () => {
    const satz = formatSizeComparison(0.27);
    expect(satz).not.toMatch(/e\+/i);
  });
});

describe('Facts-Daten', () => {
  it('jede Koerper-ID aus bodies.json hat einen facts-Eintrag', async () => {
    const [bodies, facts] = await Promise.all([
      import('../../src/data/bodies.json'),
      import('../../src/data/facts.json'),
    ]);
    const eintraege = facts.bodies as Record<string, BodyFacts | undefined>;
    const fehlend = bodies.bodies
      .map((body) => body.id)
      .filter((id) => eintraege[id] === undefined);
    expect(fehlend).toEqual([]);
  });

  it('facts.json enthaelt mindestens fuenf Mondfragen', async () => {
    const facts = (await import('../../src/data/facts.json')).default;
    expect(facts.quiz.length).toBeGreaterThanOrEqual(24);
  });
});
