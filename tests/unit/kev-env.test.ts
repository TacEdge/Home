import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError, kevBootStatus, kevConfig, parseEnv } from '@/lib/env';
import { register } from '@/instrumentation';

// Kev's settings and boot line (M8 contract §1.3, §13.4, §14; matrix rows
// N2, N3, S10, L10). A synthetic, test-only key: never a real-looking one.
const KEY = 'test-only-not-a-key';

const secret = 'x'.repeat(48);
const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://home:home@localhost:5432/home',
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'http://localhost:3000',
  HOME_ALLOWED_EMAILS: 'sam@example.test',
  HOME_MAIL_TRANSPORT: 'test',
  AUDIT_HASH_SECRET: secret,
};
const prod = {
  ...valid,
  NODE_ENV: 'production',
  HOME_MAIL_TRANSPORT: 'provider',
  MAIL_API_KEY: 'k',
  MAIL_FROM: 'home@example.test',
  BETTER_AUTH_URL: 'https://home.example.test',
};

describe('HOME_KEV and HOME_KEV_MONTHLY_CAP_NZD', () => {
  it('HOME_KEV defaults to off; only on/off are accepted', () => {
    expect(parseEnv(valid).HOME_KEV).toBe('off');
    expect(parseEnv({ ...valid, HOME_KEV: 'on' }).HOME_KEV).toBe('on');
    expect(() => parseEnv({ ...valid, HOME_KEV: 'yes' })).toThrow(/HOME_KEV/);
  });

  it('L10: unset, 0, 120 and 300 are accepted; abc, 301, 12.5, 050 and -1 refused at boot', () => {
    expect(parseEnv(valid).HOME_KEV_MONTHLY_CAP_NZD).toBeUndefined();
    expect(parseEnv({ ...valid, HOME_KEV_MONTHLY_CAP_NZD: '0' }).HOME_KEV_MONTHLY_CAP_NZD).toBe(0);
    expect(parseEnv({ ...valid, HOME_KEV_MONTHLY_CAP_NZD: '120' }).HOME_KEV_MONTHLY_CAP_NZD).toBe(
      120,
    );
    expect(parseEnv({ ...valid, HOME_KEV_MONTHLY_CAP_NZD: '300' }).HOME_KEV_MONTHLY_CAP_NZD).toBe(
      300,
    );
    for (const bad of ['abc', '301', '12.5', '050', '-1', '', ' 100'])
      expect(() => parseEnv({ ...valid, HOME_KEV_MONTHLY_CAP_NZD: bad }), bad).toThrow(
        /HOME_KEV_MONTHLY_CAP_NZD/,
      );
  });

  it('the key is never held on env, and an error never carries a value', () => {
    const env = parseEnv({ ...valid, HOME_KEV_PROVIDER_KEY: KEY });
    expect(JSON.stringify(env)).not.toContain(KEY);
    try {
      parseEnv({ ...valid, HOME_KEV_MONTHLY_CAP_NZD: 'abc', HOME_KEV_PROVIDER_KEY: KEY });
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect(String((e as Error).message)).not.toContain(KEY);
      expect(String((e as Error).message)).not.toContain('abc');
    }
  });
});

describe('N3: HOME_TEST_KEV=scripted is for local and CI only', () => {
  it('is accepted locally', () => {
    expect(parseEnv({ ...valid, HOME_TEST_KEV: 'scripted' }).HOME_TEST_KEV).toBe('scripted');
  });

  it('is refused at boot on Vercel (any environment) and under NODE_ENV=production', () => {
    for (const source of [
      { ...valid, VERCEL_ENV: 'preview' },
      { ...valid, VERCEL_ENV: 'development' },
      { ...valid, VERCEL: '1' },
      prod,
    ])
      expect(() => parseEnv({ ...source, HOME_TEST_KEV: 'scripted' })).toThrow(/HOME_TEST_KEV/);
  });
});

describe('kevConfig and the boot line', () => {
  it('off by default; scripted with HOME_KEV=on locally; the key gives `on`', () => {
    expect(kevConfig({})).toEqual({ status: 'off' });
    expect(kevConfig({ HOME_KEV: 'off', HOME_KEV_PROVIDER_KEY: KEY })).toEqual({ status: 'off' });
    expect(kevConfig({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted' })).toEqual({
      status: 'scripted',
    });
    // Scripted wins over a key: tests and CI never call the provider.
    expect(
      kevConfig({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted', HOME_KEV_PROVIDER_KEY: KEY }),
    ).toEqual({ status: 'scripted' });
    expect(kevConfig({ HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: KEY })).toEqual({
      status: 'on',
      key: KEY,
    });
  });

  it('N2: HOME_KEV=on with no HOME_KEV_PROVIDER_KEY and ANTHROPIC_API_KEY set is `no key`; ANTHROPIC_* never read', () => {
    const reads: string[] = [];
    const source = new Proxy(
      {
        HOME_KEV: 'on',
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_AUTH_TOKEN: KEY,
        ANTHROPIC_BASE_URL: 'https://example.test',
      } as Record<string, string | undefined>,
      {
        get(target, prop) {
          reads.push(String(prop));
          return target[String(prop)];
        },
      },
    );
    expect(kevConfig(source)).toEqual({ status: 'no key' });
    expect(reads.filter((r) => r.startsWith('ANTHROPIC_'))).toEqual([]);
    expect(kevConfig({ HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: '   ' })).toEqual({
      status: 'no key',
    });
  });

  it('N3: scripted is off (never constructed) anywhere deployed', () => {
    expect(kevConfig({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted', VERCEL_ENV: 'preview' })).toEqual(
      { status: 'off' },
    );
    expect(
      kevConfig({ HOME_KEV: 'on', HOME_TEST_KEV: 'scripted', NODE_ENV: 'production' }),
    ).toEqual({ status: 'off' });
  });

  it('S10: Production with the gate closed, HOME_KEV=on and a key: `off (gate closed)`', () => {
    for (const gate of [undefined, '', 'OPEN', 'open ', 'true'])
      expect(
        kevConfig({
          VERCEL_ENV: 'production',
          HOME_REAL_DATA: gate,
          HOME_KEV: 'on',
          HOME_KEV_PROVIDER_KEY: KEY,
        }),
      ).toEqual({ status: 'off (gate closed)' });
    expect(
      kevConfig({
        VERCEL_ENV: 'production',
        HOME_REAL_DATA: 'open',
        HOME_KEV: 'on',
        HOME_KEV_PROVIDER_KEY: KEY,
      }),
    ).toEqual({ status: 'on', key: KEY });
    // Preview: the gate does not apply.
    expect(
      kevConfig({ VERCEL_ENV: 'preview', HOME_KEV: 'on', HOME_KEV_PROVIDER_KEY: KEY }).status,
    ).toBe('on');
  });

  it('the boot line names a status, never the key', () => {
    expect(kevBootStatus({ status: 'on', key: KEY })).toBe('on');
    expect(kevBootStatus({ status: 'off (gate closed)' })).toBe('off (gate closed)');
  });
});

describe('the boot line at server start', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('logs `kev: …` and never the key', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.HOME_KEV = 'on';
    process.env.HOME_KEV_PROVIDER_KEY = KEY;
    delete process.env.HOME_TEST_KEV;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // The runtime-role check needs a database; a failure after the boot
      // lines is fine here.
      await register().catch(() => undefined);
      const lines = log.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines).toContain('[home] kev: on');
      for (const line of lines) expect(line).not.toContain(KEY);
    } finally {
      log.mockRestore();
    }
  });
});
