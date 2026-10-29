/**
 * Lounge / elevator music, synthesised live: a laid-back bossa nova in F at 96 bpm.
 * Soft FM electric piano comping, a walking sine bass, a vibraphone melody, shaker and a rim-click
 * clave, all through a generated room reverb. No audio files.
 */

const BPM = 96;
const BEAT = 60 / BPM;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Eight bars, one chord each (MIDI notes): Fmaj9 Dm9 Gm9 C13 | Am7 D7(9) Gm9 C7(13).
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 41, tones: [57, 60, 64, 67] }, // Fmaj9: A C E G
  { root: 38, tones: [57, 60, 64, 65] }, // Dm9: A C E F
  { root: 43, tones: [58, 62, 65, 69] }, // Gm9: Bb D F A
  { root: 36, tones: [58, 62, 64, 69] }, // C13: Bb D E A
  { root: 45, tones: [55, 60, 64, 67] }, // Am7: G C E G
  { root: 38, tones: [54, 60, 64, 66] }, // D7(9): F# C E F#
  { root: 43, tones: [58, 62, 65, 69] }, // Gm9
  { root: 36, tones: [58, 62, 64, 67] }, // C7(13)
];

// A gentle melody: [bar, beat, midi, beats long]
const MELODY: [number, number, number, number][] = [
  [0, 0, 72, 1.5], [0, 1.5, 69, 0.5], [0, 2, 67, 2],
  [1, 0, 69, 1], [1, 1, 72, 1], [1, 2, 74, 2],
  [2, 0.5, 74, 1], [2, 1.5, 72, 0.5], [2, 2, 70, 2],
  [3, 0, 69, 1.5], [3, 1.5, 67, 2.5],
  [4, 0, 72, 1], [4, 1, 76, 1.5], [4, 2.5, 74, 1.5],
  [5, 0, 72, 2], [5, 2, 69, 2],
  [6, 0, 70, 1.5], [6, 1.5, 69, 0.5], [6, 2, 67, 2],
  [7, 0, 65, 4],
];

// Bossa piano comping hits within a bar (in beats).
const COMP = [0, 1.5, 3, 3.5];
// 3-2 clave across two bars (in beats from the start of the pair).
const CLAVE = [0, 1.5, 3, 5, 6];

export class LoungeMusic {
  readonly out: GainNode;
  private readonly bus: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private timer = 0;
  private nextTime = 0;
  private step = 0; // eighth notes since start
  private playing = false;
  private duckLevel = 1;
  private storm = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, noise: AudioBuffer) {
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0.22;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 9000;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.bus.connect(this.tone);
    this.bus.connect(reverb).connect(wet).connect(this.tone);
    this.tone.connect(this.out).connect(destination);
  }

  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    this.playing = false;
    window.clearInterval(this.timer);
  }

  /** Lower the music briefly (speech, passenger reactions). */
  duck(amount = 0.35, seconds = 2.5): void {
    const t = this.ctx.currentTime;
    this.duckLevel = amount;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(amount, t, 0.08);
    this.bus.gain.setTargetAtTime(1, t + seconds, 0.6);
    window.setTimeout(() => (this.duckLevel = 1), seconds * 1000);
  }

  /** Heavy weather muffles the music (as if the cabin speakers are fighting the rain). */
  setStorm(s: number): void {
    if (Math.abs(s - this.storm) < 0.02) return;
    this.storm = s;
    this.tone.frequency.setTargetAtTime(9000 - s * 7800, this.ctx.currentTime, 0.4);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get ducked(): boolean {
    return this.duckLevel < 1;
  }

  private schedule(): void {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += BEAT / 2;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 8) % CHORDS.length;
    const beat = (step % 8) / 2;
    const chord = CHORDS[bar];
    const swing = step % 2 ? BEAT * 0.04 : 0; // a touch of laid-back feel

    if (COMP.includes(beat)) {
      const accent = beat === 0 ? 1 : 0.75;
      chord.tones.forEach((n, i) => this.epiano(midi(n), t + swing + i * 0.012, beat === 3.5 ? 0.5 : 1.1, 0.05 * accent));
    }
    // Bass: root on 1, fifth on the "and" of 2, root on 3, fifth on the "and" of 4.
    if (beat === 0 || beat === 2) this.bass(midi(chord.root), t, BEAT * 1.4);
    if (beat === 1.5 || beat === 3.5) this.bass(midi(chord.root + 7), t + swing, BEAT * 0.45);

    for (const [b, at, note, len] of MELODY) if (b === bar && at === beat) this.vibes(midi(note), t + swing, len * BEAT);

    // Shaker on every eighth, accented on the off-beats.
    this.shaker(t + swing, step % 2 ? 0.022 : 0.012);
    const inPair = (bar % 2) * 4 + beat;
    if (CLAVE.includes(inPair)) this.rim(t);
  }

  private epiano(freq: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 1.0;
    modGain.gain.setValueAtTime(freq * 1.6, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.15, t + 0.4);
    mod.connect(modGain).connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.bus);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private bass(freq: number, t: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private vibes(freq: number, t: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.frequency.value = freq;
    o2.frequency.value = freq * 4; // bar overtone
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.3;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const peak = 0.055;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, dur * 1.2));
    // Tremolo: a gain stage around 1.0, wobbled by ±0.3.
    const tremStage = ctx.createGain();
    tremStage.gain.value = 1;
    trem.connect(tremGain).connect(tremStage.gain);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(tremStage).connect(this.bus);
    const end = t + Math.max(0.6, dur * 1.2) + 0.05;
    for (const n of [o, o2, trem]) {
      n.start(t);
      n.stop(end);
    }
  }

  private shaker(t: number, vol: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }

  private rim(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1700;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(bp).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.05);
  }
}
