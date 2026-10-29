/** The cabin panel: a row of passengers whose faces follow comfort, plus their reactions. */
import type { Reaction } from '../game/comfort';
import { PASSENGERS } from '../game/comfort';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const REACTION_FACE: Record<Reaction, string> = {
  gasp: '😮',
  whoa: '😲',
  scream: '😱',
  vomit: '🤮',
  nervous: '😕',
  lightning: '😨',
  happy: '😴',
  applause: '👏',
};

function face(c: number): string {
  return c > 90 ? '😊' : c > 78 ? '🙂' : c > 62 ? '😐' : c > 45 ? '😟' : c > 30 ? '😣' : '🤢';
}

export function comfortFace(c: number): string {
  return face(c);
}

export class Cabin {
  private readonly seats: HTMLSpanElement[] = [];
  private readonly sensitivity: number[] = [];
  private readonly override: { face: string; until: number }[] = [];
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
      s.textContent = '😊';
      row.appendChild(s);
      this.seats.push(s);
      // Some passengers are braver than others.
      this.sensitivity.push(((i * 7) % count) * 2.4 - count);
      this.override.push({ face: '', until: 0 });
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
      const f = o.until > now ? o.face : face(comfort + this.sensitivity[i]);
      if (s.textContent !== f) s.textContent = f;
    });
    const happy = Math.max(0, Math.round(PASSENGERS * (comfort / 100) ** 1.5) - sickBags);
    const text = `${happy} happy${sickBags ? ` · ${sickBags} 🤮` : ''}`;
    if (this.happy.textContent !== text) this.happy.textContent = text;
  }

  react(kind: Reaction, text: string): void {
    const now = performance.now();
    const n = kind === 'scream' || kind === 'applause' || kind === 'lightning' ? 5 : kind === 'happy' ? 2 : 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * this.seats.length);
      this.override[i] = { face: REACTION_FACE[kind], until: now + 2200 };
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
