import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '@/db/schema';
import { NotPermittedError } from '@/domain/common/errors';
import {
  createEventWithPeople,
  getEvent,
  listEventPeople,
  setEventPeople,
} from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import { auditRowColumns } from '@/trust/audit';
import { FAMILY_EVENTS, FAMILY_PEOPLE } from '../fixtures/family';
import { testDb } from './db';
import { ensureFixtureUsers, type Household } from './fixtures';

// Package 5's two domain additions (M3 contract §3.6, ADR 0006 §40):
// setEventPeople makes an event's annotations exactly a set, in one
// transaction; createEventWithPeople creates and annotates in one.

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
