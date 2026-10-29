/**
 * A simple path-following pilot. Used by the unit tests to prove the route is flyable, and exposed
 * on window.__game so the end-to-end test can steer through the real phone sensor pipeline.
 */
import { G, MAX_BANK, TURN_GAIN, type Aircraft, type FlightInput } from './flight';
import { DEG, headingFromDir, type Route, type Track } from './route';

export function autopilot(ac: Aircraft, route: Route, track: Track): Omit<FlightInput, 'throttle'> {
  if (ac.onGround) return { roll: 0, pitch: ac.speed > 56 ? 0.45 : 0 };
  const v = Math.max(ac.speed, 40);
  // Lateral: pure pursuit of a point a few seconds ahead on the dotted line, plus a curvature
  // feed-forward. Smooth and stable with the airliner-like roll rate.
  const look = Math.max(150, v * 3.5);
  const here = route.at(track.s);
  const target = route.at(track.s + look);
  const curvature = ((((target.heading - here.heading + 540) % 360) - 180) * DEG) / look; // rad per metre
  const bankFF = Math.atan((curvature * v * v) / (TURN_GAIN * G)) / DEG;
  const desired = headingFromDir(target.x - ac.pos.x, target.z - ac.pos.z);
  const hdgErr = ((desired - ac.heading + 540) % 360) - 180;
  const bank = Math.max(-28, Math.min(28, bankFF * 0.6 + hdgErr * 1.5));

  // Vertical: auto-trim already follows the slope; correct height error.
  const pathVs = here.slope * v;
  let pitch = Math.max(-0.35, Math.min(0.35, -track.vertical / 60 - (ac.vs - pathVs) / 60));
  const agl = ac.pos.y;
  if (route.stations['final'] < track.s && agl < 9) pitch = 0.2; // flare

  return { roll: bank / MAX_BANK, pitch };
}
