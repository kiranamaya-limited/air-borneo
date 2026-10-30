/** Messages exchanged between the phone controller and the big-screen game. */

export type FlapSetting = 0 | 15 | 30;

export type Phase = 'pairing' | 'lineup' | 'takeoff' | 'flight' | 'flare' | 'rollout' | 'results' | 'crashed';

/** Phone → screen. */
export type ControllerMsg =
  | { t: 'hello'; v: 1; device: string }
  | { t: 'input'; s: number; r: number; p: number; th: number; f: FlapSetting; cal: boolean }
  | { t: 'btn'; b: 'action' | 'flaps' }
  /** The phone is leaving (page closed): pause straight away. */
  | { t: 'bye' };

/** Screen → phone. */
export type ScreenMsg =
  | { t: 'welcome'; code: string }
  | { t: 'state'; phase: Phase; prompt: string; want: Want; flaps: FlapSetting; score: number; comfort: number }
  | { t: 'haptic'; pattern: number | number[] }
  | { t: 'result'; score: number; stars: number; rank: string; best: number };

/** Which phone control the game is currently asking for, so the phone can highlight it. */
export type Want = 'none' | 'flaps' | 'throttle-up' | 'throttle-idle' | 'pitch-up' | 'steer' | 'action';

/** Pairing codes are six digits: quick to read off a screen and to type on a phone's number pad. */
export const CODE_ALPHABET = '0123456789';
export const CODE_LENGTH = 6;
export const PEER_PREFIX = 'airborneo-fcr-';

export function makeCode(length = CODE_LENGTH, rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return out;
}

export function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function peerIdFor(code: string): string {
  return PEER_PREFIX + code.toLowerCase();
}
