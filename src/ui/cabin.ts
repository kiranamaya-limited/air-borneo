/** The cabin panel: a row of passengers whose faces follow comfort, plus their reactions. */
import type { Reaction } from '../game/comfort';
import { PASSENGERS } from '../game/comfort';

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

export class Cabin {
  private readonly seats: HTMLSpanElement[] = [];
  private readonly shown: Mood[] = [];
  private readonly sensitivity: number[] = [];
  private readonly override: { mood: Mood; until: number }[] = [];
  private readonly bubble = $('cabin-bubble');
  private readonly story = $('cabin-story');
  private readonly happy = $('cabin-happy');
  private bubbleTimer = 0;
  private storyTimer = 0;

  constructor(count = 10) {
    const row = $('cabin-seats');
    row.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.innerHTML = faceSvg('happy');
      row.appendChild(s);
      this.seats.push(s);
      this.shown.push('happy');
      // Some passengers are braver than others.
      this.sensitivity.push(((i * 7) % count) * 2.4 - count);
      this.override.push({ mood: 'happy', until: 0 });
    }
  }

  reset(): void {
    for (const o of this.override) o.until = 0;
    this.bubble.classList.remove('show');
    this.story.textContent = '';
  }

  update(comfort: number, sickBags: number): void {
    const now = performance.now();
    this.seats.forEach((s, i) => {
      const o = this.override[i];
      const mood = o.until > now ? o.mood : comfortMood(comfort + this.sensitivity[i]);
      if (this.shown[i] !== mood) {
        this.shown[i] = mood;
        s.innerHTML = faceSvg(mood);
      }
    });
    const happy = Math.max(0, Math.round(PASSENGERS * (comfort / 100) ** 1.5) - sickBags);
    const text = `${happy} happy${sickBags ? ` · ${sickBags} sick ${sickBags === 1 ? 'bag' : 'bags'}` : ''}`;
    if (this.happy.textContent !== text) this.happy.textContent = text;
  }

  react(kind: Reaction, text: string): void {
    const now = performance.now();
    const n = kind === 'scream' || kind === 'applause' || kind === 'lightning' ? 5 : kind === 'happy' ? 2 : 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * this.seats.length);
      this.override[i] = { mood: REACTION_MOOD[kind], until: now + 2200 };
      const seat = this.seats[i];
      seat.classList.remove('react');
      void seat.offsetWidth;
      seat.classList.add('react');
    }
    this.bubble.textContent = text;
    this.bubble.classList.toggle('bad', kind === 'scream' || kind === 'vomit');
    this.bubble.classList.add('show');
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.bubble.classList.remove('show'), 2200);
  }

  tell(text: string): void {
    this.story.textContent = text;
    window.clearTimeout(this.storyTimer);
    this.storyTimer = window.setTimeout(() => (this.story.textContent = ''), 9000);
  }
}
