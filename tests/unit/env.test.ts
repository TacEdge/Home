import { describe, expect, it } from 'vitest';
import { EnvError, describeDbSsl, normaliseDbHost, parseEnv } from '@/lib/env';

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
  describe('the test time source (M5 contract §8.4)', () => {
    it('is allowed locally and in CI', () => {
      expect(parseEnv({ ...valid, HOME_TEST_TIME: 'allow' }).HOME_TEST_TIME).toBe('allow');
    });

    it('is refused in production, and on any Vercel deployment', () => {
      const prod = {
        ...valid,
        NODE_ENV: 'production',
        HOME_MAIL_TRANSPORT: 'provider',
        MAIL_API_KEY: 'k',
        MAIL_FROM: 'home@example.test',
        BETTER_AUTH_URL: 'https://home.example.test',
      };
      expect(() => parseEnv({ ...prod, HOME_TEST_TIME: 'allow' })).toThrow(/HOME_TEST_TIME/);
      expect(() => parseEnv({ ...valid, VERCEL_ENV: 'preview', HOME_TEST_TIME: 'allow' })).toThrow(
        /HOME_TEST_TIME/,
      );
    });

    it('takes a steady home clock for the end-to-end suite, refused where the source is', () => {
      expect(
        parseEnv({ ...valid, HOME_TEST_TIME: 'allow', HOME_TEST_CLOCK: '07:03' }),
      ).toMatchObject({
        HOME_TEST_CLOCK: '07:03',
      });
      expect(() => parseEnv({ ...valid, HOME_TEST_CLOCK: '7:03' })).toThrow(EnvError);
      expect(() => parseEnv({ ...valid, VERCEL_ENV: 'preview', HOME_TEST_CLOCK: '07:03' })).toThrow(
        /HOME_TEST_TIME/,
      );
    });

    it('accepts only the value allow', () => {
      expect(() => parseEnv({ ...valid, HOME_TEST_TIME: 'yes' })).toThrow(EnvError);
    });
  });

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

  describe('preview/production database isolation (§1.4)', () => {
    const prodHost = 'ep-prod.ap-southeast-2.aws.neon.tech';
    const devHost = 'ep-dev.ap-southeast-2.aws.neon.tech';
    const url = (host: string) => `postgres://home_app:pw@${host}/neondb?sslmode=verify-full`;

    it('preview refuses the production database host', () => {
      expect(() =>
        parseEnv({
          ...valid,
          VERCEL_ENV: 'preview',
          HOME_PRODUCTION_DB_HOST: prodHost,
          DATABASE_URL: url(prodHost),
        }),
      ).toThrow(/DATABASE_URL/);
    });

    it('preview requires HOME_PRODUCTION_DB_HOST', () => {
      expect(() =>
        parseEnv({ ...valid, VERCEL_ENV: 'preview', DATABASE_URL: url(devHost) }),
      ).toThrow(/HOME_PRODUCTION_DB_HOST/);
    });

    it('preview accepts a different host', () => {
      expect(() =>
        parseEnv({
          ...valid,
          VERCEL_ENV: 'preview',
          HOME_PRODUCTION_DB_HOST: prodHost,
          DATABASE_URL: url(devHost),
        }),
      ).not.toThrow();
    });

    it('production accepts its own host', () => {
      expect(() =>
        parseEnv({
          ...valid,
          VERCEL_ENV: 'production',
          HOME_PRODUCTION_DB_HOST: prodHost,
          DATABASE_URL: url(prodHost),
        }),
      ).not.toThrow();
    });

    it('production refuses a mismatched host', () => {
      expect(() =>
        parseEnv({
          ...valid,
          VERCEL_ENV: 'production',
          HOME_PRODUCTION_DB_HOST: prodHost,
          DATABASE_URL: url(devHost),
        }),
      ).toThrow(/DATABASE_URL/);
    });

    it('never echoes the URL or password', () => {
      try {
        parseEnv({
          ...valid,
          VERCEL_ENV: 'preview',
          HOME_PRODUCTION_DB_HOST: prodHost,
          DATABASE_URL: url(prodHost),
        });
        expect.unreachable();
      } catch (e) {
        expect((e as Error).message).not.toContain('pw@');
        expect((e as Error).message).not.toContain(prodHost);
      }
    });

    describe('Neon pooled/direct endpoint forms are the same database', () => {
      const direct = 'ep-example.ap-southeast-2.aws.neon.tech';
      const pooled = 'ep-example-pooler.ap-southeast-2.aws.neon.tech';
      const other = 'ep-other.ap-southeast-2.aws.neon.tech';

      it('preview refuses: production host direct, DATABASE_URL pooled', () => {
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'preview',
            HOME_PRODUCTION_DB_HOST: direct,
            DATABASE_URL: url(pooled),
          }),
        ).toThrow(/DATABASE_URL/);
      });

      it('preview refuses: production host pooled, DATABASE_URL direct', () => {
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'preview',
            HOME_PRODUCTION_DB_HOST: pooled,
            DATABASE_URL: url(direct),
          }),
        ).toThrow(/DATABASE_URL/);
      });

      it('preview accepts a genuinely different Neon endpoint, pooled or direct', () => {
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'preview',
            HOME_PRODUCTION_DB_HOST: direct,
            DATABASE_URL: url(other),
          }),
        ).not.toThrow();
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'preview',
            HOME_PRODUCTION_DB_HOST: pooled,
            DATABASE_URL: url(`ep-other-pooler.ap-southeast-2.aws.neon.tech`),
          }),
        ).not.toThrow();
      });

      it('production accepts its own endpoint in either form', () => {
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'production',
            HOME_PRODUCTION_DB_HOST: direct,
            DATABASE_URL: url(pooled),
          }),
        ).not.toThrow();
      });

      it('leaves non-Neon hosts alone: "-pooler" there is just part of the name', () => {
        expect(normaliseDbHost('db-pooler.example.test')).toBe('db-pooler.example.test');
        expect(() =>
          parseEnv({
            ...valid,
            VERCEL_ENV: 'preview',
            HOME_PRODUCTION_DB_HOST: 'db.example.test',
            DATABASE_URL: url('db-pooler.example.test'),
          }),
        ).not.toThrow();
        expect(normaliseDbHost(pooled)).toBe(direct);
        expect(normaliseDbHost('EP-Example.ap-southeast-2.aws.neon.tech')).toBe(direct);
      });
    });

    it('does nothing outside Vercel', () => {
      expect(() => parseEnv({ ...valid, HOME_PRODUCTION_DB_HOST: prodHost })).not.toThrow();
    });
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

  describe('database TLS mode on Vercel', () => {
    const host = 'ep-x-pooler.ap-southeast-2.aws.neon.tech';
    const vercel = (query: string) => ({
      ...valid,
      VERCEL_ENV: 'production',
      DATABASE_URL: `postgres://home_app:pw@${host}/neondb${query}`,
    });

    it('accepts exactly one sslmode=verify-full', () => {
      expect(() => parseEnv(vercel('?sslmode=verify-full'))).not.toThrow();
    });

    it.each([
      ['require', '?sslmode=require'],
      ['prefer', '?sslmode=prefer'],
      ['verify-ca', '?sslmode=verify-ca'],
      ['no-verify', '?sslmode=no-verify'],
      ['disable', '?sslmode=disable'],
      ['an unknown value', '?sslmode=verify_full'],
      ['no sslmode', ''],
      ['a second sslmode that pg would apply instead', '?sslmode=verify-full&sslmode=require'],
      ['a duplicated verify-full', '?sslmode=verify-full&sslmode=verify-full'],
    ])('refuses %s, naming the variable and the parsed mode', (_name, query) => {
      try {
        parseEnv(vercel(query));
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(EnvError);
        expect((e as EnvError).variables).toEqual(['DATABASE_URL']);
        expect((e as Error).message).toMatch(/DATABASE_URL .*sslmode=verify-full; found sslmode=/);
        expect((e as Error).message).not.toContain(host);
        expect((e as Error).message).not.toContain('home_app');
      }
    });

    it('applies in preview deployments too', () => {
      expect(() =>
        parseEnv({
          ...vercel('?sslmode=require'),
          VERCEL_ENV: 'preview',
          HOME_PRODUCTION_DB_HOST: 'ep-prod.ap-southeast-2.aws.neon.tech',
        }),
      ).toThrow(/DATABASE_URL .*sslmode=verify-full/);
    });

    it('does not apply off Vercel (local databases have no sslmode)', () => {
      expect(() =>
        parseEnv({ ...valid, DATABASE_URL: 'postgres://home:home@localhost:5432/home' }),
      ).not.toThrow();
      expect(() =>
        parseEnv({ ...valid, DATABASE_URL: `postgres://u:p@${host}/db?sslmode=require` }),
      ).not.toThrow();
    });
  });
});

describe('describeDbSsl', () => {
  const user = 'secretuser';
  const password = 'hunter2-secret-password';
  const host = 'ep-secret-host.ap-southeast-2.aws.neon.tech';
  const database = 'secretdb';
  const url = (query: string) => `postgres://${user}:${password}@${host}:5432/${database}${query}`;

  it.each([
    ['?sslmode=verify-full', 'verify-full', 1],
    ['?sslmode=require', 'require', 1],
    ['?sslmode=prefer&foo=bar', 'prefer', 1],
    ['?sslmode=verify-full&sslmode=require', 'require', 2],
    ['?sslmode=require&sslmode=verify-full', 'verify-full', 2],
    ['', 'absent', 0],
    ['?foo=bar', 'absent', 0],
    ['?sslmode=verify_full', 'unrecognised', 1],
    ['?sslmode=VERIFY-FULL', 'unrecognised', 1],
    ['?sslmode=verify-full%20', 'unrecognised', 1],
  ])('%s → sslmode=%s, %i occurrence(s)', (query, sslmode, occurrences) => {
    expect(describeDbSsl(url(query))).toEqual({ sslmode, occurrences });
  });

  it('reports an unparseable string without echoing it', () => {
    expect(describeDbSsl('not a url ' + password)).toEqual({
      sslmode: 'unparseable',
      occurrences: 0,
    });
  });

  it('never contains the username, password, hostname or database, whatever sslmode holds', () => {
    // Includes an sslmode value that *is* a credential-shaped string: the
    // report must still say only `unrecognised`.
    const queries = [
      '?sslmode=verify-full',
      '?sslmode=require',
      '',
      `?sslmode=${password}`,
      `?sslmode=${host}`,
      `?sslmode=${user}@${host}`,
    ];
    for (const query of queries) {
      const text = JSON.stringify(describeDbSsl(url(query)));
      for (const secret of [user, password, host, database, 'neon', '5432']) {
        expect(text, `report for ${query.replace(password, '<pw>')}`).not.toContain(secret);
      }
    }
  });

  it('only ever reports a value from the fixed vocabulary', () => {
    const vocabulary = new Set([
      'disable',
      'allow',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
      'no-verify',
      'absent',
      'unrecognised',
      'unparseable',
    ]);
    for (const value of [
      'verify-full',
      'require',
      'x',
      password,
      '',
      'require%20',
      'require&a=b',
    ]) {
      expect(vocabulary.has(describeDbSsl(url(`?sslmode=${value}`)).sslmode)).toBe(true);
    }
  });
});
