import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError } from '@/lib/env';
import { register } from '@/instrumentation';

// Server-start validation (contract §2.6): a bad environment throws at boot.

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe('instrumentation.register', () => {
  it('throws EnvError when a required variable is missing', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.BETTER_AUTH_SECRET;
    await expect(register()).rejects.toThrow(EnvError);
    await expect(register()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it('logs the parsed database TLS mode and nothing else from DATABASE_URL', async () => {
    const user = 'secretuser';
    const password = 'hunter2-secret-password';
    const host = 'ep-secret-host.ap-southeast-2.aws.neon.tech';
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.DATABASE_URL = `postgres://${user}:${password}@${host}/secretdb?sslmode=require`;
    // A missing secret makes register() stop before it opens a connection.
    delete process.env.BETTER_AUTH_SECRET;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(register()).rejects.toThrow(EnvError);
      const lines = log.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines).toContain('[home] database tls: sslmode=require (1 occurrence(s))');
      for (const line of lines)
        for (const secret of [user, password, host, 'secretdb']) expect(line).not.toContain(secret);
    } finally {
      log.mockRestore();
    }
  });

  it('does nothing outside the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.BETTER_AUTH_SECRET;
    await expect(register()).resolves.toBeUndefined();
  });
});
