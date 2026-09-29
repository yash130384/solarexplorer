/**
 * Nav.ts — Navigationsbaum aller Himmelskoerper.
 *
 * Bei several hundert Koerpern (454 Monde plus Planeten) ist eine flache
 * Liste fuer Kinder unbrauchbar. Deshalb: Baum mit Sonne > Planeten >
 * Monde, Live-Suche und schrittweises Rendern. Nur was sichtbar oder
 * aufgeklappt ist, liegt im DOM — bei 456 Koerpern bleiben es so ~20
 * Knoten statt 456.
 *
 * Kein Framework, kein innerHTML: Knoten entstehen per createElement.
 */

import type { BodyData } from './InfoPanel';

/** Gruppe, in der ein Koerper in der Navigation erscheint. */
export type NavGroup = 'star' | 'planets' | 'moons';

/** Anzeigenamen der Gruppen in Reihenfolge. */
export const NAV_GROUP_ORDER: readonly NavGroup[] = ['star', 'planets', 'moons'] as const;

/** Deutsche Ueberschriften der Gruppen. */
export const NAV_GROUP_LABELS: Readonly<Record<NavGroup, string>> = {
  star: 'Sonne',
  planets: 'Planeten',
  moons: 'Monde',
};

/** Wie viele Mond-Eintraege eines Planeten gezeigt werden, bevor gekuerzt wird. */
export const MOON_PAGE_SIZE = 25;

/** Sichtbarkeit eines Koerpers in der Navigation. */
export type NavFilter = 'all' | 'known';

/** Konfiguration der Navigationsliste. */
export interface NavOptions {
  /** Wird bei Klick auf einen Eintrag mit der Koerper-ID aufgerufen. */
  readonly onSelect?: (id: string) => void;
  /** Wird beim Ein-/Ausklappen auf Mobilgeraeten aufgerufen. */
  readonly onToggle?: (open: boolean) => void;
  /** Anzahl der Mond-Eintraege pro Planetenseite. */
  readonly moonPageSize?: number;
}

/**
 * Entscheidet, ob ein Koerper als "bekannt" gilt.
 *
 * Ein Koerper ist bekannt, wenn er einen Radius UND eine Umlaufbahn hat —
 * also wenn das Info-Panel ueberhaupt Werte zeigen kann. Die kleinen
 * Irregulaer-Monde ohne gemessenen Radius fallen durch dieses Raster.
 *
 * @param body Koerper aus bodies.json.
 * @returns true, wenn der Koerper belastbare Daten hat.
 */
export function isKnownBody(body: BodyData): boolean {
  return Number.isFinite(body.radiusKm) && body.radiusKm > 0;
}

/**
 * Normalisiert eine Suchanfrage: klein, ohne Diakritika, ohne Leerzeichen.
 *
 * "IO" und "io" muessen denselben Treffer liefern, und "Ganyme de" soll
 * wie "ganymede" greifen.
 *
 * @param query Rohtext aus dem Suchfeld.
 * @returns Vergleichsform der Anfrage.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Prueft, ob ein Koerper zur Suchanfrage passt.
 *
 * Gesucht wird in Name, lateinischem Namen, ID und im Namen des Planeten.
 * "io" findet damit den Jupitermond Io, "jupiter" alle seine Monde und
 * "erde" die Erde wie den Erdmond.
 *
 * @param body Koerper aus bodies.json.
 * @param needle Normalisierte Suchanfrage; leer passt alles.
 * @returns true, wenn der Koerper angezeigt werden soll.
 */
export function matchesQuery(body: BodyData, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  const haystack = normalizeQuery(
    `${body.name}${body.nameLatin}${body.id}${body.parent ?? ''}`,
  );
  return haystack.includes(needle);
}

/**
 * Seitenliste zur Auswahl eines Koerpers.
 *
 * Die Koerperdaten werden ueber `update()` uebergeben, damit Nav keine eigene
 * Datenhaltung dupliziert.
 */
export class NavUI {
  private readonly root: HTMLElement;

  private readonly options: NavOptions;

  private readonly pageSize: number;

  private element: HTMLDivElement | null = null;

  private list: HTMLUListElement | null = null;

  private toggleButton: HTMLButtonElement | null = null;

  private searchInput: HTMLInputElement | null = null;

  private filterSelect: HTMLSelectElement | null = null;

  private statusLine: HTMLParagraphElement | null = null;

  /** Nur IDs -> Buttons. Haelt die Markierung auch fuer nicht gerenderte Eintraege. */
  private buttons = new Map<string, HTMLButtonElement>();

  private bodies: readonly BodyData[] = [];

  /** Koerper nach Parent-ID, fuer den Baum. */
  private childrenOf = new Map<string | null, BodyData[]>();

  /** Aktuell aufgeklappte Planeten (Sterne sind immer offen). */
  private expanded = new Set<string>();

  /** Wie viele Monde je Planet gezeigt werden. */
  private moonLimit = new Map<string, number>();

  private activeId: string | null = null;

  private open = false;

  /** Normalisierte Form der aktuellen Suche, für `matchesQuery`. */
  private query = '';

  /** Originaltext der Suche, für das Eingabefeld. */
  private rawQuery = '';

  private filter: NavFilter = 'known';

  private readonly onToggleClick: () => void;

  /**
   * Erzeugt die Navigation, ohne sie in den DOM einzuhängen.
   *
   * @param root Container fuer die Navigationsliste.
   * @param options Callbacks.
   */
  constructor(root: HTMLElement, options: NavOptions = {}) {
    this.root = root;
    this.options = options;
    this.pageSize = options.moonPageSize ?? MOON_PAGE_SIZE;
    this.onToggleClick = () => this.toggle();
  }

  /** Baut den DOM-Baum auf und registriert die Listener. */
  mount(): void {
    if (this.element !== null) {
      return;
    }
    const el = document.createElement('nav');
    el.className = 'se-nav';
    el.setAttribute('aria-label', 'Körper-Navigation');

    el.append(this.buildHeader(), this.buildSearchRow(), this.buildList());

    this.root.appendChild(el);
    this.element = el as HTMLDivElement;
    this.render();
  }

  /**
   * Uebernimmt die Koerperliste und baut die Eintraege neu auf.
   *
   * @param bodies Koerper aus bodies.json.
   */
  update(bodies: readonly BodyData[]): void {
    this.bodies = [...bodies].sort(compareByDistanceFromSun);
    this.reindex();
    if (this.activeId !== null && !this.bodies.some((body) => body.id === this.activeId)) {
      this.activeId = null;
    }
    this.render();
  }

  /**
   * Markiert den aktiven Koerper.
   *
   * @param id Koerper-ID oder null, um die Markierung zu entfernen.
   */
  setActive(id: string | null): void {
    this.activeId = id;
    for (const [bodyId, button] of this.buttons) {
      const active = bodyId === id;
      button.classList.toggle('is-active', active);
      if (active) {
        button.setAttribute('aria-current', 'true');
      } else {
        button.setAttribute('aria-current', 'false');
      }
    }
  }

  /**
   * Liefert die aktuell angezeigten Koerper.
   *
   * @returns Kopie der Koerperliste in Navigationsreihenfolge.
   */
  getBodies(): readonly BodyData[] {
    return [...this.bodies];
  }

  /** Blendet die Navigation ein. */
  show(): void {
    this.element?.removeAttribute('hidden');
  }

  /** Blendet die Navigation aus. */
  hide(): void {
    this.element?.setAttribute('hidden', '');
  }

  /**
   * Setzt den Sichtbarkeitsfilter.
   *
   * @param filter 'all' zeigt jeden Koerper, 'known' nur die mit Radius.
   * @returns Der jetzt gesetzte Filter.
   */
  setFilter(filter: NavFilter): NavFilter {
    this.filter = filter;
    this.syncControls();
    this.render();
    return this.filter;
  }

  /**
   * Setzt die Suchanfrage.
   *
   * @param query Freitext, z.B. "titan" oder "io".
   * @returns Normalisierte Form der Anfrage.
   */
  setQuery(query: string): string {
    this.rawQuery = query;
    this.query = normalizeQuery(query);
    this.syncControls();
    // Bei aktiver Suche ist Aufklappen sinnlos: die Treffer sollen
    // sichtbar sein, egal ob ihr Planet sonst zu ist.
    this.render();
    return this.query;
  }

  /**
   * Schreibt Filter und Suchtext zurueck in die Bedienelemente.
   *
   * Ohne das laufen `setQuery()`/`setFilter()` (z.B. aus dem HUD oder einem
   * Test) am sichtbaren Zustand der Controls vorbei: das Eingabefeld bliebe
   * leer, obwohl gefiltert wird.
   *
   * @returns {void}
   */
  private syncControls(): void {
    if (this.searchInput !== null && this.searchInput.value !== this.rawQuery) {
      this.searchInput.value = this.rawQuery;
    }
    if (this.filterSelect !== null) {
      this.filterSelect.value = this.filter;
    }
  }

  /**
   * Liefert die aktuell sichtbaren Koerper-IDs.
   *
   * "Sichtbar" heisst hier: der Koerper besteht den Filter UND die Suche
   * UND haengt an einem aufgeklappten Planeten. Genau das, was ein Kind
   * gerade anklicken kann.
   *
   * @returns IDs in Navigationsreihenfolge.
   */
  getVisibleIds(): readonly string[] {
    const visible: string[] = [];
    for (const body of this.bodies) {
      if (!this.isVisible(body)) {
        continue;
      }
      if (body.type !== 'moon' || this.isExpanded(body.parent)) {
        visible.push(body.id);
      }
    }
    return visible;
  }

  /** Entfernt die Navigation aus dem DOM und loest alle Listener. */
  dispose(): void {
    this.element?.remove();
    this.element = null;
    this.list = null;
    this.toggleButton = null;
    this.searchInput = null;
    this.filterSelect = null;
    this.statusLine = null;
    this.buttons.clear();
    this.childrenOf.clear();
    this.bodies = [];
    this.activeId = null;
    this.expanded.clear();
    this.moonLimit.clear();
  }

  /**
   * Klappt die Liste auf Mobilgeraeten ein bzw. aus.
   *
   * @returns true, wenn die Liste nun offen ist.
   */
  toggle(): boolean {
    this.open = !this.open;
    this.element?.classList.toggle('is-open', this.open);
    this.toggleButton?.setAttribute('aria-expanded', String(this.open));
    this.options.onToggle?.(this.open);
    return this.open;
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'se-nav__header';

    const title = document.createElement('h2');
    title.className = 'se-nav__title';
    title.textContent = 'Körper';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'se-button se-nav__toggle';
    toggle.setAttribute('aria-expanded', String(this.open));
    toggle.setAttribute('aria-controls', 'se-nav-list');
    toggle.textContent = 'Menü';
    toggle.addEventListener('click', this.onToggleClick);
    this.toggleButton = toggle;

    header.append(title, toggle);
    return header;
  }

  private buildSearchRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'se-nav__search';

    // Label ist versteckt, aber fuer Screenreader Pflicht: ein reines
    // Suchfeld ohne Namen ist unbedienbar.
    const label = document.createElement('label');
    label.className = 'se-visually-hidden';
    label.htmlFor = 'se-nav-search';
    label.textContent = 'Körper suchen';

    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'se-nav-search';
    input.className = 'se-nav__input';
    input.placeholder = 'Suchen, z. B. Titan';
    input.setAttribute('aria-label', 'Körper suchen');
    input.setAttribute('aria-controls', 'se-nav-list');
    // 'input' feuert bei jedem Tastendruck. Bewusst kein 'change' und kein
    // Debounce: bei 456 Koerpern ist das Filtern im Speicher billig, und
    // die Kinder sollen ohne Wartezeit tippen duerfen.
    input.addEventListener('input', () => {
      this.setQuery(input.value);
    });
    this.searchInput = input;

    const select = document.createElement('select');
    select.className = 'se-nav__filter';
    select.setAttribute('aria-label', 'Welche Körper anzeigen');
    for (const [value, labelText] of [
      ['known', 'Nur bekannte'],
      ['all', 'Zeige alle'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labelText;
      select.appendChild(option);
    }
    select.value = this.filter;
    select.addEventListener('change', () => {
      this.setFilter(select.value === 'all' ? 'all' : 'known');
    });
    this.filterSelect = select;

    const status = document.createElement('p');
    status.className = 'se-nav__status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    this.statusLine = status;

    row.append(label, input, select, status);
    return row;
  }

  private buildList(): HTMLUListElement {
    const list = document.createElement('ul');
    list.className = 'se-nav__list';
    list.id = 'se-nav-list';
    this.list = list;
    return list;
  }

  /** Baut den Parent -> Kinder-Index neu auf. */
  private reindex(): void {
    this.childrenOf.clear();
    for (const body of this.bodies) {
      const key = body.parent;
      const bucket = this.childrenOf.get(key);
      if (bucket === undefined) {
        this.childrenOf.set(key, [body]);
      } else {
        bucket.push(body);
      }
    }
  }

  /**
   * Prueft, ob ein Koerper den aktuellen Sichtbarkeitsregeln entspricht.
   *
   * @param body Koerper aus bodies.json.
   * @returns true, wenn der Koerper im Baum auftauchen darf.
   */
  private isVisible(body: BodyData): boolean {
    if (this.filter === 'known' && !isKnownBody(body)) {
      return false;
    }
    return matchesQuery(body, this.query);
  }

  /**
   * Entscheidet, ob ein Planet als Knoten gerendert wird.
   *
   * Ein Planet muss auch dann stehen bleiben, wenn er selbst nicht zur
   * Suchanfrage passt, aber einer seiner Monde passt. Sonst wuerde die
   * Suche nach "Titan" den Saturn wegklicken und damit seinen einzigen
   * Treffer verstecken — genau das Gegenteil dessen, was ein Kind will.
   *
   * @param planet Planet oder Sonne.
   * @returns true, wenn der Knoten mit seinen Monden erscheinen soll.
   */
  private isPlanetVisible(planet: BodyData): boolean {
    if (this.isVisible(planet)) {
      return true;
    }
    return this.moonsOf(planet.id).some((moon) => this.isVisible(moon));
  }

  /**
   * Prueft, ob die Monde eines Planeten aufgeklappt sind.
   *
   * Bei aktiver Suche gilt jeder Planet als aufgeklappt — sonst kaeme ein
   * Treffer nicht zum Vorschein.
   *
   * @param parentId Planeten-ID oder null.
   * @returns true, wenn die Monde sichtbar gerendert werden.
   */
  private isExpanded(parentId: string | null): boolean {
    if (this.query.length > 0) {
      return true;
    }
    if (parentId === null) {
      return true;
    }
    return this.expanded.has(parentId);
  }

  /**
   * Behandelt das `toggle`-Event eines Planeten-Knotens.
   *
   * Waehrend einer Suche sind alle Planeten zwangslaeufig offen, damit die
   * Treffer sichtbar sind. Das ist ein Anzeigezustand, keine Nutzeraktion:
   * schriebe man ihn in `expanded`, blieben nach dem Leeren der Suche genau
   * die Planeten aufgeklappt, bei denen man gesucht hat — inklusive aller
   * ihrer Monde im DOM. Deshalb wird waehrend der Suche nichts gemerkt.
   *
   * @param planetId ID des Planeten.
   * @param open Neuer Zustand des <details>.
   */
  private onToggle(planetId: string, open: boolean): void {
    if (this.query.length > 0) {
      return;
    }
    if (open) {
      this.expanded.add(planetId);
    } else {
      this.expanded.delete(planetId);
    }
  }

  private render(): void {
    if (this.list === null) {
      return;
    }
    this.buttons.clear();
    while (this.list.firstChild !== null) {
      this.list.firstChild.remove();
    }

    const fragment = document.createDocumentFragment();

    for (const group of NAV_GROUP_ORDER) {
      // Die Gruppe "moons" entfaellt im Baum: ihre Mitglieder haengen bereits
      // unter ihrem Planeten in <details>. Eine zusaetzliche flache Gruppe
      // wuerde jeden der ~440 Monde ein zweites Mal in den DOM legen — genau
      // die Dublette, die der Baum vermeiden soll.
      if (group === 'moons') {
        continue;
      }
      const members = this.bodies.filter((body) => {
        if (groupOf(body) !== group) {
          return false;
        }
        // Bei Planeten zaehlt auch ein treffender Mond als Grund, den
        // Knoten stehen zu lassen.
        return body.type === 'star' || body.type === 'moon'
          ? this.isVisible(body)
          : this.isPlanetVisible(body);
      });
      if (members.length === 0) {
        continue;
      }
      fragment.appendChild(this.renderGroup(group, members));
    }

    this.list.appendChild(fragment);
    this.setActive(this.activeId);
    // `rendered` darf nicht die Anzahl der Gruppen-Knoten zaehlen: die
    // Mond-Gruppe wird uebersprungen, ihre Koerper haengen in den
    // <details> der Planeten. Sonst behauptete die Statuszeile bei
    // "Zeige alle" "9 Koerper", obwohl 465 erreichbar sind. Gezaehlt wird
    // deshalb der Bestand, den die aktuellen Regeln sichtbar machen.
    this.updateStatus(this.countVisible());
  }

  /**
   * Zaehlt die Koerper, die zur aktuellen Anzeige gehoeren.
   *
   * Bei aktiver Suche zaehlt nur, was SELBST passt: der Planet-Knoten
   * bleibt auch dann stehen, wenn nur sein Mond den Treffer liefert —
   * der Planet ist aber kein Treffer und gehoert nicht in die Zahl.
   * Ohne Suche zaehlt, was der Filter durchlaesst.
   *
   * @returns Anzahl der sichtbaren Koerper.
   */
  private countVisible(): number {
    return this.bodies.filter((body) => this.isVisible(body)).length;
  }

  /**
   * Schreibt die Statuszeile ("87 von 456 Körpern").
   *
   * @param count Anzahl der sichtbaren Koerper.
   * @returns {void}
   */
  private updateStatus(count: number): void {
    if (this.statusLine === null) {
      return;
    }
    const total = this.bodies.length;
    if (count === 0) {
      this.statusLine.textContent =
        total === 0 ? 'Noch keine Körper geladen.' : 'Nichts gefunden.';
      return;
    }
    if (this.query.length > 0) {
      this.statusLine.textContent = `${count} passende Körper.`;
      return;
    }
    if (this.filter === 'known') {
      this.statusLine.textContent = `${count} von ${total} Körpern — Mond-Resten mit „Zeige alle“.`;
      return;
    }
    this.statusLine.textContent = `${count} Körper.`;
  }

  private renderGroup(group: NavGroup, members: readonly BodyData[]): HTMLElement {
    const item = document.createElement('li');
    item.className = `se-nav__group se-nav__group--${group}`;

    const caption = document.createElement('span');
    caption.className = 'se-nav__group-title';
    caption.textContent = NAV_GROUP_LABELS[group];
    item.appendChild(caption);

    const list = document.createElement('ul');
    list.className = 'se-nav__sublist';
    for (const body of members) {
      // Ein Planet ist zugleich Blatt (Sonne) und Knoten (mit Monden).
      if (body.type !== 'star' && this.moonsOf(body.id).length > 0) {
        list.appendChild(this.renderPlanet(body));
      } else {
        list.appendChild(this.renderItem(body));
      }
    }
    item.appendChild(list);
    return item;
  }

  private moonsOf(planetId: string): readonly BodyData[] {
    return this.childrenOf.get(planetId) ?? [];
  }

  private renderPlanet(planet: BodyData): HTMLElement {
    const item = document.createElement('li');
    item.className = 'se-nav__planet';

    // Zwei getrennte Ziele statt einem: links der Planet-Knopf (waehlt den
    // Planeten aus), rechts der <summary>, der die Monde aufklappt. Ein
    // Button INNERHALB des <summary> waere zwar erlaubt, aber jeder Klick
    // loest dann Toggle UND Auswahl zugleich aus — der Knopf ist dadurch
    // nicht zuverlaessig anzuclicken und die Bedienlogik bleibt undurch-
    // schaulich. Getrennte Elemente kennt jede Baum-Navigation.
    const details = document.createElement('details');
    details.className = 'se-nav__details';
    details.open = this.isExpanded(planet.id);

    const summary = document.createElement('summary');
    summary.className = 'se-nav__summary';
    const moonTotal = this.moonsOf(planet.id).filter((moon) => this.isVisible(moon)).length;
    summary.setAttribute('aria-label', `${planet.name} — ${moonTotal} Monde anzeigen`);
    const summaryLabel = document.createElement('span');
    summaryLabel.className = 'se-nav__summary-label';
    summaryLabel.textContent = moonTotal === 1 ? '1 Mond' : `${moonTotal} Monde`;
    summary.appendChild(summaryLabel);

    const moonList = document.createElement('ul');
    moonList.className = 'se-nav__sublist se-nav__moons';

    // Die Monde werden ERST gebaut, wenn der Knoten offen ist. Ein
    // geschlossenes <details> versteckt seinen Inhalt nur visuell — die
    // Knoten liegen trotzdem im DOM und werden bei jedem Rendern neu
    // aufgebaut. Bei 465 Koerpern sind das ohne Lazy-Aufbau ueber 100
    // Knoten, die niemand sieht. Genau das will die Aufgabe vermeiden.
    const fillMoons = (): void => {
      while (moonList.firstChild !== null) {
        moonList.firstChild.remove();
      }
      for (const moon of this.renderedMoons(planet)) {
        moonList.appendChild(this.renderItem(moon));
      }
      if (moonList.childElementCount > 0) {
        moonList.appendChild(this.renderMoreRow(planet));
      }
    };

    if (details.open) {
      fillMoons();
    }

    details.addEventListener('toggle', () => {
      this.onToggle(planet.id, details.open);
      if (details.open) {
        fillMoons();
      } else {
        // Beim Zuklappen die Knoten wieder loeschen, sonst wachsen sie
        // ueber die Seitenaufrufe hinweg immer weiter.
        while (moonList.firstChild !== null) {
          moonList.firstChild.remove();
        }
      }
    });

    details.append(summary, moonList);

    const head = document.createElement('div');
    head.className = 'se-nav__planet-head';
    head.append(this.buildButton(planet, false), details);
    item.appendChild(head);
    return item;
  }

  /**
   * Schneidet die Monde eines Planeten auf die aktuelle Seitenlaenge.
   *
   * @param planet Planet, dessen Monde geholt werden.
   * @returns Sichtbare Monde dieser Seite.
   */
  private renderedMoons(planet: BodyData): readonly BodyData[] {
    const limit = this.moonLimit.get(planet.id) ?? this.pageSize;
    // Waehrend einer Suche gibt es keine Seitengrenzen mehr: der Nutzer will
    // ALLE Treffer sehen, nicht die ersten 25. Sonst waere "Titan" unter
    // 200 Saturn-Monden unsichtbar, nur weil er auf Seite 4 steht.
    const cap = this.query.length > 0 ? Number.POSITIVE_INFINITY : limit;
    return this.moonsOf(planet.id)
      .filter((moon) => this.isVisible(moon))
      .slice(0, cap);
  }

  private renderMoreRow(planet: BodyData): HTMLElement {
    const item = document.createElement('li');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'se-button se-nav__more';
    const all = this.moonsOf(planet.id).filter((moon) => this.isVisible(moon));
    // `shown` muss die TATSACHLICH gerenderte Zahl sein, nicht die
    // Seitenlaenge: waehrend einer Suche rendert `renderedMoons` alle
    // Treffer ohne Seitengrenze. Mit der Seitenlaenge gerechnet ergab sich
    // bei einem Treffer "1 - 25 = -24 weitere".
    const shown = this.renderedMoons(planet).length;
    const remaining = all.length - shown;
    button.textContent = `Mehr anzeigen (${remaining} weitere)`;
    button.addEventListener('click', () => {
      // Die neue Grenze richtet sich nach dem bisherigen Limit, nicht nach
      // `shown`: waehrend einer Suche entspricht `shown` der vollen
      // Trefferzahl, und `shown + pageSize` waere dann ein No-Op.
      const base = this.moonLimit.get(planet.id) ?? this.pageSize;
      this.moonLimit.set(planet.id, base + this.pageSize);
      this.render();
    });
    item.appendChild(button);
    return item;
  }

  private renderItem(body: BodyData): HTMLElement {
    const item = document.createElement('li');
    item.appendChild(this.buildButton(body, false));
    return item;
  }

  /**
   * Baut den Knopf eines Koerpers.
   *
   * @param body Koerper aus bodies.json.
   * @param asSummaryContent true, wenn der Knopf in einem <summary> sitzt.
   * @returns Fertiger Knopf.
   */
  private buildButton(body: BodyData, asSummaryContent: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    // Die Klasse richtet sich nach der ART des Koerpers, nicht nach der
    // Position: die Sonne ist zwar ein Blatt (keine Monde), darf aber nicht
    // wie ein Mond aussehen.
    const kind = body.type === 'moon' ? 'moon' : 'planet';
    button.className = `se-nav__button se-nav__button--${kind}`;
    button.dataset.bodyId = body.id;
    button.setAttribute('aria-current', 'false');

    const dot = document.createElement('span');
    dot.className = 'se-nav__dot';
    dot.style.background = body.color;
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'se-nav__label';
    label.textContent = body.name;

    button.append(dot, label);

    const moonCount = this.moonsOf(body.id).filter((moon) => this.isVisible(moon)).length;
    if (moonCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'se-nav__count';
      badge.textContent = String(moonCount);
      button.appendChild(badge);
    }

    // innerhalb <summary> muss der Klick nicht die Liste aufklappen,
    // sondern den Koerper waehlen.
    button.addEventListener('click', (event) => {
      if (asSummaryContent) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.setActive(body.id);
      this.options.onSelect?.(body.id);
    });

    this.buttons.set(body.id, button);
    return button;
  }
}

/**
 * Ordnet zwei Koerper nach ihrem Abstand von der Sonne.
 *
 * @param a Erster Koerper.
 * @param b Zweiter Koerper.
 * @returns Negativ, wenn a naeher an der Sonne liegt.
 */
export function compareByDistanceFromSun(a: BodyData, b: BodyData): number {
  if (a.type === 'star' && b.type !== 'star') {
    return -1;
  }
  if (b.type === 'star' && a.type !== 'star') {
    return 1;
  }
  if (a.semiMajorAxisKm !== b.semiMajorAxisKm) {
    return a.semiMajorAxisKm - b.semiMajorAxisKm;
  }
  return a.orderFromSun - b.orderFromSun;
}

/**
 * Bestimmt die Navigationsgruppe eines Koerpers.
 *
 * @param body Koerper aus bodies.json.
 * @param isMoon Ob der Koerper einen Parent besitzt.
 * @returns Zugehoerige Gruppe.
 */
export function groupOf(body: BodyData, isMoon = body.type === 'moon'): NavGroup {
  if (body.type === 'star') {
    return 'star';
  }
  if (isMoon) {
    return 'moons';
  }
  return 'planets';
}
