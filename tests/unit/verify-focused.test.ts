import { describe, expect, it } from 'vitest';
import { classify, specsFor } from '../../scripts/verify-focused.mts';

// pnpm verify:focused picks browser specs from the changed paths (ADR 0007
// §48). It narrows routine runs; it never stands in for `pnpm verify` or CI.
// A high-risk change fails it outright; a path no spec maps to is named.

describe('specsFor', () => {
  it('maps an area to the specs that exercise it, unioned and sorted', () => {
    expect(
      specsFor(['src/app/(home)/events/[id]/page.tsx', 'src/domain/calendar/sync.ts']),
    ).toEqual(['calendar-refresh', 'calendars', 'events', 'occurrence-changes', 'synced-events']);
  });

  it('a changed spec runs itself', () => {
    expect(specsFor(['tests/e2e/people.spec.ts'])).toEqual(['people']);
  });

  it('docs, unit tests and unmapped paths ask for no browser run', () => {
    expect(
      specsFor(['docs/m4/M4-ACCEPTANCE.md', 'tests/unit/agenda.test.ts', 'README.md']),
    ).toEqual([]);
  });

  it('the CSP and the shell map to their own specs', () => {
    expect(specsFor(['src/proxy.ts'])).toEqual(['csp', 'shell']);
    expect(specsFor(['src/ui/list.tsx'])).toEqual(['shell']);
  });
});

describe('classify: what a focused run cannot prove', () => {
  const risky = (p: string) => classify([p]).highRisk;

  it.each([
    ['trust', 'src/trust/visibility.ts'],
    ['auth', 'src/trust/auth.ts'],
    ['audit and the gate', 'src/trust/audit.ts'],
    ['the environment and HOME_REAL_DATA', 'src/lib/env.ts'],
    ['database schema', 'src/db/schema/events.ts'],
    ['database client', 'src/db/client.ts'],
    ['a migration', 'src/db/migrations/0012_occurrence_changes.sql'],
    ['migration metadata', 'src/db/migrations/meta/_journal.json'],
    ['domain/common', 'src/domain/common/errors.ts'],
    ['integrations', 'src/integrations/calendar/ics.ts'],
    ['weather integration', 'src/integrations/weather/provider.ts'],
    ['the proxy', 'src/proxy.ts'],
    ['the auth route', 'src/app/api/auth/[...all]/route.ts'],
    ['the sign-in screen', 'src/app/(auth)/sign-in/page.tsx'],
    ['the e2e sign-in and seeding', 'tests/e2e/fixture-adults.ts'],
  ])('%s is high-risk', (_, p) => {
    expect(risky(p)).toEqual([p]);
  });

  it('an ordinary mapped UI change is neither high-risk nor unmapped', () => {
    expect(classify(['src/app/(home)/events/[id]/page.tsx', 'src/ui/list.tsx'])).toEqual({
      highRisk: [],
      unmapped: [],
    });
  });

  it('an ordinary unmapped change is named, not high-risk', () => {
    expect(classify(['src/domain/engines/insights/bins.ts', 'src/app/_misc/thing.tsx'])).toEqual({
      highRisk: [],
      unmapped: ['src/domain/engines/insights/bins.ts', 'src/app/_misc/thing.tsx'],
    });
  });

  it('docs, unit and integration tests and changed specs need no warning', () => {
    expect(
      classify([
        'docs/m4/M4-ACCEPTANCE.md',
        'README.md',
        'tests/unit/agenda.test.ts',
        'tests/integration/events.test.ts',
        'tests/e2e/people.spec.ts',
      ]),
    ).toEqual({ highRisk: [], unmapped: [] });
  });

  it('one high-risk path among ordinary ones is enough to fail the run', () => {
    const { highRisk } = classify([
      'docs/m4/M4-ACCEPTANCE.md',
      'src/app/(home)/events/[id]/page.tsx',
      'src/db/migrations/0013_example.sql',
      'src/ui/list.tsx',
    ]);
    expect(highRisk).toEqual(['src/db/migrations/0013_example.sql']);
  });
});
