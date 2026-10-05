import { describe, expect, it } from 'vitest';
import { REDACTED_KEYS, createLogger, redact, sanitiseMessage } from '@/lib/log';

describe('redact', () => {
  it.each([...REDACTED_KEYS])('redacts key "%s" at the top level', (key) => {
    expect(redact({ [key]: 'sensitive' })).toEqual({ [key]: '[redacted]' });
  });

  it('is case-insensitive and catches suffixed keys', () => {
    expect(redact({ Email: 'a', userEmail: 'b', magicUrl: 'c', AUTHORIZATION: 'd' })).toEqual({
      Email: '[redacted]',
      userEmail: '[redacted]',
      magicUrl: '[redacted]',
      AUTHORIZATION: '[redacted]',
    });
  });

  it('redacts at depth and inside arrays', () => {
    const out = redact({ a: { b: [{ token: 't', keep: 1 }, 'plain'] }, list: [{ email: 'e' }] });
    expect(out).toEqual({
      a: { b: [{ token: '[redacted]', keep: 1 }, 'plain'] },
      list: [{ email: '[redacted]' }],
    });
  });

  it('keeps non-sensitive values and primitives', () => {
    expect(redact({ userId: 'u1', count: 3, ok: true, nothing: null })).toEqual({
      userId: 'u1',
      count: 3,
      ok: true,
      nothing: null,
    });
  });

  it('reduces errors to name and message', () => {
    expect(redact(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
  });
});

describe('createLogger', () => {
  it('writes one JSON line per event with level and event name', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    log.info('auth.sign_in', { userId: 'u1', email: 'sam@example.test' });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('auth.sign_in');
    expect(entry.userId).toBe('u1');
    expect(entry.email).toBe('[redacted]');
    expect(typeof entry.ts).toBe('string');
  });

  it('respects the minimum level', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), minLevel: 'warn' });
    log.info('x');
    log.debug('y');
    log.warn('z');
    expect(lines).toHaveLength(1);
  });

  it('child loggers carry base fields, redacted too', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) }).child({
      requestId: 'r1',
      cookie: 'c',
    });
    log.error('boom');
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.requestId).toBe('r1');
    expect(entry.cookie).toBe('[redacted]');
  });
});

describe('sanitiseMessage', () => {
  it('strips URLs (with query strings), tokens and emails from library text', () => {
    const out = sanitiseMessage(
      'Invalid callbackURL: https://x.test/a?token=abc123 for sam@example.test',
    );
    expect(out).not.toContain('x.test');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('sam@');
    expect(out).not.toContain('example.test');
    expect(out).toContain('Invalid callbackURL');
  });

  it('removes long token-like strings on their own', () => {
    const token = 'abcdefghijkl'.repeat(2); // 24 token-like chars, not a secret
    expect(sanitiseMessage(`bad token ${token} rejected`)).toBe('bad token [token] rejected');
  });

  it('truncates to 200 characters and copes with non-strings', () => {
    expect(sanitiseMessage('word '.repeat(100))).toHaveLength(200);
    expect(sanitiseMessage(undefined)).toBe('');
    expect(sanitiseMessage({ toString: () => 'obj' })).toBe('obj');
  });
});

describe('calendar credentials never reach a log line (M4 contract §4.1)', () => {
  const SECRET =
    'https://calendar.google.com/calendar/ical/synthetic%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics';
  const WEBCAL = SECRET.replace('https', 'webcal');
  const SEALED = `hc1.0123456789abcdef.${'A'.repeat(16)}.${'Bq9+/x'.repeat(10)}.${'C'.repeat(22)}`;
  const KEY = Buffer.from('home-test-credentials-key-32byte').toString('base64');
  const FINGERPRINT = `fp1.${'D'.repeat(43)}`;
  const pieces = [
    'calendar.google.com',
    'private-0123456789abcdef',
    SEALED.split('.')[3],
    KEY,
    'DDDDDDDD',
  ];

  it('under any field name a caller is likely to use, at any depth', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l) });
    log.error('calendar_refresh_failed', {
      address: SECRET,
      calendarAddress: WEBCAL,
      secretUrl: SECRET,
      feed_url: SECRET,
      credential: SEALED,
      credentialsEncrypted: SEALED,
      ciphertext: SEALED,
      sealed: SEALED,
      key: KEY,
      credentialsKey: KEY,
      fingerprint: FINGERPRINT,
      addressFingerprint: FINGERPRINT,
      nonce: 'bm9uY2Utbm9uY2Utbm9uY2U=',
      nested: { deeper: [{ address: SECRET, key: KEY }] },
    });
    for (const piece of pieces) expect(lines.join('\n'), piece).not.toContain(piece);
  });

  it('in free text a library might produce', () => {
    for (const text of [
      `fetch failed for ${SECRET}`,
      `could not open ${WEBCAL} (timeout)`,
      `bad value ${SEALED}`,
      `key ${KEY} rejected`,
    ]) {
      const out = sanitiseMessage(text);
      for (const piece of pieces) expect(out, `${text} → ${piece}`).not.toContain(piece);
    }
  });
});
