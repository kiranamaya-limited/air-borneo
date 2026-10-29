import './brand/brand.css';
import './ui/hud.css';
import * as THREE from 'three';
import { Mission, type MissionEvent } from './game/mission';
import { autopilot } from './game/autopilot';
import type { FlightInput } from './game/flight';
import { World } from './world/world';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { GameAudio } from './audio/audio';
import { HostLink, type LinkStatus } from './net/link';
import { makeCode, normaliseCode, type ControllerMsg, type Phase } from './net/protocol';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
/** Debug: run the simulation N times faster (for automated tests on slow software renderers). */
const timescale = Math.max(1, Math.min(20, Number(params.get('timescale') ?? 1) || 1));
const ACTIVE: Phase[] = ['lineup', 'takeoff', 'flight', 'flare', 'rollout'];

function readBest(): number {
  try {
    return Number(localStorage.getItem('ab-best') ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number): void {
  try {
    localStorage.setItem('ab-best', String(v));
  } catch {
    /* storage unavailable */
  }
}

async function fontsReady(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('800 40px "Plus Jakarta Sans"'), document.fonts.load('700 20px "B612 Mono"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

async function boot(): Promise<void> {
  await fontsReady();
  const mission = new Mission(seedParam ? Number(seedParam) : undefined);
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const world = new World(canvas, mission, params.get('quality') === 'low' ? 'low' : 'high');
  const hud = new Hud(mission);
  const screens = new Screens();
  const audio = new GameAudio();

  // ------------------------------------------------------------------ input
  let mode: 'phone' | 'keyboard' | null = null;
  const phone = { roll: 0, pitch: 0, throttle: 0, cal: false, at: 0 };
  const kb = { roll: 0, pitch: 0, throttle: 0 };
  const keys = new Set<string>();
  let startTimer = 0;

  const link = new HostLink(onController, onLinkStatus);
  const code = normaliseCode(params.get('code') ?? '') || makeCode();
  const host = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(location.hostname) ? __DEV_LAN_HOST__ : location.hostname;
  const port = location.port ? `:${location.port}` : '';
  const pairUrl = (c: string) => `${location.protocol}//${host}${port}/controller.html?c=${c}`;
  link.start(code);

  function onLinkStatus(status: LinkStatus, c: string): void {
    void screens.setPairing(c.toUpperCase(), pairUrl(c.toUpperCase()));
    const text: Record<LinkStatus, [string, 'ok' | 'warn' | 'bad']> = {
      starting: ['Starting…', 'warn'],
      ready: ['Waiting for your phone', 'warn'],
      connected: [phone.cal ? 'Phone ready' : 'Phone connected · calibrate on your phone', 'ok'],
      reconnecting: ['Reconnecting…', 'warn'],
      'no-screen': ['Pairing server unavailable', 'bad'],
      offline: ['Offline · retrying', 'bad'],
    };
    screens.pairStatus(...text[status]);
  }

  function startMission(): void {
    window.clearTimeout(startTimer);
    startTimer = 0;
    screens.hideResults();
    mission.start();
  }

  function onController(msg: ControllerMsg): void {
    if (msg.t === 'hello') {
      if (mode !== 'keyboard') mode = 'phone';
      screens.pairStatus('Phone connected · calibrate on your phone', 'ok');
      sendState(true);
    } else if (msg.t === 'input') {
      phone.roll = msg.r;
      phone.pitch = msg.p;
      phone.throttle = msg.th;
      phone.at = performance.now();
      if (msg.cal && !phone.cal) screens.pairStatus('Phone ready · starting', 'ok');
      phone.cal = msg.cal;
      if (mode === null) mode = 'phone';
      if (mode === 'phone' && msg.cal && mission.phase === 'pairing' && !startTimer) {
        startTimer = window.setTimeout(startMission, 1500);
      }
    } else if (msg.t === 'btn') {
      if (msg.b === 'flaps') mission.flapsPress();
      if (msg.b === 'action') {
        if (mission.phase === 'pairing') {
          if (phone.cal) startMission();
        } else if (mission.phase === 'results' || mission.phase === 'crashed') startMission();
        else mission.action();
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    audio.unlock();
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'Enter') {
      if (mission.phase === 'pairing') {
        mode = 'keyboard';
        startMission();
      } else if (mission.phase === 'results' || mission.phase === 'crashed') startMission();
      else mission.action();
      e.preventDefault();
    }
    if (e.code === 'KeyF') mission.flapsPress();
    if (e.code === 'KeyK' && mission.phase === 'pairing') {
      mode = 'keyboard';
      startMission();
    }
    if (e.code === 'Digit1') kb.throttle = 0;
    if (e.code === 'Digit2') kb.throttle = 0.8;
    if (e.code === 'Digit3') kb.throttle = 1;
    if (e.code === 'KeyM') audio.muted = !audio.muted;
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('pointerdown', () => audio.unlock());
  document.getElementById('keyboard-btn')!.addEventListener('click', () => {
    audio.unlock();
    mode = 'keyboard';
    startMission();
  });
  document.getElementById('again-btn')!.addEventListener('click', () => {
    audio.unlock();
    startMission();
  });
  const soundBtn = document.getElementById('sound-btn')!;
  soundBtn.addEventListener('click', () => audio.unlock());

  function keyboardInput(dt: number): void {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowDown'); // yoke convention: pull back (down arrow) = nose up
    const down = keys.has('ArrowUp');
    const toward = (v: number, target: number, rate: number) => v + Math.sign(target - v) * Math.min(Math.abs(target - v), rate * dt);
    kb.roll = toward(kb.roll, (right ? 1 : 0) - (left ? 1 : 0), left || right ? 1.6 : 3);
    kb.pitch = toward(kb.pitch, (up ? 0.7 : 0) - (down ? 0.7 : 0), up || down ? 1.5 : 3);
    if (keys.has('KeyW')) kb.throttle = Math.min(1, kb.throttle + dt * 0.8);
    if (keys.has('KeyS')) kb.throttle = Math.max(0, kb.throttle - dt * 0.8);
  }

  // ------------------------------------------------------------------ phone sync

  let lastState = '';
  let lastSent = 0;
  function sendState(force = false): void {
    const now = performance.now();
    const key = `${mission.phase}|${mission.prompt}|${mission.want}|${mission.ac.flaps}`;
    if (!force && key === lastState && now - lastSent < 500) return;
    lastState = key;
    lastSent = now;
    const prompt = mission.phase === 'pairing' ? (phone.cal ? 'Starting…' : 'Calibrate to start') : mission.prompt;
    link.send({ t: 'state', phase: mission.phase, prompt, want: mission.want, flaps: mission.ac.flaps, score: mission.scorer.score });
  }

  // ------------------------------------------------------------------ events

  function handle(e: MissionEvent): void {
    world.onEvent(e);
    switch (e.type) {
      case 'phase':
        onPhase(e.phase);
        break;
      case 'marker':
        hud.popup(e.grade, e.points);
        audio.chime(e.grade);
        break;
      case 'callout':
        hud.showCallout(e.text);
        audio.speak(e.speak ?? e.text);
        break;
      case 'atc':
        hud.showAtc(e.text);
        audio.squelch();
        break;
      case 'alert':
        if (e.alert.level === 'caution') audio.caution();
        break;
      case 'lightning':
        audio.thunder();
        link.send({ t: 'haptic', pattern: [30, 40, 60] });
        break;
      case 'touchdown':
        audio.touchdown(e.grade === 'Hard');
        break;
      case 'config':
        audio.configHorn();
        break;
      case 'crash':
        audio.touchdown(true);
        break;
      case 'haptic':
        link.send({ t: 'haptic', pattern: e.pattern });
        break;
      default:
        break;
    }
  }

  function onPhase(phase: Phase): void {
    screens.showTitle(phase === 'pairing', readBest());
    hud.show(phase !== 'pairing' && phase !== 'results' && phase !== 'crashed');
    if (phase === 'results' || phase === 'crashed') {
      const sum = mission.summary!;
      const best = readBest();
      const newBest = sum.score > best;
      if (newBest) writeBest(sum.score);
      window.setTimeout(() => screens.showResults(sum, Math.max(best, sum.score), newBest, mission.crashReason), phase === 'crashed' ? 1200 : 300);
      link.send({ t: 'result', score: sum.score, stars: sum.stars, rank: sum.crashed ? mission.crashReason : sum.rank, best: Math.max(best, sum.score) });
    } else screens.hideResults();
    sendState(true);
  }

  // ------------------------------------------------------------------ loop

  const clock = new THREE.Clock();
  let time = 0;
  let input: FlightInput = { roll: 0, pitch: 0, throttle: 0 };
  screens.showTitle(true, readBest());
  screens.hideLoading();

  // Watch the frame rate once flying starts; step down quality on slow GPUs.
  let fpsFrames = 0;
  let fpsTime = 0;
  let fpsChecked = false;

  function frame(): void {
    const realDt = clock.getDelta();
    const dt = Math.min(realDt, 0.05);
    time += dt;
    if (!fpsChecked && mission.phase !== 'pairing') {
      fpsFrames++;
      fpsTime += realDt;
      if (fpsTime > 4) {
        fpsChecked = true;
        if (fpsFrames / fpsTime < 32) world.lowerQuality();
      }
    }
    keyboardInput(dt);
    const stale = mode === 'phone' && performance.now() - phone.at > 500;
    if (mode === 'keyboard') input = { ...kb };
    else if (mode === 'phone' && !stale) input = { roll: phone.roll, pitch: phone.pitch, throttle: phone.throttle };
    if (autoFly) {
      const ap = autopilot(mission.ac, mission.route, mission.track);
      input = { ...ap, throttle: mission.phase === 'rollout' ? 0 : 1 };
      if (mission.phase === 'lineup' && mission.ac.flaps !== 15) mission.flapsPress();
      if (mission.want === 'flaps' && mission.phase === 'flight') mission.flapsPress();
    }

    const paused = mode === 'phone' && !link.connected && ACTIVE.includes(mission.phase);
    screens.showPaused(paused);
    if (!paused) for (let i = 0; i < timescale; i++) mission.update(dt, input);
    for (const e of mission.drain()) handle(e);

    world.update(dt, time, input);
    if (mission.phase !== 'pairing') hud.update(mission);
    hud.linkStatus(mode === 'keyboard' ? 'keyboard' : link.status, stale);
    audio.update(dt, {
      prop: mission.ac.prop,
      speed: mission.ac.speed,
      rain: ['flight', 'flare'].includes(mission.phase) ? mission.wx.rain : 0,
      warning: mission.alert?.level === 'warning',
    });
    soundBtn.classList.toggle('hidden', audio.unlocked || mission.phase === 'pairing');
    sendState();
    world.render();
    requestAnimationFrame(frame);
  }

  // Debug / test hooks.
  let autoFly = params.has('autopilot');
  (window as unknown as { __game: object }).__game = {
    mission,
    world,
    get code() {
      return link.code;
    },
    get mode() {
      return mode;
    },
    get input() {
      return input;
    },
    get paused() {
      return !document.getElementById('paused')!.classList.contains('hidden');
    },
    set autoFly(v: boolean) {
      autoFly = v;
    },
    /** Desired yoke inputs to follow the route (used by the end-to-end test). */
    hint: () => autopilot(mission.ac, mission.route, mission.track),
    /** Advance the simulation without rendering, flown by the autopilot (tests and screenshots). */
    fastForward: (seconds: number, until?: (m: Mission) => boolean) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        const ap = autopilot(mission.ac, mission.route, mission.track);
        if (mission.phase === 'lineup' && mission.ac.flaps !== 15) mission.flapsPress();
        if (mission.want === 'flaps' && mission.phase === 'flight') mission.flapsPress();
        input = { ...ap, throttle: mission.phase === 'rollout' ? 0 : 1 };
        mission.update(1 / 60, input);
        for (const e of mission.drain()) handle(e);
        world.update(1 / 60, (time += 1 / 60), input);
        if (until?.(mission)) break;
      }
      return mission.phase;
    },
    start: (m: 'keyboard' | 'phone' = 'keyboard') => {
      mode = m;
      startMission();
    },
  };
  requestAnimationFrame(frame);
}

void boot();
