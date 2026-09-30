import { describe, expect, it } from 'vitest';
import { REDACTED_KEYS, createLogger, redact } from '@/lib/log';

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
