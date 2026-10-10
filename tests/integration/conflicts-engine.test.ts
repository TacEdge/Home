import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agenda } from '@/domain/engines/agenda';
import { conflicts } from '@/domain/engines/conflicts';
import { readAgendaInputs } from '@/domain/events/agenda-inputs';
import {
  changeEventOccurrence,
  createEventWithPeople,
  skipEventOccurrence,
} from '@/domain/events/service';
import { createPerson } from '@/domain/people/service';
import type { UserActor } from '@/trust/actor';
import { addDays, isoDateInZone } from '@/lib/dates';
import { testDb } from './db';
import { clearDomainRows, ensureFixtureUsers, type Household } from './fixtures';

// The conflict engine through the real services (M6 Package 2; contract
// §3.4, §5.7, §8.2): composed as a page will compose it, from one agenda read
// as each adult over 90 days. A change and a skip made through the event
// services reach the engine with the identities §5.7 sets. The other adult's
// private records change nothing in a reader's conflicts: not a key, a count,
// the order or a fact. The same records do change their owner's. Synthetic.

const { db, close } = testDb();
const deps = { db };
const ZONE = 'Pacific/Auckland';
const NOW = new Date('2026-10-14T07:03:00+13:00');

let h: Household;
const id = { sam: '', alex: '', milo: '', swim: '', tutor: '', art: '', interviews: '' };

async function read(actor: UserActor, now = NOW) {
  const inputs = await readAgendaInputs(actor, deps);
  const from = isoDateInZone(now, ZONE);
  const to = addDays(from, 89);
  const days = agenda({
    from,
    to,
    timeZone: ZONE,
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, dateOfBirth: p.dateOfBirth })),
  });
  return conflicts({
    now,
    timeZone: ZONE,
    window: { from, to },
    days,
    coverage: { from, to },
    events: inputs.events,
    people: inputs.people.map((p) => ({ id: p.id, name: p.name, inHousehold: p.inHousehold })),
  });
}

const timed = (start: string, end: string) => ({
  allDay: false as const,
  startsAt: start,
  endsAt: end,
  timeZone: ZONE,
});

beforeAll(async () => {
  await clearDomainRows(db);
  h = await ensureFixtureUsers(db);
  id.sam = (await createPerson(h.sam, { name: 'Sam CE', role: 'parent' }, deps)).id;
  id.alex = (await createPerson(h.sam, { name: 'Alex CE', role: 'parent' }, deps)).id;
  id.milo = (await createPerson(h.sam, { name: 'Milo CE', role: 'child' }, deps)).id;
  // The contract's fixture (§5.7.4), as household records.
  id.swim = (
    await createEventWithPeople(
      h.sam,
      {
        title: 'Swimming',
        kind: 'activity',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        time: timed('2026-10-14T15:30:00+13:00', '2026-10-14T16:15:00+13:00'),
      },
      [
        { personId: id.milo, role: 'attending' },
        { personId: id.alex, role: 'responsible' },
      ],
      deps,
    )
  ).id;
  id.tutor = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Tutoring',
        kind: 'activity',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        time: timed('2026-10-14T15:45:00+13:00', '2026-10-14T16:30:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  id.art = (
    await createEventWithPeople(
      h.sam,
      {
        title: 'Art club',
        kind: 'activity',
        time: timed('2026-10-15T15:00:00+13:00', '2026-10-15T16:00:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    )
  ).id;
  await createEventWithPeople(
    h.alex,
    {
      title: 'Dentist',
      kind: 'appointment',
      time: timed('2026-10-15T15:30:00+13:00', '2026-10-15T16:30:00+13:00'),
    },
    [{ personId: id.milo, role: 'attending' }],
    deps,
  );
  // A household event Sam is on, for Sam's private event to overlap.
  id.interviews = (
    await createEventWithPeople(
      h.alex,
      {
        title: 'Parent interviews',
        kind: 'school',
        time: timed('2026-10-22T16:00:00+13:00', '2026-10-22T17:00:00+13:00'),
      },
      [{ personId: id.sam, role: 'attending' }],
      deps,
    )
  ).id;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
});

const keys = (cs: Awaited<ReturnType<typeof read>>) => cs.map((c) => c.key);

describe('the contract fixture through the real reads', () => {
  it('both adults see the same household conflicts, with the same keys', async () => {
    const sam = await read(h.sam);
    const alex = await read(h.alex);
    expect(keys(sam)).toEqual(keys(alex));
    expect(keys(sam)).toEqual([
      `conflict.overlap:${id.milo}:${[id.swim, id.tutor].sort().join('.')}:w1545-1615`,
      expect.stringMatching(
        new RegExp(`^conflict\\.overlap:${id.milo}:.+:20261015T0230Z-20261015T0300Z$`),
      ),
    ]);
    expect(sam[0]!.identity).toBe('standing');
    expect(sam[0]!.instances).toHaveLength(13);
  });
});

describe('a change and a skip through the event services (§5.7.4 T4, T7)', () => {
  it('T4: the 28 October Swimming changed to 16:00–16:45 is its own conflict, keyed by the change row', async () => {
    const change = await changeEventOccurrence(
      h.sam,
      id.swim,
      '2026-10-28T02:30:00Z',
      { time: timed('2026-10-28T16:00:00+13:00', '2026-10-28T16:45:00+13:00') },
      deps,
    );
    const cs = await read(h.alex);
    const standing = cs.find((c) => c.identity === 'standing')!;
    expect(standing.instances.map((i) => i.when)).not.toContain('2026-10-28');
    const own = cs.find((c) => c.key.includes(change.id))!;
    expect(own).toMatchObject({ identity: 'occurrence', when: '2026-10-28' });
    expect(own.key).toBe(
      `conflict.overlap:${id.milo}:${[change.id, id.tutor].sort().join('.')}:20261028T0300Z-20261028T0330Z`,
    );
    // The change has no people of its own: it shows its series' (Milo, Alex).
    expect(own.occurrences.find((o) => o.eventId === change.id)!.role).toBe('attending');
  });

  it('T7: the 21 October Tutoring skipped: the standing key is the same; its next date moves to 28 October', async () => {
    const before = await read(h.sam, new Date('2026-10-15T07:03:00+13:00'));
    await skipEventOccurrence(h.alex, id.tutor, '2026-10-21', deps);
    const after = await read(h.sam, new Date('2026-10-15T07:03:00+13:00'));
    const standing = (cs: typeof after) => cs.find((c) => c.identity === 'standing')!;
    expect(standing(after).key).toBe(standing(before).key);
    expect(standing(before).when).toBe('2026-10-21');
    // 28 October is the changed occurrence (T4), so the standing pattern is next on 4 November.
    expect(standing(after).when).toBe('2026-11-04');
    expect(standing(after).instances.map((i) => i.when)).not.toContain('2026-10-21');
  });
});

describe('non-interference (contract §3.4, §8.2; §5.7.4 T18)', () => {
  it('Sam’s private records change nothing in Alex’s conflicts, and do change Sam’s', async () => {
    const alexBefore = await read(h.alex);
    const samBefore = await read(h.sam);

    // A private event of Sam's overlapping the household Parent interviews Sam is on.
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private appointment',
        kind: 'appointment',
        visibility: 'private',
        time: timed('2026-10-22T16:30:00+13:00', '2026-10-22T17:30:00+13:00'),
      },
      [{ personId: id.sam, role: 'responsible' }],
      deps,
    );
    // A private event naming Milo (a household person both see), overlapping Art club.
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private Milo thing',
        kind: 'activity',
        visibility: 'private',
        time: timed('2026-10-15T15:15:00+13:00', '2026-10-15T15:45:00+13:00'),
      },
      [{ personId: id.milo, role: 'attending' }],
      deps,
    );
    // A private weekly series naming Milo, overlapping Swimming every Wednesday.
    await createEventWithPeople(
      h.sam,
      {
        title: 'Private weekly',
        kind: 'activity',
        visibility: 'private',
        rrule: 'FREQ=WEEKLY;BYDAY=WE',
        time: timed('2026-10-14T16:00:00+13:00', '2026-10-14T17:00:00+13:00'),
      },
      [{ personId: id.milo, role: 'responsible' }],
      deps,
    );
    // A private person, on Sam's own private events only (a household event naming one is refused).
    const secret = (
      await createPerson(h.sam, { name: 'Secret CE', role: 'other', visibility: 'private' }, deps)
    ).id;
    for (const [start, end] of [
      ['2026-10-16T10:00:00+13:00', '2026-10-16T11:00:00+13:00'],
      ['2026-10-16T10:30:00+13:00', '2026-10-16T11:30:00+13:00'],
    ])
      await createEventWithPeople(
        h.sam,
        {
          title: 'Private visit',
          kind: 'social',
          visibility: 'private',
          time: timed(start!, end!),
        },
        [{ personId: secret, role: 'attending' }],
        deps,
      );

    const alexAfter = await read(h.alex);
    // Identical: keys, counts, order, facts, explanations, every instance.
    expect(alexAfter).toEqual(alexBefore);
    expect(JSON.stringify(alexAfter)).toBe(JSON.stringify(alexBefore));
    expect(JSON.stringify(alexAfter)).not.toMatch(/Private|Secret/);

    // The same records reach their owner: the invariant is not vacuous.
    const samAfter = await read(h.sam);
    expect(samAfter.length).toBeGreaterThan(samBefore.length + 3);
    expect(samAfter.some((c) => c.person.id === id.sam && c.rule === 'conflict.overlap')).toBe(
      true,
    );
    expect(samAfter.some((c) => c.person.id === secret)).toBe(true);
    expect(
      samAfter.some(
        (c) => c.person.id === id.milo && c.occurrences.some((o) => o.title === 'Private weekly'),
      ),
    ).toBe(true);
  });
});
