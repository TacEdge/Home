import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The M0 prototype is retired (ROADMAP M6, ADR 0009 §32): `/prototype` is
// deleted, the tag `m0.6-prototype` keeps it, and nothing that builds,
// lints, formats or deploys HOME still names it. Restoring it, or leaving a
// stale exclusion behind, fails here.

describe('the M0 prototype is retired', () => {
  it('the /prototype directory is gone', () => {
    expect(existsSync('prototype')).toBe(false);
  });

  it.each([
    'eslint.config.mjs',
    'tsconfig.json',
    'tsconfig.test.json',
    '.prettierignore',
    '.vercelignore',
  ])('%s no longer excludes it', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/\bprototype\b/);
  });

  it('no application source names it', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const named = walk('src').filter((f) => /['"`/]prototype\//.test(readFileSync(f, 'utf8')));
    expect(named).toEqual([]);
  });
});
