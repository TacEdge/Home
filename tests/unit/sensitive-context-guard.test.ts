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

describe('sensitive context is never opted into automatically', () => {
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
