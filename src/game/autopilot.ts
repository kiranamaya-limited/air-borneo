/**
 * A simple path-following pilot. Used by the unit tests to prove the route is flyable, and exposed
 * on window.__game so the end-to-end test can steer through the real phone sensor pipeline.
 */
import { G, MAX_BANK, TURN_GAIN, type Aircraft, type FlightInput } from './flight';
import { DEG, type Route, type Track } from './route';

export function autopilot(ac: Aircraft, route: Route, track: Track): Omit<FlightInput, 'throttle'> {
  if (ac.onGround) return { roll: 0, pitch: ac.speed > 56 ? 0.45 : 0 };
  const v = Math.max(ac.speed, 40);
  const look = Math.max(80, v * 1.2);
  const ahead = route.at(track.s + look);
  const here = route.at(track.s);

  // Lateral: chase the path heading, corrected for offset, with a curvature feed-forward.
  const curvature = ((((ahead.heading - here.heading + 540) % 360) - 180) * DEG) / look; // rad per metre
  const turnRate = curvature * v;
  const bankFF = Math.atan((turnRate * v) / (TURN_GAIN * G)) / DEG;
  const intercept = -Math.atan2(track.lateral, 220) / DEG;
  const hdgErr = ((here.heading + intercept - ac.heading + 540) % 360) - 180;
  const bank = Math.max(-MAX_BANK, Math.min(MAX_BANK, bankFF + hdgErr * 2.2));

  // Vertical: auto-trim already follows the slope; correct height error.
  const pathVs = here.slope * v;
  let pitch = Math.max(-1, Math.min(1, -track.vertical / 25 - (ac.vs - pathVs) / 40));
  const agl = ac.pos.y;
  if (route.stations['final'] < track.s && agl < 9) pitch = 0.2; // flare

  return { roll: bank / MAX_BANK, pitch };
}
