import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  classifyPath,
  FULL_LABEL,
  RULES,
  select,
  SMOKE,
  summary,
  TIERS,
} from '../../scripts/ci-select.mts';

// The shared risk classifier (ADR 0010): how much verification a change
// needs, for CI and for `pnpm verify:focused`. The highest-risk path decides;
// anything unnamed escalates; labels only ever raise verification; and a
// classifier failure fails the job rather than passing it.

const pr = (...paths: string[]) => select({ paths, event: 'pull_request' });

describe('tiers by kind of change', () => {
  it('documentation only: low, no browser tests', () => {
    expect(pr('docs/HOME-VISION.md', 'README.md', 'docs/m6/M6-BUILD-CONTRACT.md')).toMatchObject({
      tier: 'low',
      mode: 'none',
      specs: [],
    });
  });

  it('isolated unit and integration tests: low', () => {
    expect(pr('tests/unit/agenda.test.ts', 'tests/integration/events.test.ts').mode).toBe('none');
  });

  it('a screen: medium, its mapped specs plus the smoke suite', () => {
    expect(pr('src/app/(home)/today/today-view.tsx')).toMatchObject({
      tier: 'medium',
      mode: 'targeted',
      specs: [SMOKE, 'today', 'today-conflicts', 'today-screen'].sort(),
    });
    // Events screens are also used by People, the regular week and To sort
    // (which Today uses): their specs come too (ADR 0010 §8).
    expect(pr('src/app/(home)/events/[id]/page.tsx').specs).toEqual(
      [
        'capture-sort',
        'events',
        'forward',
        'home-tasks',
        'occurrence-changes',
        'people',
        'regular-week',
        SMOKE,
        'synced-events',
        'today',
        'today-conflicts',
        'today-screen',
      ].sort(),
    );
  });

  it('the one engine no shared code imports: medium', () => {
    expect(pr('src/domain/engines/forward.ts')).toMatchObject({
      tier: 'medium',
      mode: 'targeted',
    });
  });

  it.each([
    ['form helpers', 'src/app/_forms/action-form.tsx'],
    ['the capture bar', 'src/app/_capture/capture-bar.tsx'],
    ['the Today engine (the agenda loader imports it)', 'src/domain/engines/today.ts'],
    ['day facts', 'src/domain/engines/day-facts.ts'],
    [
      'the insight detectors (a domain service imports them)',
      'src/domain/engines/insights/index.ts',
    ],
    ['the profile engine (the agenda engine imports it)', 'src/domain/engines/profile.ts'],
    ['the staleness engine (domain services import it)', 'src/domain/engines/staleness.ts'],
  ])('shared code (%s): high, full regression', (_, p) => {
    expect(pr(p)).toMatchObject({ tier: 'high', mode: 'full' });
  });

  it.each([
    [
      'refresh on use reaches Today, Forward and a person’s page',
      'src/app/_calendar/refresh-on-use.tsx',
      ['today-conflicts', 'today-screen', 'events', 'people', 'calendars'],
    ],
    [
      'To sort is used by Today',
      'src/app/(home)/sort/copy.ts',
      ['capture-sort', 'today', 'today-conflicts', 'today-screen'],
    ],
    [
      'task forms are used by To sort',
      'src/app/(home)/tasks/task-form.tsx',
      ['home-tasks', 'capture-sort', 'today'],
    ],
    [
      'project forms are used by To sort',
      'src/app/(home)/home/project-form.tsx',
      ['home-tasks', 'capture-sort'],
    ],
    [
      'notes are on events, projects and people',
      'src/app/_notes/notes-section.tsx',
      ['events', 'home-tasks', 'people', 'capture-sort'],
    ],
  ])('cross-screen code (%s) selects every dependent screen’s specs', (_, p, want) => {
    const s = pr(p);
    expect(s.mode).toBe('targeted');
    for (const w of want) expect(s.specs, w).toContain(w);
  });

  it.each([
    ['the shared agenda engine', 'src/domain/engines/agenda.ts'],
    ['recurrence', 'src/domain/engines/recurrence.ts'],
    ['the shared agenda loader', 'src/app/_agenda/load.ts'],
    ['a privacy-enforcing domain service', 'src/domain/events/service.ts'],
    ['the agenda read', 'src/domain/events/agenda-inputs.ts'],
    ['an integration', 'src/integrations/calendar/ics.ts'],
    ['shared UI', 'src/ui/shell.tsx'],
    ['the app layout', 'src/app/(home)/layout.tsx'],
  ])('%s: high, full regression', (_, p) => {
    expect(pr(p)).toMatchObject({ tier: 'high', mode: 'full' });
  });

  it.each([
    ['visibility', 'src/trust/visibility.ts'],
    ['authentication', 'src/trust/auth.ts'],
    ['the sign-in screen', 'src/app/(auth)/sign-in/page.tsx'],
    ['the auth route', 'src/app/api/auth/[...all]/route.ts'],
    ['a migration', 'src/db/migrations/0012_example.sql'],
    ['migration metadata', 'src/db/migrations/meta/_journal.json'],
    ['the schema', 'src/db/schema/event.ts'],
    ['the CI workflow', '.github/workflows/ci.yml'],
    ['the classifier itself', 'scripts/ci-select.mts'],
    ['environment controls', 'src/lib/env.ts'],
    ['the proxy and CSP', 'src/proxy.ts'],
    ['dependencies', 'package.json'],
    ['the lockfile', 'pnpm-lock.yaml'],
    ['the browser test harness', 'tests/e2e/fixture-adults.ts'],
    ['the integration harness', 'tests/integration/db.ts'],
    ['fixtures', 'tests/fixtures/family.ts'],
    ['Playwright config', 'playwright.config.ts'],
    ['milestone acceptance', 'docs/m5/M5-ACCEPTANCE.md'],
    ['the production gate runbook', 'docs/runbooks/DEPLOY.md'],
  ])('%s: critical, full regression', (_, p) => {
    expect(pr(p)).toMatchObject({ tier: 'critical', mode: 'full' });
  });

  it.each([
    ['a new app area', 'src/app/_misc/thing.tsx'],
    ['a new screen area', 'src/app/(home)/family/page.tsx'],
    ['a new engine', 'src/domain/engines/conflicts.ts'],
    ['a root file', 'some-new-config.toml'],
    ['a public asset', 'public/icon.png'],
  ])('unknown (%s): fails closed to high, full regression', (_, p) => {
    expect(classifyPath(p)).toMatchObject({ tier: 'high' });
    expect(pr(p).mode).toBe('full');
  });

  it('a changed browser spec runs itself, with the smoke suite', () => {
    expect(pr('tests/e2e/people.spec.ts')).toMatchObject({
      tier: 'medium',
      specs: ['people', SMOKE],
    });
  });

  it('a deleted browser spec: high, full regression, and the summary says why', () => {
    const s = pr('tests/e2e/no-longer-here.spec.ts');
    expect(s).toMatchObject({ tier: 'high', mode: 'full', specs: [] });
    expect(summary(s)).toMatch(
      /no-longer-here\.spec\.ts` \| high \| a browser spec this change deletes or renames/,
    );
  });

  it('a renamed browser spec (old path deleted, new path added): full regression', () => {
    // git diff --no-renames lists a rename as the old path and the new one.
    const s = pr('tests/e2e/people-old-name.spec.ts', 'tests/e2e/people.spec.ts');
    expect(s).toMatchObject({ tier: 'high', mode: 'full' });
    expect(s.paths.find((p) => p.path.endsWith('people.spec.ts'))?.tier).toBe('medium');
  });

  it('a deleted spec never yields no browser tests, even beside docs only', () => {
    expect(pr('docs/HOME-VISION.md', 'tests/e2e/gone.spec.ts').mode).toBe('full');
  });
});

describe('the highest-risk path decides', () => {
  it('docs plus a migration is critical', () => {
    expect(pr('docs/HOME-VISION.md', 'src/db/migrations/0013_x.sql').tier).toBe('critical');
  });
  it('docs plus a screen is medium', () => {
    expect(pr('docs/HOME-VISION.md', 'src/app/(home)/people/page.tsx')).toMatchObject({
      tier: 'medium',
      specs: [
        'capture-sort',
        'people',
        'regular-week',
        SMOKE,
        'today',
        'today-conflicts',
        'today-screen',
      ].sort(),
    });
  });
  it('a screen plus an unknown path is high', () => {
    expect(pr('src/app/(home)/people/page.tsx', 'src/app/_misc/x.ts').mode).toBe('full');
  });
  it('specs from several screens are unioned', () => {
    expect(pr('src/app/(home)/today/page.tsx', 'src/app/(home)/home/page.tsx').specs).toEqual(
      ['capture-sort', 'home-tasks', SMOKE, 'today', 'today-conflicts', 'today-screen'].sort(),
    );
  });
});

describe('labels only raise verification', () => {
  it(`${FULL_LABEL} makes a docs change full`, () => {
    expect(
      select({ paths: ['docs/x.md'], labels: [FULL_LABEL], event: 'pull_request' }),
    ).toMatchObject({
      tier: 'low',
      mode: 'full',
      forced: `label ${FULL_LABEL}`,
    });
  });
  it.each([['ci:low'], ['ci:skip'], ['skip-e2e'], ['docs-only'], ['risk:low']])(
    'label %s cannot lower a critical change',
    (label) => {
      expect(
        select({ paths: ['src/db/migrations/0013_x.sql'], labels: [label], event: 'pull_request' }),
      ).toMatchObject({ tier: 'critical', mode: 'full' });
    },
  );
  it('no label changes the tier, only the mode', () => {
    for (const labels of [[], ['ci:low'], [FULL_LABEL]])
      expect(
        select({ paths: ['src/app/(home)/today/page.tsx'], labels, event: 'pull_request' }).tier,
      ).toBe('medium');
  });
});

describe('always full', () => {
  it.each([['push'], ['schedule'], ['workflow_dispatch']])('%s, whatever changed', (event) => {
    expect(select({ paths: [], event })).toMatchObject({
      mode: 'full',
      forced: `${event}: always full`,
    });
  });
});

describe('fail closed', () => {
  it('an empty diff is high, full regression', () => {
    expect(pr()).toMatchObject({ tier: 'high', mode: 'full' });
  });
  it('an unexpected event throws', () => {
    expect(() => select({ paths: ['docs/x.md'], event: 'pull_request_target' })).toThrow();
  });
  it('a path that is not a path throws', () => {
    expect(() => pr('')).toThrow();
    expect(() => pr(' docs/x.md')).toThrow();
  });
  it('no tier above low ever yields no browser tests (every tracked file)', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    for (const f of files) {
      const s = pr(f);
      expect(TIERS).toContain(s.tier);
      if (s.tier !== 'low') expect(s.mode, f).not.toBe('none');
      if (s.tier === 'high' || s.tier === 'critical') expect(s.mode, f).toBe('full');
    }
  });
});

describe('the map is complete and real', () => {
  const specs = readdirSync('tests/e2e')
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.replace(/\.spec\.ts$/, ''));

  it('every spec a rule names exists', () => {
    for (const r of RULES) for (const s of r.specs ?? []) expect(specs, s).toContain(s);
  });
  it('every browser spec is reached by some rule, or is the smoke suite or a full-regression sweep', () => {
    const named = new Set([SMOKE, ...RULES.flatMap((r) => r.specs ?? [])]);
    // Sweeps and cross-cutting specs run in full regression (high and critical changes).
    const fullOnly = ['csp', 'm3-device-sweep', 'm3-privacy-sweep', 'shell', 'sign-in'];
    for (const s of specs) expect(named.has(s) || fullOnly.includes(s), s).toBe(true);
  });
  it('the summary names the tier, the mode and every path', () => {
    const text = summary(pr('docs/x.md', 'src/app/(home)/today/page.tsx'));
    expect(text).toMatch(/Risk tier: \*\*medium\*\*/);
    expect(text).toMatch(/`today`/);
    expect(text).toMatch(/docs\/x\.md/);
  });
});

describe('the CI entry point fails closed', () => {
  const run = (env: Record<string, string>) =>
    spawnSync('node', ['scripts/ci-select.mts', '--ci'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv,
    });
  const dir = mkdtempSync(join(tmpdir(), 'ci-select-'));
  const event = (base: string, labels: string[] = []) => {
    const f = join(dir, `event-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(
      f,
      JSON.stringify({
        pull_request: { base: { sha: base }, labels: labels.map((name) => ({ name })) },
      }),
    );
    return f;
  };

  it('without GITHUB_OUTPUT it exits non-zero', () => {
    expect(run({ GITHUB_EVENT_NAME: 'push' }).status).not.toBe(0);
  });
  it('with a base that is not a commit it exits non-zero', () => {
    const out = join(dir, 'out-bad');
    writeFileSync(out, '');
    const r = run({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_OUTPUT: out,
      GITHUB_EVENT_PATH: event('not-a-sha'),
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/risk classification failed/);
    expect(readFileSync(out, 'utf8')).toBe(''); // no mode written: the guard step fails too
  });
  it('with an unknown commit it exits non-zero', () => {
    const out = join(dir, 'out-unknown');
    writeFileSync(out, '');
    const r = run({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_OUTPUT: out,
      GITHUB_EVENT_PATH: event('0'.repeat(40)),
    });
    expect(r.status).not.toBe(0);
  });
  it('a push writes mode=full', () => {
    const out = join(dir, 'out-push');
    writeFileSync(out, '');
    expect(run({ GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: out }).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toMatch(/^mode=full$/m);
  });
  it('a pull request against a real base writes a tier and a mode', () => {
    const base = execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();
    const out = join(dir, 'out-pr');
    writeFileSync(out, '');
    const r = run({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_OUTPUT: out,
      GITHUB_EVENT_PATH: event(base),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toMatch(/^tier=(low|medium|high|critical)$/m);
    expect(readFileSync(out, 'utf8')).toMatch(/^mode=(none|targeted|full)$/m);
  });
});
