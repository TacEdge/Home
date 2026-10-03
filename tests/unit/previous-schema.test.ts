import { describe, expect, it } from 'vitest';
import {
  before,
  checkPrefix,
  compatSuites,
  plus,
  resolveBase,
  type MigrationSet,
} from '../../scripts/check-previous-schema.mts';

// The pure parts of the previous-schema check (M2 contract §2.1 rule 7). The
// check itself runs in CI, where its --self-test proves it fails on schemas
// that lack what the code needs.

const set = (...tags: string[]): MigrationSet => ({
  journal: {
    version: '7',
    dialect: 'postgresql',
    entries: tags.map((tag, idx) => ({
      idx,
      version: '7',
      when: 1000 + idx,
      tag,
      breakpoints: true,
    })),
  },
  sql: new Map(tags.map((t) => [t, `-- ${t}`])),
});

describe('checkPrefix', () => {
  it('returns the migrations the change adds after the base', () => {
    expect(checkPrefix(set('0000_a', '0001_b'), set('0000_a', '0001_b', '0002_c'))).toEqual([
      '0002_c',
    ]);
    expect(checkPrefix(set('0000_a'), set('0000_a'))).toEqual([]);
  });

  it('refuses a migration edited after it reached the base', () => {
    const head = set('0000_a', '0001_b');
    head.sql.set('0001_b', '-- changed');
    expect(() => checkPrefix(set('0000_a', '0001_b'), head)).toThrow(/"0001_b" was changed/);
  });

  it('refuses a removed or reordered migration', () => {
    expect(() => checkPrefix(set('0000_a', '0001_b'), set('0000_a'))).toThrow(/removed/);
    expect(() => checkPrefix(set('0000_a', '0001_b'), set('0000_a', '0001_x', '0002_b'))).toThrow(
      /"0001_b" on the base but "0001_x"/,
    );
  });
});

describe('building schemas', () => {
  it('before() keeps only the migrations ahead of a tag', () => {
    const b = before(set('0000_a', '0001_b', '0002_c'), '0002_c');
    expect(b.journal.entries.map((e) => e.tag)).toEqual(['0000_a', '0001_b']);
    expect([...b.sql.keys()]).toEqual(['0000_a', '0001_b']);
    expect(() => before(set('0000_a'), 'nope')).toThrow(/no migration/);
  });

  it('plus() appends one migration after the last, in order', () => {
    const p = plus(set('0000_a'), '9999_x', 'SELECT 1;');
    expect(p.journal.entries.map((e) => [e.idx, e.tag])).toEqual([
      [0, '0000_a'],
      [1, '9999_x'],
    ]);
    expect(p.journal.entries[1]?.when).toBeGreaterThan(p.journal.entries[0]?.when ?? 0);
    expect(p.sql.get('9999_x')).toBe('SELECT 1;');
  });
});

describe('compatSuites', () => {
  it('runs every integration suite except the ones asserting new schema', () => {
    expect(
      compatSuites([
        'auth.test.ts',
        'migrations.test.ts',
        'db.ts',
        'app-role.test.ts',
        'audit.test.ts',
      ]),
    ).toEqual(['tests/integration/audit.test.ts', 'tests/integration/auth.test.ts']);
  });
});

describe('resolveBase', () => {
  it('uses an explicit ref first', () => {
    expect(resolveBase('abc123', { GITHUB_BASE_REF: 'main' })).toBe('abc123');
  });
  it('uses the merge base with the PR target on pull requests', () => {
    expect(
      resolveBase(undefined, { GITHUB_BASE_REF: 'main', GITHUB_EVENT_NAME: 'pull_request' }),
    ).toBe('merge-base:origin/main');
  });
  it('uses the previous main on a push (the merge’s first parent)', () => {
    expect(resolveBase(undefined, { GITHUB_EVENT_NAME: 'push' })).toBe('HEAD^1');
  });
  it('defaults to the merge base with origin/main locally', () => {
    expect(resolveBase(undefined, {})).toBe('merge-base:origin/main');
  });
});
