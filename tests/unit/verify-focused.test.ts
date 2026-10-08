import { describe, expect, it } from 'vitest';
import { specsFor } from '../../scripts/verify-focused.mts';

// pnpm verify:focused picks browser specs from the changed paths (ADR 0007
// §48). It narrows routine runs; it never stands in for `pnpm verify` or CI.

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
