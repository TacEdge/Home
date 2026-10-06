import { describe, expect, it } from 'vitest';
import {
  assertMirrored,
  etagOf,
  identityKey,
  mirroredColumns,
  SyncInvariantError,
  UNTITLED,
  type MirroredWrite,
} from '@/domain/calendar/mirror';
import type { ExternalEvent } from '@/domain/calendar/provider';

// How a provider event becomes a synced event, and the invariants every
// synced write keeps (ADR 0007 §8, §26, §36). Synthetic values only.

const SOURCE = {
  id: 'src-1',
  ownerUserId: 'u-owner',
  visibility: 'private' as const,
  defaultKind: null,
};
const ctx = (series = new Map<string, { id: string; uid: string }>()) => ({
  source: SOURCE,
  connectionOwner: 'u-owner',
  series,
});
const ev = (over: Partial<ExternalEvent> = {}): ExternalEvent => ({
  uid: 'series-1@example.test',
  recurrenceId: null,
  status: 'confirmed',
  time: { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
  rrule: 'FREQ=WEEKLY',
  recurrence: 'rule',
  exdates: [],
  cancelledOccurrences: [],
  title: 'Swimming',
  description: null,
  location: null,
  sequence: 4,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});
const write = (over: Partial<MirroredWrite> = {}, e = ev()): MirroredWrite =>
  ({ ...mirroredColumns(e, SOURCE), recurrenceParentId: null, ...over }) as MirroredWrite;
const breaks = (row: MirroredWrite, c = ctx()) => {
  try {
    assertMirrored(row, c);
    return null;
  } catch (e) {
    return e instanceof SyncInvariantError ? e.message : String(e);
  }
};

describe('mirroredColumns', () => {
  it('is always the owner’s, via sync, synced, in its source, with the source’s visibility and kind', () => {
    const c = mirroredColumns(ev(), SOURCE);
    expect(c).toMatchObject({
      createdBy: 'u-owner',
      createdVia: 'sync',
      source: 'synced',
      calendarSourceId: 'src-1',
      visibility: 'private',
      kind: 'other',
      domain: null,
      externalUid: 'series-1@example.test',
      recurrenceOriginal: null,
    });
    expect(mirroredColumns(ev({ title: null }), SOURCE).title).toBe(UNTITLED);
    expect(mirroredColumns(ev({ recurrence: 'unreadable', rrule: null }), SOURCE).rrule).toBeNull();
  });

  it('the content tag changes with provider content, never with the revision counter', () => {
    expect(etagOf(ev())).toBe(etagOf(ev({ sequence: 9, updatedAt: null })));
    expect(etagOf(ev())).not.toBe(etagOf(ev({ title: 'Swimming (squad)' })));
    expect(etagOf(ev())).not.toBe(etagOf(ev({ exdates: ['2026-10-27'] })));
    expect(etagOf(ev())).toMatch(/^e1:[0-9a-f]{64}$/);
  });

  it('identity is the UID and the original occurrence, never the parent', () => {
    expect(identityKey('a', null)).toBe(identityKey('a', null));
    expect(identityKey('a', null)).not.toBe(identityKey('a', '2026-10-20'));
    expect(identityKey('a\n', 'b')).not.toBe(identityKey('a', '\nb'));
  });
});

describe('assertMirrored', () => {
  const series = new Map([
    ['series-1@example.test', { id: 'master-1', uid: 'series-1@example.test' }],
  ]);
  const override = (over: Partial<MirroredWrite> = {}) =>
    write(
      { recurrenceParentId: 'master-1', ...over },
      ev({ recurrenceId: '2026-10-27', rrule: null }),
    );

  it('accepts a series, a linked override and an orphan override', () => {
    expect(breaks(write())).toBeNull();
    expect(breaks(override(), ctx(series))).toBeNull();
    expect(breaks(override({ recurrenceParentId: null }))).toBeNull();
  });

  it.each([
    ['created by the refresher, not the owner', write({ createdBy: 'u-other' })],
    ['made by hand', write({ createdVia: 'ui' as never })],
    ['in another source', write({ calendarSourceId: 'src-2' })],
    ['visible beyond its source', write({ visibility: 'household' })],
    ['its own parent', override({ id: 'master-1' })],
    ['a parent from another series', override({ externalUid: 'other@example.test' })],
    ['a parent that is not this source’s series', override({ recurrenceParentId: 'elsewhere' })],
    ['a parent with no original', write({ recurrenceParentId: 'master-1' })],
  ])('refuses a row %s', (_name, row) => {
    expect(breaks(row, ctx(series))).toMatch(/^sync invariant:/);
  });

  it('refuses a source owned by someone other than its connection’s owner', () => {
    expect(breaks(write(), { ...ctx(), connectionOwner: 'u-other' })).toMatch(/^sync invariant:/);
  });
});
