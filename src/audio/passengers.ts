/**
 * Passenger voices, made with formant synthesis (a buzzy "vocal cord" source shaped by vowel
 * resonances): gasps and "whoa"s, screams on sudden drops, a comic "bleurgh" when someone is
 * sick, nervous murmuring, laughter and applause. No audio files.
 */
import type { Reaction } from '../game/comfort';

type Vowel = 'a' | 'o' | 'u' | 'e' | 'i';

// First three formants (Hz) of each vowel.
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [800, 1200, 2500],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
  e: [400, 2000, 2550],
  i: [300, 2300, 3000],
};

interface VoiceShape {
  /** Pitch contour: [time 0..1, Hz] points. */
  pitch: [number, number][];
  /** Vowel contour: [time 0..1, vowel] points. */
  vowels: [number, Vowel][];
  dur: number;
  vol: number;
  /** Random pitch wobble depth (Hz), for gurgles. */
  jitter?: number;
  /** Amplitude wobble (Hz), for retching. */
  wobble?: number;
  breath?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class PassengerVoices {
  readonly out: GainNode;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(destination);
  }

  react(kind: Reaction): void {
    switch (kind) {
      case 'gasp':
      case 'lightning':
        this.crowd(kind === 'lightning' ? 4 : 2 + Math.floor(Math.random() * 2), () => this.gasp());
        break;
      case 'whoa':
        this.crowd(3, () => this.whoa());
        break;
      case 'scream':
        this.crowd(4, () => this.scream());
        break;
      case 'vomit':
        this.vomit();
        break;
      case 'nervous':
        this.murmur();
        break;
      case 'happy':
        this.crowd(2, () => this.laugh());
        break;
      case 'applause':
        this.applause();
        this.crowd(2, () => this.woo());
        break;
    }
  }

  // ------------------------------------------------------------------ reactions

  private crowd(n: number, voice: () => void): void {
    for (let i = 0; i < n; i++) window.setTimeout(voice, i === 0 ? 0 : rnd(40, 320));
  }

  private f0(): number {
    // A mix of men, women and children.
    const r = Math.random();
    return r < 0.4 ? rnd(105, 140) : r < 0.85 ? rnd(190, 250) : rnd(280, 340);
  }

  private gasp(): void {
    const f = this.f0();
    this.voice({
      pitch: [[0, f * 0.95], [0.35, f * 1.35], [1, f * 1.05]],
      vowels: [[0, 'u'], [0.4, 'o'], [1, 'o']],
      dur: rnd(0.45, 0.7),
      vol: 0.16,
      breath: 0.08,
    });
  }

  private whoa(): void {
    const f = this.f0();
    this.voice({
      pitch: [[0, f * 1.1], [0.3, f * 1.45], [1, f * 0.85]],
      vowels: [[0, 'u'], [0.25, 'o'], [0.7, 'a'], [1, 'a']],
      dur: rnd(0.7, 1.0),
      vol: 0.17,
    });
  }

  private scream(): void {
    const f = rnd(420, 700);
    this.voice({
      pitch: [[0, f], [0.2, f * 1.5], [0.7, f * 1.35], [1, f * 0.9]],
      vowels: [[0, 'a'], [0.5, Math.random() < 0.5 ? 'a' : 'i'], [1, 'a']],
      dur: rnd(0.9, 1.3),
      vol: 0.12,
      jitter: 12,
    });
  }

  private vomit(): void {
    const f = rnd(95, 130);
    // A heave, a gurgling "bleurgh", then a splash.
    this.voice({ pitch: [[0, f * 1.3], [1, f]], vowels: [[0, 'e'], [1, 'u']], dur: 0.3, vol: 0.12, breath: 0.1 });
    window.setTimeout(() => {
      this.voice({
        pitch: [[0, f * 1.2], [0.3, f], [1, f * 0.7]],
        vowels: [[0, 'e'], [0.2, 'u'], [0.5, 'o'], [0.8, 'u'], [1, 'u']],
        dur: 1.1,
        vol: 0.24,
        jitter: 40,
        wobble: 17,
      });
      this.splash(0.85);
    }, 380);
    window.setTimeout(() => this.crowd(2, () => this.ew()), 1500);
  }

  private ew(): void {
    const f = this.f0() * 1.1;
    this.voice({ pitch: [[0, f * 1.2], [1, f * 0.9]], vowels: [[0, 'e'], [1, 'u']], dur: 0.45, vol: 0.1 });
  }

  private murmur(): void {
    for (let v = 0; v < 4; v++) {
      const f = rnd(110, 210);
      let t = rnd(0, 300);
      for (let k = 0; k < 4; k++) {
        const vowels: Vowel[] = ['a', 'e', 'o', 'u', 'i'];
        const vow = vowels[Math.floor(Math.random() * vowels.length)];
        window.setTimeout(() => this.voice({ pitch: [[0, f], [1, f * rnd(0.9, 1.15)]], vowels: [[0, vow], [1, vow]], dur: rnd(0.12, 0.25), vol: 0.05 }), t);
        t += rnd(150, 320);
      }
    }
  }

  private laugh(): void {
    const f = this.f0() * 1.15;
    for (let k = 0; k < 4; k++) {
      window.setTimeout(() => this.voice({ pitch: [[0, f * (1.1 - k * 0.04)], [1, f * 0.95]], vowels: [[0, 'a'], [1, 'a']], dur: 0.11, vol: 0.09, breath: 0.12 }), k * 150);
    }
  }

  private woo(): void {
    const f = this.f0() * 1.3;
    this.voice({ pitch: [[0, f], [0.5, f * 1.5], [1, f * 1.2]], vowels: [[0, 'u'], [1, 'u']], dur: 0.8, vol: 0.1 });
  }

  private applause(): void {
    const ctx = this.ctx;
    const start = ctx.currentTime;
    const dur = 3.2;
    for (let i = 0; i < 140; i++) {
      const t = start + Math.random() * dur * (0.4 + 0.6 * Math.random());
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = rnd(900, 2600);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      const fade = 1 - (t - start) / dur;
      g.gain.setValueAtTime(0.18 * fade, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(bp).connect(g).connect(this.out);
      src.start(t, Math.random());
      src.stop(t + 0.04);
    }
  }

  private splash(at: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(lp).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }

  // ------------------------------------------------------------------ the synthesiser

  private voice(v: VoiceShape): void {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const t1 = t0 + v.dur;

    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(v.pitch[0][1], t0);
    for (const [k, hz] of v.pitch) if (k > 0) src.frequency.linearRampToValueAtTime(hz, t0 + k * v.dur);

    // Natural vibrato, plus optional gurgle jitter.
    const vib = ctx.createOscillator();
    vib.frequency.value = rnd(5, 6.5);
    const vibGain = ctx.createGain();
    vibGain.gain.value = v.pitch[0][1] * 0.02;
    vib.connect(vibGain).connect(src.frequency);
    const extras: AudioScheduledSourceNode[] = [vib];
    if (v.jitter) {
      const j = ctx.createBufferSource();
      j.buffer = this.noise;
      j.playbackRate.value = 0.02;
      const jg = ctx.createGain();
      jg.gain.value = v.jitter;
      j.connect(jg).connect(src.frequency);
      extras.push(j);
    }

    // Three formant filters in parallel, following the vowel contour.
    const mix = ctx.createGain();
    for (let f = 0; f < 3; f++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = f === 0 ? 6 : 9;
      bp.frequency.setValueAtTime(FORMANTS[v.vowels[0][1]][f], t0);
      for (const [k, vow] of v.vowels) if (k > 0) bp.frequency.linearRampToValueAtTime(FORMANTS[vow][f], t0 + k * v.dur);
      const g = ctx.createGain();
      g.gain.value = [1, 0.6, 0.25][f];
      src.connect(bp).connect(g).connect(mix);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(v.vol, t0 + Math.min(0.06, v.dur * 0.2));
    env.gain.setValueAtTime(v.vol, t1 - v.dur * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    if (v.wobble) {
      const w = ctx.createOscillator();
      w.frequency.value = v.wobble;
      const wg = ctx.createGain();
      wg.gain.value = v.vol * 0.7;
      w.connect(wg).connect(env.gain);
      extras.push(w);
    }
    mix.connect(env).connect(this.out);

    if (v.breath) {
      const b = ctx.createBufferSource();
      b.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1600;
      bp.Q.value = 0.8;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(v.breath, t0);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.35, v.dur));
      b.connect(bp).connect(bg).connect(this.out);
      b.start(t0, Math.random());
      b.stop(t0 + 0.4);
    }

    src.start(t0);
    src.stop(t1 + 0.05);
    for (const e of extras) {
      e.start(t0);
      e.stop(t1 + 0.05);
    }
  }
}
