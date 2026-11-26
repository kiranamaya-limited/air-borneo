/** Passenger faces and reactions for the HUD's comfort meter. */
import type { Reaction } from '../game/comfort';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Every expression a passenger can pull, drawn as a flat icon in the brand palette. */
export type Mood = 'happy' | 'content' | 'neutral' | 'worried' | 'upset' | 'queasy' | 'gasp' | 'scream' | 'sick' | 'asleep' | 'cheer';

const REACTION_MOOD: Record<Reaction, Mood> = {
  gasp: 'gasp',
  whoa: 'gasp',
  scream: 'scream',
  vomit: 'sick',
  nervous: 'worried',
  lightning: 'scream',
  happy: 'asleep',
  applause: 'cheer',
};

const SKIN: Record<Mood, string> = {
  happy: '#1fa463',
  content: '#5cb85c',
  neutral: '#ffc629',
  worried: '#f39a1e',
  upset: '#e8622a',
  queasy: '#8db63c',
  gasp: '#ffc629',
  scream: '#d21f2c',
  sick: '#7aa83a',
  asleep: '#1fa463',
  cheer: '#1fa463',
};

const INK = '#111216';
const eyes = (y = 10) => `<circle cx="8.5" cy="${y}" r="1.6" fill="${INK}"/><circle cx="15.5" cy="${y}" r="1.6" fill="${INK}"/>`;
const line = (d: string, w = 1.8) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;

const FEATURES: Record<Mood, string> = {
  happy: eyes() + line('M7.5 14.5 Q12 19 16.5 14.5'),
  content: eyes() + line('M8.5 15 Q12 17.5 15.5 15'),
  neutral: eyes() + line('M8.5 15.5 H15.5'),
  worried: eyes() + line('M6.5 7 L10 8') + line('M17.5 7 L14 8') + line('M8.5 16.5 Q12 14.5 15.5 16.5'),
  upset: eyes(10.5) + line('M6.5 7.5 L10 6.5') + line('M17.5 7.5 L14 6.5') + line('M8 17 Q12 13.5 16 17'),
  queasy: line('M7 10 H10') + line('M14 10 H17') + line('M7.5 16 Q9.5 14.5 12 16 T16.5 16'),
  gasp: eyes(9.5) + `<ellipse cx="12" cy="16" rx="2.2" ry="2.8" fill="${INK}"/>`,
  scream: `<circle cx="8.5" cy="9.5" r="2" fill="#fff" stroke="${INK}" stroke-width="1.2"/><circle cx="15.5" cy="9.5" r="2" fill="#fff" stroke="${INK}" stroke-width="1.2"/>` + `<ellipse cx="12" cy="16.5" rx="3" ry="3.8" fill="${INK}"/>`,
  sick: line('M7 9 L10 11 M7 11 L10 9', 1.5) + line('M14 9 L17 11 M14 11 L17 9', 1.5) + `<path d="M8 15 Q12 13 16 15 L15 20 Q12 22 9 20 Z" fill="#4e7d1e" stroke="${INK}" stroke-width="1.2"/>`,
  asleep: line('M7 10.5 Q8.5 12 10 10.5') + line('M14 10.5 Q15.5 12 17 10.5') + line('M9.5 15.5 Q12 17 14.5 15.5'),
  cheer: line('M7 10.5 Q8.5 8.5 10 10.5') + line('M14 10.5 Q15.5 8.5 17 10.5') + `<path d="M7.5 13.5 Q12 21 16.5 13.5 Z" fill="${INK}"/>`,
};

/** A passenger's face as inline SVG. */
export function faceSvg(mood: Mood): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${SKIN[mood]}"/>${FEATURES[mood]}</svg>`;
}

/** The mood that goes with a comfort level (0–100). */
export function comfortMood(c: number): Mood {
  return c > 90 ? 'happy' : c > 78 ? 'content' : c > 62 ? 'neutral' : c > 45 ? 'worried' : c > 30 ? 'upset' : 'queasy';
}

/**
 * The cabin's voice on the HUD: a speech bubble under the comfort meter when passengers react, and
 * the reaction's face shown on the meter for a moment. Passenger stories go to the subtitle line.
 */
export class Cabin {
  private readonly bubble = $('cabin-bubble');
  private bubbleTimer = 0;
  private reaction: { mood: Mood; until: number } | null = null;

  constructor(private readonly onStory: (text: string) => void) {}

  reset(): void {
    this.reaction = null;
    this.bubble.classList.remove('show');
  }

  /** The face to show on the comfort meter right now, if a reaction is still playing. */
  get reactionMood(): Mood | null {
    return this.reaction && this.reaction.until > performance.now() ? this.reaction.mood : null;
  }

  react(kind: Reaction, text: string): void {
    this.reaction = { mood: REACTION_MOOD[kind], until: performance.now() + 1800 };
    this.bubble.textContent = text;
    this.bubble.classList.toggle('bad', kind === 'scream' || kind === 'vomit' || kind === 'lightning');
    this.bubble.classList.toggle('good', kind === 'happy' || kind === 'applause');
    this.bubble.classList.remove('show');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('show');
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.bubble.classList.remove('show'), 2200);
  }

  tell(text: string): void {
    this.onStory(text);
  }
}
