import { describe, expect, it } from 'vitest';
import { createEventInput, eventTime, timeColumns, updateEventInput } from '@/domain/events/schema';
import { createNoteInput } from '@/domain/notes/schema';
import { createProjectInput } from '@/domain/projects/schema';
import { createTaskInput, updateTaskInput } from '@/domain/tasks/schema';
import { isValidTimeZone } from '@/lib/dates';

// Package 3b inputs: one Zod schema per input (CLAUDE.md conventions),
// mirroring the database checks so a bad value never reaches SQL.

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe('isValidTimeZone', () => {
  it.each(['UTC', 'Pacific/Auckland', 'Europe/London', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (tz) => {
      expect(isValidTimeZone(tz)).toBe(true);
    },
  );
  it.each(['', ' UTC', 'UTC ', 'Mars/Olympus', 'NZDT+13', 'x'.repeat(65)])('rejects %j', (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});

describe('event time', () => {
  const timed = {
    allDay: false,
    startsAt: '2026-10-14T15:30:00+13:00',
    endsAt: '2026-10-14T16:15:00+13:00',
    timeZone: 'Pacific/Auckland',
  };
  const allDay = { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' };

  it('accepts a timed and an all-day shape', () => {
    expect(ok(eventTime, timed)).toBe(true);
    expect(ok(eventTime, allDay)).toBe(true);
    expect(ok(eventTime, { ...timed, endsAt: timed.startsAt })).toBe(true);
  });

  it.each([
    ['naive local instants', { ...timed, startsAt: '2026-10-14T15:30:00' }],
    ['a missing zone', { allDay: false, startsAt: timed.startsAt, endsAt: timed.endsAt }],
    ['an unknown zone', { ...timed, timeZone: 'Nowhere/Special' }],
    ['a reversed timed range', { ...timed, startsAt: timed.endsAt, endsAt: timed.startsAt }],
    ['dates on a timed event', { ...timed, startDate: '2026-10-14' }],
    ['instants on an all-day event', { ...allDay, startsAt: timed.startsAt }],
    ['a zone on an all-day event', { ...allDay, timeZone: 'UTC' }],
    ['an inclusive all-day end', { ...allDay, endDate: allDay.startDate }],
    ['a reversed all-day range', { ...allDay, startDate: '2026-10-22' }],
    ['a missing allDay flag', { startDate: '2026-10-20', endDate: '2026-10-21' }],
    ['an impossible date', { ...allDay, startDate: '2026-02-30', endDate: '2026-03-01' }],
  ])('rejects %s', (_label, t) => {
    expect(ok(eventTime, t)).toBe(false);
  });

  it('maps each shape onto its columns and clears the other', () => {
    const t = timeColumns(eventTime.parse(timed));
    expect(t).toMatchObject({
      allDay: false,
      startDate: null,
      endDate: null,
      timeZone: 'Pacific/Auckland',
    });
    expect(t.startsAt?.toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(timeColumns(eventTime.parse(allDay))).toEqual({
      allDay: true,
      startsAt: null,
      endsAt: null,
      timeZone: null,
      startDate: '2026-10-20',
      endDate: '2026-10-21',
    });
  });
});

describe('event input', () => {
  const base = {
    title: 'Swimming',
    kind: 'activity',
    time: { allDay: true, startDate: '2026-10-20', endDate: '2026-10-21' },
  };
  it('defaults to household and refuses source and sync fields', () => {
    expect(createEventInput.parse(base).visibility).toBe('household');
    for (const k of ['source', 'calendarSourceId', 'externalUid', 'createdBy', 'archivedAt']) {
      expect(ok(createEventInput, { ...base, [k]: 'x' })).toBe(false);
      expect(ok(updateEventInput, { [k]: 'x' })).toBe(false);
    }
  });
  it('keeps RRULE text and EXDATE strings as given, but checks their form', () => {
    const v = createEventInput.parse({
      ...base,
      rrule: 'FREQ=WEEKLY;BYDAY=WE',
      exdates: ['2026-10-21', '2026-10-28T02:30:00Z'],
    });
    expect(v.rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
    expect(v.exdates).toEqual(['2026-10-21', '2026-10-28T02:30:00Z']);
    expect(ok(createEventInput, { ...base, exdates: ['tomorrow'] })).toBe(false);
    expect(ok(createEventInput, { ...base, rrule: '' })).toBe(false);
  });
});

describe('task, project and note inputs', () => {
  it('task needs are known and unique; estimates are whole positive minutes', () => {
    expect(
      ok(createTaskInput, {
        title: 'Paint',
        needs: ['dry_weather', 'daylight'],
        estimateMinutes: 180,
      }),
    ).toBe(true);
    expect(ok(createTaskInput, { title: 'Paint', needs: ['daylight', 'daylight'] })).toBe(false);
    expect(ok(createTaskInput, { title: 'Paint', estimateMinutes: 0 })).toBe(false);
    expect(ok(updateTaskInput, { completedAt: '2026-10-14T00:00:00Z' })).toBe(false);
  });
  it('projects are home projects in V0.1', () => {
    expect(createProjectInput.parse({ title: 'Garage' })).toMatchObject({
      domain: 'home',
      status: 'idea',
    });
    expect(ok(createProjectInput, { title: 'Holiday', domain: 'family' })).toBe(false);
  });
  it('a note body is required and its subject is a typed reference', () => {
    expect(ok(createNoteInput, { body: '   ' })).toBe(false);
    expect(
      ok(createNoteInput, {
        body: 'Measure the gate',
        subject: { type: 'task', id: crypto.randomUUID() },
      }),
    ).toBe(false);
    expect(
      ok(createNoteInput, {
        body: 'Measure the gate',
        subject: { type: 'project', id: crypto.randomUUID() },
      }),
    ).toBe(true);
  });
});
