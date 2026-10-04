import { describe, expect, it } from 'vitest';
import { FormFieldError } from '@/app/_forms/errors';
import { describeEvent, describeVia } from '@/app/(home)/settings/activity/labels';
import { CATEGORY_LABEL, categoryLabel, stalenessLine } from '@/app/(home)/settings/knows/copy';
import { readContextPatch, readNewContext } from '@/app/(home)/settings/knows/context-form-data';
import { groupContext } from '@/app/(home)/settings/knows/group';
import { CONTEXT_CATEGORIES } from '@/domain/context/schema';
import type { Context } from '@/domain/context/service';

// What Kev knows and Activity, the pure parts (M3 contract §3.9, §3.1):
// grouping and order, the gentle wording, kinds in words, the readers, and
// Activity's labels.

const NZ = 'Pacific/Auckland';
const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';
const row = (over: Partial<Context>): Context =>
  ({
    id: 'x',
    subjectType: 'household',
    subjectId: null,
    content: 'c',
    category: 'routine',
    status: 'active',
    sensitivity: 'normal',
    visibility: 'household',
    validUntil: null,
    lastConfirmedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    archivedAt: null,
    ...over,
  }) as Context;
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('groupContext', () => {
  it('groups household, then people, then projects; stale first, then newest; retired apart', () => {
    const groups = groupContext(
      [
        row({
          id: 'h-new',
          createdAt: new Date('2026-10-01T00:00:00Z'),
          lastConfirmedAt: new Date('2026-10-01T00:00:00Z'),
        }),
        row({
          id: 'h-stale',
          category: 'intention',
          lastConfirmedAt: new Date('2026-01-01T00:00:00Z'),
        }),
        row({ id: 'h-retired', status: 'retired' }),
        row({ id: 'q', subjectType: 'project', subjectId: Q }),
        row({ id: 'p', subjectType: 'person', subjectId: P }),
        row({
          id: 'gone',
          subjectType: 'person',
          subjectId: '33333333-3333-4333-8333-333333333333',
        }),
      ],
      { people: [{ id: P, name: 'Milo' }], projects: [{ id: Q, title: 'Garage' }] },
      '2026-10-04',
      NZ,
    );
    expect(groups.map((g) => g.title)).toEqual(['Everyone at home', 'Milo', 'Garage']);
    expect(groups[0]!.active.map((i) => i.row.id)).toEqual(['h-stale', 'h-new']);
    expect(groups[0]!.active[0]!.staleness.possiblyStale).toBe(true);
    expect(groups[0]!.retired.map((r) => r.id)).toEqual(['h-retired']);
    expect(groups[1]!.href).toBe(`/people/${P}`);
  });
});

describe('copy', () => {
  it('says "still true?" gently, with the date', () => {
    expect(stalenessLine({ possiblyStale: false, reason: null, since: null })).toBeNull();
    expect(
      stalenessLine({ possiblyStale: true, reason: 'unconfirmed_for', since: '2026-03-01' }),
    ).toBe('Still true? Not confirmed since 1 Mar.');
    expect(
      stalenessLine({ possiblyStale: true, reason: 'past_valid_until', since: '2026-03-02' }),
    ).toBe('Still true? It was meant to hold until 2 Mar.');
  });
  it('every kind has words; nothing reads as a code', () => {
    for (const c of CONTEXT_CATEGORIES) expect(CATEGORY_LABEL[c]).toMatch(/^[A-Z]/);
    expect(categoryLabel('other')).toBe('Something else');
  });
});

describe('readers', () => {
  it('a new item: subject offered only, sensitivity as chosen by the person', () => {
    const subjects = ['household', `person:${P}`];
    expect(
      readNewContext(
        form({
          subject: `person:${P}`,
          content: 'Likes trains',
          category: 'interest',
          sensitivity: 'sensitive',
          visibility: 'private',
        }),
        subjects,
      ),
    ).toEqual({
      subject: { type: 'person', id: P },
      content: 'Likes trains',
      category: 'interest',
      validUntil: null,
      visibility: 'private',
      sensitivity: 'sensitive',
    });
    expect(() => readNewContext(form({ subject: `project:${Q}`, content: 'x' }), subjects)).toThrow(
      FormFieldError,
    );
  });
  it('a patch carries only what was sent, never sensitivity', () => {
    expect(
      readContextPatch(form({ content: 'y', validUntil: '', sensitivity: 'sensitive' })),
    ).toEqual({
      content: 'y',
      validUntil: null,
    });
  });
});

describe('Activity labels', () => {
  it('reads as plain words, never a code, for every known event and the rest', () => {
    expect(describeEvent('auth.sign_in')).toBe('Signed in');
    expect(describeEvent('task.create')).toBe('A task added');
    expect(describeEvent('event.put_back')).toBe('A skipped time of an event put back');
    expect(describeEvent('context.sensitive_read')).toBe('Sensitive items shown, on request');
    expect(describeEvent('note.restore')).toBe('A note restored');
    expect(describeEvent('capture.organise')).toBe('A capture made into something');
    expect(describeEvent('widget.frobnicate')).toBe('widget frobnicate');
    expect(describeVia('ui')).toBe('by hand');
    expect(describeVia('kev')).toBe('through Kev');
  });
});
