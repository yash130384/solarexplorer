/**
 * Hud.ts — Kopfzeile und Statusanzeige der SolarExplorer-Oberflaeche.
 *
 * Enthaelt Datum/Zeitraffer, umschaltbare Skalierungsmodi, Flugstatus des
 * Raumschiffs, FPS-Anzeige und einen Pause/Play-Knopf.
 *
 * Kein Framework, kein innerHTML: saemtliche Knoten werden per
 * createElement + textContent erzeugt.
 */

/** Skalierungsmodus fuer Koerpergroessen. */
export type SizeScaleMode = 'visual' | 'real';

/** Skalierungsmodus fuer Umlaufbahn-Abstaende. */
export type DistanceScaleMode = 'real' | 'visual';

/** Detailstufe der Szene: alle Koerper oder nur die mit Kindtext. */
export type DetailMode = 'all' | 'known';

/** Verfuegbare Detailstufen in Anzeigereihenfolge. */
export const DETAIL_MODES: readonly DetailMode[] = ['all', 'known'] as const;

/** Deutsche Anzeigenamen der Detailstufen. */
export const DETAIL_MODE_LABELS: Readonly<Record<DetailMode, string>> = {
  all: 'Alle',
  known: 'Nur bekannte',
};

/** Verfuegbare Groessenmodi in Anzeigereihenfolge. */
export const SIZE_SCALE_MODES: readonly SizeScaleMode[] = ['visual', 'real'] as const;

/** Verfuegbare Distanzmodi in Anzeigereihenfolge. */
export const DISTANCE_SCALE_MODES: readonly DistanceScaleMode[] = ['real', 'visual'] as const;

/** Deutsche Anzeigenamen der Skalierungsmodi. */
export const SCALE_MODE_LABELS: Readonly<Record<SizeScaleMode | DistanceScaleMode, string>> = {
  visual: 'Sichtbar',
  real: 'Echt',
};

/** Kommas fuer Dezimaltrennzeichen im Deutschen. */
const NUMBER_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Sekunden pro julianischem Jahr (365.25 Tage). */
const SECONDS_PER_YEAR = 31_557_600;

/** Sekunden pro Tag. */
const SECONDS_PER_DAY = 86_400;

/** Sekunden pro Stunde. */
const SECONDS_PER_HOUR = 3_600;

/** Julianisches Datum des J2000.0-Epochs (2000-01-01T12:00:00Z). */
const J2000_JULIAN_DATE = 2_451_545.0;

/** Millisekunden pro Tag — fuer die Umrechnung julianisches Datum <-> Date. */
const MS_PER_DAY = 86_400_000;

/** Anzahl Sekunden bis 2000-01-01T00:00:00Z im julianischen Tageszaehler. */
const JULIAN_UNIX_EPOCH_OFFSET = 2_440_587.5;

/** Richtungslabels fuer den Kompass, im 45-Grad-Raster. */
const COMPASS_POINTS: readonly string[] = [
  'N',
  'NO',
  'O',
  'SO',
  'S',
  'SW',
  'W',
  'NW',
] as const;

/** Daten fuer den Flugstatus des Raumschiffs. */
export interface ShipStatus {
  /** Geschwindigkeit relativ zum Ziel in km/s. */
  readonly speedKmS: number;
  /** Kurs in Grad, 0 = Norden, im Uhrzeigersinn. */
  readonly headingDeg: number;
  /** Schublevel von 0 (aus) bis 1 (voll). */
  readonly thrustLevel: number;
}

/** Bündel aller Werte, die `HudUI.update()` annimmt. */
export interface HudUpdateData {
  /** Aktuelles julianisches Datum. */
  readonly julianDate: number;
  /** Simulationssekunden pro Echtzeitsekunde. */
  readonly timeScale: number;
  /** Aktueller Groessen-Skalierungsmodus. */
  readonly sizeMode: SizeScaleMode;
  /** Aktueller Distanz-Skalierungsmodus. */
  readonly distanceMode: DistanceScaleMode;
  /** Flugstatus des Raumschiffs. */
  readonly ship: ShipStatus;
  /** Bilder pro Sekunde, oder null wenn unbekannt. */
  readonly fps: number | null;
  /** Ist die Zeit angehalten? */
  readonly paused: boolean;
}

/** Optionale Callbacks und Startwerte. */
export interface HudOptions {
  /** Startwert des Groessenmodus. Default 'visual'. */
  readonly initialSizeMode?: SizeScaleMode;
  /** Startwert des Distanzmodus. Default 'real'. */
  readonly initialDistanceMode?: DistanceScaleMode;
  /** Wird beim Klick auf einen Skalierungsmodus aufgerufen. */
  readonly onScaleModeChange?: (kind: 'size' | 'distance', mode: string) => void;
  /** Wird beim Klick auf Pause/Play aufgerufen. */
  readonly onPauseToggle?: (paused: boolean) => void;
  /** Startwert der Detailstufe. Default 'all'. */
  readonly initialDetailMode?: DetailMode;
  /** Wird beim Wechsel der Detailstufe aufgerufen. */
  readonly onDetailModeChange?: (mode: DetailMode) => void;
}

/**
 * Statusleiste (Head-up-Display) der Anwendung.
 *
 * Alle Positionsangaben werden aus dem uebergegebenen Root-Element berechnet,
 * damit das HUD sowohl ueber dem Canvas als auch in einem eigenen Panel
 * funktioniert.
 */
export class HudUI {
  private readonly root: HTMLElement;

  private readonly options: HudOptions;

  private element: HTMLDivElement | null = null;

  private modeLabel: HTMLSpanElement | null = null;

  private dateLabel: HTMLSpanElement | null = null;

  private timeScaleLabel: HTMLSpanElement | null = null;

  private speedLabel: HTMLSpanElement | null = null;

  private headingLabel: HTMLSpanElement | null = null;

  private thrustBar: HTMLDivElement | null = null;

  /**
   * Das Element mit `role="progressbar"` der Schubanzeige.
   *
   * `aria-valuenow` gehoert nach ARIA auf das Element, das die Rolle traegt —
   * nicht auf dessen Kind. Screenreader lesen sonst "unbekannter Wert".
   */
  private thrustMeter: HTMLDivElement | null = null;

  private fpsLabel: HTMLSpanElement | null = null;

  private pauseButton: HTMLButtonElement | null = null;

  private sizeButtons = new Map<SizeScaleMode, HTMLButtonElement>();

  private distanceButtons = new Map<DistanceScaleMode, HTMLButtonElement>();

  private detailButtons = new Map<DetailMode, HTMLButtonElement>();

  private sizeMode: SizeScaleMode;

  private distanceMode: DistanceScaleMode;

  private detailMode: DetailMode;

  private paused = false;

  private readonly onKeyDown: (event: KeyboardEvent) => void;

  private readonly onPauseClick: () => void;

  /**
   * Erzeugt das HUD, bindet es aber noch nicht in den DOM ein.
   *
   * @param root Container, in den das HUD eingehängt wird.
   * @param options Callbacks und Startwerte.
   */
  constructor(root: HTMLElement, options: HudOptions = {}) {
    this.root = root;
    this.options = options;
    this.sizeMode = options.initialSizeMode ?? 'visual';
    this.distanceMode = options.initialDistanceMode ?? 'real';
    this.detailMode = options.initialDetailMode ?? 'all';
    this.onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    this.onPauseClick = () => this.togglePause();
  }

  /** Baut den DOM-Baum des HUDs auf und registriert die Listener. */
  mount(): void {
    if (this.element !== null) {
      return;
    }
    const el = document.createElement('div');
    el.className = 'se-hud';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Statusanzeige');

    el.appendChild(this.buildTopBar());
    el.appendChild(this.buildShipStatus());
    el.appendChild(this.buildFooter());
    this.root.appendChild(el);
    this.element = el;
    document.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  /**
   * Aktualisiert alle Anzeigewerte auf einmal.
   *
   * @param data Zeit, Skalierung, Flugstatus und FPS.
   */
  update(data: HudUpdateData): void {
    this.sizeMode = data.sizeMode;
    this.distanceMode = data.distanceMode;
    this.paused = data.paused;
    this.render();
    this.setTime(data.julianDate);
    this.setTimeScale(data.timeScale);
    this.setShipStatus(data.ship);
    this.setFps(data.fps);
  }

  /**
   * Setzt das angezeigte Datum aus einem julianischen Datum.
   *
   * @param julianDate Julisches Datum (z. B. 2451545.0 fuer J2000.0).
   * @returns Die formatierte Datumsangabe, oder leerer String vor `mount()`.
   */
  setTime(julianDate: number): string {
    if (this.dateLabel === null) {
      return '';
    }
    const label = formatJulianDate(julianDate);
    this.dateLabel.textContent = label;
    return label;
  }

  /**
   * Setzt die Zeitraffer-Angabe, z. B. "1 Sekunde = 10 Tage".
   *
   * @param secondsPerSecond Simulationssekunden pro Echtzeitsekunde.
   * @returns Die formatierte Angabe, oder leerer String vor `mount()`.
   */
  setTimeScale(secondsPerSecond: number): string {
    if (this.timeScaleLabel === null) {
      return '';
    }
    const label = formatTimeScale(secondsPerSecond);
    this.timeScaleLabel.textContent = label;
    return label;
  }

  /**
   * Setzt Geschwindigkeit, Kompassrichtung und Schublevel.
   *
   * @param status Aktueller Flugstatus.
   */
  setShipStatus(status: ShipStatus): void {
    if (this.speedLabel !== null) {
      this.speedLabel.textContent = `${NUMBER_FORMAT.format(status.speedKmS)} km/s`;
    }
    if (this.headingLabel !== null) {
      this.headingLabel.textContent = `${compassPoint(status.headingDeg)} ${NUMBER_FORMAT.format(
        normalizeHeading(status.headingDeg),
      )}°`;
    }
    if (this.thrustBar !== null) {
      const clamped = Math.min(1, Math.max(0, status.thrustLevel));
      this.thrustBar.style.width = `${(clamped * 100).toFixed(0)}%`;
      // Der Wert gehoert auf das Element mit `role="progressbar"`, sonst
      // meldet der Screenreader "unbekannt".
      this.thrustMeter?.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    }
  }

  /**
   * Setzt den aktiven Groessenmodus und aktualisiert die Schaltflaechen.
   *
   * @param mode Neuer Groessenmodus.
   */
  setSizeMode(mode: SizeScaleMode): void {
    this.sizeMode = mode;
    this.render();
  }

  /**
   * Setzt den aktiven Distanzmodus und aktualisiert die Schaltflaechen.
   *
   * @param mode Neuer Distanzmodus.
   */
  setDistanceMode(mode: DistanceScaleMode): void {
    this.distanceMode = mode;
    this.render();
  }

  /**
   * Setzt die FPS-Anzeige.
   *
   * @param fps Bilder pro Sekunde, oder null zum Ausblenden.
   */
  setFps(fps: number | null): void {
    if (this.fpsLabel === null) {
      return;
    }
    this.fpsLabel.textContent = fps === null ? '' : `${Math.round(fps)} FPS`;
  }

  /** Blendet das HUD ein. */
  show(): void {
    this.element?.removeAttribute('hidden');
    this.element?.classList.add('is-visible');
  }

  /** Blendet das HUD aus. */
  hide(): void {
    this.element?.setAttribute('hidden', '');
    this.element?.classList.remove('is-visible');
  }

  /** Entfernt das HUD aus dem DOM und loest alle Listener. */
  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.element?.remove();
    this.element = null;
    this.modeLabel = null;
    this.dateLabel = null;
    this.timeScaleLabel = null;
    this.speedLabel = null;
    this.headingLabel = null;
    this.thrustBar = null;
    this.thrustMeter = null;
    this.fpsLabel = null;
    this.pauseButton = null;
    this.sizeButtons.clear();
    this.distanceButtons.clear();
    this.detailButtons.clear();
  }

  private buildTopBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'se-hud__top';

    const brand = document.createElement('div');
    brand.className = 'se-hud__brand';
    const title = document.createElement('span');
    title.className = 'se-hud__title';
    title.textContent = 'SolarExplorer';
    const mode = document.createElement('span');
    mode.className = 'se-hud__mode';
    this.modeLabel = mode;
    brand.append(title, mode);

    const when = document.createElement('div');
    when.className = 'se-hud__when';
    const date = document.createElement('span');
    date.className = 'se-hud__date';
    this.dateLabel = date;
    const scale = document.createElement('span');
    scale.className = 'se-hud__timescale';
    this.timeScaleLabel = scale;
    when.append(date, scale);

    const scales = document.createElement('div');
    scales.className = 'se-hud__scales';

    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'se-toggle';
    sizeGroup.setAttribute('role', 'group');
    sizeGroup.setAttribute('aria-label', 'Groessen-Skalierung');
    for (const mode of SIZE_SCALE_MODES) {
      const button = this.createModeButton(mode, 'size');
      this.sizeButtons.set(mode, button);
      sizeGroup.appendChild(button);
    }

    const distanceGroup = document.createElement('div');
    distanceGroup.className = 'se-toggle';
    distanceGroup.setAttribute('role', 'group');
    distanceGroup.setAttribute('aria-label', 'Distanz-Skalierung');
    for (const mode of DISTANCE_SCALE_MODES) {
      const button = this.createModeButton(mode, 'distance');
      this.distanceButtons.set(mode, button);
      distanceGroup.appendChild(button);
    }

    scales.append(sizeGroup, distanceGroup);

    // Detail-Knopf: blendet die kleinen Monde ohne Kindtext aus, damit die
    // Szene fuer Kinder uebersichtlich bleibt.
    const detailGroup = document.createElement('div');
    detailGroup.className = 'se-toggle';
    detailGroup.setAttribute('role', 'group');
    detailGroup.setAttribute('aria-label', 'Details');
    detailGroup.dataset['testid'] = 'detail-toggle';
    for (const mode of DETAIL_MODES) {
      const button = this.createDetailButton(mode);
      this.detailButtons.set(mode, button);
      detailGroup.appendChild(button);
    }
    scales.appendChild(detailGroup);

    bar.append(brand, when, scales);
    return bar;
  }

  /**
   * Erzeugt einen Knopf der Detailstufe ("Alle" / "Nur bekannte").
   *
   * @param mode - Die Detailstufe, die der Knopf setzt.
   * @returns Der neu erzeugte Knopf.
   */
  private createDetailButton(mode: DetailMode): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'se-toggle__button';
    button.textContent = DETAIL_MODE_LABELS[mode];
    button.dataset.mode = mode;
    button.dataset.kind = 'detail';
    button.addEventListener('click', () => {
      this.detailMode = mode;
      this.render();
      this.options.onDetailModeChange?.(mode);
    });
    return button;
  }

  /**
   * Setzt die aktive Detailstufe (auch von aussen steuerbar).
   *
   * @param mode - Neue Detailstufe.
   * @returns {void}
   */
  setDetailMode(mode: DetailMode): void {
    this.detailMode = mode;
    this.render();
  }

  private createModeButton(mode: string, kind: 'size' | 'distance'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'se-toggle__button';
    button.textContent = SCALE_MODE_LABELS[mode as SizeScaleMode] ?? mode;
    button.dataset.mode = mode;
    button.dataset.kind = kind;
    button.addEventListener('click', () => {
      if (kind === 'size') {
        this.sizeMode = mode as SizeScaleMode;
      } else {
        this.distanceMode = mode as DistanceScaleMode;
      }
      this.render();
      this.options.onScaleModeChange?.(kind, mode);
    });
    return button;
  }

  private buildShipStatus(): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'se-hud__ship';

    const headingLabel = document.createElement('span');
    headingLabel.className = 'se-hud__ship-title';
    headingLabel.textContent = 'Raumschiff';

    const speed = document.createElement('span');
    speed.className = 'se-hud__ship-value';
    this.speedLabel = speed;

    const heading = document.createElement('span');
    heading.className = 'se-hud__ship-value';
    this.headingLabel = heading;

    const thrustTrack = document.createElement('div');
    thrustTrack.className = 'se-meter';
    thrustTrack.setAttribute('role', 'progressbar');
    thrustTrack.setAttribute('aria-label', 'Schublevel');
    thrustTrack.setAttribute('aria-valuemin', '0');
    thrustTrack.setAttribute('aria-valuemax', '100');
    thrustTrack.setAttribute('aria-valuenow', '0');
    const fill = document.createElement('div');
    fill.className = 'se-meter__fill';
    this.thrustBar = fill;
    thrustTrack.appendChild(fill);
    this.thrustMeter = thrustTrack;

    box.append(headingLabel, speed, heading, thrustTrack);
    return box;
  }

  private buildFooter(): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'se-hud__footer';

    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'se-button se-hud__pause';
    pause.setAttribute('aria-label', 'Zeit anhalten oder fortsetzen');
    pause.addEventListener('click', this.onPauseClick);
    this.pauseButton = pause;

    const fps = document.createElement('span');
    fps.className = 'se-hud__fps';
    this.fpsLabel = fps;

    box.append(pause, fps);
    return box;
  }

  private render(): void {
    if (this.modeLabel !== null) {
      const parts: string[] = [];
      parts.push(`Groesse: ${SCALE_MODE_LABELS[this.sizeMode]}`);
      parts.push(`Distanz: ${SCALE_MODE_LABELS[this.distanceMode]}`);
      this.modeLabel.textContent = parts.join(' · ');
    }
    for (const [mode, button] of this.sizeButtons) {
      button.classList.toggle('is-active', mode === this.sizeMode);
      button.setAttribute('aria-pressed', String(mode === this.sizeMode));
    }
    for (const [mode, button] of this.distanceButtons) {
      button.classList.toggle('is-active', mode === this.distanceMode);
      button.setAttribute('aria-pressed', String(mode === this.distanceMode));
    }
    for (const [mode, button] of this.detailButtons) {
      button.classList.toggle('is-active', mode === this.detailMode);
      button.setAttribute('aria-pressed', String(mode === this.detailMode));
    }
    if (this.pauseButton !== null) {
      this.pauseButton.textContent = this.paused ? '▶ Play' : '❚❚ Pause';
      this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    }
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.render();
    this.options.onPauseToggle?.(this.paused);
  }

  /**
   * Tastatursteuerung: Leertaste pausiert, sofern kein Eingabefeld aktiv ist.
   *
   * @param event Tastaturereignis.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || target?.isContentEditable) {
      return;
    }
    event.preventDefault();
    this.togglePause();
  }
}

/**
 * Wandelt ein julianisches Datum in eine deutsche Datumsangabe um.
 *
 * @param julianDate Julisches Datum.
 * @returns Formatiertes Datum, z. B. "14.10.2026".
 */
export function formatJulianDate(julianDate: number): string {
  const ms = (julianDate - JULIAN_UNIX_EPOCH_OFFSET) * MS_PER_DAY;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return 'Unbekanntes Datum';
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

/**
 * Formatiert einen Zeitraffer als "1 Sekunde = X".
 *
 * @param secondsPerSecond Simulationssekunden pro Echtzeitsekunde.
 * @returns Lesbare deutsche Zeitangabe.
 */
export function formatTimeScale(secondsPerSecond: number): string {
  const rate = Math.abs(secondsPerSecond);
  if (rate < 1) {
    return 'Zeit steht still';
  }
  if (rate >= SECONDS_PER_YEAR) {
    return `1 Sekunde = ${formatAmount(rate / SECONDS_PER_YEAR, 'Jahre')}`;
  }
  if (rate >= SECONDS_PER_DAY) {
    return `1 Sekunde = ${formatAmount(rate / SECONDS_PER_DAY, 'Tage')}`;
  }
  if (rate >= SECONDS_PER_HOUR) {
    return `1 Sekunde = ${formatAmount(rate / SECONDS_PER_HOUR, 'Stunden')}`;
  }
  return `1 Sekunde = ${formatAmount(rate, 'Sekunden')}`;
}

/**
 * Liefert die Kompassrichtung fuer einen Kurs.
 *
 * @param headingDeg Kurs in Grad, 0 = Norden.
 * @returns Eine der acht Himmelsrichtungen.
 */
export function compassPoint(headingDeg: number): string {
  const index = Math.round(normalizeHeading(headingDeg) / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? 'N';
}

/**
 * Normalisiert einen Kurs auf [0, 360).
 *
 * @param headingDeg Kurs in Grad, beliebig.
 * @returns Kurs im Bereich [0, 360).
 */
export function normalizeHeading(headingDeg: number): number {
  if (!Number.isFinite(headingDeg)) {
    return 0;
  }
  return ((headingDeg % 360) + 360) % 360;
}

/** @returns Julisches Datum des J2000.0-Epochs, fuer Defaults. */
export function julianDateJ2000(): number {
  return J2000_JULIAN_DATE;
}

function formatAmount(value: number, unit: string): string {
  return `${NUMBER_FORMAT.format(value)} ${unit}`;
}
