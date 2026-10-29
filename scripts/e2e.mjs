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
  check(/^[A-Z0-9]{5}$/.test(code), `screen shows a pairing code (${code})`);
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
  check(true, 'phone connected to the screen over WebRTC');
  await phone.screenshot({ path: `${SHOTS}/02-phone-calibrate.png` });
  await phone.click('#calibrate-btn');
  await screen.waitForFunction(() => window.__game.mission.phase === 'lineup', null, { timeout: 30000 });
  check(true, 'calibrating puts you straight on the runway (no cutscene)');
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

  // Fly the rest by autopilot in fast-forward, with stills along the way.
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['city'] + 500));
  await screen.screenshot({ path: `${SHOTS}/06-kuching.png` });
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['islands-2'] + 300));
  await screen.screenshot({ path: `${SHOTS}/06-islands.png` });
  await screen.evaluate(() => window.__game.fastForward(120, (m) => m.track.s > m.route.stations['storm'] + 500));
  await screen.screenshot({ path: `${SHOTS}/06-storm.png` });
  const phase = await screen.evaluate(() => window.__game.fastForward(200, (m) => m.phase === 'results' || m.phase === 'crashed'));
  check(phase === 'results', `mission reaches results (${phase})`);
  await screen.waitForSelector('#results:not(.hidden)', { timeout: 30000 });
  await screen.screenshot({ path: `${SHOTS}/07-results.png` });
  const stars = await screen.textContent('#res-stars');
  check(/★/.test(stars ?? ''), `results show a star rating (${stars})`);
  const note = await screen.textContent('#res-note');
  check(/passengers had a lovely flight/.test(note ?? ''), `results talk about the passengers (${note?.slice(0, 60)}…)`);
  const seats = await screen.evaluate(() => document.querySelectorAll('#cabin-seats span').length);
  check(seats === 10, 'cabin panel shows the passengers');
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
