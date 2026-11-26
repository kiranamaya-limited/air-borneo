import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, makeCode, normaliseCode } from '../src/net/protocol';
import { describeLink, type LinkDiagnostics } from '../src/net/link';
import { Dedupe, isEnvelope, topics } from '../src/net/mqtt';

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

describe('relay path', () => {
  it('handles each message once, whichever path or broker it arrives on', () => {
    const d = new Dedupe();
    expect(d.fresh({ f: 'phone', i: 1 })).toBe(true);
    expect(d.fresh({ f: 'phone', i: 1 })).toBe(false);
    expect(d.fresh({ f: 'other-phone', i: 1 })).toBe(true);
    for (let i = 2; i < 1000; i++) expect(d.fresh({ f: 'phone', i })).toBe(true);
    expect(d.fresh({ f: 'phone', i: 999 })).toBe(false);
  });

  it('only accepts well-formed envelopes', () => {
    expect(isEnvelope({ f: 'a', i: 0, m: { t: 'bye' } })).toBe(true);
    expect(isEnvelope({ t: 'input' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });

  it('uses one topic each way per pairing code', () => {
    const t = topics('123456');
    expect(t.toScreen).not.toBe(t.toPhone);
    expect(t.toScreen).toContain('123456');
    expect(topics('654321').toScreen).not.toBe(t.toScreen);
  });
});

describe('connection panel', () => {
  const base: LinkDiagnostics = { online: true, relays: 7, relayTotal: 10, brokers: 2, brokerTotal: 3, found: false, link: 'none', path: 'none' };

  it('blames the device that is offline first', () => {
    const d = describeLink({ ...base, online: false }, 'phone');
    expect(d.bad).toBe(true);
    expect(d.text).toMatch(/This screen is offline/);
    expect(describeLink({ ...base, online: false }, 'screen').text).toMatch(/This phone is offline/);
  });

  it('says when nothing can be reached', () => {
    const d = describeLink({ ...base, relays: 0, brokers: 0 }, 'phone');
    expect(d.bad).toBe(true);
    expect(d.text).toMatch(/0\/10/);
  });

  it('is fine with relays down as long as a broker works', () => {
    expect(describeLink({ ...base, relays: 0 }, 'phone').bad).toBe(false);
  });

  it('walks through waiting, linking and linked, and says which path', () => {
    expect(describeLink(base, 'phone').text).toMatch(/waiting for the phone/);
    expect(describeLink({ ...base, found: true, link: 'connecting' }, 'phone').text).toMatch(/linking to the phone/);
    expect(describeLink({ ...base, found: true, link: 'connected', path: 'direct' }, 'phone')).toEqual({ text: 'Online · Relays 7/10 · Brokers 2/3 · phone linked directly', bad: false });
    expect(describeLink({ ...base, found: true, link: 'connected', path: 'relay' }, 'screen').text).toMatch(/screen linked via relay/);
    expect(describeLink({ ...base, found: true, link: 'failed' }, 'screen').bad).toBe(true);
  });
});
