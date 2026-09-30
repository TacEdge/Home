import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '@/lib/env';

const secret = 'x'.repeat(48);
const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://home:home@localhost:5432/home',
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'http://localhost:3000',
  HOME_ALLOWED_EMAILS: 'sam@example.test, Alex@Example.test',
  HOME_MAIL_TRANSPORT: 'test',
  AUDIT_HASH_SECRET: secret,
};

describe('parseEnv', () => {
  it('parses a valid development environment', () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.HOME_TIMEZONE).toBe('Pacific/Auckland');
  });

  it('normalises the allowlist: trims, lower-cases, drops empties', () => {
    const env = parseEnv({
      ...valid,
      HOME_ALLOWED_EMAILS: ' sam@example.test ,, ALEX@example.test ',
    });
    expect(env.HOME_ALLOWED_EMAILS).toEqual(['sam@example.test', 'alex@example.test']);
  });

  it.each([
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'HOME_ALLOWED_EMAILS',
    'HOME_MAIL_TRANSPORT',
    'AUDIT_HASH_SECRET',
  ])('fails naming %s when it is missing', (name) => {
    const source: Record<string, string | undefined> = { ...valid };
    delete source[name];
    expect(() => parseEnv(source)).toThrow(EnvError);
    try {
      parseEnv(source);
    } catch (e) {
      expect((e as EnvError).variables).toContain(name);
      expect((e as Error).message).toContain(name);
    }
  });

  it('never includes a variable value in the error message', () => {
    const source = { ...valid, BETTER_AUTH_SECRET: 'tooshort-secret-value' };
    try {
      parseEnv(source);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('BETTER_AUTH_SECRET');
      expect((e as Error).message).not.toContain('tooshort-secret-value');
    }
  });

  it('rejects secrets shorter than 32 bytes', () => {
    expect(() => parseEnv({ ...valid, AUDIT_HASH_SECRET: 'short' })).toThrow(/AUDIT_HASH_SECRET/);
  });

  it('rejects an empty allowlist', () => {
    expect(() => parseEnv({ ...valid, HOME_ALLOWED_EMAILS: ' , ' })).toThrow(/HOME_ALLOWED_EMAILS/);
  });

  describe('in production', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://home.example.test',
      HOME_MAIL_TRANSPORT: 'provider',
      MAIL_API_KEY: 'k'.repeat(20),
      MAIL_FROM: 'home@auth.example.test',
    };

    it('accepts a complete production environment', () => {
      expect(() => parseEnv(prod)).not.toThrow();
    });

    it('refuses the test mail transport', () => {
      expect(() => parseEnv({ ...prod, HOME_MAIL_TRANSPORT: 'test' })).toThrow(
        /HOME_MAIL_TRANSPORT/,
      );
    });

    it('refuses a non-https auth URL', () => {
      expect(() => parseEnv({ ...prod, BETTER_AUTH_URL: 'http://home.example.test' })).toThrow(
        /BETTER_AUTH_URL/,
      );
    });

    it('requires mail credentials when using the provider transport', () => {
      expect(() => parseEnv({ ...prod, MAIL_API_KEY: undefined })).toThrow(/MAIL_API_KEY/);
    });
  });
});
