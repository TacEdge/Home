import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The sensitive-context invariant (ADR 0005 §37, CLAUDE.md rule 6): sensitive
// context is left out of every default read and every automatic or
// proactive use (Kev context assembly, Today, Forward, Week Ahead,
// insights). It is returned only when a person explicitly asks. So no
// application code may opt in on its own: `includeSensitive` set to true,
// or the raw sensitivity filter switched off, appears only in the context
// service and the trust predicate that define it. A future screen that lets
// a person ask must be added here deliberately, with its decision.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const ALLOWED = [
  join('src', 'domain', 'context', 'service.ts'),
  join('src', 'trust', 'visibility.ts'),
];

/**
 * Screens where a person explicitly asks for sensitive context, each with
 * its decision. Nothing else may even name the option.
 */
const PERSON_ASKS: Record<string, string> = {
  // The export's unticked "Include sensitive items" (ADR 0006 §6).
  [join('src', 'domain', 'export', 'service.ts')]: 'ADR 0006 §6',
  [join('src', 'app', '(home)', 'settings', 'export', 'download', 'route.ts')]: 'ADR 0006 §6',
  [join('src', 'app', '(home)', 'settings', 'export', 'page.tsx')]:
    'ADR 0006 §6 (the unticked box)',
  // What Kev knows: "Show sensitive items", a press, for that response only (ADR 0006 §55).
  [join('src', 'app', '(home)', 'settings', 'knows', 'actions.ts')]: 'ADR 0006 §55',
};

describe('sensitive context is never opted into automatically', () => {
  it('only the reviewed person-asks call sites mention includeSensitive at all', () => {
    const named = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !ALLOWED.includes(f))
      .filter((f) => /includeSensitive/.test(readFileSync(f, 'utf8')));
    expect(named.sort()).toEqual(Object.keys(PERSON_ASKS).sort());
  });

  it('the export asks only when the person ticks the box, never by default', () => {
    const route = readFileSync(
      join('src', 'app', '(home)', 'settings', 'export', 'download', 'route.ts'),
      'utf8',
    );
    expect(route).toMatch(/includeSensitive = form\?\.get\('includeSensitive'\) === 'on'/);
    const service = readFileSync(join('src', 'domain', 'export', 'service.ts'), 'utf8');
    expect(service).toMatch(/const includeSensitive = opts\.includeSensitive === true;/);
    const page = readFileSync(
      join('src', 'app', '(home)', 'settings', 'export', 'page.tsx'),
      'utf8',
    );
    expect(page).not.toMatch(/defaultChecked/);
  });

  it('no application code asks for sensitive context outside its own service', () => {
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !ALLOWED.includes(f))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return (
          /includeSensitive\s*:\s*(true|!)/.test(src) ||
          /sensitivityFilter\([^)]*,\s*true\s*\)/.test(src) ||
          /readableBy\([^)]*includeSensitive/.test(src)
        );
      });
    expect(offenders).toEqual([]);
  });

  it('Kev has no way in: nothing under src/kev reads context with sensitivity options', () => {
    const kev = (() => {
      try {
        return walk(join('src', 'kev'));
      } catch {
        return [];
      }
    })();
    expect(kev.filter((f) => /includeSensitive/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
