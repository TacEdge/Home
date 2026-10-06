import { describe, expect, it } from 'vitest';
import { failureExcerpt } from '../../scripts/verify-local.mts';

// `pnpm verify` keeps every step's whole log; on failure it prints enough to
// diagnose it there and then (review of PR #43: a failure kept as one
// summary line could not be explained afterwards).
describe('failureExcerpt', () => {
  const log = [
    '\x1b[32m ✓ tests/integration/a.test.ts (3 tests)\x1b[39m',
    ...Array.from({ length: 200 }, (_, i) => `noise ${i}`),
    ' FAIL  |integration| tests/integration/privacy.test.ts > sam (via ui): no read …',
    'AssertionError: expected "…" not to contain "canary-alex-"',
    '  - Expected',
    '  + Received',
    ...Array.from({ length: 200 }, (_, i) => `more ${i}`),
    ' Test Files  1 failed | 26 passed (27)',
  ].join('\n');

  it('keeps the failing test, its assertion and the summary, without colour codes', () => {
    const out = failureExcerpt(log);
    expect(out).toContain('FAIL  |integration| tests/integration/privacy.test.ts > sam (via ui)');
    expect(out).toContain('AssertionError: expected "…" not to contain "canary-alex-"');
    expect(out).toContain('+ Received');
    expect(out).toContain('Test Files  1 failed | 26 passed (27)');
    expect(out).not.toContain('\x1b[');
    expect(out).not.toContain('noise 10\n');
  });

  it('a timeout is kept as a timeout, not a bare test name', () => {
    expect(failureExcerpt('x\nError: Test timed out in 5000ms.\ny')).toContain(
      'timed out in 5000ms',
    );
  });
});
