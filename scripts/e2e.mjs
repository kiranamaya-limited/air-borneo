/**
 * End-to-end test: a big screen and a phone in one headless Chromium.
 *
 * Starts the Vite dev server (with its local PeerJS signalling server), pairs a phone-sized page
 * over real WebRTC, drives it with synthetic deviceorientation events and taps, and checks that
 * the flaps, throttle, tilt, pause-on-disconnect and results all reach the game. The cruise is
 * fast-forwarded (software WebGL is slow here). Screenshots go to ./e2e-shots.
 *
 *   npm run e2e            (first time: npx playwright install chromium)
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5180;
// E2E_URL=https://<lan-ip>:8443 tests an already-running offline demo server instead of the dev server.
const BASE = process.env.E2E_URL ?? `https://localhost:${PORT}`;
const SHOTS = 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });

const server = process.env.E2E_URL ? null : spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stopServer = () => {
  try {
    if (server) process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
if (server) await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite did not start')), 60000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on('exit', (code) => reject(new Error(`vite exited ${code}`)));
});

const errors = [];
const failures = [];
function check(cond, label) {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures.push(label);
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--proxy-server=direct://', '--autoplay-policy=no-user-gesture-required'] });
try {
  const screenCtx = await browser.newContext({ viewport: { width: 960, height: 540 }, ignoreHTTPSErrors: true });
  const screen = await screenCtx.newPage();
  screen.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
  screen.on('console', (m) => m.type() === 'error' && errors.push(`screen console: ${m.text()}`));
  await screen.goto(`${BASE}/?seed=7&quality=low&timescale=6`);
  await screen.waitForFunction(() => window.__game, null, { timeout: 120000 });
  await screen.waitForFunction(() => document.querySelector('#pair-status')?.textContent?.includes('Waiting'), null, { timeout: 30000 });
  const code = await screen.evaluate(() => window.__game.code.toUpperCase());
  check(/^[0-9]{6}$/.test(code), `screen shows a 6-digit pairing code (${code})`);
  await screen.waitForTimeout(1500);
  const sound = await screen.evaluate(() => window.__game.audio);
  check(sound.context === 'running' && sound.music, `lounge music plays without a click (${JSON.stringify(sound)})`);
  await screen.screenshot({ path: `${SHOTS}/01-title.png` });

  const phoneCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, deviceScaleFactor: 2 });
  await phoneCtx.grantPermissions(['accelerometer', 'gyroscope', 'magnetometer']).catch(() => undefined);
  const openPhone = async () => {
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
    await phone.goto(`${BASE}/controller.html?c=${code}`);
    // Synthetic yoke: landscape, tilted back 45°, then roll/pitch relative to that (see tests/tilt.test.ts).
    await phone.evaluate(() => {
      const DEG = Math.PI / 180;
      window.__tilt = (roll = 0, pitch = 0) => {
        const e = (45 + pitch) * DEG;
        const r = roll * DEG;
        const u = { x: Math.cos(r) * Math.cos(e), y: Math.sin(r), z: Math.cos(r) * Math.sin(e) };
        let beta = Math.asin(u.y) / DEG;
        let gamma = Math.atan2(-u.x, u.z) / DEG;
        if (gamma >= 90 || gamma < -90) {
          gamma = gamma >= 90 ? gamma - 180 : gamma + 180;
          beta = beta >= 0 ? 180 - beta : -180 - beta;
        }
        window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma }));
      };
      window.__tiltTimer = setInterval(() => window.__tilt(window.__roll ?? 0, window.__pitch ?? 0), 50);
    });
    return phone;
  };
  const setTilt = (page, roll, pitch) => page.evaluate(([r, p]) => { window.__roll = r; window.__pitch = p; }, [roll, pitch]);

  let phone = await openPhone();
  await phone.click('#connect-btn');
  await phone.waitForSelector('#calibrate-btn:not([disabled])', { timeout: 30000 });
  await phone.waitForFunction(() => window.__yoke.state.connected, null, { timeout: 30000 });
  check(true, 'phone connected to the screen');
  await phone.screenshot({ path: `${SHOTS}/02-phone-calibrate.png` });
  await phone.click('#calibrate-btn');
  await screen.waitForFunction(() => window.__game.mission.phase === 'lineup', null, { timeout: 30000 });
  check(true, 'calibrating puts you straight on the runway (no cutscene)');
  await screen.waitForFunction(() => window.__game.audio.clipsPlayed > 0, null, { timeout: 20000 }).catch(() => {});
  const voice = await screen.evaluate(() => window.__game.audio);
  check(voice.voices === 24 && voice.clipsPlayed > 0, `captain's recorded voice loads and plays (${voice.voices} clips, ${voice.clipsPlayed} played)`);
  check(await screen.evaluate(() => !document.getElementById('sound-btn')), 'no "Click for sound" button');

  await phone.click('#flaps-btn', { force: true }); // it pulses while it's the next action
  await screen.waitForFunction(() => window.__game.mission.ac.flaps === 15, null, { timeout: 15000 });
  check(true, 'phone FLAPS button sets flaps 15');

  // Throttle lever: drag from bottom to top.
  const track = await phone.locator('#lever-track').boundingBox();
  await phone.mouse.move(track.x + track.width / 2, track.y + track.height - 10);
  await phone.mouse.down();
  await phone.mouse.move(track.x + track.width / 2, track.y + 5, { steps: 8 });
  await phone.mouse.up();
  await screen.waitForFunction(() => window.__game.mission.phase === 'takeoff', null, { timeout: 15000 });
  check(true, 'throttle lever to TO starts the take-off roll');
  await phone.screenshot({ path: `${SHOTS}/03-phone-fly.png` });

  await setTilt(phone, 30, 0);
  await screen.waitForFunction(() => window.__game.input.roll > 0.3, null, { timeout: 10000 });
  check(true, 'tilting the phone right reaches the game as right roll');
  await setTilt(phone, 0, 0);

  await screen.waitForFunction(() => window.__game.mission.ac.speed > 58, null, { timeout: 120000 });
  // Pitch starts inverted: tilting the top edge away from you raises the nose.
  await setTilt(phone, 0, -15);
  await screen.waitForFunction(() => window.__game.input.pitch > 0.2, null, { timeout: 10000 });
  check(true, 'pitch starts inverted: tilting forward is nose up');
  await screen.waitForFunction(() => window.__game.mission.phase === 'flight', null, { timeout: 60000 });
  check(true, 'tilting forward at Vr rotates and lifts off');
  const hudState = await screen.evaluate(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      game: ['comfort-hero', 'hud-score', 'steady-arc', 'hud-plane'].every(visible) && !!document.querySelector('#hud-face svg'),
      sim: ['speed-tape', 'alt-tape', 'heading-tape', 'hud-flaps', 'hud-wind', 'hud-stage'].filter((id) => document.getElementById(id)),
    };
  });
  check(hudState.game, 'HUD shows the comfort meter, score, journey and steady arc');
  check(hudState.sim.length === 0, `no simulator instruments on the HUD (${hudState.sim.join(', ') || 'none'})`);
  await setTilt(phone, 0, 0);
  await screen.screenshot({ path: `${SHOTS}/04-climb.png` });

  // Pause when the phone goes away, resume when it comes back.
  await phone.close();
  await screen.waitForFunction(() => window.__game.paused, null, { timeout: 30000 });
  check(true, 'losing the phone pauses the flight');
  await screen.screenshot({ path: `${SHOTS}/05-paused.png` });
  phone = await openPhone();
  await phone.click('#connect-btn');
  await screen.waitForFunction(() => !window.__game.paused, null, { timeout: 30000 });
  check(true, 'reconnecting the phone resumes the flight');
  await phone.waitForSelector('#calibrate-btn:not([disabled])');
  await phone.click('#calibrate-btn');

  // The phone's network drops, then comes back: the link recovers by itself (autopilot flies meanwhile).
  await screen.evaluate(() => { window.__game.autoFly = true; });
  await phoneCtx.setOffline(true);
  await phone.evaluate(() => window.dispatchEvent(new Event('offline')));
  await phone.waitForTimeout(3000);
  const offlineSeen = await phone.evaluate(() => !navigator.onLine);
  await phoneCtx.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await screen.waitForFunction(() => window.__game.linkConnected && !window.__game.paused, null, { timeout: 60000 });
  await screen.evaluate(() => { window.__game.autoFly = false; });
  check(true, `link recovers after the phone's network drops (phone saw offline: ${offlineSeen})`);
  const diag = await screen.evaluate(() => document.getElementById('pair-diag').textContent);
  check(/linked/.test(diag), `screen's connection panel reports the link (${diag})`);

  // Fly the rest by autopilot in fast-forward, with stills along the way.
  await screen.evaluate(() => { window.__game.autoFly = true; });
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['kl'] + 300));
  await screen.screenshot({ path: `${SHOTS}/06-kl.png` });
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['storm'] + 500));
  await screen.screenshot({ path: `${SHOTS}/06-storm.png` });
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['sarawak'] + 300));
  await screen.screenshot({ path: `${SHOTS}/06-sarawak.png` });
  const phase = await screen.evaluate(() => window.__game.fastForward(200, (m) => m.phase === 'results' || m.phase === 'crashed'));
  const why = await screen.evaluate(() => { const m = window.__game.mission; return `${m.crashReason} at s=${Math.round(m.track.s)} (${Object.entries(m.route.stations).filter(([k, v]) => !k.includes(':') && v <= m.track.s).pop()?.[0]})`; });
  check(phase === 'results', `mission reaches results (${phase}${phase === 'crashed' ? ': ' + why : ''})`);
  await screen.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  await screen.screenshot({ path: `${SHOTS}/07-results.png` });
  const stars = await screen.textContent('#res-stars');
  check(/★/.test(stars ?? ''), `results show a star rating (${stars})`);
  const note = await screen.textContent('#res-note');
  check(/passengers had a lovely flight/.test(note ?? ''), `results talk about the passengers (${note?.slice(0, 60)}…)`);
  await phone.waitForFunction(() => /★|☆/.test(document.getElementById('prompt').textContent), null, { timeout: 15000 });
  check(true, 'phone receives the result');
  await phone.screenshot({ path: `${SHOTS}/08-phone-result.png` });
} finally {
  await browser.close();
  stopServer();
}

const realErrors = errors.filter((e) => !/favicon|WebGL|GPU stall|peer error/i.test(e));
check(realErrors.length === 0, `no page errors${realErrors.length ? `: ${realErrors.join(' | ')}` : ''}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll end-to-end checks passed. Screenshots in ./e2e-shots');
