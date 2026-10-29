/**
 * Points, grades and the final rating.
 *
 * Passenger comfort is the headline: it drives the star rating and most of the score. The dotted
 * line guides you; passing close to its markers adds points with a streak multiplier. Take-off
 * technique and the landing add bonuses.
 */
import { Comfort, PASSENGERS, type Reaction } from './comfort';

export type Grade = 'PERFECT' | 'GOOD' | 'OK' | 'MISS';

export const GRADE_RADIUS = { PERFECT: 7, GOOD: 16, OK: 32 } as const;
export const GRADE_POINTS: Record<Grade, number> = { PERFECT: 30, GOOD: 15, OK: 5, MISS: 0 };

export const RANKS = ['Mission failed', 'Trainee', 'First Officer', 'Captain', 'Senior Captain', 'Smooth Operator'] as const;

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
  /** Final and average passenger comfort, 0..100. */
  comfort: number;
  avgComfort: number;
  happy: number;
  passengers: number;
  sickBags: number;
  accuracy: number; // 0..1
  perfect: number;
  good: number;
  ok: number;
  miss: number;
  markers: number;
  avgDeviation: number;
  bestCombo: number;
  landing?: Landing & { grade: LandingGrade };
  lines: { label: string; value: string; points: number }[];
  crashed: boolean;
}

export class Scorer {
  score = 0;
  combo = 0;
  bestCombo = 0;
  readonly comfort = new Comfort();
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

  /** Grades the landing and returns how the cabin reacts to it. */
  touchdown(l: Landing): { grade: LandingGrade; reactions: Reaction[] } {
    const grade = landingGrade(l.fpm);
    this.landing = { ...l, grade };
    let reactions: Reaction[] = [];
    if (grade === 'Hard') reactions = this.comfort.jolt(Math.min(25, 8 + (l.fpm - 600) / 25), 'scream');
    else if (grade === 'Firm') reactions = this.comfort.jolt(3, 'gasp');
    else reactions = this.comfort.delight(grade === 'Butter' ? 4 : 2);
    this.bonus('Landing', `${grade} · ${Math.round(l.fpm)} fpm`, LANDING_POINTS[grade]);
    const cl = Math.abs(l.centreline);
    this.bonus('Centreline', `${cl.toFixed(1)} m off`, cl <= 5 ? 200 : cl <= 12 ? 100 : 0);
    // The touchdown zone is the first 900 m of runway; the aim point is 300 m in.
    const tdz = l.fromAim >= -300 && l.fromAim <= 600;
    this.bonus('Touchdown zone', tdz ? `${Math.round(l.fromAim + 300)} m in` : `${Math.round(Math.abs(l.fromAim))} m ${l.fromAim > 0 ? 'long' : 'short'}`, tdz ? 200 : 0);
    return { grade, reactions };
  }

  summary(): Summary {
    const c = this.comfort;
    const accuracy = this.markerCount ? this.basePoints / (this.markerCount * GRADE_POINTS.PERFECT) : 0;
    const comfortScore = c.average * 0.5 + c.value * 0.5;
    let stars = comfortScore >= 90 ? 5 : comfortScore >= 78 ? 4 : comfortScore >= 62 ? 3 : comfortScore >= 45 ? 2 : 1;
    if (this.landing?.grade === 'Hard') stars = Math.min(stars, 3);
    if (this.crashed) stars = 0;
    const comfortPoints = this.crashed ? 0 : Math.round(comfortScore * 800);
    const happy = this.crashed ? 0 : c.happyPassengers();
    const lines = [
      { label: 'Passenger comfort', value: `${Math.round(comfortScore)}% · ${happy}/${PASSENGERS} happy`, points: comfortPoints },
      { label: 'On the line', value: `${Math.round(accuracy * 100)}%`, points: this.score - this.bonuses.reduce((a, b) => a + b.points, 0) },
      ...this.bonuses,
    ];
    if (c.sickBags > 0) lines.push({ label: 'Sick bags used', value: `${c.sickBags} 🤮`, points: -c.sickBags * 500 });
    return {
      score: Math.max(0, this.score + comfortPoints - c.sickBags * 500),
      stars,
      rank: RANKS[stars],
      comfort: Math.round(c.value),
      avgComfort: Math.round(c.average),
      happy,
      passengers: PASSENGERS,
      sickBags: c.sickBags,
      accuracy,
      perfect: this.counts.PERFECT,
      good: this.counts.GOOD,
      ok: this.counts.OK,
      miss: this.counts.MISS,
      markers: this.markerCount,
      avgDeviation: this.devN ? this.devSum / this.devN : 0,
      bestCombo: this.bestCombo,
      landing: this.landing,
      lines,
      crashed: this.crashed,
    };
  }
}
