import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_TABLES, EXPORT_TYPES } from '@/domain/export/spec';

// kev_budget_reservation (migration 0009, M8 Package 1a; contract §4.6,
// §13.6) is content-free spend-cap accounting. It has no privacy surface:
// no page or route reads it, and the export leaves it out. Migration-first:
// in Package 1a no application code uses it, or kev_usage's new attempt_id,
// at all; Package 1b's bookkeeping path is the first and only user, and
// narrows the second case to that path.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const sources = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f));
const RESERVATION = /kev_budget_reservation|kevBudgetReservation|KEV_RESERVATION_STATUSES/;

describe('kev_budget_reservation has no privacy surface', () => {
  it('no page, route or export code reads it', () => {
    const files = [
      ...sources('src/app'),
      ...sources('src/domain/export').filter((f) => f !== join('src/domain/export/spec.ts')),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(RESERVATION);
  });

  it('the export spec names it only to exclude it', () => {
    expect(Object.values(EXPORT_TYPES).map((t) => t.table)).not.toContain('kev_budget_reservation');
    expect(EXCLUDED_TABLES.kev_budget_reservation).toBeTypeOf('string');
    const spec = readFileSync('src/domain/export/spec.ts', 'utf8');
    expect(spec.match(/kev_budget_reservation|kevBudgetReservation/g)).toEqual([
      'kev_budget_reservation',
    ]);
  });

  it('migration-first: nothing outside src/db uses the table or kev_usage.attempt_id yet (Package 1a)', () => {
    const files = sources('src').filter(
      (f) => !f.startsWith(join('src', 'db')) && f !== join('src/domain/export/spec.ts'),
    );
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(RESERVATION);
      expect(text, f).not.toMatch(/attempt_id|attemptId/);
    }
  });
});
