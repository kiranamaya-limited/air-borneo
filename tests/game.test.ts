import { describe, expect, it } from 'vitest';
import { Route, designator, dirFromHeading, headingFromDir, lineupPoint, KCH, KLIA } from '../src/game/route';
import { Aircraft, G, ROLL_RATE, TURN_GAIN, VR, ias, altitudeFt } from '../src/game/flight';
import { Comfort } from '../src/game/comfort';
import { Scorer, gradeFor, landingGrade } from '../src/game/scoring';
import { Mission } from '../src/game/mission';
import { autopilot } from '../src/game/autopilot';
import { VOICE_LINES, voiceFor } from '../src/audio/lines';

const CALM = { wind: { x: 0, y: 0, z: 0 }, rollDisturb: 0, pitchDisturb: 0 };

describe('route', () => {
  const route = new Route();

  it('starts on KLIA runway 32R and ends on Kuching runway 25', () => {
    const start = route.at(0);
    expect(start.heading).toBeCloseTo(KLIA.runwayHeading, 5);
    expect(designator(KLIA.runwayHeading)).toBe('32');
    expect(start.y).toBe(0);
    const final = route.at(route.stations['final'] + 10);
    expect(final.heading).toBeCloseTo(KCH.runwayHeading, 3);
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

  it('places the line-up point just past the KLIA runway 32R threshold', () => {
    const lu = lineupPoint();
    expect(Math.hypot(lu.pos.x - KLIA.threshold.x, lu.pos.z - KLIA.threshold.z)).toBeCloseTo(80, 0);
    expect(lu.heading).toBe(KLIA.runwayHeading);
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
    expect(ias(VR)).toBeCloseTo(150);
    expect(ias(210)).toBeCloseTo(290);
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
    expect(sum.rank).toBe('Smooth Operator');
    expect(sum.landing?.grade).toBe('Butter');

    const bad = new Scorer(20);
    for (let i = 0; i < 20; i++) bad.marker(i % 2 ? 50 : 20);
    bad.crashed = true;
    expect(bad.summary().stars).toBe(0);
  });
});

function fly(seed: number) {
  const m = new Mission(seed);
  m.start();
  const dt = 1 / 60;
  let t = 0;
  let airborneAt = 0;
  let touchdownAt = 0;
  const phases = new Set<string>();
  const reactions: string[] = [];
  const spoken: string[] = [];
  while (t < 300 && m.phase !== 'results' && m.phase !== 'crashed') {
    const ap = autopilot(m.ac, m.route, m.track);
    const throttle = m.phase === 'rollout' ? 0 : 1;
    if (m.phase === 'flight' && m.ac.flaps !== 30 && m.want === 'flaps') m.flapsPress();
    m.update(dt, { ...ap, throttle });
    for (const e of m.drain()) {
      if (e.type === 'liftoff') airborneAt = t;
      if (e.type === 'touchdown') touchdownAt = t;
      if (e.type === 'reaction') reactions.push(e.kind);
      if (e.type === 'callout') spoken.push(e.speak ?? e.text);
      if (e.type === 'pa') spoken.push(e.text);
    }
    phases.add(m.phase);
    t += dt;
  }
  return { m, airTime: touchdownAt - airborneAt, phases, reactions, spoken };
}

describe('voice', () => {
  it('has a recorded line for everything the crew says on a flight', () => {
    const { spoken } = fly(7);
    expect(spoken.length).toBeGreaterThan(10);
    const missing = [...new Set(spoken)].filter((t) => !voiceFor(t));
    expect(missing).toEqual([]);
  });

  it('lists every line once, with a unique id', () => {
    const ids = VOICE_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of VOICE_LINES) expect(['pa', 'callout']).toContain(l.kind);
  });
});

describe('mission', () => {
  it('starts straight on the runway, no cutscene', () => {
    const m = new Mission(3);
    m.start();
    expect(m.phase).toBe('lineup');
  });

  for (const seed of [1234, 7, 99]) {
    it(`can be flown smoothly end to end by the autopilot (seed ${seed})`, () => {
      const { m, airTime, phases, reactions } = fly(seed);
      expect(m.crashReason).toBe('');
      expect(m.phase).toBe('results');
      for (const p of ['takeoff', 'flight', 'flare', 'rollout']) expect(phases).toContain(p);
      // About two minutes of flying.
      expect(airTime).toBeGreaterThan(110);
      expect(airTime).toBeLessThan(140);
      const sum = m.summary!;
      console.log(`seed ${seed}: comfort ${sum.comfort} lost ${JSON.stringify(Object.fromEntries(Object.entries(m.scorer.comfort.lostTo).map(([k, v]) => [k, Math.round(v)])))} reactions ${reactions.join(',')}`);
      expect(sum.comfort).toBeGreaterThanOrEqual(85);
      expect(sum.sickBags).toBe(0);
      expect(sum.stars).toBeGreaterThanOrEqual(4);
      console.log(
        `seed ${seed}: air ${airTime.toFixed(1)} s, comfort ${sum.comfort}% (avg ${sum.avgComfort}%), happy ${sum.happy}/${sum.passengers}, ` +
          `line ${(sum.accuracy * 100).toFixed(0)}%, landing ${sum.landing?.grade} ${sum.landing?.fpm.toFixed(0)} fpm, ` +
          `score ${sum.score}, stars ${sum.stars}, lost ${JSON.stringify(Object.fromEntries(Object.entries(m.scorer.comfort.lostTo).map(([k, v]) => [k, Math.round(v)])))}, reactions ${reactions.join(',')}`,
      );
    });
  }

  it('a rough pilot makes the cabin gasp, scream and be sick', () => {
    const m = new Mission(5);
    m.start();
    const kinds = new Set<string>();
    for (let i = 0; i < 60 * 150 && m.phase !== 'results' && m.phase !== 'crashed'; i++) {
      const ap = autopilot(m.ac, m.route, m.track);
      const t = i / 60;
      // Follow the route, but yank the yoke around every few seconds once airborne.
      const yank = !m.ac.onGround && t > 25 ? (Math.floor(t / 2.5) % 2 ? 1 : -1) : 0;
      const pitchYank = !m.ac.onGround && t > 25 ? Math.sin(t * 2.2) * 0.9 : 0;
      const roll = Math.max(-1, Math.min(1, ap.roll + yank * 0.8));
      m.update(1 / 60, { roll, pitch: pitchYank ? Math.sign(pitchYank) : ap.pitch, throttle: m.phase === 'rollout' ? 0 : 1 });
      for (const e of m.drain()) if (e.type === 'reaction') kinds.add(e.kind);
    }
    expect(kinds).toContain('gasp');
    expect(kinds.has('scream') || kinds.has('whoa')).toBe(true);
    expect(kinds).toContain('vomit');
    expect(m.comfort).toBeLessThan(50);
  });

  it('sets take-off flaps automatically if the throttle goes up first', () => {
    const m = new Mission(7);
    m.start();
    m.update(0.1, { roll: 0, pitch: 0, throttle: 1 });
    expect(m.phase).toBe('takeoff');
    expect(m.ac.flaps).toBe(15);
    expect(m.drain().some((e) => e.type === 'config')).toBe(true);
  });
});

describe('passenger comfort', () => {
  const calm = { bank: 0, pilotRollRate: 0, load: 1, turb: 0.05, offLine: 5, airborne: true };

  it('drains with steep banks and makes people gasp', () => {
    const c = new Comfort();
    const reactions: string[] = [];
    for (let i = 0; i < 60 * 5; i++) reactions.push(...c.update(1 / 60, { ...calm, bank: 40, pilotRollRate: 30 }));
    expect(c.value).toBeLessThan(85);
    expect(reactions).toContain('gasp');
    expect(c.biggestComplaint()).toBe('bank');
  });

  it('screams on a sudden drop and someone is sick after sustained rough flying', () => {
    const c = new Comfort();
    const reactions: string[] = [];
    for (let i = 0; i < 60 * 25; i++) reactions.push(...c.update(1 / 60, { ...calm, load: i % 180 < 90 ? 0.3 : 1.8, turb: 0.9 }));
    expect(reactions).toContain('scream');
    expect(reactions).toContain('vomit');
    expect(c.sickBags).toBeGreaterThan(0);
  });

  it('recovers when the flight is smooth and on the line', () => {
    const c = new Comfort();
    c.jolt(20, null);
    for (let i = 0; i < 60 * 20; i++) c.update(1 / 60, calm);
    expect(c.value).toBeGreaterThan(85);
  });

  it('gets nervous when far off the dotted line', () => {
    const c = new Comfort();
    const reactions: string[] = [];
    for (let i = 0; i < 60 * 10; i++) reactions.push(...c.update(1 / 60, { ...calm, offLine: 200 }));
    expect(reactions).toContain('nervous');
    expect(c.value).toBeLessThan(90);
  });
});

describe('controls', () => {
  it('caps the roll rate, even with a full yank', () => {
    const ac = new Aircraft();
    ac.reset({ x: 0, y: 300, z: 0 }, 270);
    ac.onGround = false;
    ac.speed = 200;
    const ctx = { targetSpeed: 200, trimGamma: 0, groundY: 0, landing: false };
    let maxRate = 0;
    for (let i = 0; i < 120; i++) {
      const b0 = ac.bank;
      ac.step(1 / 60, { roll: 1, pitch: 0, throttle: 0.8 }, CALM, ctx);
      maxRate = Math.max(maxRate, Math.abs(ac.bank - b0) * 60);
    }
    expect(maxRate).toBeLessThanOrEqual(ROLL_RATE + 0.01);
  });
});
