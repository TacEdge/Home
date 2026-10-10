import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPath, type PathClass } from '../../scripts/ci-select.mts';

// Cross-screen dependency coverage for the risk classifier (ADR 0010 §8). A
// medium change runs only the specs its rule names, so every screen that
// imports a medium file (directly, or through other code) must be covered by
// those specs; and if any importer is high-tier shared code, the file must be
// high itself. This reads the real imports under src/ on every run, so the
// map cannot drift from the code. Anything it cannot resolve fails the test:
// an unresolved local import, a dynamic import of a computed path, a require.

type Graph = { importers: Map<string, Set<string>>; uncertain: string[] };

const SPECIFIER =
  /(?:^|[;\s])(?:import|export)\s[^;]*?\sfrom\s*(['"])([^'"]+)\1|(?:^|[;\s])import\s*(['"])([^'"]+)\3|import\(\s*(['"])([^'"]+)\5\s*\)/g;

/** Local imports between source files; packages (react, next, zod…) are not followed. */
export function importGraph(sources: Map<string, string>): Graph {
  const importers = new Map<string, Set<string>>();
  const uncertain: string[] = [];
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/')
      ? `src/${spec.slice(2)}`
      : normalize(join(dirname(from), spec));
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`])
      if (sources.has(c)) return c;
    // A stylesheet or other asset named with its extension: a leaf, never a source.
    if (/\.(css|json|svg)$/.test(base) && existsSync(base)) return base;
    return null;
  };
  for (const [file, text] of sources) {
    if (/\brequire\(/.test(text)) uncertain.push(`${file}: require()`);
    if (/\bimport\(\s*[^'"\s)]/.test(text)) uncertain.push(`${file}: import() of a computed path`);
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[2] ?? m[4] ?? m[6]!;
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
      const target = resolve(file, spec);
      if (!target) {
        uncertain.push(`${file}: cannot resolve '${spec}'`);
        continue;
      }
      (importers.get(target) ?? importers.set(target, new Set()).get(target)!).add(file);
    }
  }
  return { importers, uncertain };
}

/** Every file that imports `file`, directly or through other files. */
function dependents(g: Graph, file: string): Set<string> {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length)
    for (const by of g.importers.get(queue.pop()!) ?? [])
      if (!seen.has(by)) {
        seen.add(by);
        queue.push(by);
      }
  return seen;
}

/**
 * What the classifier gets wrong for these sources: a medium file with a
 * high (or worse) dependent, or a dependent whose specs the file's selection
 * leaves out. Empty means every medium change selects every affected spec.
 */
export function coverageGaps(
  sources: Map<string, string>,
  classify: (path: string) => PathClass,
): string[] {
  const g = importGraph(sources);
  const gaps = [...g.uncertain.map((u) => `uncertain: ${u}`)];
  for (const file of sources.keys()) {
    const own = classify(file);
    if (own.tier !== 'medium') continue;
    for (const by of [...dependents(g, file)].sort()) {
      const dep = classify(by);
      if (dep.tier !== 'medium' && dep.tier !== 'low') {
        gaps.push(`${file} is imported by ${dep.tier} ${by}: it must be ${dep.tier} too`);
        continue;
      }
      const missing = dep.specs.filter((s) => !own.specs.includes(s));
      if (missing.length)
        gaps.push(`${file} is used by ${by}, but leaves out ${missing.join(', ')}`);
    }
  }
  return gaps;
}

const tracked = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.tsx?$/.test(f) && existsSync(f));
const sources = new Map(tracked.map((f) => [f, readFileSync(f, 'utf8')]));

describe('cross-screen dependency coverage (ADR 0010 §8)', () => {
  it('reads a real graph: the source is there and its imports resolve', () => {
    expect(sources.size).toBeGreaterThan(200);
    const g = importGraph(sources);
    expect(g.uncertain).toEqual([]);
    // Known edges, so an empty result can never mean the scan read nothing.
    expect(g.importers.get('src/app/(home)/sort/copy.ts')).toContain(
      'src/app/(home)/today/today-view.tsx',
    );
    expect(g.importers.get('src/app/_forms/action-form.tsx')?.size).toBeGreaterThan(10);
  });

  it('every medium file selects the specs of every screen that uses it, and none is used by high-tier code', () => {
    expect(coverageGaps(sources, classifyPath)).toEqual([]);
  });
});

describe('the coverage check catches what it guards (mutation)', () => {
  const without = (prefix: string, spec: string) => (p: string) => {
    const c = classifyPath(p);
    return p.startsWith(prefix) ? { ...c, specs: c.specs.filter((s) => s !== spec) } : c;
  };

  it('removing a cross-screen spec (To sort without Today’s specs) fails', () => {
    const gaps = coverageGaps(sources, without('src/app/(home)/sort/', 'today'));
    expect(gaps.some((g) => /sort\/copy\.ts is used by .*today.* leaves out today$/.test(g))).toBe(
      true,
    );
  });

  it('removing a calendar dependent (refresh on use without People) fails', () => {
    const gaps = coverageGaps(sources, without('src/app/_calendar/', 'people'));
    expect(gaps.some((g) => g.includes('_calendar/') && g.endsWith('leaves out people'))).toBe(
      true,
    );
  });

  it('putting shared form helpers back to medium fails: the shell imports them', () => {
    const asMedium = (p: string) =>
      p.startsWith('src/app/_forms/')
        ? { path: p, tier: 'medium' as const, reason: 'mutant', specs: ['events'] }
        : classifyPath(p);
    const gaps = coverageGaps(sources, asMedium);
    expect(
      gaps.some((g) => /_forms\/.* is imported by high src\/app\/\(home\)\/layout\.tsx/.test(g)),
    ).toBe(true);
  });

  it('an import it cannot resolve, a computed import() or a require() fails closed', () => {
    const synthetic = new Map([
      ['src/app/(home)/today/a.ts', "import { x } from './missing';\nexport const a = x;"],
      ['src/app/(home)/today/b.ts', 'const m = await import(name);'],
      ['src/app/(home)/today/c.ts', "const n = require('./a');"],
    ]);
    const gaps = coverageGaps(synthetic, classifyPath);
    expect(gaps).toEqual([
      "uncertain: src/app/(home)/today/a.ts: cannot resolve './missing'",
      'uncertain: src/app/(home)/today/b.ts: import() of a computed path',
      'uncertain: src/app/(home)/today/c.ts: require()',
    ]);
  });

  it('follows imports through other files (transitive), not only direct ones', () => {
    const synthetic = new Map([
      ['src/app/(home)/sort/leaf.ts', 'export const leaf = 1;'],
      ['src/app/(home)/people/middle.ts', "export { leaf } from '../sort/leaf';"],
      ['src/app/_agenda/top.ts', "import { leaf } from '@/app/(home)/people/middle';"],
    ]);
    const gaps = coverageGaps(synthetic, classifyPath);
    expect(gaps).toContain(
      'src/app/(home)/sort/leaf.ts is imported by high src/app/_agenda/top.ts: it must be high too',
    );
  });
});
