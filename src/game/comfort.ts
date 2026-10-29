/**
 * Passenger comfort: the heart of the game. 68 people are on board and they feel everything:
 * steep banks, yanking the yoke, sudden drops, shaking in rough air, wandering off course and a
 * hard landing. Comfort drains while they're unhappy and slowly recovers while the flight is
 * smooth. Discrete reactions (gasps, screams, someone being sick, applause) are emitted for the
 * HUD and the sound engine, with cooldowns so they stay funny rather than constant.
 */

export type Reaction = 'gasp' | 'whoa' | 'scream' | 'vomit' | 'nervous' | 'lightning' | 'happy' | 'applause';

export const PASSENGERS = 68;

/** What the passengers feel this frame. */
export interface Feel {
  bank: number; // deg
  pilotRollRate: number; // deg/s the pilot commands
  load: number; // g
  turb: number; // 0..1
  offLine: number; // metres from the dotted line
  airborne: boolean;
}

const COOLDOWN: Record<Reaction, number> = {
  gasp: 2.6,
  whoa: 3.2,
  scream: 4.5,
  vomit: 7,
  nervous: 9,
  lightning: 6,
  happy: 14,
  applause: 30,
};

export const COMFORT_LIMITS = {
  /** Banks beyond this start to worry people. */
  bank: 25,
  /** Commanded roll rates beyond this feel like a lurch. */
  rollRate: 20,
  loadLow: 0.6,
  loadHigh: 1.45,
  /** Turbulence above this is felt as shaking. */
  turb: 0.5,
  /** Metres off the dotted line before the cabin gets nervous. */
  offLine: 45,
};

export type Complaint = 'bank' | 'roll' | 'g' | 'shake' | 'lost' | 'jolt';

export const COMPLAINTS: Record<Complaint, string> = {
  bank: 'Steep banking',
  roll: 'Jerky steering',
  g: 'Stomach-lurching climbs and drops',
  shake: 'Rough air',
  lost: 'Wandering off course',
  jolt: 'A bumpy take-off or landing',
};

export class Comfort {
  value = 100;
  sickBags = 0;
  /** Comfort lost to each cause, in percentage points. */
  readonly lostTo: Record<Complaint, number> = { bank: 0, roll: 0, g: 0, shake: 0, lost: 0, jolt: 0 };
  private sum = 0;
  private time = 0;
  private load = 1;
  private sickness = 0;
  private calm = 0;
  private readonly last: Partial<Record<Reaction, number>> = {};
  private clock = 0;

  /** Average comfort across the flight so far. */
  get average(): number {
    return this.time > 0 ? this.sum / this.time : this.value;
  }

  /** Advance by dt seconds. Returns any reactions the cabin has. */
  update(dt: number, f: Feel): Reaction[] {
    this.clock += dt;
    const out: Reaction[] = [];
    if (!f.airborne) return out;
    const L = COMFORT_LIMITS;
    // People feel sustained g, not single-frame spikes.
    this.load += (f.load - this.load) * Math.min(1, dt * 1.5);

    const bankExcess = Math.max(0, Math.abs(f.bank) - L.bank);
    const rollExcess = Math.max(0, Math.abs(f.pilotRollRate) - L.rollRate);
    const gExcess = Math.max(0, this.load - L.loadHigh) + Math.max(0, L.loadLow - this.load);
    const shake = Math.max(0, f.turb - L.turb);
    const lost = Math.max(0, f.offLine - L.offLine);

    const parts: Record<Exclude<Complaint, 'jolt'>, number> = {
      bank: bankExcess * 0.28, // 35° bank ≈ 2.8 %/s
      roll: rollExcess * 0.25, // yanking at 12°/s ≈ 1 %/s
      g: gExcess * 12, // a sustained 0.4 g drop ≈ 2.4 %/s
      shake: shake * 4.5, // edge of the storm ≈ 0.7 %/s, its core ≈ 2.2 %/s
      lost: Math.min(2, lost / 70), // well off course ≈ up to 2 %/s
    };
    const drain = parts.bank + parts.roll + parts.g + parts.shake + parts.lost;
    if (drain > 0.05 && this.value > 0) {
      for (const k of Object.keys(parts) as (keyof typeof parts)[]) this.lostTo[k] += parts[k] * dt;
    }

    if (drain > 0.05) {
      this.value = Math.max(0, this.value - drain * dt);
      this.sickness += drain * dt;
      this.calm = 0;
    } else {
      this.calm += dt;
      if (f.offLine < 25 && this.calm > 2) this.value = Math.min(100, this.value + 0.7 * dt);
    }
    this.sum += this.value * dt;
    this.time += dt;

    // Reactions, most dramatic first.
    if (this.load < 0.5) this.react('scream', out);
    else if (this.load > 1.6) this.react('whoa', out);
    if (bankExcess > 6 || rollExcess > 2.5) this.react('gasp', out);
    if (shake > 0.18 && Math.random() < dt * 0.8) this.react('gasp', out);
    if (lost > 80) this.react('nervous', out);
    if (this.value < 45 && this.sickness > 14) {
      if (this.react('vomit', out)) {
        this.sickBags++;
        this.sickness = 0;
      }
    }
    if (this.calm > 9 && this.value > 88) {
      if (this.react('happy', out)) this.calm = 0;
    }
    return out;
  }

  /** A one-off jolt (tail strike, hard landing). */
  jolt(amount: number, reaction: Reaction | null, out: Reaction[] = []): Reaction[] {
    this.value = Math.max(0, this.value - amount);
    this.lostTo.jolt += amount;
    this.sickness += amount;
    if (reaction) this.react(reaction, out, true);
    return out;
  }

  /** A pleasant moment (a butter landing). */
  delight(amount: number, out: Reaction[] = []): Reaction[] {
    this.value = Math.min(100, this.value + amount);
    this.react('applause', out, true);
    return out;
  }

  /** Lightning close by always makes someone jump. */
  flash(out: Reaction[] = []): Reaction[] {
    this.react('lightning', out);
    return out;
  }

  /** What upset the passengers most, if anything did. */
  biggestComplaint(): Complaint | null {
    let best: Complaint | null = null;
    for (const k of Object.keys(this.lostTo) as Complaint[]) if (this.lostTo[k] > 2 && (!best || this.lostTo[k] > this.lostTo[best])) best = k;
    return best;
  }

  /** How many passengers had a lovely flight. */
  happyPassengers(): number {
    const score = (this.average * 0.5 + this.value * 0.5) / 100;
    return Math.max(0, Math.min(PASSENGERS, Math.round(PASSENGERS * score ** 1.5) - this.sickBags));
  }

  private react(r: Reaction, out: Reaction[], force = false): boolean {
    const last = this.last[r] ?? -Infinity;
    if (!force && this.clock - last < COOLDOWN[r]) return false;
    this.last[r] = this.clock;
    out.push(r);
    return true;
  }
}
