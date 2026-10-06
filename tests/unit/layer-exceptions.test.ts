import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The one layer exception (ADR 0007 §42): app may import the calendar
// composition root, @/integrations/calendar/entry, and nothing else in
// integrations; the root exposes only provider-free operations.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const IMPORT = /from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

describe('app → integrations', () => {
  it('app imports nothing from integrations but the calendar entry point', () => {
    const found = walk('src/app')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(IMPORT)]
          .map((m) => m[1] ?? m[2] ?? '')
          .filter((s) => /(^@\/|\/src\/)integrations(\/|$)/.test(s))
          .map((s) => `${f}: ${s}`),
      );
    for (const f of found) expect(f).toMatch(/: @\/integrations\/calendar\/entry$/);
  });

  it('the lint rule allows exactly the entry point and refuses every other integrations import', async () => {
    const eslint = new ESLint();
    const lint = async (spec: string) => {
      const [r] = await eslint.lintText(`import * as x from '${spec}';\nexport const y = x;\n`, {
        filePath: 'src/app/zz-layer-probe.ts',
      });
      return (r?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
    };
    expect(await lint('@/integrations/calendar/entry')).toBe(0);
    for (const spec of [
      '@/integrations/calendar/ics/provider',
      '@/integrations/calendar/fake',
      '@/integrations/net/safe-fetch',
      '@/integrations/calendar',
      '@/integrations/calendar/entry/more',
    ])
      expect(await lint(spec), spec).toBe(1);
  }, 60_000);

  it('the entry point exposes only provider-free operations', async () => {
    const text = readFileSync('src/integrations/calendar/entry.ts', 'utf8');
    const exported = [...text.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(['refreshCalendarNow', 'refreshStaleCalendarsNow']);
    expect(text).not.toMatch(/^export (const|type|class|\{)/m);
  });

  it('domain never imports integrations', () => {
    for (const f of walk('src/domain').filter((x) => /\.(ts|tsx)$/.test(x)))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /from\s+['"](@\/integrations|.*\/integrations\/)/,
      );
  });
});
