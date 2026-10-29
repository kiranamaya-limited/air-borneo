/**
 * Points, grades and the final rating.
 *
 * The dotted line is made of collectible markers. Crossing a marker scores by how close the
 * aircraft is to it, with a combo multiplier for staying tight. Take-off technique, landing
 * sink rate and cargo freshness add bonuses on top.
 */

export type Grade = 'PERFECT' | 'GOOD' | 'OK' | 'MISS';

export const GRADE_RADIUS = { PERFECT: 7, GOOD: 16, OK: 32 } as const;
export const GRADE_POINTS: Record<Grade, number> = { PERFECT: 100, GOOD: 50, OK: 20, MISS: 0 };

export const RANKS = ['Mission failed', 'Cadet', 'First Officer', 'Captain', 'Senior Captain', 'Borneo Ace'] as const;

export function gradeFor(distance: number): Grade {
  if (distance <= GRADE_RADIUS.PERFECT) return 'PERFECT';
  if (distance <= GRADE_RADIUS.GOOD) return 'GOOD';
  if (distance <= GRADE_RADIUS.OK) return 'OK';
  return 'MISS';
}

export type LandingGrade = 'Butter' | 'Smooth' | 'Firm' | 'Hard';

export function landingGrade(fpm: number): LandingGrade {
  if (fpm <= 240) return 'Butter';
  if (fpm <= 400) return 'Smooth';
  if (fpm <= 600) return 'Firm';
  return 'Hard';
}

const LANDING_POINTS: Record<LandingGrade, number> = { Butter: 1000, Smooth: 700, Firm: 400, Hard: 100 };

export interface Landing {
  fpm: number;
  centreline: number; // metres off centreline at touchdown
  fromAim: number; // metres from the aim point (+ long)
}

export interface Summary {
  score: number;
  stars: number;
  rank: string;
  accuracy: number; // 0..1
  perfect: number;
  good: number;
  ok: number;
  miss: number;
  markers: number;
  avgDeviation: number;
  bestCombo: number;
  freshness: number;
  landing?: Landing & { grade: LandingGrade };
  lines: { label: string; value: string; points: number }[];
  crashed: boolean;
}

export class Scorer {
  score = 0;
  combo = 0;
  bestCombo = 0;
  freshness = 100;
  readonly counts: Record<Grade, number> = { PERFECT: 0, GOOD: 0, OK: 0, MISS: 0 };
  private basePoints = 0;
  private devSum = 0;
  private devN = 0;
  private bonuses: { label: string; value: string; points: number }[] = [];
  landing?: Landing & { grade: LandingGrade };
  crashed = false;

  constructor(readonly markerCount: number) {}

  get multiplier(): number {
    return Math.min(3, 1 + Math.floor(this.combo / 8) * 0.5);
  }

  /** A marker was crossed at `distance` metres from its centre. Returns grade and points earned. */
  marker(distance: number): { grade: Grade; points: number } {
    const grade = gradeFor(distance);
    this.counts[grade]++;
    this.devSum += Math.min(distance, 60);
    this.devN++;
    if (grade === 'PERFECT' || grade === 'GOOD') this.combo++;
    else if (grade === 'OK') this.combo = Math.max(0, this.combo - 4);
    else this.combo = 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const base = GRADE_POINTS[grade];
    this.basePoints += base;
    const points = Math.round(base * this.multiplier);
    this.score += points;
    return { grade, points };
  }

  bonus(label: string, value: string, points: number): void {
    this.bonuses.push({ label, value, points });
    this.score = Math.max(0, this.score + points);
  }

  /**
   * Fresh cargo is bruised by flying into the rough core of the weather and by yanking the
   * aircraft around; staying on the (smoother) route keeps it fresh.
   */
  handling(dt: number, turb: number, bank: number): void {
    const rough = Math.max(0, turb - 0.55) * 4;
    const aggressive = Math.max(0, Math.abs(bank) - 32) * 0.15;
    this.freshness = Math.max(55, this.freshness - dt * (rough + aggressive));
  }

  touchdown(l: Landing): LandingGrade {
    const grade = landingGrade(l.fpm);
    this.landing = { ...l, grade };
    if (grade === 'Hard') this.freshness = Math.max(55, this.freshness - Math.min(20, (l.fpm - 600) / 30 + 5));
    this.bonus('Landing', `${grade} · ${Math.round(l.fpm)} fpm`, LANDING_POINTS[grade]);
    const cl = Math.abs(l.centreline);
    this.bonus('Centreline', `${cl.toFixed(1)} m off`, cl <= 5 ? 200 : cl <= 12 ? 100 : 0);
    // The touchdown zone is the first 900 m of runway; the aim point is 300 m in.
    const tdz = l.fromAim >= -300 && l.fromAim <= 600;
    this.bonus('Touchdown zone', tdz ? `${Math.round(l.fromAim + 300)} m in` : `${Math.round(Math.abs(l.fromAim))} m ${l.fromAim > 0 ? 'long' : 'short'}`, tdz ? 200 : 0);
    return grade;
  }

  summary(): Summary {
    const accuracy = this.markerCount ? this.basePoints / (this.markerCount * 100) : 0;
    const freshness = Math.round(this.freshness);
    let stars = accuracy >= 0.72 ? 5 : accuracy >= 0.55 ? 4 : accuracy >= 0.38 ? 3 : accuracy >= 0.2 ? 2 : 1;
    if (this.landing?.grade === 'Hard') stars = Math.min(stars, 3);
    if (freshness < 80) stars = Math.max(1, stars - 1);
    if (this.crashed) stars = 0;
    const fresh = this.crashed ? 0 : Math.round(freshness * 12);
    const lines = [
      { label: 'Path accuracy', value: `${Math.round(accuracy * 100)}%`, points: this.score - this.bonuses.reduce((a, b) => a + b.points, 0) },
      ...this.bonuses,
      { label: 'Cargo freshness', value: `${freshness}%`, points: fresh },
    ];
    return {
      score: this.score + fresh,
      stars,
      rank: RANKS[stars],
      accuracy,
      perfect: this.counts.PERFECT,
      good: this.counts.GOOD,
      ok: this.counts.OK,
      miss: this.counts.MISS,
      markers: this.markerCount,
      avgDeviation: this.devN ? this.devSum / this.devN : 0,
      bestCombo: this.bestCombo,
      freshness,
      landing: this.landing,
      lines,
      crashed: this.crashed,
    };
  }
}
