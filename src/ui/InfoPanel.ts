/**
 * InfoPanel.ts — Seitenpanel mit den Details eines Himmelskoerpers.
 *
 * Laedt bodies.json und facts.json selbst per fetch und zeigt Name, Kindtext,
 * Steckbrief, Groessenvergleich und den Bereich "Mehr erfahren".
 *
 * Kein Framework, kein innerHTML: Knoten entstehen per createElement, alle
 * Texte aus JSON werden ueber textContent gesetzt.
 */

/** Typ eines Koerpers laut bodies.json. */
export type BodyType = 'star' | 'planet' | 'moon';

/** Ein Himmelskoerper aus src/data/bodies.json. */
export interface BodyData {
  readonly id: string;
  readonly name: string;
  readonly nameLatin: string;
  readonly type: BodyType;
  readonly parent: string | null;
  readonly radiusKm: number;
  readonly massKg: number;
  readonly semiMajorAxisKm: number;
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  readonly rotationPeriodH: number;
  readonly axialTiltDeg: number;
  readonly surfaceTempC: { readonly min: number; readonly mean: number; readonly max: number };
  readonly gravityMs2: number;
  readonly atmosphere: string;
  readonly moonsCount: number;
  readonly color: string;
  readonly discovery: string;
  readonly orderFromSun: number;
}

/** Rohtyp aus bodies.json. */
export interface BodiesFile {
  readonly bodies: readonly BodyData[];
}

/** Verstaendliche Vergleiche aus facts.json. */
export interface BodyComparisons {
  readonly earths?: number;
  readonly yearLength?: string;
  readonly dayLength?: string;
}

/** Kindtexte zu einem Koerper aus facts.json. */
export interface BodyFacts {
  readonly summary: string;
  readonly funFact: string;
  readonly kidQuestion: string;
  readonly comparisons?: BodyComparisons;
  readonly wouldYouSurvive: string;
}

/** Rohtyp aus facts.json (nur der hier benoetigte Ausschnitt). */
export interface FactsFile {
  readonly bodies: Readonly<Record<string, BodyFacts | undefined>>;
}

/** Datenbasis fuer Steckbrief-Vergleiche. */
export interface ReferenceConstants {
  /** Aequatorradius der Erde in km. */
  readonly earthRadiusKm: number;
  /** Masse der Erde in kg. */
  readonly earthMassKg: number;
}

/** Standardwerte laut AGENTS.md / bodies.json. */
export const DEFAULT_REFERENCE: ReferenceConstants = {
  earthRadiusKm: 6371,
  earthMassKg: 5.972e24,
};

/** Referenzabstand fuer die Balkenbreite des Groessenvergleichs (in Erdradien). */
const SIZE_BAR_MAX_EARTHS = 1200;

/** Obergrenze fuer "So gross wie X Erden", damit der Balken lesbar bleibt. */
const SIZE_BAR_CAP_EARTHS = 150;

/**
 * Ab hier wird der Erdenvergleich unlesbar.
 *
 * Bei 456 Koerpern gibt es auch Trümmer-Moende mit einem Zehntel
 * Millimeter Radius. "So gross wie 0,0000001 Erden" versteht kein Kind und
 * fuellt die Zeile nur. Ab dieser Grenze wechselt die Anzeige auf einen
 * Vergleich mit unserem Mond, dessen Groesse Kinder kennen.
 */
const SIZE_MIN_READABLE_EARTHS = 0.0001;

/** Radius unseres Mondes in km — Bezugsgroesse fuer winzige Koerper. */
const MOON_RADIUS_KM = 1737.4;

/** Text, wenn der Koerper zwar existiert, aber noch keinen Kindtext hat. */
export const NO_TEXT_YET = 'Daten noch nicht erfasst';

/** Anzahl Nachkommastellen in der Anzeige. */
const NUMBER_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Konfigurierbare Pfade und Callbacks des Panels. */
export interface InfoPanelOptions {
  /** Basis-URL fuer die Datendateien. Default './data'. */
  readonly dataBaseUrl?: string;
  /** Wird nach jedem successfulen Laden der Daten aufgerufen. */
  readonly onDataLoaded?: (bodies: readonly BodyData[]) => void;
  /** Wird aufgerufen, wenn Daten nicht geladen werden konnten. */
  readonly onDataError?: (error: Error) => void;
}

/**zeile des Steckbriefs: Beschriftung und Wert. */
interface SpecRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Seitenpanel, das die Informationen zu einem Koerper anzeigt.
 *
 * Typische Nutzung:
 * ```ts
 * const panel = new InfoPanelUI(document.body);
 * panel.mount();
 * panel.showBody('mars');
 * ```
 */
export class InfoPanelUI {
  private readonly root: HTMLElement;

  private readonly options: InfoPanelOptions;

  private element: HTMLDivElement | null = null;

  private title: HTMLHeadingElement | null = null;

  private subtitle: HTMLParagraphElement | null = null;

  private body: HTMLDivElement | null = null;

  private moreButton: HTMLButtonElement | null = null;

  private bodies: readonly BodyData[] = [];

  private facts: FactsFile = { bodies: {} };

  private activeId: string | null = null;

  private dataLoaded = false;

  private loadPromise: Promise<void> | null = null;

  private readonly onKeyDown: (event: KeyboardEvent) => void;

  private readonly onCloseClick: () => void;

  private readonly onMoreClick: () => void;

  /**
   * Erzeugt das Panel, ohne es in den DOM einzuhängen.
   *
   * @param root Container fuer das Panel.
   * @param options Datenpfade und Callbacks.
   */
  constructor(root: HTMLElement, options: InfoPanelOptions = {}) {
    this.root = root;
    this.options = options;
    this.onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    this.onCloseClick = () => this.hide();
    this.onMoreClick = () => this.renderMore();
  }

  /** Baut den DOM-Baum auf und registriert die Listener. */
  mount(): void {
    if (this.element !== null) {
      return;
    }
    const el = document.createElement('aside');
    el.className = 'se-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'se-panel-title');
    el.setAttribute('hidden', '');

    const header = document.createElement('header');
    header.className = 'se-panel__header';

    const heading = document.createElement('h2');
    heading.className = 'se-panel__title';
    heading.id = 'se-panel-title';
    heading.textContent = 'Weltraum-Objekt';
    this.title = heading;

    const subtitle = document.createElement('p');
    subtitle.className = 'se-panel__subtitle';
    subtitle.textContent = '';
    this.subtitle = subtitle;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'se-button se-panel__close';
    close.setAttribute('aria-label', 'Panel schliessen');
    close.textContent = '✕';
    close.addEventListener('click', this.onCloseClick);

    header.append(heading, subtitle, close);

    const body = document.createElement('div');
    body.className = 'se-panel__body';
    this.body = body;

    el.append(header, body);
    this.root.appendChild(el);
    this.element = el as HTMLDivElement;
    document.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * Setzt den anzuzeigenden Koerper und laedt bei Bedarf die Daten.
   *
   * @param id Koerper-ID aus bodies.json.
   */
  showBody(id: string): void {
    this.activeId = id;
    this.show();
    this.renderLoading();
    void this.ensureData()
      .then(() => this.renderBody(id))
      .catch(() => {
        // renderError() hat bereits eine freundliche Meldung gesetzt.
      });
  }

  /**
   * Aktualisiert die Panel-Inhalte fuer einen bereits geladenen Koerper.
   *
   * @param id Koerper-ID; null blendet das Panel aus.
   */
  update(id: string | null): void {
    if (id === null) {
      this.hide();
      return;
    }
    this.showBody(id);
  }

  /** Blendet das Panel ein und setzt den Fokus auf den Schliessen-Knopf. */
  show(): void {
    if (this.element === null) {
      return;
    }
    this.element.removeAttribute('hidden');
    this.element.classList.add('is-open');
  }

  /** Blendet das Panel aus. */
  hide(): void {
    this.activeId = null;
    this.element?.setAttribute('hidden', '');
    this.element?.classList.remove('is-open');
  }

  /**
   * Laedt bodies.json und facts.json genau einmal.
   *
   * @returns Promise, das erfuellt ist, sobald die Daten verfuegbar sind.
   */
  async ensureData(): Promise<void> {
    if (this.dataLoaded) {
      return;
    }
    if (this.loadPromise !== null) {
      return this.loadPromise;
    }
    const base = this.options.dataBaseUrl ?? './data';
    this.loadPromise = (async () => {
      try {
        const [bodies, facts] = await Promise.all([
          fetchJson<BodiesFile>(`${base}/bodies.json`),
          fetchJson<FactsFile>(`${base}/facts.json`),
        ]);
        this.bodies = Array.isArray(bodies.bodies) ? bodies.bodies : [];
        this.facts = facts.bodies !== undefined ? facts : { bodies: {} };
        this.dataLoaded = true;
        this.options.onDataLoaded?.(this.bodies);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.loadPromise = null;
        this.options.onDataError?.(error);
        this.renderError(error);
        throw error;
      }
    })();
    return this.loadPromise;
  }

  /** Entfernt das Panel aus dem DOM und loest alle Listener. */
  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.element?.remove();
    this.element = null;
    this.title = null;
    this.subtitle = null;
    this.body = null;
    this.moreButton = null;
    this.bodies = [];
    this.facts = { bodies: {} };
    this.activeId = null;
    this.dataLoaded = false;
    this.loadPromise = null;
  }

  /**
   * ESC schliesst das Panel.
   *
   * @param event Tastaturereignis.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.activeId !== null) {
      this.hide();
    }
  }

  private clearBody(): void {
    if (this.body === null) {
      return;
    }
    while (this.body.firstChild !== null) {
      this.body.firstChild.remove();
    }
  }

  private setHeading(name: string, latin: string): void {
    if (this.title !== null) {
      this.title.textContent = name;
    }
    if (this.subtitle !== null) {
      this.subtitle.textContent = latin;
    }
  }

  private renderLoading(): void {
    this.setHeading('Einen Moment ...', 'Daten werden geladen');
    this.clearBody();
    if (this.body === null) {
      return;
    }
    const status = document.createElement('p');
    status.className = 'se-panel__status';
    status.setAttribute('role', 'status');
    status.textContent = 'Ich lade die Infos über diesen Körper …';
    this.body.appendChild(status);
  }

  /**
   * Zeigt eine freundliche Fehlermeldung statt Absturz.
   *
   * @param error Fehler aus dem Ladevorgang.
   */
  private renderError(error: Error): void {
    this.setHeading('Ups!', 'Daten nicht gefunden');
    this.clearBody();
    if (this.body === null) {
      return;
    }
    const message = document.createElement('p');
    message.className = 'se-panel__status is-error';
    message.setAttribute('role', 'alert');
    message.textContent =
      'Die Dateien über die Körper konnten nicht geladen werden. ' +
      'Vielleicht läuft der Server noch nicht — bitte lade die Seite neu.';
    const detail = document.createElement('p');
    detail.className = 'se-panel__hint';
    detail.textContent = `Technische Angabe: ${error.message}`;
    this.body.append(message, detail);
  }

  /**
   * Baut das komplette Panel fuer eine Koerper-ID auf.
   *
   * @param id Koerper-ID.
   */
  private renderBody(id: string): void {
    if (this.activeId !== id || this.body === null) {
      return;
    }
    const body = this.bodies.find((entry) => entry.id === id);
    if (body === undefined) {
      this.setHeading('Unbekannter Körper', id);
      this.clearBody();
      const message = document.createElement('p');
      message.className = 'se-panel__status is-error';
      message.setAttribute('role', 'alert');
      message.textContent = `Diesen Körper (${id}) kenne ich leider nicht.`;
      this.body.appendChild(message);
      return;
    }
    const facts = this.facts.bodies[id];

    this.setHeading(body.name, body.nameLatin);
    this.clearBody();

    this.body.append(
      this.renderSummary(textOr(facts?.summary)),
      this.renderFunFact(facts?.funFact),
      this.renderSpecTable(body, facts),
      this.renderSizeCompare(body, facts),
      this.renderMoreSection(body, facts),
    );
  }

  private renderSummary(text: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'se-panel__section';
    const heading = document.createElement('h3');
    heading.className = 'se-panel__section-title';
    heading.textContent = 'Das ist …';
    const paragraph = document.createElement('p');
    paragraph.className = 'se-panel__text';
    paragraph.textContent = text;
    section.append(heading, paragraph);
    return section;
  }

  private renderFunFact(text: string | undefined): HTMLElement {
    const section = document.createElement('section');
    section.className = 'se-panel__section se-panel__section--fact';
    const heading = document.createElement('h3');
    heading.className = 'se-panel__section-title';
    heading.textContent = 'Cool fact';
    const paragraph = document.createElement('p');
    paragraph.className = 'se-panel__text';
    paragraph.textContent = text === undefined || text.trim().length === 0
      ? NO_TEXT_YET
      : text;
    section.append(heading, paragraph);
    return section;
  }

  private renderSpecTable(body: BodyData, facts: BodyFacts | undefined): HTMLElement {
    const section = document.createElement('section');
    section.className = 'se-panel__section';
    const heading = document.createElement('h3');
    heading.className = 'se-panel__section-title';
    heading.textContent = 'Steckbrief';
    const table = document.createElement('table');
    table.className = 'se-spec';
    const caption = document.createElement('caption');
    caption.className = 'se-visually-hidden';
    caption.textContent = `Daten zu ${body.name}`;
    table.appendChild(caption);
    const bodyRows = document.createElement('tbody');
    for (const row of buildSpecRows(body, facts)) {
      bodyRows.appendChild(this.buildSpecRow(row));
    }
    table.appendChild(bodyRows);
    section.append(heading, table);
    return section;
  }

  private buildSpecRow(row: SpecRow): HTMLTableRowElement {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = row.label;
    const td = document.createElement('td');
    td.textContent = row.value;
    tr.append(th, td);
    return tr;
  }

  private renderSizeCompare(body: BodyData, facts: BodyFacts | undefined): HTMLElement {
    const section = document.createElement('section');
    section.className = 'se-panel__section';
    const heading = document.createElement('h3');
    heading.className = 'se-panel__section-title';
    heading.textContent = 'Größenvergleich';

    const earths = facts?.comparisons?.earths ?? safeDivide(body.radiusKm, DEFAULT_REFERENCE.earthRadiusKm);
    const paragraph = document.createElement('p');
    paragraph.className = 'se-panel__text';
    paragraph.textContent = formatSizeComparison(earths);

    const track = document.createElement('div');
    track.className = 'se-meter se-meter--wide';
    track.setAttribute('role', 'img');
    // Der Balken nutzt eine logarithmische Skala ueber eine Klassengrösse.
    // Winzige Koerper bekommen die Mindestbreite von 2 % — ein Balken auf
    // 0,0001 % waere unsichtbar und wuerde nur so tun, als waere nichts da.
    const capForBar = Math.min(earths, SIZE_BAR_CAP_EARTHS);
    const percent = Number.isFinite(capForBar) && capForBar > 0
      ? Math.max(2, Math.min(100, (Math.log10(capForBar + 1) / Math.log10(SIZE_BAR_MAX_EARTHS)) * 100))
      : 2;
    track.setAttribute(
      'aria-label',
      Number.isFinite(earths) && earths > 0
        ? `Groessenvergleich: ${formatNumber(earths)} Erden`
        : 'Groessenvergleich: keine Daten vorhanden',
    );
    const fill = document.createElement('div');
    fill.className = 'se-meter__fill';
    fill.style.width = `${percent.toFixed(1)}%`;
    fill.style.background = body.color;
    track.appendChild(fill);

    section.append(heading, paragraph, track);
    return section;
  }

  private renderMoreSection(body: BodyData, facts: BodyFacts | undefined): HTMLElement {
    const section = document.createElement('section');
    section.className = 'se-panel__section se-panel__more';
    section.hidden = true;

    const heading = document.createElement('h3');
    heading.className = 'se-panel__section-title';
    heading.textContent = 'Noch mehr erfahren';
    section.appendChild(heading);

    if (facts?.kidQuestion) {
      const question = document.createElement('p');
      question.className = 'se-panel__question';
      question.textContent = facts.kidQuestion;
      section.appendChild(question);
    }
    if (facts?.wouldYouSurvive) {
      const survive = document.createElement('p');
      survive.className = 'se-panel__text';
      survive.textContent = facts.wouldYouSurvive;
      section.appendChild(survive);
    }
    // `body.atmosphere` fehlt bei manchen Datenluecken. `undefined.length`
    // wuerde hier werfen und das Panel halb gerendert stehen lassen.
    const atmosphere = body.atmosphere;
    if (atmosphere === undefined || atmosphere === null || atmosphere.trim().length === 0) {
      const hint = document.createElement('p');
      hint.className = 'se-panel__hint';
      hint.textContent = `${body.name} hat keine Atmosphäre — dort ist nichts zum Atmen.`;
      section.appendChild(hint);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'se-button se-panel__more-button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'se-panel-more');
    button.textContent = 'Mehr erfahren';
    button.id = 'se-panel-more-button';
    section.id = 'se-panel-more';
    button.addEventListener('click', this.onMoreClick);
    this.moreButton = button;

    return section;
  }

  /**
   * Schaltet den Bereich "Mehr erfahren" um.
   *
   * @returns true, wenn der Bereich nun sichtbar ist.
   */
  private renderMore(): boolean {
    if (this.moreButton === null) {
      return false;
    }
    const target = this.root.querySelector<HTMLElement>('.se-panel__more');
    if (target === null) {
      return false;
    }
    const open = target.hidden;
    target.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
    this.moreButton.textContent = open ? 'Weniger erfahren' : 'Mehr erfahren';
    return open;
  }
}

/**
 * Baut die Steckbrief-Zeilen fuer einen Koerper.
 *
 * @param body Koerper aus bodies.json.
 * @param facts Passende Kindtexte, falls vorhanden.
 * @returns Beschriftung/Wert-Paare fuer die Tabelle.
 */
export function buildSpecRows(body: BodyData, facts: BodyFacts | undefined): readonly SpecRow[] {
  // Jedes Feld laeuft durch numberOr/textOr: bei 456 Koerpern gibt es
  // Kleinmonde ohne Radius, ohne Masse oder mit fehlendem Atmosphaeren-Feld.
  // Ohne das stuende hier woertlich "undefined km" in der Tabelle.
  const massEarths = safeDivide(body.massKg, DEFAULT_REFERENCE.earthMassKg);
  const days = facts?.comparisons?.yearLength;
  const dayLength = facts?.comparisons?.dayLength;
  const temp = body.surfaceTempC;
  const rows: SpecRow[] = [
    { label: 'Radius', value: withUnit(numberOr(body.radiusKm)) },
    {
      label: 'Masse',
      value: body.massKg > 0
        ? `${numberOr(body.massKg)} kg (${numberOr(massEarths)} Erden)`
        : NO_TEXT_YET,
    },
    { label: 'Schwerkraft', value: withUnit(numberOr(body.gravityMs2), 'm/s²') },
    {
      label: 'Temperatur',
      value: isTemperatureKnown(temp)
        ? `${numberOr(temp?.min)} °C bis ${numberOr(temp?.max)} °C (Ø ${numberOr(temp?.mean)} °C)`
        : NO_TEXT_YET,
    },
    {
      label: 'Tag / Jahr',
      value: `${dayLength ?? formatRotation(body.rotationPeriodH)} / ${days ?? 'siehe Bahnradius'}`,
    },
    {
      label: 'Bahnradius',
      value: body.type === 'star' ? '— (Mittelpunkt)' : withUnit(numberOr(body.semiMajorAxisKm)),
    },
    { label: 'Rotation', value: formatRotation(body.rotationPeriodH) },
    { label: 'Achsneigung', value: withUnit(numberOr(body.axialTiltDeg), '°') },
    {
      label: 'Monde',
      value: !Number.isFinite(body.moonsCount) || body.moonsCount === 0
        ? 'keine'
        : formatNumber(body.moonsCount),
    },
    { label: 'Atmosphäre', value: atmosphereText(body.atmosphere) },
    { label: 'Entdeckung', value: discoveryText(body.discovery) },
  ];
  return rows;
}

/**
 * Haengt eine Einheit an einen Wert, ausser er ist der Platzhalter.
 *
 * @param value Bereits formatierter Wert.
 * @param unit Einheit, z.B. "km".
 * @returns Wert mit Einheit bzw. der nackte Platzhalter.
 */
function withUnit(value: string, unit: string = 'km'): string {
  return value === NO_TEXT_YET ? value : `${value} ${unit}`;
}

/**
 * Teilt, ohne durch Null oder NaN zu teilen.
 *
 * @param numerator Zaehler.
 * @param denominator Nenner.
 * @returns Quotient oder NaN (wird von numberOr aufgefangen).
 */
function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return Number.NaN;
  }
  return numerator / denominator;
}

/**
 * Prueft, ob Temperaturangaben vorhanden und sinnvoll sind.
 *
 * @param temp Temperaturblock aus bodies.json.
 * @returns true, wenn mindestens ein Wert gesetzt ist.
 */
function isTemperatureKnown(temp: BodyData['surfaceTempC'] | undefined): boolean {
  if (temp === undefined || temp === null) {
    return false;
  }
  return [temp.min, temp.mean, temp.max].some(
    (value) => value !== undefined && value !== null && Number.isFinite(value),
  );
}

/**
 * Formatiert die Atmosphaerenangabe.
 *
 * @param atmosphere Rohwert, darf fehlen.
 * @returns "keine", der Text oder der Platzhalter.
 */
function atmosphereText(atmosphere: string | undefined): string {
  if (atmosphere === undefined || atmosphere === null) {
    return NO_TEXT_YET;
  }
  return atmosphere.trim().length === 0 ? 'keine' : atmosphere;
}

/**
 * Formatiert die Entdeckungsangabe.
 *
 * @param discovery Rohwert, darf fehlen.
 * @returns Text, "schon immer bekannt" oder der Platzhalter.
 */
function discoveryText(discovery: string | undefined): string {
  if (discovery === undefined || discovery === null) {
    return NO_TEXT_YET;
  }
  return discovery.trim().length === 0 ? 'schon immer bekannt' : discovery;
}

/**
 * Formatiert eine Rotationsdauer lesbar, inklusive Retrograd-Hinweis.
 *
 * @param hours Rotationsdauer in Stunden, negativ = retrograde Rotation.
 * @returns Deutsche Kurzangabe.
 */
export function formatRotation(hours: number): string {
  if (!Number.isFinite(hours) || hours === 0) {
    return 'keine eigene Rotation';
  }
  const magnitude = Math.abs(hours);
  const direction = hours < 0 ? ' (rückwärts)' : '';
  if (magnitude >= 48) {
    return `${formatNumber(magnitude / 24)} Tage${direction}`;
  }
  return `${formatNumber(magnitude)} Stunden${direction}`;
}

/**
 * Holt eine JSON-Datei und wandelt sie in das gewünschte Typ-Interface.
 *
 * @param url URL der JSON-Datei.
 * @returns Geparste Daten.
 * @throws Error wenn die Datei nicht erreichbar oder unparsbar ist.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} konnte nicht geladen werden (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

/**
 * Formatiert eine Zahl mit deutschem Dezimalkomma.
 *
 * @param value Zahl.
 * @returns Formatierte Zahl.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return NUMBER_FORMAT.format(value);
}

/**
 * Liest eine Zahl aus einem Datensatz, ohne je "undefined" auszugeben.
 *
 * bodies.json enthaelt bei 456 Koerpern Luecken: manche Kleinmonde haben
 * keinen Radius, kein Feld "atmosphere" oder gar nichts Brauchbares. Ohne
 * diese Absicherung landet im Panel wörtlich "undefined" oder "NaN".
 *
 * @param value Rohwert aus dem JSON.
 * @param fallback Text, wenn der Wert fehlt oder unbrauchbar ist.
 * @returns Die Zahl oder der Fallback-Text.
 */
export function numberOr(value: number | undefined | null, fallback: string = NO_TEXT_YET): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return formatNumber(value);
}

/**
 * Liest einen Text aus, Leer-/Fehlwert wird zum Platzhalter.
 *
 * @param value Rohwert aus dem JSON.
 * @returns Der Text oder "Daten noch nicht erfasst".
 */
export function textOr(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return NO_TEXT_YET;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? NO_TEXT_YET : trimmed;
}

/**
 * Formatiert den Groessenvergleich als deutschen Satz.
 *
 * Drei Faelle, alle fuer Kinder lesbar:
 * - mindestens ein Erdradius: "So groß wie etwa 11 Erden."
 * - messbar, aber winzig: Vergleich mit unserem Mond, in Prozent.
 * - unbrauchbar (Radius fehlt oder ist 0): ehrlicher Platzhalter.
 *
 * @param earths Vielfaches des Erdradius.
 * @returns Fertiger Satz ohne "undefined" und ohne Billionen.
 */
export function formatSizeComparison(earths: number): string {
  if (!Number.isFinite(earths) || earths <= 0) {
    return `So groß wie ${NO_TEXT_YET.toLowerCase()} — von diesem Körper wissen wir die Größe noch nicht.`;
  }
  if (earths >= SIZE_MIN_READABLE_EARTHS) {
    if (earths >= 0.5) {
      // Ab halber Erde lohnt der Erdenvergleich: "So gross wie etwa 11
      // Erden" sagt einem Kind mehr als jeder Prozentsatz.
      //
      // Auf eine Nachkommastelle runden: "1,006 Erden" liest sich fuer
      // Kinder wie eine Unsinnsgenauigkeit ("dreimal so gross wie die
      // Erde", nicht "2,97").
      const rounded = Math.max(0.1, Math.round(earths * 10) / 10);
      return rounded >= 1
        ? `So groß wie etwa ${formatNumber(rounded)} ${earthWord(rounded)}.`
        : `So groß wie nur einem kleinen Stück Erde (Faktor ${formatNumber(rounded)}).`;
    }
    // Zwischen 0,0001 und 0,5 Erdradien ist der Erdenvergleich wertlos:
    // eine Nachkommastelle rundet 0,0002 auf 0,0 und der Faktor-Text
    // behauptet dann eine Genauigkeit, die nicht dasteht.
    const percent = earths * 100;
    return `Viel kleiner als die Erde: nur etwa ${formatNumber(percent)} % vom Erdradius.`;
  }
  // Winziger als ein Zehntausendstel der Erde: in Prozent des Mondes.
  const moonPercent = (earths * DEFAULT_REFERENCE.earthRadiusKm) / MOON_RADIUS_KM * 100;
  if (moonPercent < 0.1) {
    return 'Viel zu klein, um etwas zu sehen — kleiner als ein Sandkorn aus der Ferne.';
  }
  return `Viel kleiner als unser Mond: nur etwa ${formatNumber(moonPercent)} % so breit.`;
}

/**
 * Waehlt die passende deutsche Form von "Erde" als Vergleichseinheit.
 *
 * Deutsch dekliniert "die Erde"; nach einer Zahl lautet der Nominativ
 * "eine Erde", im Plural dagegen "Erden" (ohne Artikel). Ohne diese
 * Unterscheidung entstuende "1 Erden", was Kindern sofort als Fehler auffaellt.
 *
 * @param value Vielfaches des Erdradius.
 * @returns "eine Erde" bei genau einem Erdradius, sonst "Erden".
 */
export function earthWord(value: number): string {
  return Math.abs(value - 1) < 0.005 ? 'eine Erde' : 'Erden';
}
