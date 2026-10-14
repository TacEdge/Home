import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// N1 (M8 contract §4.3, §15.1): `@anthropic-ai/sdk` is imported only by
// src/kev/providers/anthropic.ts, and ESLint refuses a planted import
// anywhere else, subpaths included. And S13's source half: everything in
// src/kev and the bookkeeping path is server-only, so no client component
// can import a model id, a key or a provider response.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const ADAPTER = join('src/kev/providers/anthropic.ts');
const SDK = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@anthropic-ai\/sdk(?:\/[^'"]*)?['"]/;

describe('N1: the SDK import', () => {
  it('only the adapter imports @anthropic-ai/sdk, in src, tests and scripts', () => {
    const files = ['src', 'tests', 'scripts']
      .flatMap(walk)
      .filter((f) => /\.(ts|tsx|mts|js|mjs|cjs)$/.test(f));
    const importers = files.filter((f) => SDK.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([ADAPTER]);
  });

  it('ESLint refuses a planted import anywhere but the adapter, subpaths included', async () => {
    const eslint = new ESLint();
    const lint = async (filePath: string, spec: string) => {
      const [r] = await eslint.lintText(`import * as x from '${spec}';\nexport const y = x;\n`, {
        filePath,
      });
      return (r?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
    };
    for (const file of [
      'src/kev/providers/fetch.ts',
      'src/kev/providers/zz-probe.ts',
      'src/kev/zz-probe.ts',
      'src/domain/zz-probe.ts',
      'src/app/zz-probe.ts',
      'src/lib/zz-probe.ts',
    ]) {
      expect(await lint(file, '@anthropic-ai/sdk'), file).toBeGreaterThan(0);
      expect(await lint(file, '@anthropic-ai/sdk/core/error'), file).toBeGreaterThan(0);
    }
    expect(await lint(ADAPTER, '@anthropic-ai/sdk')).toBe(0);
  });
});

describe('S13: Kev is server-only', () => {
  it('every module in src/kev and the bookkeeping service imports server-only', () => {
    const files = [
      ...walk('src/kev').filter((f) => /\.(ts|tsx)$/.test(f)),
      join('src/domain/kev-bookkeeping/service.ts'),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).toMatch(/^import 'server-only';$/m);
  });

  it('nothing under src/app or src/ui imports src/kev yet (no route or screen until Packages 3–4)', () => {
    const files = [...walk('src/app'), ...walk('src/ui')].filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/@\/kev(\/|['"])/);
  });
});
