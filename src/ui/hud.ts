/**
 * The big-screen HUD, kept to four things so the player can concentrate on flying smoothly:
 *  - a top bar: the journey, passenger comfort (the main score) with the cabin's reactions, and points;
 *  - one message banner with the single most important thing to do or watch out for;
 *  - the steady arc under the aircraft: how far you're banking, how fast you're rolling and how hard
 *    you're pushing or pulling, against what the passengers find comfortable;
 *  - one subtitle line for the captain's announcements and passenger stories.
 */
import { brand } from '../brand/tokens';
import { COMFORT_LIMITS } from '../game/comfort';
import type { Mission } from '../game/mission';
import type { Grade } from '../game/scoring';
import type { LinkStatus } from '../net/link';
import { Cabin, comfortMood, faceSvg, type Mood } from './cabin';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** The cruise-time hint: shown for the first seconds of flight, then the banner gets out of the way. */
const STEER_HINT_SECONDS = 10;

export class Hud {
  private readonly root = $('hud');
  private readonly score = $('hud-score');
  private readonly mult = $('hud-mult');
  private readonly comfortVal = $('hud-comfort');
  private readonly comfortBar = $('hud-comfort-bar');
  private readonly comfortHero = $('comfort-hero');
  private readonly face = $('hud-face');
  private readonly banner = $('hud-prompt');
  private readonly popups = $('popups');
  private readonly progress = $('hud-progress');
  private readonly plane = $('hud-plane');
  private readonly link = $('hud-link');
  private readonly subtitleEl = $('hud-subtitle');
  private readonly arc = $<HTMLCanvasElement>('steady-arc');
  readonly cabin = new Cabin((text) => this.subtitle(text));

  private faceMood: Mood | null = null;
  private lastComfort = 100;
  private dropTimer = 0;
  private subtitleTimer = 0;
  private popupTimer = 0;
  private pending: { grade: Grade; points: number } | null = null;
  private lastMult = 1;
  private load = 1;
  private arcAlpha = 0;
  private lastFrame = performance.now();

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Marker pop-ups, merged so a burst of markers at cruise speed reads as one. */
  popup(grade: Grade, points: number): void {
    const rank: Record<Grade, number> = { PERFECT: 3, GOOD: 2, OK: 1, MISS: 0 };
    if (this.pending && rank[grade] > rank[this.pending.grade]) this.pending.grade = grade;
    if (this.pending) this.pending.points += points;
    else this.pending = { grade, points };
    if (this.popupTimer) return;
    this.popupTimer = window.setTimeout(() => {
      const p = this.pending!;
      this.pending = null;
      this.popupTimer = 0;
      if (p.grade === 'MISS') return;
      const el = document.createElement('div');
      el.className = `popup ${p.grade}`;
      el.textContent = `${p.grade === 'PERFECT' ? 'Perfect' : p.grade === 'GOOD' ? 'Good' : 'OK'} +${p.points}`;
      el.style.marginLeft = `${(Math.random() - 0.5) * 80}px`;
      this.popups.appendChild(el);
      window.setTimeout(() => el.remove(), 950);
    }, 350);
  }

  /** One line of subtitles (the captain's announcements, passenger stories), faded out when read. */
  subtitle(text: string, speaker?: string): void {
    this.subtitleEl.innerHTML = '';
    if (speaker) {
      const who = document.createElement('b');
      who.textContent = `${speaker} `;
      this.subtitleEl.appendChild(who);
    }
    this.subtitleEl.appendChild(document.createTextNode(text));
    this.subtitleEl.classList.add('show');
    window.clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => this.subtitleEl.classList.remove('show'), Math.max(4500, text.length * 65));
  }

  /** Only shown when something is wrong with the phone. */
  linkStatus(status: LinkStatus | 'keyboard', stale: boolean): void {
    const problem = status === 'keyboard' ? '' : status !== 'connected' ? 'Phone disconnected' : stale ? 'Weak phone signal' : '';
    this.link.classList.toggle('hidden', !problem);
    if (problem) setText(this.link, problem);
  }

  update(m: Mission): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // ---- top bar
    setText(this.score, m.scorer.score.toLocaleString());
    const mult = m.scorer.multiplier;
    setText(this.mult, `×${mult % 1 ? mult.toFixed(1) : mult}`);
    this.mult.classList.toggle('hot', mult > 1);
    if (mult !== this.lastMult) {
      this.mult.classList.add('bump');
      window.setTimeout(() => this.mult.classList.remove('bump'), 220);
      this.lastMult = mult;
    }

    const c = m.comfort;
    setText(this.comfortVal, `${Math.round(c)}%`);
    this.comfortBar.style.width = `${c}%`;
    this.comfortBar.style.background = c > 75 ? brand.colors.good : c > 50 ? brand.colors.yellow : brand.colors.red;
    this.comfortHero.classList.toggle('low', c <= 50);
    // A visible jolt on the meter whenever the cabin loses comfort.
    if (c < this.lastComfort - 0.15 && !this.dropTimer) {
      this.comfortHero.classList.add('drop');
      this.dropTimer = window.setTimeout(() => {
        this.comfortHero.classList.remove('drop');
        this.dropTimer = 0;
      }, 650);
    }
    this.lastComfort = c;
    const mood = this.cabin.reactionMood ?? comfortMood(c);
    if (mood !== this.faceMood) {
      this.faceMood = mood;
      this.face.innerHTML = faceSvg(mood);
    }

    const p = m.progress;
    this.progress.style.width = `${p * 100}%`;
    this.plane.style.left = `${p * 100}%`;

    // ---- the one message that matters most right now
    this.updateBanner(m);

    // ---- steady arc
    this.drawSteadyArc(m, dt);
  }

  private updateBanner(m: Mission): void {
    const urgentWant = m.want === 'pitch-up' || m.want === 'flaps' || m.want === 'throttle-up' || m.want === 'throttle-idle';
    let text = m.prompt;
    let level: 'tip' | 'action' | 'caution' | 'warning' = urgentWant ? 'action' : 'tip';
    const a = m.alert;
    if (a && (a.level === 'warning' || !urgentWant)) {
      text = a.text;
      level = a.level === 'warning' ? 'warning' : 'caution';
    }
    // The cruise hint has done its job after a few seconds; keep the screen clear.
    if (level === 'tip' && m.want === 'steer' && text === m.steerHint && m.phase === 'flight' && m.phaseTime > STEER_HINT_SECONDS) text = '';
    setText(this.banner, text);
    this.banner.className = `banner ${level}${text ? ' show' : ''}`;
  }

  /**
   * The steady arc: a smile-shaped gauge under the aircraft. The needle is the bank angle (green while
   * the passengers are comfortable, amber, then red) and glows when you roll too fast; the dot in the
   * middle rises and sinks with the push and pull you're putting the cabin through.
   */
  private drawSteadyArc(m: Mission, dt: number): void {
    const canvas = this.arc;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ac = m.ac;
    const flying = (m.phase === 'flight' || m.phase === 'flare') && !ac.onGround;
    this.load += (ac.load - this.load) * Math.min(1, dt * 1.5);
    const L = COMFORT_LIMITS;
    const bank = ac.bank;
    const rolling = Math.abs(ac.pilotRollRate) > L.rollRate;
    const gOff = this.load > L.loadHigh || this.load < L.loadLow;
    // Fade in when the player moves the plane, fade back when everything is calm.
    const activity = Math.max(Math.abs(bank) / 15, Math.abs(ac.pilotRollRate) / L.rollRate, Math.abs(this.load - 1) / 0.25);
    const target = flying ? 0.35 + 0.65 * Math.min(1, activity) : 0;
    this.arcAlpha += (target - this.arcAlpha) * Math.min(1, dt * 4);
    if (this.arcAlpha < 0.02) return;
    ctx.globalAlpha = this.arcAlpha;

    // We draw the lower rim of a circle whose centre sits above the canvas, around the aircraft.
    const cx = w / 2;
    const r = Math.min(w / 2 - 16, (h - 26) / 0.52);
    const cy = h - 16 - r;
    const deg = Math.PI / 180;
    // Bank angle maps to the angle from straight down: right bank moves the needle right.
    const at = (b: number) => Math.PI / 2 - b * deg * 1.25;
    const band = (from: number, to: number, color: string) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, at(to), at(from));
      ctx.strokeStyle = color;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    const amber = 35;
    band(-48, -amber, 'rgba(210,31,44,0.85)');
    band(amber, 48, 'rgba(210,31,44,0.85)');
    band(-amber, -L.bank, 'rgba(255,198,41,0.95)');
    band(L.bank, amber, 'rgba(255,198,41,0.95)');
    band(-L.bank, L.bank, 'rgba(31,164,99,0.95)');

    // Needle.
    const b = Math.max(-48, Math.min(48, bank));
    const ang = at(b);
    const nx = cx + Math.cos(ang) * r;
    const ny = cy + Math.sin(ang) * r;
    const steep = Math.abs(bank) > L.bank;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(ang - Math.PI / 2);
    if (rolling) {
      ctx.shadowColor = brand.colors.red;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = rolling || Math.abs(bank) > amber ? brand.colors.red : steep ? brand.colors.yellow : brand.colors.white;
    ctx.strokeStyle = brand.colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, 9);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Push/pull dot: rises with extra g, sinks when the cabin goes light.
    const gy = Math.max(-1, Math.min(1, (this.load - 1) / 0.5));
    const px = cx;
    const pyMid = cy + r * 0.6;
    ctx.fillStyle = 'rgba(17,18,22,0.35)';
    ctx.beginPath();
    ctx.roundRect(px - 5, pyMid - 22, 10, 44, 5);
    ctx.fill();
    ctx.fillStyle = gOff ? brand.colors.red : brand.colors.white;
    ctx.beginPath();
    ctx.arc(px, pyMid - gy * 18, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
