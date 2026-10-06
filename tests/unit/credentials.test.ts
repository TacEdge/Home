import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normaliseCalendarAddress } from '@/lib/calendar-address';
import {
  addressFingerprint,
  CredentialError,
  credentialKeysFrom,
  fingerprintKeyFrom,
  openCredential,
  parseCredentialKey,
  parseFingerprintKey,
  requireCredentialKeys,
  requireFingerprintKey,
  sameFingerprint,
  sealCredential,
  sealedWithPreviousKey,
  type CredentialKeys,
} from '@/trust/credentials';

// Calendar credentials at rest (M4 contract §4.1, ADR 0007 §11). Synthetic
// keys and synthetic secret addresses only.

const keyText = () => randomBytes(32).toString('base64');
const keysOf = (current: string, previous?: string): CredentialKeys =>
  requireCredentialKeys(
    credentialKeysFrom({ HOME_CREDENTIALS_KEY: current, HOME_CREDENTIALS_KEY_PREVIOUS: previous }),
  );
const SECRET =
  'https://calendar.google.com/calendar/ical/synthetic.family%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics';
const BIND = { connectionId: '11111111-1111-4111-8111-111111111111', ownerUserId: 'fixture-sam' };
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof CredentialError ? e.code : `not a CredentialError: ${String(e)}`;
  }
  return 'no error';
};

describe('HOME_CREDENTIALS_KEY format', () => {
  it('accepts exactly 32 random bytes in standard base64', () => {
    expect(() => parseCredentialKey(keyText())).not.toThrow();
  });
  it.each([
    ['empty', ''],
    ['too short', randomBytes(16).toString('base64')],
    ['too long', randomBytes(48).toString('base64')],
    ['base64url, not base64', randomBytes(32).toString('base64url')],
    ['padded with a space', ` ${keyText()}`],
    ['a trailing newline', `${keyText()}\n`],
    ['hex', randomBytes(32).toString('hex')],
    ['a placeholder', 'replace-me'],
    ['one byte repeated', Buffer.alloc(32, 7).toString('base64')],
    ['all zero', Buffer.alloc(32).toString('base64')],
  ])('refuses %s', (_name, raw) => {
    expect(codeOf(() => parseCredentialKey(raw))).toBe('key_invalid');
  });

  it('a missing or malformed key never throws: it is a state, named by variable only', () => {
    expect(credentialKeysFrom({})).toEqual({ status: 'absent' });
    expect(credentialKeysFrom({ HOME_CREDENTIALS_KEY: 'nope' })).toEqual({
      status: 'invalid',
      variable: 'HOME_CREDENTIALS_KEY',
    });
    const k = keyText();
    expect(
      credentialKeysFrom({ HOME_CREDENTIALS_KEY: k, HOME_CREDENTIALS_KEY_PREVIOUS: 'x' }),
    ).toEqual({
      status: 'invalid',
      variable: 'HOME_CREDENTIALS_KEY_PREVIOUS',
    });
    expect(
      credentialKeysFrom({ HOME_CREDENTIALS_KEY: k, HOME_CREDENTIALS_KEY_PREVIOUS: k }),
    ).toEqual({
      status: 'invalid',
      variable: 'HOME_CREDENTIALS_KEY_PREVIOUS',
    });
    expect(
      JSON.stringify(credentialKeysFrom({ HOME_CREDENTIALS_KEY: 'nope-secret' })),
    ).not.toContain('nope-secret');
    expect(codeOf(() => requireCredentialKeys({ status: 'absent' }))).toBe('key_absent');
    expect(
      codeOf(() => requireCredentialKeys({ status: 'invalid', variable: 'HOME_CREDENTIALS_KEY' })),
    ).toBe('key_invalid');
  });

  it('the test environment carries a valid synthetic key', async () => {
    const { testEnv } = await import('../env');
    expect(credentialKeysFrom(testEnv).status).toBe('ready');
  });
});

describe('sealing and opening', () => {
  const keys = keysOf(keyText());

  it('round-trips, and the sealed form carries version, key id, IV, ciphertext and tag', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    expect(sealed).toMatch(
      /^hc1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/,
    );
    expect(sealed.split('.')[1]).toBe(keys.current.id);
    expect(openCredential(keys, sealed, BIND)).toBe(SECRET);
  });

  it('never contains the address, or any long piece of it', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    expect(sealed).not.toContain('calendar.google.com');
    expect(sealed).not.toContain('0123456789abcdef');
    expect(sealed).not.toContain(Buffer.from(SECRET).toString('base64url').slice(0, 12));
  });

  it('uses a fresh IV every time: the same address seals differently', () => {
    const ivs = new Set<string>();
    const all = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const s = sealCredential(keys, SECRET, BIND);
      ivs.add(s.split('.')[2]!);
      all.add(s);
    }
    expect(ivs.size).toBe(2000);
    expect(all.size).toBe(2000);
  });

  it('does not open with another key', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    expect(codeOf(() => openCredential(keysOf(keyText()), sealed, BIND))).toBe(
      'credential_unreadable',
    );
  });

  it('does not open for another connection or another owner (bound by associated data)', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    expect(
      codeOf(() =>
        openCredential(keys, sealed, {
          ...BIND,
          connectionId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toBe('credential_unreadable');
    expect(
      codeOf(() => openCredential(keys, sealed, { ...BIND, ownerUserId: 'fixture-alex' })),
    ).toBe('credential_unreadable');
    // No ambiguity from joining fields: shifting a character between them is another binding.
    expect(
      codeOf(() =>
        openCredential(keys, sealed, {
          connectionId: `${BIND.connectionId}f`,
          ownerUserId: BIND.ownerUserId.slice(1),
        }),
      ),
    ).toBe('credential_unreadable');
  });

  it('refuses any single changed character in any part, and any malformed value', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    const parts = sealed.split('.');
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!;
      for (const at of [0, Math.floor(part.length / 2), part.length - 1]) {
        const flipped = part[at] === 'A' ? 'B' : 'A';
        const changed = [...parts];
        changed[p] = part.slice(0, at) + flipped + part.slice(at + 1);
        const tampered = changed.join('.');
        if (tampered === sealed) continue;
        expect(
          codeOf(() => openCredential(keys, tampered, BIND)),
          `part ${p} at ${at}`,
        ).toBe('credential_unreadable');
      }
    }
    for (const bad of [
      '',
      'hc1',
      'hc2.' + parts.slice(1).join('.'),
      `${sealed}.extra`,
      parts.slice(0, 4).join('.'),
    ])
      expect(
        codeOf(() => openCredential(keys, bad, BIND)),
        bad,
      ).toBe('credential_unreadable');
  });

  it('refuses an empty or oversized credential', () => {
    expect(codeOf(() => sealCredential(keys, '', BIND))).toBe('credential_too_long');
    expect(codeOf(() => sealCredential(keys, 'x'.repeat(4097), BIND))).toBe('credential_too_long');
  });

  it('errors are a fixed code: no address, ciphertext or key in the message or JSON', () => {
    const sealed = sealCredential(keys, SECRET, BIND);
    try {
      openCredential(keysOf(keyText()), sealed, BIND);
    } catch (e) {
      const text = `${String(e)} ${(e as Error).stack} ${JSON.stringify(e)}`;
      expect((e as Error).message).toBe('credential_unreadable');
      for (const part of sealed.split('.').slice(2)) expect(text).not.toContain(part);
      expect(text).not.toContain('calendar.google.com');
    }
  });
});

describe('rotation', () => {
  it('opens what the previous key sealed, seals only with the current key, and says what to reseal', () => {
    const old = keyText();
    const before = keysOf(old);
    const sealedOld = sealCredential(before, SECRET, BIND);
    const during = keysOf(keyText(), old);
    expect(openCredential(during, sealedOld, BIND)).toBe(SECRET);
    expect(sealedWithPreviousKey(during, sealedOld)).toBe(true);
    const resealed = sealCredential(during, openCredential(during, sealedOld, BIND), BIND);
    expect(resealed.split('.')[1]).toBe(during.current.id);
    expect(sealedWithPreviousKey(during, resealed)).toBe(false);
    // Once the previous key is removed, what it sealed no longer opens.
    expect(codeOf(() => openCredential(keysOf(keyText()), sealedOld, BIND))).toBe(
      'credential_unreadable',
    );
  });
});

describe('address fingerprint (HOME_FINGERPRINT_KEY, ADR 0007 §34)', () => {
  const fpKey = keyText();
  const key = parseFingerprintKey(fpKey);
  const fp = (a: string, k = key) => addressFingerprint(k, normaliseCalendarAddress(a));

  it('is stable for the same address in any accepted spelling', () => {
    const webcal = SECRET.replace('https://', 'webcal://');
    const upperHost = SECRET.replace('calendar.google.com', 'CALENDAR.Google.com');
    const portful = SECRET.replace('calendar.google.com', 'calendar.google.com:443');
    expect(fp(webcal)).toBe(fp(SECRET));
    expect(fp(upperHost)).toBe(fp(SECRET));
    expect(fp(portful)).toBe(fp(SECRET));
    expect(fp(`  ${SECRET}  `)).toBe(fp(SECRET));
    expect(sameFingerprint(fp(webcal), fp(SECRET))).toBe(true);
  });

  it('differs for a different address, and when the fingerprint key changes', () => {
    const other = SECRET.replace('private-0123456789abcdef', 'private-fedcba9876543210');
    expect(fp(other)).not.toBe(fp(SECRET));
    expect(sameFingerprint(fp(other), fp(SECRET))).toBe(false);
    expect(fp(SECRET, parseFingerprintKey(keyText()))).not.toBe(fp(SECRET));
  });

  it('is unchanged by rotating HOME_CREDENTIALS_KEY: the sealing key plays no part', () => {
    const before = keyText();
    const after = keyText();
    const env = (credentials: string, previous?: string) =>
      requireFingerprintKey(
        fingerprintKeyFrom({
          HOME_FINGERPRINT_KEY: fpKey,
          HOME_CREDENTIALS_KEY: credentials,
          HOME_CREDENTIALS_KEY_PREVIOUS: previous,
        }),
      );
    const original = fp(SECRET, env(before));
    // During the rotation, and after the previous key is removed.
    expect(fp(SECRET, env(after, before))).toBe(original);
    expect(fp(SECRET, env(after))).toBe(original);
    expect(original).toBe(fp(SECRET));
  });

  it('carries nothing of the address and is a fixed-size keyed hash, version 2', () => {
    const f = fp(SECRET);
    expect(f).toMatch(/^fp2\.[A-Za-z0-9_-]{43}$/);
    expect(f).not.toContain('google');
    expect(f).not.toContain('0123456789abcdef');
    // The database accepts it (migration 0007's calendar_connection_fingerprint_check).
    expect(f.length).toBeLessThanOrEqual(128);
    expect(f).toMatch(/^fp[0-9]+\.[A-Za-z0-9_-]{16,}$/);
  });
});

describe('HOME_FINGERPRINT_KEY format and state', () => {
  it.each([
    ['empty', ''],
    ['too short', randomBytes(16).toString('base64')],
    ['base64url, not base64', randomBytes(32).toString('base64url')],
    ['a placeholder', 'replace-me'],
    ['one byte repeated', Buffer.alloc(32, 7).toString('base64')],
  ])('refuses %s', (_name, raw) => {
    expect(codeOf(() => parseFingerprintKey(raw))).toBe('fingerprint_key_invalid');
  });

  it('is a state, never a throw: absent, invalid, or the same as a sealing key', () => {
    const k = keyText();
    expect(fingerprintKeyFrom({})).toEqual({ status: 'absent' });
    expect(fingerprintKeyFrom({ HOME_FINGERPRINT_KEY: 'nope-secret' })).toEqual({
      status: 'invalid',
    });
    // Separate key material: reusing the sealing key (current or previous) is refused.
    expect(fingerprintKeyFrom({ HOME_FINGERPRINT_KEY: k, HOME_CREDENTIALS_KEY: k }).status).toBe(
      'invalid',
    );
    expect(
      fingerprintKeyFrom({
        HOME_FINGERPRINT_KEY: k,
        HOME_CREDENTIALS_KEY: keyText(),
        HOME_CREDENTIALS_KEY_PREVIOUS: k,
      }).status,
    ).toBe('invalid');
    expect(
      fingerprintKeyFrom({ HOME_FINGERPRINT_KEY: k, HOME_CREDENTIALS_KEY: keyText() }).status,
    ).toBe('ready');
    expect(
      JSON.stringify(fingerprintKeyFrom({ HOME_FINGERPRINT_KEY: 'nope-secret' })),
    ).not.toContain('nope-secret');
    expect(codeOf(() => requireFingerprintKey({ status: 'absent' }))).toBe(
      'fingerprint_key_absent',
    );
    expect(codeOf(() => requireFingerprintKey({ status: 'invalid' }))).toBe(
      'fingerprint_key_invalid',
    );
  });

  it('the test environment has a valid fingerprint key, separate from the sealing key', async () => {
    const { testEnv } = await import('../env');
    expect(fingerprintKeyFrom(testEnv).status).toBe('ready');
    expect(testEnv.HOME_FINGERPRINT_KEY).not.toBe(testEnv.HOME_CREDENTIALS_KEY);
  });
});
