import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Only the proposal service may issue an execution (M2 contract §5.3, §5.7):
// it is what lets a service record `created_via = 'kev'`, so no other code
// may mint one. Services only read it, through executionOf/provenanceOf.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('execution tokens', () => {
  it('are issued only by the proposal service', () => {
    const issuers = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\bissueExecution\b/.test(readFileSync(f, 'utf8')));
    expect(issuers.sort()).toEqual([
      join('src', 'domain', 'common', 'write.ts'),
      join('src', 'domain', 'proposals', 'service.ts'),
    ]);
  });

  it("are the only way a service sets created_via 'kev'", () => {
    const offenders = walk('src/domain')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /createdVia:\s*'kev'/.test(readFileSync(f, 'utf8')))
      .filter((f) => f !== join('src', 'domain', 'common', 'write.ts'));
    expect(offenders).toEqual([]);
  });

  it('sync actors are issued only by the calendar sync service (M4 contract §3.4)', () => {
    const issuers = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\bissueSyncActor\b/.test(readFileSync(f, 'utf8')));
    expect(issuers.sort()).toEqual([
      join('src', 'domain', 'calendar', 'sync.ts'),
      join('src', 'domain', 'common', 'write.ts'),
    ]);
  });

  it("only the sync service sets created_via 'sync'", () => {
    const offenders = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /createdVia:\s*'sync'/.test(readFileSync(f, 'utf8')))
      .filter((f) => f !== join('src', 'domain', 'calendar', 'mirror.ts'));
    expect(offenders).toEqual([]);
  });
});
