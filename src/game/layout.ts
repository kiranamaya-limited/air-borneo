/**
 * Airport layout in runway-aligned coordinates, shared by the 3D world and the mission logic.
 * u = metres along the runway (direction of the active runway heading), v = metres to the right.
 */
import { CHANGI_RWY, KCH, dirFromHeading, type Route } from './route';

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

/** Kuching: origin at the runway centre, u along runway 25 (248°). Terminal on the north side. */
export const kchFrame = makeFrame(KCH.runwayCenter.x, KCH.runwayCenter.z, KCH.runwayHeading);

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

/** Taxi route from the stand to the runway 25 line-up point, as (u, v) points. */
export function kchTaxiPath(): { u: number; v: number }[] {
  const L = KCH_LAYOUT;
  const thr = -L.halfLength;
  return [
    { u: L.stand.u, v: L.stand.v },
    { u: L.stand.u, v: 250 },
    { u: L.stand.u - 60, v: L.taxiwayV },
    { u: -1500, v: L.taxiwayV },
    { u: thr + 120, v: L.taxiwayV },
    { u: thr + 20, v: 120 },
    { u: thr + 35, v: 25 },
    { u: thr + 80, v: 0 },
  ];
}

/** Changi frame: origin at the 20C threshold, u along 200°. Cargo and terminals to the right (west). */
export function changiFrame(route: Route): Frame {
  return makeFrame(route.changiThreshold.x, route.changiThreshold.z, CHANGI_RWY.heading);
}

export const CHANGI_LAYOUT = {
  length: CHANGI_RWY.length,
  width: CHANGI_RWY.width,
  taxiwayV: 210,
  cargoApron: { u0: 1300, u1: 2300, v0: 270, v1: 470 },
  cargoSheds: { u0: 1350, u1: 2250, v0: 500, v1: 600 },
  terminal: { u0: 2500, u1: 3700, v0: 380, v1: 700 },
  tower: { u: 2350, v: 460 },
  cargoStand: { u: 1800, v: 360 },
};
