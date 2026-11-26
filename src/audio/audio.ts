/**
 * Synthesised sound: lounge music, CFM56 turbofan rumble and whine, wind gusts, rain, thunder, passenger
 * reactions, cabin chimes, marker chimes and cockpit alerts. The captain's announcements and the
 * cockpit callouts are recorded voice clips (public/voice, made by scripts/voices.py), the PA played
 * through a cabin-speaker chain; any line without a clip falls back to the browser's speech synthesis.
 *
 * Audio starts without a click wherever the browser allows it (the Mac app and the demo launcher
 * enable autoplay); otherwise it starts silently on the first key press or tap.
 */
import type { Grade } from '../game/scoring';
import type { Reaction } from '../game/comfort';
import { LoungeMusic } from './music';
import { PassengerVoices } from './passengers';
import { VOICE_LINES, voiceFor, type VoiceKind } from './lines';

/** Lounge music level: the main thing you hear, above the engines. */
const MUSIC_LEVEL = 0.5;

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
  private readonly clips = new Map<string, AudioBuffer>();
  private voicesRequested = false;
  private paIn?: AudioNode;
  private calloutIn?: AudioNode;
  private clipsPlayed = 0;
  private gustPhase = 0;
  muted = false;

  /** For tests: is sound running, and is the lounge music playing? */
  get state(): { context: string; music: boolean; voices: number; clipsPlayed: number } {
    return { context: this.ctx?.state ?? 'none', music: !!this.music?.isPlaying, voices: this.clips.size, clipsPlayed: this.clipsPlayed };
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Create the audio graph and try to start straight away (no click needed where autoplay is allowed). */
  init(): void {
    if (!this.ctx) this.build();
    this.pickVoice();
    void this.loadVoices();
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
    // A gentle limiter so the louder music, thunder and screams never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);

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

    // Turbofan core rumble (N2) under a soft low-pass.
    const propFilter = ctx.createBiquadFilter();
    propFilter.type = 'lowpass';
    propFilter.frequency.value = 240;
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

    // Fan whine (N1 blade-pass).
    this.whine = ctx.createOscillator();
    this.whine.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.whine.start();

    // Jet roar.
    const wash = ctx.createBiquadFilter();
    wash.type = 'bandpass';
    wash.frequency.value = 380;
    wash.Q.value = 0.5;
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

    // The captain on the cabin PA: telephone-band speakers, a touch of drive, a small cabin's echo.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1900;
    presence.gain.value = 4;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    drive.curve = curve;
    const room = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 0.45);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 4;
    }
    room.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    const pa = ctx.createGain();
    pa.gain.value = 0.95;
    hp.connect(lp).connect(presence).connect(drive).connect(pa).connect(this.master);
    drive.connect(room).connect(wet).connect(this.master);
    this.paIn = hp;
    // Cockpit callouts: dry and close, a little quieter.
    const cockpit = ctx.createBiquadFilter();
    cockpit.type = 'highpass';
    cockpit.frequency.value = 160;
    const cg = ctx.createGain();
    cg.gain.value = 0.7;
    cockpit.connect(cg).connect(this.master);
    this.calloutIn = cockpit;
  }

  /** Fetch and decode the recorded voice clips listed in public/voice/index.json (if any). */
  private async loadVoices(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.voicesRequested) return;
    this.voicesRequested = true;
    let available: string[] = [];
    try {
      const res = await fetch('/voice/index.json', { cache: 'no-cache' });
      if (!res.ok) return;
      available = (await res.json()) as string[];
    } catch {
      return; // no clips: speech synthesis it is
    }
    const wanted = VOICE_LINES.filter((l) => available.includes(l.id));
    await Promise.all(
      wanted.map(async (l) => {
        try {
          const data = await (await fetch(`/voice/${l.id}.mp3`)).arrayBuffer();
          this.clips.set(l.id, await ctx.decodeAudioData(data));
        } catch {
          /* this line falls back to speech synthesis */
        }
      }),
    );
  }

  private playClip(buffer: AudioBuffer, kind: VoiceKind): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect((kind === 'pa' ? this.paIn : this.calloutIn) ?? this.master);
    if (kind === 'pa') {
      this.paSpeaking = true;
      src.onended = () => (this.paSpeaking = false);
      this.music?.duck(0.3, buffer.duration + 0.6);
    }
    src.start(ctx.currentTime + 0.05);
    this.clipsPlayed++;
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
    // The engines sit well under the music: a soft hum, not a roar.
    const core = 32 + s.prop * 46;
    this.propOsc.frequency.setTargetAtTime(core, t, 0.6);
    this.propOsc2.frequency.setTargetAtTime(core * 1.51, t, 0.6);
    this.propGain.gain.setTargetAtTime(this.muted ? 0 : 0.01 + s.prop * 0.024, t, 0.4);
    // Spools up slowly, like a real jet.
    this.whine.frequency.setTargetAtTime(1100 + s.prop * 2600, t, 1.2);
    this.whineGain.gain.setTargetAtTime(this.muted ? 0 : 0.0006 + s.prop * 0.0032, t, 0.8);
    this.washGain.gain.setTargetAtTime(this.muted ? 0 : s.prop * 0.034, t, 0.8);
    // Wind swells with gusts and rough air.
    this.gustPhase += dt * (0.6 + s.turb * 2.5);
    const swell = 1 + s.gust * 0.9 * (0.5 + 0.5 * Math.sin(this.gustPhase)) + s.turb * 0.6 * Math.abs(Math.sin(this.gustPhase * 2.3));
    this.windFilter.frequency.setTargetAtTime((250 + s.speed * 5) * (0.8 + 0.4 * swell), t, k);
    this.windGain.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.32, (s.speed / 1100) * swell), t, k);
    this.rainGain.gain.setTargetAtTime(this.muted ? 0 : s.rain * 0.2, t, 0.4);
    this.music?.setStorm(Math.max(s.rain, s.turb > 0.5 ? s.turb - 0.3 : 0));
    this.music?.out.gain.setTargetAtTime(this.muted ? 0 : MUSIC_LEVEL, t, 0.3);
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
  speak(text: string, kind: VoiceKind = 'callout'): void {
    if (this.muted) return;
    const recorded = voiceFor(text);
    const clip = recorded && this.clips.get(recorded.id);
    if (clip && this.ctx) {
      this.playClip(clip, kind);
      return;
    }
    if (!('speechSynthesis' in window)) return;
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
