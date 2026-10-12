import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '@/instrumentation';
import {
  CHRISTCHURCH,
  LOCATION_LEAKS,
  WEATHER_VARIABLES,
  weatherEnv,
} from '../../fixtures/weather';

// The weather boot line (M7 contract §5.1, §7, §8.6 W12, W21): a status,
// never a value. The database step is stubbed: boot reaches it last.

vi.mock('@/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/db/role-check', () => ({ assertRuntimeRole: async () => undefined }));

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

async function bootLines(vars: Record<string, string>): Promise<string[]> {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, { NEXT_RUNTIME: 'nodejs', ...vars });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await register();
    return log.mock.calls.map((c) => c.map(String).join(' '));
  } finally {
    log.mockRestore();
  }
}

describe('[home] weather location: …', () => {
  it.each([
    ['set', weatherEnv(CHRISTCHURCH, { HOME_ELEVATION: '37' })],
    ['absent', {}],
    ['invalid', { HOME_LAT: '95', HOME_LON: '174.78' }],
    ['set, key missing', { ...weatherEnv(), HOME_WEATHER_LOCATION_KEY: '' }],
    [
      'set, key missing',
      { ...weatherEnv(), HOME_WEATHER_LOCATION_KEY: process.env.HOME_FINGERPRINT_KEY! },
    ],
  ])('%s', async (status, vars) => {
    const lines = await bootLines(vars);
    expect(lines.filter((l) => l.startsWith('[home] weather location:'))).toEqual([
      `[home] weather location: ${status}`,
    ]);
    const all = lines.join('\n');
    for (const leak of [...LOCATION_LEAKS, '37', '-43.53', '172.64'])
      expect(all).not.toContain(leak);
  });
});
