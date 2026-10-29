import '../brand/brand.css';
import './controller.css';
import { createPhoneLink, type LinkStatus } from '../net/link';
import { normaliseCode, type FlapSetting, type ScreenMsg, type Want } from '../net/protocol';
import { calibrate, readTilt, shapeAxis, Smoother, upFromBetaGamma, upFromGravity, type Calibration, type Vec3 } from './tilt';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const steps = {
  connect: $('step-connect'),
  calibrate: $('step-calibrate'),
  fly: $('step-fly'),
};
const codeInput = $<HTMLInputElement>('code');
const connectHint = $('connect-hint');
const sensorHint = $('sensor-hint');
const calibrateBtn = $<HTMLButtonElement>('calibrate-btn');
const promptEl = $('prompt');
const scoreEl = $('score');
const flapsBtn = $('flaps-btn');
const flapsValue = $('flaps-value');
const actionBtn = $('action-btn');
const actionValue = $('action-value');
const leverTrack = $('lever-track');
const leverHandle = $('lever-handle');
const leverFill = $('lever-fill');
const leverValue = $('lever-value');
const invertBtn = $('invert-btn');
const attitude = $<HTMLCanvasElement>('attitude');
const rotateOverlay = $('rotate-overlay');

type Step = keyof typeof steps;
let step: Step = 'connect';

function show(next: Step): void {
  step = next;
  for (const [k, el] of Object.entries(steps)) el.classList.toggle('hidden', k !== next);
  updateRotateOverlay();
}

// ---------------------------------------------------------------- sensors

let latestUp: Vec3 | null = null;
let sensorSource: 'orientation' | 'motion' | null = null;
let cal: Calibration | null = null;
const rollSmooth = new Smoother(0.35);
const pitchSmooth = new Smoother(0.35);
let roll = 0;
let pitch = 0;
let invertPitch = readPref('ab-invert-pitch') === '1';

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

function onOrientation(e: DeviceOrientationEvent): void {
  if (e.beta == null || e.gamma == null) return;
  sensorSource = 'orientation';
  latestUp = upFromBetaGamma(e.beta, e.gamma);
  sensorUpdated();
}

function onMotion(e: DeviceMotionEvent): void {
  if (sensorSource === 'orientation') return;
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null || g.z == null) return;
  sensorSource = 'motion';
  latestUp = upFromGravity({ x: g.x, y: g.y, z: g.z }, screenAngle());
  sensorUpdated();
}

function sensorUpdated(): void {
  if (step === 'calibrate' && calibrateBtn.disabled) {
    calibrateBtn.disabled = false;
    sensorHint.textContent = sensorSource === 'orientation' ? 'Motion sensors ready.' : 'Using the accelerometer.';
    sensorHint.classList.remove('bad');
  }
  if (!cal || !latestUp) return;
  const t = readTilt(cal, latestUp);
  roll = shapeAxis(rollSmooth.next(t.roll), 2, 35);
  pitch = shapeAxis(pitchSmooth.next(t.pitch), 2, 25) * (invertPitch ? -1 : 1);
}

async function requestSensors(): Promise<boolean> {
  type PermissionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };
  // Listen regardless: the permission answer only decides what hint to show if no data arrives.
  window.addEventListener('deviceorientation', onOrientation);
  window.addEventListener('devicemotion', onMotion);
  let granted = true;
  try {
    const ori = DeviceOrientationEvent as unknown as PermissionCtor;
    if (typeof ori.requestPermission === 'function') granted = (await ori.requestPermission()) === 'granted';
    const mot = window.DeviceMotionEvent as unknown as PermissionCtor | undefined;
    if (mot && typeof mot.requestPermission === 'function') await mot.requestPermission().catch(() => 'denied');
  } catch (err) {
    console.warn('sensor permission', err);
  }
  return granted;
}

// ---------------------------------------------------------------- comfort: wake lock, fullscreen

let wakeLock: { release: () => Promise<void> } | null = null;
async function keepAwake(): Promise<void> {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (wl) wakeLock = await wl.request('screen');
  } catch {
    /* not supported or denied: the game still works */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock) void keepAwake();
});

async function goFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape').catch(() => undefined);
  } catch {
    /* iOS Safari has no fullscreen API for pages: fine */
  }
}

function updateRotateOverlay(): void {
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  rotateOverlay.classList.toggle('hidden', !(portrait && step === 'fly'));
}
window.addEventListener('resize', updateRotateOverlay);

// ---------------------------------------------------------------- link

const link = createPhoneLink(onScreenMessage, onLinkStatus);
window.addEventListener('pagehide', () => link.close());
let connectedOnce = false;

function onLinkStatus(status: LinkStatus): void {
  const text: Record<LinkStatus, [string, string]> = {
    starting: ['Connecting…', 'warn'],
    ready: ['Ready', 'warn'],
    connected: ['Connected', 'ok'],
    reconnecting: ['Reconnecting…', 'warn'],
    'no-screen': ['Looking for the screen… check the code', 'warn'],
    offline: ['Offline, retrying…', 'bad'],
  };
  const [label, cls] = text[status];
  for (const id of ['chip-cal', 'chip-fly']) {
    const chip = $(id);
    chip.className = `ab-chip ${cls}`;
    chip.querySelector('span:last-child')!.textContent = label;
  }
  if (status === 'connected' && !connectedOnce) {
    connectedOnce = true;
    show(cal ? 'fly' : 'calibrate');
  }
  if (status === 'no-screen' && step === 'calibrate' && !connectedOnce) {
    connectHint.textContent = 'No big screen is showing that code. Check it and try again.';
    connectHint.classList.add('bad');
    show('connect');
  }
}

let flaps: FlapSetting = 0;
let throttle = 0;
let want: Want = 'none';

function onScreenMessage(msg: ScreenMsg): void {
  switch (msg.t) {
    case 'welcome':
      break;
    case 'state': {
      promptEl.textContent = msg.prompt;
      promptEl.classList.toggle('urgent', msg.want === 'pitch-up' || msg.want === 'throttle-idle');
      scoreEl.textContent = msg.phase === 'pairing' || msg.phase === 'lineup' ? '' : `Passengers ${Math.round(msg.comfort)}%`;
      setWant(msg.want);
      if (msg.flaps !== flaps) setFlaps(msg.flaps, false);
      actionValue.textContent = actionLabel(msg.phase);
      break;
    }
    case 'haptic':
      navigator.vibrate?.(msg.pattern);
      break;
    case 'result':
      promptEl.textContent = `${'★'.repeat(msg.stars)}${'☆'.repeat(5 - msg.stars)}  ${msg.rank}`;
      scoreEl.textContent = `${msg.score.toLocaleString()} pts · best ${msg.best.toLocaleString()}`;
      break;
  }
}


function actionLabel(phase: string): string {
  if (phase === 'results' || phase === 'crashed') return 'Fly again';
  if (phase === 'pairing') return 'Start';
  return 'Action';
}

function setWant(next: Want): void {
  want = next;
  flapsBtn.classList.toggle('want', want === 'flaps');
  leverTrack.classList.toggle('want', want === 'throttle-up' || want === 'throttle-idle');
  actionBtn.classList.toggle('want', want === 'action');
}

// ---------------------------------------------------------------- controls

function setFlaps(f: FlapSetting, notify: boolean): void {
  flaps = f;
  flapsValue.textContent = `${f}°`;
  if (notify) link.send({ t: 'btn', b: 'flaps' });
}

flapsBtn.addEventListener('click', () => {
  const next: FlapSetting = flaps === 0 ? 15 : flaps === 15 ? 30 : 0;
  setFlaps(next, true);
  navigator.vibrate?.(15);
});

actionBtn.addEventListener('click', () => {
  link.send({ t: 'btn', b: 'action' });
  navigator.vibrate?.(15);
});

const DETENTS = [
  { at: 0, label: 'IDLE' },
  { at: 0.8, label: 'CLB' },
  { at: 1, label: 'TO' },
];

function setThrottle(v: number): void {
  let value = Math.max(0, Math.min(1, v));
  let label = `${Math.round(value * 100)}%`;
  for (const d of DETENTS) {
    if (Math.abs(value - d.at) < 0.06) {
      if (Math.abs(throttle - d.at) >= 0.06) navigator.vibrate?.(10);
      value = d.at;
      label = d.label;
    }
  }
  throttle = value;
  leverValue.textContent = label;
  leverHandle.style.bottom = `calc(${value * 100}% - ${value * 54}px)`;
  leverFill.style.height = `${value * 100}%`;
}

let leverPointer: number | null = null;
function leverFromEvent(e: PointerEvent): void {
  const rect = leverTrack.getBoundingClientRect();
  const handle = 54;
  const v = 1 - (e.clientY - rect.top - handle / 2) / (rect.height - handle);
  setThrottle(v);
}
leverTrack.addEventListener('pointerdown', (e) => {
  leverPointer = e.pointerId;
  leverTrack.setPointerCapture(e.pointerId);
  leverFromEvent(e);
});
leverTrack.addEventListener('pointermove', (e) => {
  if (e.pointerId === leverPointer) leverFromEvent(e);
});
const releaseLever = (e: PointerEvent) => {
  if (e.pointerId === leverPointer) leverPointer = null;
};
leverTrack.addEventListener('pointerup', releaseLever);
leverTrack.addEventListener('pointercancel', releaseLever);

invertBtn.addEventListener('click', () => {
  invertPitch = !invertPitch;
  writePref('ab-invert-pitch', invertPitch ? '1' : '0');
  invertBtn.textContent = invertPitch ? 'Pitch: inverted' : 'Pitch: normal';
});
invertBtn.textContent = invertPitch ? 'Pitch: inverted' : 'Pitch: normal';

function doCalibrate(): void {
  if (!latestUp) return;
  cal = calibrate(latestUp, screenAngle());
  rollSmooth.reset();
  pitchSmooth.reset();
  navigator.vibrate?.([20, 40, 20]);
}

calibrateBtn.addEventListener('click', () => {
  doCalibrate();
  show('fly');
});
$('recal-btn').addEventListener('click', doCalibrate);

$('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = normaliseCode(codeInput.value);
  if (code.length < 4) {
    connectHint.textContent = 'The code has 5 letters and numbers.';
    connectHint.classList.add('bad');
    return;
  }
  connectHint.classList.remove('bad');
  const granted = await requestSensors();
  void keepAwake();
  void goFullscreen();
  show('calibrate');
  window.setTimeout(() => {
    if (latestUp) return;
    sensorHint.textContent = granted
      ? 'No motion sensor data yet. This page must be opened over https on a phone.'
      : 'Motion access was blocked. Allow motion & orientation for this site, then reload.';
    sensorHint.classList.add('bad');
  }, 2500);
  link.connect(code);
  const url = new URL(location.href);
  url.searchParams.set('c', code);
  history.replaceState(null, '', url);
});

// ---------------------------------------------------------------- send loop + attitude display

let seq = 0;
window.setInterval(() => {
  if (!link.connected) return;
  link.send({ t: 'input', s: seq++, r: round3(roll), p: round3(pitch), th: round3(throttle), f: flaps, cal: !!cal });
}, 33);

const ctx = attitude.getContext('2d')!;
function drawAttitude(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(attitude.clientWidth * dpr) || 320;
  if (attitude.width !== size) {
    attitude.width = size;
    attitude.height = size;
  }
  const s = size;
  const r = s / 2;
  ctx.clearRect(0, 0, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(r, r);
  ctx.rotate(-roll * (35 * Math.PI) / 180);
  const offset = pitch * r * 0.6;
  ctx.fillStyle = '#d9ecf7';
  ctx.fillRect(-s, -s * 2 + offset, s * 2, s * 2);
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(-s, offset, s * 2, s * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(-s, offset);
  ctx.lineTo(s, offset);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, s * 0.006);
  for (let i = -2; i <= 2; i++) {
    if (!i) continue;
    const y = offset - i * r * 0.18;
    const w = i % 2 ? r * 0.12 : r * 0.24;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
  // aircraft symbol
  ctx.strokeStyle = '#111216';
  ctx.lineWidth = Math.max(4, s * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r - r * 0.5, r);
  ctx.lineTo(r - r * 0.15, r);
  ctx.lineTo(r, r + r * 0.1);
  ctx.lineTo(r + r * 0.15, r);
  ctx.lineTo(r + r * 0.5, r);
  ctx.stroke();
  ctx.fillStyle = '#ffc629';
  ctx.beginPath();
  ctx.arc(r, r, s * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111216';
  ctx.lineWidth = Math.max(3, s * 0.016);
  ctx.beginPath();
  ctx.arc(r, r, r - 3, 0, Math.PI * 2);
  ctx.stroke();
  if (want === 'pitch-up') {
    ctx.fillStyle = '#d21f2c';
    ctx.font = `800 ${Math.round(s * 0.09)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('TILT BACK', r, s * 0.22);
  }
  requestAnimationFrame(drawAttitude);
}

// ---------------------------------------------------------------- boot

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const preset = new URLSearchParams(location.search).get('c');
if (preset) codeInput.value = normaliseCode(preset);
setThrottle(0);
setFlaps(0, false);
requestAnimationFrame(drawAttitude);

// Debug hook for automated tests.
(window as unknown as { __yoke: object }).__yoke = {
  get state() {
    return { step, roll, pitch, throttle, flaps, connected: link.connected, calibrated: !!cal, sensorSource };
  },
  setThrottle,
};
