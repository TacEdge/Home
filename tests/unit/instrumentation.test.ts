import { afterEach, describe, expect, it } from 'vitest';
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

  it('does nothing outside the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.BETTER_AUTH_SECRET;
    await expect(register()).resolves.toBeUndefined();
  });
});
