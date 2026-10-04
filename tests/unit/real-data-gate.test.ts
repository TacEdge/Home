import { describe, expect, it } from 'vitest';
import { parseEnv, realDataGateOpen } from '@/lib/env';
import { testEnv } from '../env';

// ADR 0006 §2, M3 contract §6: fail-closed in Production, exact `open` only.

describe('realDataGateOpen', () => {
  it.each([undefined, 'preview', 'development'])(
    'does not apply outside Vercel Production (VERCEL_ENV=%j)',
    (vercel) => {
      for (const value of [undefined, '', 'closed', 'open'])
        expect(realDataGateOpen({ VERCEL_ENV: vercel, HOME_REAL_DATA: value })).toBe(true);
    },
  );

  it('opens in Production only for the exact value `open`', () => {
    expect(realDataGateOpen({ VERCEL_ENV: 'production', HOME_REAL_DATA: 'open' })).toBe(true);
  });

  it.each([
    undefined,
    '',
    ' ',
    'OPEN',
    'Open',
    ' open',
    'open ',
    'open\n',
    'opened',
    'true',
    '1',
    'yes',
  ])('stays closed in Production for HOME_REAL_DATA=%j', (value) => {
    expect(realDataGateOpen({ VERCEL_ENV: 'production', HOME_REAL_DATA: value })).toBe(false);
  });

  it('never fails boot: any HOME_REAL_DATA value parses', () => {
    for (const value of ['', 'garbage', 'OPEN', 'open'])
      expect(() => parseEnv({ ...testEnv, HOME_REAL_DATA: value })).not.toThrow();
  });
});
