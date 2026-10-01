import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract §2.8: the home time zone comes from HOME_TIMEZONE. The only place
// the default may be written is lib/env.ts.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('time zone configuration', () => {
  it('hard-codes Pacific/Auckland nowhere in src/ except the env default', () => {
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('Pacific/Auckland'));
    expect(offenders).toEqual(['src/lib/env.ts']);
  });
});
