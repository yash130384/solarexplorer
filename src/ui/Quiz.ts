/**
 * Quiz.ts — Lernquiz mit Fragen aus facts.json.
 *
 * Zeigt Frage, vier Antworten, Rueckmeldung, Erklaerung, Fortschrittsbalken
 * und eine lobende Abschluss-Auswertung.
 *
 * Kein Framework, kein innerHTML: Knoten entstehen per createElement.
 */

import { fetchJson, formatNumber } from './InfoPanel';

/** Schwierigkeitsgrad einer Quizfrage. */
export type QuizDifficulty = 'leicht' | 'mittel' | 'schwer';

/** Eine Quizfrage aus facts.json. */
export interface QuizQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
  readonly difficulty: QuizDifficulty;
}

/** Rohtyp aus facts.json (nur der Quiz-Ausschnitt). */
export interface QuizFile {
  readonly quiz?: readonly QuizQuestion[];
}

/** Punktestand des laufenden Quizzes. */
export interface QuizScore {
  readonly correct: number;
  readonly total: number;
}

/** Konfiguration des Quizzes. */
export interface QuizOptions {
  /** Basis-URL fuer facts.json. Default './data'. */
  readonly dataBaseUrl?: string;
  /** Wird aufgerufen, wenn facts.json nicht geladen werden kann. */
  readonly onDataError?: (error: Error) => void;
}

/** Lob-Texte fuer die Abschluss-Auswertung, von schwaechster zu bester Leistung. */
const PRAISE_TEXTS: readonly string[] = [
  'Gut geübt! Beim nächsten Mal klappt das noch besser.',
  'Das war schon ordentlich — weiter so!',
  'Klasse! Dein Weltraum-Wissen wird immer besser.',
  'Super gemacht! Du weißt jetzt richtig viel über unser Sonnensystem.',
];

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/**
 * Lernquiz mit Fortschrittsanzeige und Auswertung.
 */
export class QuizUI {
  private readonly root: HTMLElement;

  private readonly options: QuizOptions;

  private element: HTMLDivElement | null = null;

  private questionLabel: HTMLParagraphElement | null = null;

  private progressBar: HTMLDivElement | null = null;

  private progressText: HTMLSpanElement | null = null;

  private answers: HTMLDivElement | null = null;

  private explanation: HTMLDivElement | null = null;

  private nextButton: HTMLButtonElement | null = null;

  private summary: HTMLDivElement | null = null;

  private questions: readonly QuizQuestion[] = [];

  private currentIndex = 0;

  private correct = 0;

  private running = false;

  private answered = false;

  private readonly onDocumentKeyDown: (event: KeyboardEvent) => void;

  /**
   * Erzeugt das Quiz, ohne es in den DOM einzuhängen.
   *
   * @param root Container fuer das Quiz.
   * @param options Datenpfad und Callbacks.
   */
  constructor(root: HTMLElement, options: QuizOptions = {}) {
    this.root = root;
    this.options = options;
    this.onDocumentKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
  }

  /** Baut den DOM-Baum auf und registriert die Listener. */
  mount(): void {
    if (this.element !== null) {
      return;
    }
    const el = document.createElement('section');
    el.className = 'se-quiz';
    el.setAttribute('aria-label', 'Lernquiz');
    el.setAttribute('hidden', '');

    const heading = document.createElement('h2');
    heading.className = 'se-quiz__title';
    heading.textContent = 'Quiz';

    const progress = document.createElement('div');
    progress.className = 'se-quiz__progress';
    const track = document.createElement('div');
    track.className = 'se-meter se-meter--wide';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Quiz-Fortschritt');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'se-meter__fill';
    this.progressBar = fill;
    track.appendChild(fill);
    const text = document.createElement('span');
    text.className = 'se-quiz__progress-text';
    this.progressText = text;
    progress.append(track, text);

    const question = document.createElement('p');
    question.className = 'se-quiz__question';
    this.questionLabel = question;

    const answers = document.createElement('div');
    answers.className = 'se-quiz__answers';
    answers.setAttribute('role', 'group');
    answers.setAttribute('aria-label', 'Antwortmöglichkeiten');
    this.answers = answers;

    const explanation = document.createElement('div');
    explanation.className = 'se-quiz__explanation';
    explanation.setAttribute('role', 'status');
    explanation.hidden = true;
    this.explanation = explanation;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'se-button se-quiz__next';
    next.textContent = 'Nächste Frage';
    next.hidden = true;
    next.addEventListener('click', () => this.next());
    this.nextButton = next;

    const summary = document.createElement('div');
    summary.className = 'se-quiz__summary';
    summary.hidden = true;
    this.summary = summary;

    el.append(heading, progress, question, answers, explanation, next, summary);
    this.root.appendChild(el);
    this.element = el as HTMLDivElement;
    document.addEventListener('keydown', this.onDocumentKeyDown);
  }

  /**
   * Startet das Quiz: laedt die Fragen und zeigt die erste Frage.
   *
   * @returns Promise, das erfuellt ist, wenn die erste Frage steht.
   */
  async start(): Promise<void> {
    await this.loadQuestions();
    this.currentIndex = 0;
    this.correct = 0;
    this.running = this.questions.length > 0;
    this.answered = false;
    this.show();
    if (this.running) {
      this.renderQuestion();
    } else {
      this.renderNoQuestions();
    }
  }

  /** Beendet das Quiz, verbirgt die Inhalte und setzt den Zustand zurueck. */
  stop(): void {
    this.running = false;
    this.answered = false;
    this.hide();
  }

  /**
   * Liefert den aktuellen Punktestand.
   *
   * @returns Anzahl richtige Antworten und Gesamtzahl gestellter Fragen.
   */
  getScore(): QuizScore {
    return { correct: this.correct, total: this.currentIndex + (this.answered ? 1 : 0) };
  }

  /**
   * Aktualisiert die Fortschrittsanzeige, z. B. nach externem Neustart.
   *
   * @param data Anzahl richtiger und bereits beantworteter Fragen.
   */
  update(data: QuizScore): void {
    this.correct = Math.min(data.correct, Math.max(0, data.total));
    this.currentIndex = Math.max(0, data.total);
    this.renderProgress();
  }

  /** Blendet das Quiz ein. */
  show(): void {
    this.element?.removeAttribute('hidden');
  }

  /** Blendet das Quiz aus. */
  hide(): void {
    this.element?.setAttribute('hidden', '');
  }

  /** Entfernt das Quiz aus dem DOM und loest alle Listener. */
  dispose(): void {
    document.removeEventListener('keydown', this.onDocumentKeyDown);
    this.element?.remove();
    this.element = null;
    this.questionLabel = null;
    this.progressBar = null;
    this.progressText = null;
    this.answers = null;
    this.explanation = null;
    this.nextButton = null;
    this.summary = null;
    this.questions = [];
    this.running = false;
  }

  /**
   * Laedt die Fragen aus facts.json (nur beim ersten Mal).
   *
   * @returns Promise, das erfuellt ist, wenn `questions` gefuellt ist.
   */
  async loadQuestions(): Promise<readonly QuizQuestion[]> {
    if (this.questions.length > 0) {
      return this.questions;
    }
    const base = this.options.dataBaseUrl ?? './data';
    try {
      const file = await fetchJson<QuizFile>(`${base}/facts.json`);
      this.questions = (file.quiz ?? []).filter(isValidQuestion);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.options.onDataError?.(error);
      this.renderError(error);
      throw error;
    }
    return this.questions;
  }

  /**
   * Wertet eine Antwort aus.
   *
   * @param index Index der gewaehlten Antwort.
   * @returns true, wenn die Antwort richtig war.
   */
  answer(index: number): boolean {
    if (!this.running || this.answered) {
      return false;
    }
    const question = this.questions[this.currentIndex];
    if (question === undefined || index < 0 || index >= question.options.length) {
      return false;
    }
    this.answered = true;
    const isCorrect = index === question.correctIndex;
    if (isCorrect) {
      this.correct += 1;
    }
    this.renderFeedback(question, index, isCorrect);
    if (this.nextButton !== null) {
      this.nextButton.hidden = false;
      this.nextButton.focus();
    }
    this.renderProgress();
    return isCorrect;
  }

  /** Springt zur naechsten Frage oder zeigt die Auswertung. */
  next(): void {
    if (!this.running || !this.answered) {
      return;
    }
    this.currentIndex += 1;
    this.answered = false;
    if (this.currentIndex >= this.questions.length) {
      this.running = false;
      this.renderSummary();
      return;
    }
    this.renderQuestion();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.running || this.answered) {
      return;
    }
    const key = Number.parseInt(event.key, 10);
    if (Number.isNaN(key) || key < 1 || key > MAX_OPTIONS) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
      return;
    }
    event.preventDefault();
    this.answer(key - 1);
  }

  private renderQuestion(): void {
    const question = this.questions[this.currentIndex];
    if (question === undefined || this.answers === null) {
      return;
    }
    if (this.summary !== null) {
      this.summary.hidden = true;
    }
    if (this.questionLabel !== null) {
      this.questionLabel.textContent = question.question;
    }
    if (this.explanation !== null) {
      this.explanation.hidden = true;
      this.clearChildren(this.explanation);
    }
    if (this.nextButton !== null) {
      this.nextButton.hidden = true;
    }
    this.clearChildren(this.answers);
    question.options.forEach((option, index) => {
      this.answers?.appendChild(this.buildAnswerButton(question, option, index));
    });
    this.renderProgress();
  }

  private buildAnswerButton(
    question: QuizQuestion,
    option: string,
    index: number,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'se-button se-quiz__answer';
    button.dataset.index = String(index);
    button.dataset.correct = String(index === question.correctIndex);
    button.textContent = option;
    button.addEventListener('click', () => this.answer(index));
    return button;
  }

  private renderFeedback(question: QuizQuestion, chosen: number, isCorrect: boolean): void {
    const buttons = this.answers?.querySelectorAll<HTMLButtonElement>('.se-quiz__answer') ?? [];
    for (const button of buttons) {
      const index = Number.parseInt(button.dataset.index ?? '-1', 10);
      button.disabled = true;
      if (index === question.correctIndex) {
        button.classList.add('is-correct');
      } else if (index === chosen) {
        button.classList.add('is-wrong');
      }
    }
    if (this.explanation === null) {
      return;
    }
    this.clearChildren(this.explanation);
    const verdict = document.createElement('p');
    verdict.className = isCorrect ? 'se-quiz__verdict is-correct' : 'se-quiz__verdict is-wrong';
    verdict.textContent = isCorrect
      ? 'Richtig — sehr gut!'
      : 'Fast! Die grün markierte Antwort stimmt.';
    const reason = document.createElement('p');
    reason.className = 'se-quiz__reason';
    reason.textContent = question.explanation;
    this.explanation.append(verdict, reason);
    this.explanation.hidden = false;
  }

  private renderProgress(): void {
    const total = this.questions.length;
    const answeredCount = this.currentIndex + (this.answered ? 1 : 0);
    const percent = total === 0 ? 0 : (answeredCount / total) * 100;
    if (this.progressBar !== null) {
      this.progressBar.style.width = `${percent.toFixed(1)}%`;
      const track = this.progressBar.parentElement;
      track?.setAttribute('aria-valuenow', String(Math.round(percent)));
    }
    if (this.progressText !== null) {
      if (total === 0) {
        this.progressText.textContent = 'Keine Fragen';
      } else if (answeredCount >= total) {
        this.progressText.textContent = `Fertig — ${answeredCount} von ${total}`;
      } else {
        this.progressText.textContent = `Frage ${this.currentIndex + 1} von ${total}`;
      }
    }
  }

  private renderSummary(): void {
    if (this.answers === null || this.summary === null) {
      return;
    }
    if (this.questionLabel !== null) {
      this.questionLabel.textContent = 'Quiz geschafft!';
    }
    if (this.nextButton !== null) {
      this.nextButton.hidden = true;
    }
    if (this.explanation !== null) {
      this.explanation.hidden = true;
    }
    this.clearChildren(this.answers);
    this.clearChildren(this.summary);
    this.summary.hidden = false;

    const total = this.questions.length;
    const percent = total === 0 ? 0 : (this.correct / total) * 100;
    const heading = document.createElement('p');
    heading.className = 'se-quiz__score';
    heading.textContent = `${this.correct} von ${total} richtig (${formatNumber(percent)} %)`;

    const praise = document.createElement('p');
    praise.className = 'se-quiz__praise';
    praise.textContent = pickPraise(this.correct, total);

    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'se-button se-quiz__restart';
    restart.textContent = 'Nochmal spielen';
    restart.addEventListener('click', () => {
      void this.start();
    });

    this.summary.append(heading, praise, restart);
    this.renderProgress();
    restart.focus();
  }

  private renderNoQuestions(): void {
    if (this.answers === null || this.summary === null) {
      return;
    }
    if (this.questionLabel !== null) {
      this.questionLabel.textContent = 'Noch keine Fragen da';
    }
    this.clearChildren(this.answers);
    this.clearChildren(this.summary);
    this.summary.hidden = false;
    const message = document.createElement('p');
    message.className = 'se-quiz__praise';
    message.textContent = 'Lade die Seite neu — dann kommen die Quizfragen bestimmt mit.';
    this.summary.appendChild(message);
  }

  private renderError(error: Error): void {
    if (this.summary === null) {
      return;
    }
    if (this.questionLabel !== null) {
      this.questionLabel.textContent = 'Quiz lädt gerade nicht';
    }
    this.clearChildren(this.summary);
    this.summary.hidden = false;
    const message = document.createElement('p');
    message.className = 'se-quiz__praise';
    message.textContent =
      'Die Quizfragen konnten nicht geladen werden. Bitte lade die Seite später noch einmal.';
    const detail = document.createElement('p');
    detail.className = 'se-panel__hint';
    detail.textContent = `Technische Angabe: ${error.message}`;
    this.summary.append(message, detail);
  }

  private clearChildren(node: HTMLElement | null): void {
    if (node === null) {
      return;
    }
    while (node.firstChild !== null) {
      node.firstChild.remove();
    }
  }
}

/**
 * Prueft, ob ein Objekt eine gueltige Quizfrage ist.
 *
 * @param value Ungeprueftes Objekt aus facts.json.
 * @returns true, wenn die Frage 2 bis 4 Optionen und einen gueltigen Index hat.
 */
export function isValidQuestion(value: unknown): value is QuizQuestion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<QuizQuestion>;
  if (typeof candidate.question !== 'string' || candidate.question.length === 0) {
    return false;
  }
  if (!Array.isArray(candidate.options)) {
    return false;
  }
  const options = candidate.options as readonly unknown[];
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return false;
  }
  if (!options.every((option) => typeof option === 'string')) {
    return false;
  }
  if (typeof candidate.correctIndex !== 'number') {
    return false;
  }
  return candidate.correctIndex >= 0 && candidate.correctIndex < options.length;
}

/**
 * Waehlt einen passenden Lob-Text.
 *
 * @param correct Anzahl richtiger Antworten.
 * @param total Anzahl gestellter Fragen.
 * @returns Ein freundlicher Text.
 */
export function pickPraise(correct: number, total: number): string {
  const ratio = total === 0 ? 0 : correct / total;
  const index = Math.min(PRAISE_TEXTS.length - 1, Math.floor(ratio * PRAISE_TEXTS.length));
  return PRAISE_TEXTS[Math.max(0, index)] ?? PRAISE_TEXTS[0] ?? '';
}
