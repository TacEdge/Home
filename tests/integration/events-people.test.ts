import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import {
  createEventWithPeople,
  editEventWithPeople,
  getEvent,
  listEventPeople,
  putBackEventOccurrence,
  setEventPeople,
  skipEventOccurrence,
} from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import { auditRowColumns } from '@/trust/audit';
import { FAMILY_EVENTS, FAMILY_PEOPLE } from '../fixtures/family';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Package 5's domain additions (M3 contract §3.6, ADR 0006 §40, §42):
// setEventPeople makes an event's annotations exactly a set, in one
// transaction; createEventWithPeople creates and annotates in one;
// editEventWithPeople edits fields and people as one change; skip and put
// back judge their date against the rule, never the form.

const { db, close } = testDb();
const deps = { db };
let h: Household;
let milo: string;
let isla: string;
let secret: string;
beforeAll(async () => {
  h = await ensureFixtureUsers(db);
  milo = (await createPerson(h.sam, { ...FAMILY_PEOPLE.milo, name: 'Milo EP' }, deps)).id;
  isla = (await createPerson(h.sam, { ...FAMILY_PEOPLE.isla, name: 'Isla EP' }, deps)).id;
  secret = (
    await createPerson(h.sam, { name: 'Secret EP', role: 'other', visibility: 'private' }, deps)
  ).id;
});
afterAll(close);

const roles = (rows: { personId: string; role: string }[]) =>
  rows
    .map(
      (r) => `${r.personId === milo ? 'milo' : r.personId === isla ? 'isla' : 'other'}:${r.role}`,
    )
    .sort();
const audits = (id: string) =>
  db.select(auditRowColumns).from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.at);

describe('setEventPeople', () => {
  it('adds what is missing, removes what is extra, keeps what is there, auditing each change', async () => {
    const e = await createEventWithPeople(
      h.sam,
      FAMILY_EVENTS.swimming,
      [{ personId: milo, role: 'attending' }],
      deps,
    );
    const before = (await audits(e.id)).length;
    const after = await setEventPeople(
      h.sam,
      e.id,
      [
        { personId: milo, role: 'attending' },
        { personId: isla, role: 'attending' },
        { personId: milo, role: 'responsible' },
      ],
      deps,
    );
    expect(roles(after)).toEqual(['isla:attending', 'milo:attending', 'milo:responsible']);
    const rows = await audits(e.id);
    expect(rows.slice(before).map((r) => r.event)).toEqual([
      'event_person.set',
      'event_person.set',
    ]);
    const trimmed = await setEventPeople(
      h.sam,
      e.id,
      [{ personId: isla, role: 'attending' }],
      deps,
    );
    expect(roles(trimmed)).toEqual(['isla:attending']);
    expect((await audits(e.id)).slice(rows.length).map((r) => r.event)).toEqual([
      'event_person.remove',
      'event_person.remove',
    ]);
    // The same set again changes nothing and audits nothing.
    const count = (await audits(e.id)).length;
    await setEventPeople(h.sam, e.id, [{ personId: isla, role: 'attending' }], deps);
    expect((await audits(e.id)).length).toBe(count);
  });

  it('is one transaction: a refused person leaves the annotations as they were', async () => {
    const e = await createEventWithPeople(
      h.sam,
      FAMILY_EVENTS.football,
      [{ personId: isla, role: 'attending' }],
      deps,
    );
    await expect(
      setEventPeople(
        h.sam,
        e.id,
        [
          { personId: milo, role: 'attending' },
          { personId: secret, role: 'attending' },
        ],
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('references_private'));
    expect(roles(await listEventPeople(h.sam, e.id, {}, deps))).toEqual(['isla:attending']);
  });
});

describe('createEventWithPeople', () => {
  it('creates and annotates together', async () => {
    const e = await createEventWithPeople(
      h.alex,
      FAMILY_EVENTS.nanaJoBirthday,
      [
        { personId: milo, role: 'attending' },
        { personId: isla, role: 'attending' },
      ],
      deps,
    );
    expect(roles(await listEventPeople(h.alex, e.id, {}, deps))).toEqual([
      'isla:attending',
      'milo:attending',
    ]);
  });

  it('a refused annotation leaves no event behind', async () => {
    const before = Number(
      (await db.execute(sql`select count(*)::int as n from event where title = 'Football'`)).rows[0]
        ?.n,
    );
    await expect(
      createEventWithPeople(
        h.sam,
        FAMILY_EVENTS.football,
        [{ personId: secret, role: 'attending' }],
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('references_private'));
    const after = Number(
      (await db.execute(sql`select count(*)::int as n from event where title = 'Football'`)).rows[0]
        ?.n,
    );
    expect(after).toBe(before);
    // Alex cannot name Sam's private person at all: not found, nothing created.
    await expect(
      createEventWithPeople(
        h.alex,
        { ...FAMILY_EVENTS.football, visibility: 'private' },
        [{ personId: secret, role: 'attending' }],
        deps,
      ),
    ).rejects.toThrow();
    expect(
      Number(
        (await db.execute(sql`select count(*)::int as n from event where title = 'Football'`))
          .rows[0]?.n,
      ),
    ).toBe(before);
  });

  it('refuses Kev', async () => {
    await expect(
      createEventWithPeople(h.samViaKev, FAMILY_EVENTS.swimming, [], deps),
    ).rejects.toMatchObject(new NotPermittedError('kev_cannot_write'));
    const e = await createEventWithPeople(h.sam, FAMILY_EVENTS.swimming, [], deps);
    await expect(
      setEventPeople(h.samViaKev, e.id, [{ personId: milo, role: 'attending' }], deps),
    ).rejects.toMatchObject(new NotPermittedError('kev_cannot_write'));
    expect(await getEvent(h.sam, e.id, {}, deps)).toBeTruthy();
  });
});

describe('editEventWithPeople (ADR 0006 §40)', () => {
  it('a refused people change saves none of the field changes', async () => {
    const e = await createEventWithPeople(
      h.sam,
      FAMILY_EVENTS.football,
      [{ personId: isla, role: 'attending' }],
      deps,
    );
    const before = (await audits(e.id)).length;
    await expect(
      editEventWithPeople(
        h.sam,
        e.id,
        { title: 'Football (changed)', location: 'The park' },
        [
          { personId: milo, role: 'attending' },
          { personId: secret, role: 'attending' },
        ],
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('references_private'));
    const after = await getEvent(h.sam, e.id, {}, deps);
    expect(after.title).toBe('Football');
    expect(after.location).toBe(e.location);
    expect(roles(await listEventPeople(h.sam, e.id, {}, deps))).toEqual(['isla:attending']);
    expect((await audits(e.id)).length).toBe(before); // nothing audited either
  });

  it('private → household while taking the private person off succeeds in one save', async () => {
    const e = await createEventWithPeople(
      h.sam,
      { ...FAMILY_EVENTS.swimming, visibility: 'private' },
      [
        { personId: secret, role: 'attending' },
        { personId: milo, role: 'attending' },
      ],
      deps,
    );
    const saved = await editEventWithPeople(
      h.sam,
      e.id,
      { visibility: 'household' },
      [
        { personId: milo, role: 'attending' },
        { personId: isla, role: 'responsible' },
      ],
      deps,
    );
    expect(saved.visibility).toBe('household');
    expect(roles(await listEventPeople(h.sam, e.id, {}, deps))).toEqual([
      'isla:responsible',
      'milo:attending',
    ]);
    expect((await audits(e.id)).slice(-3).map((r) => r.event)).toEqual([
      'event_person.remove',
      'event.update',
      'event_person.set',
    ]);
    // Alex sees it now, without the private person ever having been visible.
    expect(roles(await listEventPeople(h.alex, e.id, {}, deps))).toEqual([
      'isla:responsible',
      'milo:attending',
    ]);
  });

  it('a refused field change rolls the people change back too', async () => {
    const e = await createEventWithPeople(
      h.sam,
      { ...FAMILY_EVENTS.swimming, visibility: 'private' },
      [{ personId: secret, role: 'attending' }],
      deps,
    );
    // Household with the private person still on: refused by the fields step,
    // after the people step would have removed Milo had he been there.
    await expect(
      editEventWithPeople(
        h.sam,
        e.id,
        { visibility: 'household', title: 'Swimming (changed)' },
        [
          { personId: secret, role: 'attending' },
          { personId: milo, role: 'attending' },
        ],
        deps,
      ),
    ).rejects.toMatchObject(new NotPermittedError('references_private'));
    const after = await getEvent(h.sam, e.id, {}, deps);
    expect(after.visibility).toBe('private');
    expect(after.title).toBe('Swimming');
    expect(roles(await listEventPeople(h.sam, e.id, {}, deps))).toEqual(['other:attending']);
    // And the other way: a people change that would be fine, undone by a bad patch.
    await expect(
      editEventWithPeople(
        h.sam,
        e.id,
        { title: '' },
        [{ personId: milo, role: 'attending' }],
        deps,
      ),
    ).rejects.toThrow();
    expect(roles(await listEventPeople(h.sam, e.id, {}, deps))).toEqual(['other:attending']);
  });

  it('refuses Kev and the other adult', async () => {
    const e = await createEventWithPeople(h.sam, FAMILY_EVENTS.swimming, [], deps);
    await expect(
      editEventWithPeople(h.samViaKev, e.id, { title: 'x' }, [], deps),
    ).rejects.toMatchObject(new NotPermittedError('kev_cannot_write'));
    const p = await createEventWithPeople(
      h.sam,
      { ...FAMILY_EVENTS.swimming, visibility: 'private' },
      [],
      deps,
    );
    await expect(editEventWithPeople(h.alex, p.id, { title: 'x' }, [], deps)).rejects.toThrow(
      'not found',
    );
  });
});

describe('skip and put back (ADR 0006 §42)', () => {
  it('skips a real occurrence of a repeating event, and puts it back', async () => {
    const e = await createEventWithPeople(h.sam, FAMILY_EVENTS.swimming, [], deps); // Wednesdays
    const skipped = await skipEventOccurrence(h.sam, e.id, '2026-10-21', deps);
    expect(skipped.exdates).toEqual(['2026-10-21']);
    expect((await audits(e.id)).at(-1)?.event).toBe('event.skip');
    const back = await putBackEventOccurrence(h.sam, e.id, '2026-10-21', deps);
    expect(back.exdates).toBeNull();
    expect((await audits(e.id)).at(-1)?.event).toBe('event.put_back');
  });

  it('a tampered date is refused: not an occurrence, not a date, before the first one', async () => {
    const e = await createEventWithPeople(h.sam, FAMILY_EVENTS.swimming, [], deps);
    for (const date of ['2026-10-22', 'nope', '2026-13-01', '2026-10-07', '1999-01-01']) {
      await expect(skipEventOccurrence(h.sam, e.id, date, deps)).rejects.toMatchObject(
        new NotPermittedError('not_an_occurrence'),
      );
    }
    expect((await getEvent(h.sam, e.id, {}, deps)).exdates).toBeNull();
  });

  it('a one-off event can never be skipped', async () => {
    const e = await createEventWithPeople(h.alex, FAMILY_EVENTS.nanaJoBirthday, [], deps);
    await expect(skipEventOccurrence(h.alex, e.id, '2026-10-20', deps)).rejects.toMatchObject(
      new NotPermittedError('not_recurring'),
    );
    expect((await getEvent(h.alex, e.id, {}, deps)).exdates).toBeNull();
  });

  it('put back needs a date that was skipped', async () => {
    const e = await createEventWithPeople(h.sam, FAMILY_EVENTS.swimming, [], deps);
    await expect(putBackEventOccurrence(h.sam, e.id, '2026-10-21', deps)).rejects.toMatchObject(
      new NotPermittedError('not_skipped'),
    );
    await skipEventOccurrence(h.sam, e.id, '2026-10-21', deps);
    await expect(putBackEventOccurrence(h.sam, e.id, '2026-10-28', deps)).rejects.toMatchObject(
      new NotPermittedError('not_skipped'),
    );
    expect((await getEvent(h.sam, e.id, {}, deps)).exdates).toEqual(['2026-10-21']);
  });

  it('refuses Kev, and the other adult for a private event', async () => {
    const e = await createEventWithPeople(
      h.sam,
      { ...FAMILY_EVENTS.swimming, visibility: 'private' },
      [],
      deps,
    );
    await expect(skipEventOccurrence(h.samViaKev, e.id, '2026-10-21', deps)).rejects.toMatchObject(
      new NotPermittedError('kev_cannot_write'),
    );
    await expect(skipEventOccurrence(h.alex, e.id, '2026-10-21', deps)).rejects.toThrow(
      'not found',
    );
    await expect(putBackEventOccurrence(h.alex, e.id, '2026-10-21', deps)).rejects.toThrow(
      'not found',
    );
  });
});
