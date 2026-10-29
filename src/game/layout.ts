/**
 * Airport layout in runway-aligned coordinates, shared by the 3D world and the mission logic.
 * u = metres along the runway (direction of the active runway heading), v = metres to the right.
 */
import { KCH, KLIA, dirFromHeading, type Route } from './route';

export interface Frame {
  heading: number;
  toWorld(u: number, v: number): { x: number; z: number };
  toLocal(x: number, z: number): { u: number; v: number };
}

export function makeFrame(originX: number, originZ: number, heading: number): Frame {
  const d = dirFromHeading(heading);
  const r = { x: -d.z, z: d.x };
  return {
    heading,
    toWorld: (u, v) => ({ x: originX + d.x * u + r.x * v, z: originZ + d.z * u + r.z * v }),
    toLocal: (x, z) => {
      const dx = x - originX;
      const dz = z - originZ;
      return { u: dx * d.x + dz * d.z, v: dx * r.x + dz * r.z };
    },
  };
}

/** KLIA: origin at the runway 32R threshold, u along the take-off direction. Terminal to the right. */
export const kliaFrame = makeFrame(KLIA.threshold.x, KLIA.threshold.z, KLIA.runwayHeading);

export const KLIA_LAYOUT = {
  length: KLIA.runwayLength,
  width: KLIA.runwayWidth,
  taxiwayV: 210,
  apron: { u0: 1300, u1: 2300, v0: 270, v1: 470 },
  hangar: { u0: 1350, u1: 2250, v0: 500, v1: 600 },
  terminal: { u0: 2500, u1: 3700, v0: 380, v1: 700 },
  tower: { u: 2350, v: 460 },
  stand: { u: 1800, v: 360 },
};

/** Kuching: origin at the runway centre, u along runway 25 (248°). Terminal on the north side. */
export function kchFrame(route: Route): Frame {
  return makeFrame(route.kchCentre.x, route.kchCentre.z, KCH.runwayHeading);
}

/** Kuching landing frame: origin at the runway 25 threshold, u along the landing direction. */
export function kchLandingFrame(route: Route): Frame {
  return makeFrame(route.kchThreshold.x, route.kchThreshold.z, KCH.runwayHeading);
}

export const KCH_LAYOUT = {
  halfLength: KCH.runwayLength / 2,
  width: KCH.runwayWidth,
  taxiwayV: 190,
  apron: { u0: -1350, u1: -450, v0: 225, v1: 345 },
  terminal: { u0: -1280, u1: -560, v0: 360, v1: 430 },
  tower: { u: -350, v: 380 },
  hangar: { u: 250, v: 300 },
  stand: { u: -1150, v: 300 },
};
