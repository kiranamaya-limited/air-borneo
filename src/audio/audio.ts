/**
 * Synthesised sound: lounge music, PW127 turboprop drone, wind gusts, rain, thunder, passenger
 * reactions, cabin chimes, marker chimes and cockpit alerts. Callouts and the captain's PA use the
 * browser's speech synthesis.
 *
 * Audio starts without a click wherever the browser allows it (the Mac app and the demo launcher
 * enable autoplay); otherwise it starts silently on the first key press or tap.
 */
import type { Grade } from '../game/scoring';
import type { Reaction } from '../game/comfort';
import { LoungeMusic } from './music';
import { PassengerVoices } from './passengers';

export class GameAudio {
  private ctx?: AudioContext;
  private master!: GainNode;
  private propOsc!: OscillatorNode;
  private propOsc2!: OscillatorNode;
  private propGain!: GainNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private washGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private noise!: AudioBuffer;
  private warnTimer = 0;
  private voice?: SpeechSynthesisVoice;
  private music?: LoungeMusic;
  private voices?: PassengerVoices;
  private paSpeaking = false;
  private gustPhase = 0;
  muted = false;

  /** For tests: is sound running, and is the lounge music playing? */
  get state(): { context: string; music: boolean } {
    return { context: this.ctx?.state ?? 'none', music: !!this.music?.isPlaying };
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Create the audio graph and try to start straight away (no click needed where autoplay is allowed). */
  init(): void {
    if (!this.ctx) this.build();
    this.pickVoice();
    void this.ctx?.resume().then(() => this.music?.start());
    this.music?.start();
  }

  /** Called on any key press / tap: resumes audio if the browser held it back. */
  unlock(): void {
    this.init();
  }

  private build(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.start();
      return src;
    };

    // Propeller blade-pass drone.
    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'lowpass';
    propFilter.frequency.value = 520;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propOsc = ctx.createOscillator();
    this.propOsc.type = 'sawtooth';
    this.propOsc2 = ctx.createOscillator();
    this.propOsc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    this.propOsc.connect(propFilter);
    this.propOsc2.connect(g2).connect(propFilter);
    propFilter.connect(this.propGain).connect(this.master);
    this.propOsc.start();
    this.propOsc2.start();

    // Turbine whine.
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    // Prop wash.
    const wash = ctx.createBiquadFilter();
    wash.type = 'bandpass';
    wash.frequency.value = 700;
    wash.Q.value = 0.6;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    loop().connect(wash).connect(this.washGain).connect(this.master);

    // Wind.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Rain.
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 2200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    loop().connect(rainFilter).connect(this.rainGain).connect(this.master);

    this.music = new LoungeMusic(ctx, this.master, this.noise);
    this.voices = new PassengerVoices(ctx, this.master, this.noise);
  }

  private pickVoice(): void {
    if (!('speechSynthesis' in window)) return;
    const choose = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => /en-GB/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang));
    };
    choose();
    speechSynthesis.onvoiceschanged = choose;
  }

  update(dt: number, s: { prop: number; speed: number; rain: number; warning: boolean; turb: number; gust: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = 0.15;
    // The engines sit under the music: present, not dominant.
    const blade = 38 + s.prop * 78;
    this.propOsc.frequency.setTargetAtTime(blade, t, k);
    this.propOsc2.frequency.setTargetAtTime(blade * 2.01, t, k);
    this.propGain.gain.setTargetAtTime(this.muted ? 0 : 0.03 + s.prop * 0.08, t, k);
    this.whine.frequency.setTargetAtTime(1500 + s.prop * 1600, t, k);
    this.whineGain.gain.setTargetAtTime(this.muted ? 0 : s.prop * 0.007, t, k);
    this.washGain.gain.setTargetAtTime(this.muted ? 0 : s.prop * 0.07, t, k);
    // Wind swells with gusts and rough air.
    this.gustPhase += dt * (0.6 + s.turb * 2.5);
    const swell = 1 + s.gust * 0.9 * (0.5 + 0.5 * Math.sin(this.gustPhase)) + s.turb * 0.6 * Math.abs(Math.sin(this.gustPhase * 2.3));
    this.windFilter.frequency.setTargetAtTime((250 + s.speed * 5) * (0.8 + 0.4 * swell), t, k);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.32, (s.speed / 1100) * swell), t, k);
    this.rainGain.gain.setTargetAtTime(this.muted ? 0 : s.rain * 0.2, t, 0.4);
    this.music?.setStorm(Math.max(s.rain, s.turb > 0.5 ? s.turb - 0.3 : 0));
    this.music?.out.gain.setTargetAtTime(this.muted ? 0 : 0.22, t, 0.3);
    // A whoosh now and then when it's bumpy.
    if (s.turb > 0.45 && Math.random() < dt * s.turb * 0.9) this.burst(0.9, 'bandpass', 500 + Math.random() * 600, 0.12 * s.turb, 0, 0.8);

    this.warnTimer -= dt;
    if (s.warning && this.warnTimer <= 0) {
      this.warnTimer = 0.9;
      this.beep(880, 0.12, 'square', 0.06);
      window.setTimeout(() => this.beep(880, 0.12, 'square', 0.06), 180);
    }
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, filterType: BiquadFilterType, freq: number, vol: number, delay = 0, decay = dur): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  chime(grade: Grade): void {
    if (grade === 'PERFECT') {
      this.beep(1318, 0.18, 'sine', 0.07);
      this.beep(1976, 0.22, 'sine', 0.05, 0.05);
    } else if (grade === 'GOOD') this.beep(988, 0.15, 'sine', 0.06);
    else if (grade === 'OK') this.beep(740, 0.12, 'triangle', 0.05);
  }

  caution(): void {
    this.beep(660, 0.25, 'sine', 0.1);
  }

  configHorn(): void {
    for (let i = 0; i < 4; i++) this.beep(330, 0.18, 'square', 0.08, i * 0.3);
  }

  thunder(): void {
    const delay = 0.2 + Math.random() * 1.2;
    this.burst(3.5, 'lowpass', 160, 0.55, delay, 3.2);
    this.burst(0.6, 'lowpass', 900, 0.25, delay, 0.5);
  }

  touchdown(hard: boolean): void {
    this.beep(65, hard ? 0.6 : 0.35, 'sine', hard ? 0.5 : 0.25);
    this.burst(0.25, 'bandpass', 2400, hard ? 0.18 : 0.1);
  }

  squelch(): void {
    this.burst(0.12, 'highpass', 3000, 0.05);
  }

  /** Cockpit callouts are short and may interrupt each other; the captain's PA is never cut off. */
  speak(text: string, kind: 'callout' | 'pa' = 'callout'): void {
    if (this.muted || !('speechSynthesis' in window)) return;
    if (kind === 'callout' && this.paSpeaking) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.rate = kind === 'pa' ? 0.98 : 1.05;
      u.pitch = kind === 'pa' ? 0.8 : 0.95;
      u.volume = 0.9;
      if (kind === 'pa') {
        this.paSpeaking = true;
        u.onend = u.onerror = () => (this.paSpeaking = false);
        this.music?.duck(0.3, Math.max(3, text.length / 14));
      } else speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  }

  /** The cabin "ding-dong". */
  cabinChime(): void {
    this.beep(698, 1.2, 'sine', 0.11);
    this.beep(1396, 0.5, 'sine', 0.03);
    this.beep(554, 1.4, 'sine', 0.11, 0.55);
    this.beep(1108, 0.5, 'sine', 0.03, 0.55);
  }

  /** Passengers react out loud. */
  passengers(kind: Reaction): void {
    if (this.muted || !this.voices) return;
    this.voices.react(kind);
    if (kind !== 'happy') this.music?.duck(0.55, 1.8);
  }
}
