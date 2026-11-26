import { describe, expect, it } from 'vitest';
import {
  betaGammaFromUp,
  calibrate,
  readTilt,
  screenUpFromAngle,
  shapeAxis,
  upFromBetaGamma,
  type Vec3,
} from '../src/controller/tilt';

const DEG = Math.PI / 180;

/**
 * World-up in device coordinates for a phone held like a yoke: screen-up along `sUp`, tilted back
 * from vertical by `tiltBack` degrees, then pitched by `pitch` and rolled (right edge down) by `roll`.
 */
function pose(sUp: Vec3, tiltBack: number, pitch: number, roll: number): Vec3 {
  const n = { x: 0, y: 0, z: 1 };
  const sRight = { x: sUp.y * n.z - sUp.z * n.y, y: sUp.z * n.x - sUp.x * n.z, z: sUp.x * n.y - sUp.y * n.x };
  const e = (tiltBack + pitch) * DEG;
  const r = roll * DEG;
  const a = -Math.sin(r);
  const b = Math.cos(r) * Math.cos(e);
  const c = Math.cos(r) * Math.sin(e);
  return {
    x: a * sRight.x + b * sUp.x + c * n.x,
    y: a * sRight.y + b * sUp.y + c * n.y,
    z: a * sRight.z + b * sUp.z + c * n.z,
  };
}

describe('upFromBetaGamma', () => {
  it('is +z when the phone lies flat, screen up', () => {
    const u = upFromBetaGamma(0, 0);
    expect(u.x).toBeCloseTo(0);
    expect(u.y).toBeCloseTo(0);
    expect(u.z).toBeCloseTo(1);
  });
  it('is +y when held upright in portrait', () => {
    const u = upFromBetaGamma(90, 0);
    expect(u.y).toBeCloseTo(1);
  });
  it('round-trips through betaGammaFromUp, including past gamma = 90', () => {
    for (const u of [pose(screenUpFromAngle(90), 40, 10, 20), pose(screenUpFromAngle(270), 70, -30, -15), pose(screenUpFromAngle(0), 20, 0, 0)]) {
      const { beta, gamma } = betaGammaFromUp(u);
      expect(gamma).toBeGreaterThanOrEqual(-90);
      expect(gamma).toBeLessThan(90);
      const back = upFromBetaGamma(beta, gamma);
      expect(back.x).toBeCloseTo(u.x, 6);
      expect(back.y).toBeCloseTo(u.y, 6);
      expect(back.z).toBeCloseTo(u.z, 6);
    }
  });
});

describe('readTilt', () => {
  for (const angle of [90, 270, 0]) {
    it(`reads roll and pitch relative to calibration (screen angle ${angle})`, () => {
      const sUp = screenUpFromAngle(angle);
      const cal = calibrate(pose(sUp, 45, 0, 0));
      const neutral = readTilt(cal, pose(sUp, 45, 0, 0));
      expect(neutral.roll).toBeCloseTo(0, 5);
      expect(neutral.pitch).toBeCloseTo(0, 5);

      const right = readTilt(cal, pose(sUp, 45, 0, 25));
      expect(right.roll).toBeCloseTo(25, 5);
      expect(right.pitch).toBeCloseTo(0, 5);

      const back = readTilt(cal, pose(sUp, 45, 15, 0));
      expect(back.pitch).toBeCloseTo(15, 5);
      expect(back.roll).toBeCloseTo(0, 5);

      const both = readTilt(cal, pose(sUp, 45, -10, -20));
      expect(both.roll).toBeCloseTo(-20, 5);
      expect(both.pitch).toBeCloseTo(-10, 5);
    });
  }

  it('survives the sensor path through beta/gamma', () => {
    const sUp = screenUpFromAngle(90);
    const toUp = (u: Vec3) => {
      const { beta, gamma } = betaGammaFromUp(u);
      return upFromBetaGamma(beta, gamma);
    };
    const cal = calibrate(toUp(pose(sUp, 50, 0, 0)));
    const t = readTilt(cal, toUp(pose(sUp, 50, -12, 18)));
    expect(t.roll).toBeCloseTo(18, 4);
    expect(t.pitch).toBeCloseTo(-12, 4);
  });

  it('falls back to the screen angle when calibrated flat', () => {
    const cal = calibrate({ x: 0, y: 0, z: 1 }, 90);
    expect(cal.sUp.x).toBeCloseTo(1);
    const t = readTilt(cal, pose(cal.sUp, 0, 0, 10));
    expect(t.roll).toBeCloseTo(10, 4);
  });
});

describe('shapeAxis', () => {
  it('has a deadzone and saturates', () => {
    expect(shapeAxis(1, 2, 30)).toBe(0);
    expect(shapeAxis(-1.9, 2, 30)).toBe(0);
    expect(shapeAxis(30, 2, 30)).toBeCloseTo(1);
    expect(shapeAxis(-60, 2, 30)).toBeCloseTo(-1);
    expect(shapeAxis(16, 2, 30)).toBeGreaterThan(0);
    expect(shapeAxis(16, 2, 30)).toBeLessThan(0.5);
  });
});
