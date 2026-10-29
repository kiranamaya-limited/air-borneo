import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, makeCode, normaliseCode } from '../src/net/protocol';
import { describeLink, type LinkDiagnostics } from '../src/net/link';

describe('pairing code', () => {
  it('is six digits', () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^\d{6}$/);
    expect(CODE_LENGTH).toBe(6);
  });

  it('accepts what people type: spaces, dashes, extra characters', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode(' 12-34-56 ')).toBe('123456');
    expect(normaliseCode('1234567')).toBe('123456');
    expect(normaliseCode('abc')).toBe('');
  });
});

describe('connection panel', () => {
  const base: LinkDiagnostics = { online: true, relays: 7, relayTotal: 10, found: false, link: 'none' };

  it('blames the device that is offline first', () => {
    const d = describeLink({ ...base, online: false }, 'phone');
    expect(d.bad).toBe(true);
    expect(d.text).toMatch(/This screen is offline/);
    expect(describeLink({ ...base, online: false }, 'screen').text).toMatch(/This phone is offline/);
  });

  it('says when no pairing relay can be reached', () => {
    const d = describeLink({ ...base, relays: 0 }, 'phone');
    expect(d.bad).toBe(true);
    expect(d.text).toMatch(/0\/10/);
  });

  it('walks through waiting, linking and linked', () => {
    expect(describeLink(base, 'phone').text).toMatch(/waiting for the phone/);
    expect(describeLink({ ...base, found: true, link: 'connecting' }, 'phone').text).toMatch(/linking to the phone/);
    expect(describeLink({ ...base, found: true, link: 'connected' }, 'phone')).toEqual({ text: 'Online · Pairing relays 7/10 · phone linked', bad: false });
    expect(describeLink({ ...base, found: true, link: 'failed' }, 'screen').bad).toBe(true);
  });
});
