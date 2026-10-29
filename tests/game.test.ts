import { describe, expect, it } from 'vitest';
import { Route, dirFromHeading, headingFromDir, lineupPoint, KCH } from '../src/game/route';
import { Aircraft, G, TURN_GAIN, VR, ias, altitudeFt } from '../src/game/flight';
import { Scorer, gradeFor, landingGrade } from '../src/game/scoring';
import { Mission } from '../src/game/mission';
import { autopilot } from '../src/game/autopilot';

const CALM = { wind: { x: 0, y: 0, z: 0 }, rollDisturb: 0, pitchDisturb: 0 };

describe('route', () => {
  const route = new Route();

  it('starts on runway 25 at Kuching and ends on Changi 20C', () => {
    const start = route.at(0);
    expect(start.heading).toBeCloseTo(KCH.runwayHeading, 5);
    expect(start.y).toBe(0);
    const final = route.at(route.stations['final'] + 10);
    expect(final.heading).toBeCloseTo(200, 3);
    // 3° glide path on final
    expect(Math.atan(-final.slope) / (Math.PI / 180)).toBeCloseTo(3, 0);
    expect(route.at(route.stations['final:end']).y).toBeCloseTo(0, 5);
  });

  it('headings and directions agree', () => {
    for (const h of [0, 68, 200, 248, 315]) {
      const d = dirFromHeading(h);
      expect(headingFromDir(d.x, d.z)).toBeCloseTo(h, 6);
    }
  });

  it('tracks lateral offset with the right sign and stays continuous', () => {
    const p = route.at(3000);
    const d = dirFromHeading(p.heading);
    const right = { x: -d.z, z: d.x };
    const t = route.track({ x: p.x + right.x * 30, y: p.y + 5, z: p.z + right.z * 30 });
    expect(t.s).toBeCloseTo(3000, -1);
    expect(t.lateral).toBeCloseTo(30, 0);
    expect(t.vertical).toBeCloseTo(5, 0);

    let idx = -1;
    let lastS = 0;
    for (let s = 0; s < route.length; s += 37) {
      const q = route.at(s);
      const tr = route.track(q, idx);
      expect(tr.s).toBeGreaterThanOrEqual(lastS - 1);
      expect(tr.dist).toBeLessThan(1);
      idx = tr.index;
      lastS = tr.s;
    }
  });

  it('places the line-up point on the runway 25 end', () => {
    const lu = lineupPoint();
    expect(Math.hypot(lu.pos.x, lu.pos.z)).toBeCloseTo(KCH.runwayLength / 2 - 80, 0);
  });
});

describe('flight model', () => {
  it('reaches Vr and lifts off well inside the 3,780 m runway at take-off power', () => {
    const ac = new Aircraft();
    ac.reset({ x: 0, y: 0, z: 0 }, 248);
    ac.flaps = 15;
    let t = 0;
    let liftoff = false;
    while (t < 40 && !liftoff) {
      const pitch = ac.speed > VR ? 0.5 : 0;
      const ev = ac.step(1 / 60, { roll: 0, pitch, throttle: 1 }, CALM, { targetSpeed: 0, trimGamma: 0, groundY: 0, landing: false });
      liftoff = ev.includes('liftoff');
      t += 1 / 60;
    }
    expect(liftoff).toBe(true);
    expect(ac.tailStruck).toBe(false);
    expect(Math.hypot(ac.pos.x, ac.pos.z)).toBeLessThan(1200);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(20);
  });

  it('strikes the tail when yanked back hard at Vr', () => {
    const ac = new Aircraft();
    ac.reset({ x: 0, y: 0, z: 0 }, 248);
    const events: string[] = [];
    for (let i = 0; i < 60 * 30 && !events.includes('liftoff'); i++) {
      events.push(...ac.step(1 / 60, { roll: 0, pitch: ac.speed > VR * 0.93 ? 1 : 0, throttle: 1 }, CALM, { targetSpeed: 0, trimGamma: 0, groundY: 0, landing: false }));
    }
    expect(events).toContain('tailstrike');
  });

  it('turns at TURN_GAIN · g·tanφ/V', () => {
    const ac = new Aircraft();
    ac.reset({ x: 0, y: 300, z: 0 }, 270);
    ac.onGround = false;
    ac.speed = 200;
    const ctx = { targetSpeed: 200, trimGamma: 0, groundY: 0, landing: false };
    for (let i = 0; i < 120; i++) ac.step(1 / 60, { roll: 30 / 35, pitch: 0, throttle: 0.8 }, CALM, ctx);
    const h0 = ac.heading;
    ac.step(1, { roll: 30 / 35, pitch: 0, throttle: 0.8 }, CALM, ctx);
    const rate = ((ac.heading - h0 + 540) % 360) - 180;
    const expected = ((TURN_GAIN * G * Math.tan((30 * Math.PI) / 180)) / 200) * (180 / Math.PI);
    expect(rate).toBeCloseTo(expected, 0);
  });

  it('maps instruments to realistic readings', () => {
    expect(ias(VR)).toBeCloseTo(110);
    expect(ias(210)).toBeCloseTo(275);
    expect(altitudeFt(300)).toBeCloseTo(17000);
    expect(altitudeFt(30)).toBeCloseTo(98.5, 0);
  });
});

describe('scoring', () => {
  it('grades by distance', () => {
    expect(gradeFor(3)).toBe('PERFECT');
    expect(gradeFor(12)).toBe('GOOD');
    expect(gradeFor(25)).toBe('OK');
    expect(gradeFor(80)).toBe('MISS');
  });
  it('grades landings by sink rate', () => {
    expect(landingGrade(150)).toBe('Butter');
    expect(landingGrade(350)).toBe('Smooth');
    expect(landingGrade(550)).toBe('Firm');
    expect(landingGrade(900)).toBe('Hard');
  });
  it('builds a combo multiplier and gives stars and ranks', () => {
    const s = new Scorer(20);
    for (let i = 0; i < 20; i++) s.marker(2);
    expect(s.multiplier).toBeGreaterThan(1);
    s.touchdown({ fpm: 180, centreline: 1, fromAim: 20 });
    const sum = s.summary();
    expect(sum.stars).toBe(5);
    expect(sum.rank).toBe('Borneo Ace');
    expect(sum.landing?.grade).toBe('Butter');

    const bad = new Scorer(20);
    for (let i = 0; i < 20; i++) bad.marker(i % 2 ? 50 : 20);
    bad.crashed = true;
    expect(bad.summary().stars).toBe(0);
  });
});

describe('mission', () => {
  it('can be flown end to end by the autopilot through the weather', () => {
    const m = new Mission(1234);
    m.start();
    m.action(); // skip intro
    expect(m.phase).toBe('lineup');
    m.flapsPress(); // flaps 15
    const dt = 1 / 60;
    let t = 0;
    let airborneAt = 0;
    let touchdownAt = 0;
    const phases = new Set<string>();
    while (t < 240 && m.phase !== 'results' && m.phase !== 'crashed') {
      const ap = autopilot(m.ac, m.route, m.track);
      let throttle = 1;
      if (m.phase === 'rollout') throttle = 0;
      if (m.phase === 'flight' && m.ac.flaps !== 30 && m.want === 'flaps') m.flapsPress();
      m.update(dt, { ...ap, throttle });
      for (const e of m.drain()) {
        if (e.type === 'liftoff') airborneAt = t;
        if (e.type === 'touchdown') touchdownAt = t;
      }
      phases.add(m.phase);
      t += dt;
    }
    expect(m.crashReason).toBe('');
    expect(m.phase).toBe('results');
    for (const p of ['takeoff', 'flight', 'flare', 'rollout', 'taxiIn']) expect(phases).toContain(p);
    const airTime = touchdownAt - airborneAt;
    // Enjoyable length: about a minute of steering.
    expect(airTime).toBeGreaterThan(45);
    expect(airTime).toBeLessThan(70);
    const sum = m.summary!;
    expect(sum.accuracy).toBeGreaterThan(0.5);
    expect(sum.stars).toBeGreaterThanOrEqual(3);
    console.log(
      `air time ${airTime.toFixed(1)} s, markers ${sum.markers}, accuracy ${(sum.accuracy * 100).toFixed(0)}%, ` +
        `avg dev ${sum.avgDeviation.toFixed(1)} m, landing ${sum.landing?.grade} ${sum.landing?.fpm.toFixed(0)} fpm, ` +
        `fresh ${sum.freshness}%, score ${sum.score}, stars ${sum.stars}`,
    );
  });

  it('warns about config and will not roll with flaps up', () => {
    const m = new Mission(7);
    m.start();
    m.action();
    m.update(0.1, { roll: 0, pitch: 0, throttle: 1 });
    expect(m.phase).toBe('lineup');
    expect(m.drain().some((e) => e.type === 'config')).toBe(true);
  });
});
