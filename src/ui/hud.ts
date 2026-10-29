/** The big-screen head-up display: tapes, prompts, alerts, score, route progress and ATC. */
import { brand, flight } from '../brand/tokens';
import { altitudeFt, ias, verticalSpeedFpm } from '../game/flight';
import type { Mission } from '../game/mission';
import type { Grade } from '../game/scoring';
import type { LinkStatus } from '../net/link';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  private readonly root = $('hud');
  private readonly stage = $('hud-stage');
  private readonly score = $('hud-score');
  private readonly mult = $('hud-mult');
  private readonly accuracy = $('hud-accuracy');
  private readonly dev = $('hud-dev');
  private readonly fresh = $('hud-fresh');
  private readonly prompt = $('hud-prompt');
  private readonly callout = $('hud-callout');
  private readonly alert = $('hud-alert');
  private readonly popups = $('popups');
  private readonly atc = $('hud-atc');
  private readonly radio = $('hud-radio');
  private readonly nm = $('hud-nm');
  private readonly progress = $('hud-progress');
  private readonly plane = $('hud-plane');
  private readonly flaps = $('hud-flaps');
  private readonly gear = $('hud-gear');
  private readonly wind = $('hud-wind');
  private readonly link = $('hud-link');
  private readonly speedTape = $<HTMLCanvasElement>('speed-tape');
  private readonly altTape = $<HTMLCanvasElement>('alt-tape');
  private readonly hdgTape = $<HTMLCanvasElement>('heading-tape');
  private calloutTimer = 0;
  private popupTimer = 0;
  private pending: { grade: Grade; points: number } | null = null;
  private lastMult = 1;

  constructor(mission: Mission) {
    setText($('hud-flight'), `${flight.flightNo} · ${flight.from.code} → ${flight.to.code}`);
    // Hazard icons along the progress bar.
    const track = $('progress-track');
    const st = mission.route.stations;
    const span = st['final:end'] - st['climb'];
    for (const [s, icon, label] of [
      [st['turnout'] + 400, '💨', 'Crosswind'],
      [st['rainforest'] + 300, '☁️', 'Updrafts'],
      [st['storm'] + 400, '⛈️', 'Thunderstorm'],
      [st['squall'] + 300, '🌧️', 'Sumatra squall'],
      [st['final'] + 600, '⚠️', 'Windshear'],
    ] as const) {
      const el = document.createElement('span');
      el.className = 'hazard';
      el.textContent = icon;
      el.title = label;
      el.style.left = `${((s - st['climb']) / span) * 100}%`;
      track.appendChild(el);
    }
  }

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
      el.textContent = `${p.grade} +${p.points}`;
      el.style.marginLeft = `${(Math.random() - 0.5) * 60}px`;
      this.popups.appendChild(el);
      window.setTimeout(() => el.remove(), 950);
    }, 350);
  }

  showCallout(text: string): void {
    setText(this.callout, text);
    this.callout.classList.add('show');
    window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => this.callout.classList.remove('show'), 1800);
  }

  showAtc(text: string): void {
    setText(this.atc, text);
    this.radio.classList.add('flash');
    window.setTimeout(() => this.radio.classList.remove('flash'), 1200);
  }

  linkStatus(status: LinkStatus | 'keyboard', stale: boolean): void {
    const [label, cls] =
      status === 'keyboard'
        ? ['Keyboard', 'ok']
        : status === 'connected'
          ? [stale ? 'Weak signal' : 'Phone', stale ? 'warn' : 'ok']
          : ['No phone', 'bad'];
    this.link.className = `ab-chip ${cls}`;
    setText(this.link.querySelector('span:last-child') as HTMLElement, label);
  }

  update(m: Mission): void {
    const ac = m.ac;
    this.root.classList.toggle('cinematic', m.phase === 'intro' || m.phase === 'taxiIn');
    setText(this.stage, m.stage);
    setText(this.score, m.scorer.score.toLocaleString());
    const mult = m.scorer.multiplier;
    setText(this.mult, `×${mult % 1 ? mult.toFixed(1) : mult}`);
    if (mult !== this.lastMult) {
      this.mult.classList.add('bump');
      window.setTimeout(() => this.mult.classList.remove('bump'), 200);
      this.lastMult = mult;
    }
    const inFlight = m.phase === 'flight' || m.phase === 'flare';
    const acc = inFlight ? Math.max(0, 1 - m.track.dist / 40) : 0;
    this.accuracy.style.width = `${acc * 100}%`;
    this.accuracy.style.background = acc > 0.8 ? brand.colors.good : acc > 0.5 ? brand.colors.yellow : brand.colors.red;
    setText(this.dev, inFlight ? `${Math.round(m.track.dist)} m` : '–');
    setText(this.fresh, `${Math.round(m.scorer.freshness)}%`);

    setText(this.prompt, m.prompt);
    this.prompt.classList.toggle('urgent', m.want === 'pitch-up' || m.want === 'flaps' || m.want === 'throttle-up' || m.want === 'throttle-idle');
    if (m.alert) {
      this.alert.classList.remove('hidden');
      this.alert.className = `alert ${m.alert.level}`;
      setText(this.alert, m.alert.text);
    } else this.alert.classList.add('hidden');

    const p = m.progress;
    this.progress.style.width = `${p * 100}%`;
    this.plane.style.left = `${p * 100}%`;
    setText(this.nm, `${Math.round(flight.distanceNm * (1 - p))} NM to go`);
    setText(this.flaps, `${ac.flaps}`);
    setText(this.gear, ac.gear > 0.95 ? 'DN' : ac.gear < 0.05 ? 'UP' : '···');
    this.gear.classList.toggle('ok', ac.gear > 0.95);
    const wx = m.wx;
    setText(this.wind, `${String(wx.windFrom).padStart(3, '0')}/${wx.windKt}${wx.gustKt > wx.windKt ? `G${wx.gustKt}` : ''}`);

    const routeHdg = m.route.at(m.track.s + 300).heading;
    this.drawSpeed(ias(ac.speed));
    this.drawAltitude(altitudeFt(ac.pos.y), verticalSpeedFpm(ac.vs, ac.pos.y));
    this.drawHeading(ac.heading, inFlight ? routeHdg : null);
  }

  // ------------------------------------------------------------------- instrument tapes

  private tapeFrame(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 16);
    ctx.fill();
    return ctx;
  }

  private drawVerticalTape(canvas: HTMLCanvasElement, value: number, pxPerUnit: number, minor: number, major: number, label: string, digits: (v: number) => string, footer: string, clampMin = -Infinity): void {
    const ctx = this.tapeFrame(canvas);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cy = h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 24, w, h - 48);
    ctx.clip();
    ctx.strokeStyle = brand.colors.ink;
    ctx.fillStyle = brand.colors.ink;
    ctx.lineWidth = 1.5;
    ctx.font = `700 13px ${brand.fonts.instrument}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const range = h / 2 / pxPerUnit;
    const start = Math.floor((value - range) / minor) * minor;
    for (let v = start; v <= value + range; v += minor) {
      if (v < clampMin) continue;
      const y = cy - (v - value) * pxPerUnit;
      const isMajor = Math.abs(v % major) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(w - (isMajor ? 18 : 10), y);
      ctx.lineTo(w - 2, y);
      ctx.stroke();
      if (isMajor) ctx.fillText(digits(v), w - 24, y);
    }
    ctx.restore();
    // Readout box.
    ctx.fillStyle = brand.colors.ink;
    ctx.beginPath();
    ctx.roundRect(8, cy - 17, w - 16, 34, 9);
    ctx.fill();
    ctx.fillStyle = brand.colors.white;
    ctx.font = `700 19px ${brand.fonts.instrument}`;
    ctx.textAlign = 'center';
    ctx.fillText(digits(Math.round(value)), w / 2, cy + 1);
    ctx.fillStyle = brand.colors.slate;
    ctx.font = `700 11px ${brand.fonts.instrument}`;
    ctx.fillText(label, w / 2, 13);
    ctx.fillText(footer, w / 2, h - 12);
  }

  private drawSpeed(kt: number): void {
    this.drawVerticalTape(this.speedTape, kt, 3, 10, 20, 'IAS KT', (v) => `${Math.round(v)}`, 'VR 110', 0);
  }

  private drawAltitude(ft: number, fpm: number): void {
    const fmt = (v: number) => `${Math.round(v)}`;
    const vs = `${fpm > 0 ? '▲' : fpm < 0 ? '▼' : ''}${Math.abs(fpm)} FPM`;
    this.drawVerticalTape(this.altTape, ft, ft > 3000 ? 0.06 : 0.6, ft > 3000 ? 500 : 50, ft > 3000 ? 1000 : 100, 'ALT FT', fmt, vs, -100);
  }

  private drawHeading(hdg: number, bug: number | null): void {
    const canvas = this.hdgTape;
    const ctx = this.tapeFrame(canvas);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w / 2;
    const px = 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 0, w - 20, h);
    ctx.clip();
    ctx.strokeStyle = brand.colors.ink;
    ctx.fillStyle = brand.colors.ink;
    ctx.font = `700 12px ${brand.fonts.instrument}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const start = Math.floor((hdg - cx / px) / 5) * 5;
    for (let d = start; d <= hdg + cx / px; d += 5) {
      const x = cx + (d - hdg) * px;
      const deg = ((d % 360) + 360) % 360;
      const major = deg % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, h - 4);
      ctx.lineTo(x, h - (major ? 14 : 9));
      ctx.stroke();
      if (deg % 30 === 0) {
        const card: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        ctx.fillText(card[deg] ?? String(deg / 10).padStart(2, '0'), x, 8);
      }
    }
    if (bug !== null) {
      const d = ((bug - hdg + 540) % 360) - 180;
      const x = Math.max(14, Math.min(w - 14, cx + d * px));
      ctx.fillStyle = brand.colors.red;
      ctx.beginPath();
      ctx.moveTo(x - 7, h - 2);
      ctx.lineTo(x + 7, h - 2);
      ctx.lineTo(x, h - 12);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = brand.colors.ink;
    ctx.beginPath();
    ctx.roundRect(cx - 28, 3, 56, 24, 7);
    ctx.fill();
    ctx.fillStyle = brand.colors.white;
    ctx.font = `700 15px ${brand.fonts.instrument}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, 15);
  }
}
