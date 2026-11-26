/**
 * AirBorneo livery, painted onto canvases at runtime.
 *
 * Built from public descriptions: a white fuselage with the Sarawak flag's yellow, red and black
 * sweeping up to the tail. Swap in official artwork here once it is available.
 *
 * Fuselage UV layout: u runs nose (0) → tail (1); v runs around the body starting at the crown:
 * 0 = top, 0.25 = right side, 0.5 = belly, 0.75 = left side.
 */
import * as THREE from 'three';
import { brand } from '../brand/tokens';

const W = 2048;
const H = 1024;

type Side = 'right' | 'left';

/** Metres per pixel vertically (round the ~1.94 m radius) over metres per pixel along the 39.47 m length. */
const ASPECT = (2 * Math.PI * 1.94) / H / (39.47 / W);

/** Canvas y for a height h (0 = belly line, 1 = crown) on a given side. */
function sideY(side: Side, h: number): number {
  return (side === 'right' ? 0.5 - h * 0.5 : 0.5 + h * 0.5) * H;
}

/** Run a drawing function in "side space": x = u·W, y grows upwards on the aircraft side. */
function onSide(ctx: CanvasRenderingContext2D, side: Side, draw: () => void): void {
  ctx.save();
  if (side === 'right') {
    // Rows grow downwards; content must read nose-right so it is mirrored horizontally later.
    ctx.translate(0, H * 0.5);
    ctx.scale(1, -0.5);
  } else {
    ctx.translate(0, H * 0.5);
    ctx.scale(1, 0.5);
  }
  draw();
  ctx.restore();
}

/** Draw text that reads correctly on the given side, centred at (u, h). */
function sideText(ctx: CanvasRenderingContext2D, side: Side, text: string, u: number, h: number, sizePx: number, font: string, color: string, weight = 800): void {
  ctx.save();
  ctx.translate(u * W, sideY(side, h));
  // Right side: nose points right on screen while u grows left → mirror horizontally.
  // Left side: rows grow upwards on the aircraft → mirror vertically.
  // Canvas pixels are ~1.5x wider on the fuselage than they are tall; squash to keep letters true.
  if (side === 'right') ctx.scale(-ASPECT, 1);
  else ctx.scale(ASPECT, -1);
  ctx.font = `${weight} ${sizePx}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function paintFuselage(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const c = brand.colors;

  ctx.fillStyle = '#fbfbfc';
  ctx.fillRect(0, 0, W, H);
  // Soft grey belly.
  const belly = ctx.createLinearGradient(0, H * 0.36, 0, H * 0.64);
  belly.addColorStop(0, 'rgba(225,228,233,0)');
  belly.addColorStop(0.3, 'rgba(225,228,233,1)');
  belly.addColorStop(0.7, 'rgba(225,228,233,1)');
  belly.addColorStop(1, 'rgba(225,228,233,0)');
  ctx.fillStyle = belly;
  ctx.fillRect(0, H * 0.36, W, H * 0.28);

  for (const side of ['right', 'left'] as Side[]) {
    onSide(ctx, side, () => {
      // Sarawak sweep: yellow, red and black bands rising from the belly mid-fuselage to the tail.
      // In side space x = u·W and y = h·H (h: 0 = belly line, 1 = crown).
      const curve = (du: number) => [
        [0.36 + du, -0.02],
        [0.6 + du, 0.02],
        [0.78 + du, 0.3],
        [1.0 + du, 1.02],
      ];
      const bands: [string, number, number][] = [
        [c.yellow, 0.0, 0.045],
        [c.red, 0.045, 0.09],
        [c.black, 0.09, 0.135],
      ];
      for (const [color, o0, o1] of bands) {
        const a = curve(o0);
        const b = curve(o1);
        ctx.beginPath();
        ctx.moveTo(a[0][0] * W, a[0][1] * H);
        ctx.bezierCurveTo(a[1][0] * W, a[1][1] * H, a[2][0] * W, a[2][1] * H, a[3][0] * W, a[3][1] * H);
        ctx.lineTo(b[3][0] * W, b[3][1] * H);
        ctx.bezierCurveTo(b[2][0] * W, b[2][1] * H, b[1][0] * W, b[1][1] * H, b[0][0] * W, b[0][1] * H);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
    });

    // Cockpit side windows.
    ctx.save();
    ctx.fillStyle = '#20252d';
    for (const [u0, u1, h0, h1] of [
      [0.036, 0.05, 0.6, 0.76],
      [0.052, 0.064, 0.62, 0.78],
      [0.066, 0.075, 0.66, 0.78],
    ]) {
      const y0 = sideY(side, h0);
      const y1 = sideY(side, h1);
      ctx.beginPath();
      ctx.moveTo(u0 * W, y0);
      ctx.lineTo(u1 * W, y0);
      ctx.lineTo(u1 * W, y1);
      ctx.lineTo((u0 + 0.006) * W, y1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Titles.
    sideText(ctx, side, 'AirBorneo', 0.3, 0.74, 110, brand.fonts.ui, c.ink, 800);
    sideText(ctx, side, 'CONNECTING YOU', 0.62, 0.72, 30, brand.fonts.ui, c.red, 800);
    sideText(ctx, side, brand.tagline.toUpperCase(), 0.3, 0.36, 30, brand.fonts.ui, c.slate, 700);

    // Passenger windows along the cabin (0.51 m pitch), with the two overwing exits.
    ctx.fillStyle = '#2a3340';
    const pitch = 0.51 / 39.47;
    for (let u = 0.125; u < 0.79; u += pitch) {
      if (u > 0.435 && u < 0.468) continue; // overwing exits
      const y0 = sideY(side, 0.5);
      const y1 = sideY(side, 0.58);
      ctx.beginPath();
      ctx.roundRect(u * W, Math.min(y0, y1), 11, Math.abs(y1 - y0), 5);
      ctx.fill();
    }
  }

  // Door outlines: forward and aft passenger doors (left), galley service doors (right), overwing exits.
  ctx.strokeStyle = 'rgba(17,18,22,0.35)';
  ctx.lineWidth = 3;
  const door = (side: Side, u: number, w: number, h0: number, h1: number) => {
    const y0 = sideY(side, h0);
    const y1 = sideY(side, h1);
    ctx.strokeRect(W * u, Math.min(y0, y1), W * w, Math.abs(y1 - y0));
  };
  for (const side of ['left', 'right'] as Side[]) {
    door(side, 0.09, 0.022, 0.18, 0.66);
    door(side, 0.8, 0.02, 0.2, 0.64);
    door(side, 0.438, 0.012, 0.4, 0.62);
    door(side, 0.453, 0.012, 0.4, 0.62);
  }

  // Windscreen panels across the crown at the nose.
  ctx.fillStyle = '#20252d';
  ctx.beginPath();
  ctx.moveTo(W * 0.036, H * 0.88);
  ctx.lineTo(W * 0.058, H * 0.9);
  ctx.lineTo(W * 0.058, H * 1.0);
  ctx.lineTo(W * 0.036, H * 1.0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W * 0.036, 0);
  ctx.lineTo(W * 0.058, 0);
  ctx.lineTo(W * 0.058, H * 0.1);
  ctx.lineTo(W * 0.036, H * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#fbfbfc';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(W * 0.036, 0);
  ctx.lineTo(W * 0.058, 0);
  ctx.moveTo(W * 0.036, H);
  ctx.lineTo(W * 0.058, H);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

/** Tail fin art: Sarawak-flag diagonal bands, mirrored on both sides by the geometry's UVs. */
export function paintFin(): THREE.CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const c = brand.colors;
  // u = forward → aft (z), v = bottom → top (canvas row 0 = v 0 because flipY is false).
  ctx.fillStyle = c.yellow;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = c.red;
  ctx.beginPath();
  ctx.moveTo(S * 0.15, 0);
  ctx.lineTo(S * 0.55, 0);
  ctx.lineTo(S * 1.1, S * 0.82);
  ctx.lineTo(S * 1.1, S * 1.1);
  ctx.lineTo(S * 0.95, S * 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.black;
  ctx.beginPath();
  ctx.moveTo(S * 0.55, 0);
  ctx.lineTo(S * 1.1, 0);
  ctx.lineTo(S * 1.1, S * 0.82);
  ctx.closePath();
  ctx.fill();
  // White dorsal fillet blending into the fuselage.
  const fade = ctx.createLinearGradient(0, 0, 0, S * 0.22);
  fade.addColorStop(0, '#fbfbfc');
  fade.addColorStop(1, 'rgba(251,251,252,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, S, S * 0.22);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

/** The CFM56 fan face: 24 wide-chord titanium blades round a dark hub. */
export function paintFanFace(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    const g = ctx.createLinearGradient(0, 0, S / 2, 0);
    g.addColorStop(0, '#5d636c');
    g.addColorStop(1, '#a7adb6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(S * 0.08, -2);
    ctx.quadraticCurveTo(S * 0.3, -9, S / 2, -5);
    ctx.lineTo(S / 2, 3);
    ctx.quadraticCurveTo(S * 0.3, -1, S * 0.08, 3);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
