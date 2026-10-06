import { describe, expect, it } from 'vitest';
import { importWindow, type ExternalEvent } from '@/domain/calendar/provider';
import { fakeProvider } from '@/integrations/calendar/fake';
import { SYNTHETIC_ADDRESS } from '../../fixtures/calendars/google';
import { SEQUENCES, TODAY } from '../../fixtures/calendars/sequences';

// The fake provider's own behaviour (the shared contract is in
// provider-contract.test.ts): a script replayed step by step, deterministic,
// with no network, for Package 4b's sync scenarios.

const CONN = { kind: 'ics' as const, address: SYNTHETIC_ADDRESS };
const CAL = { id: 'default', name: null };
const RANGE = importWindow(TODAY);
const ev = (uid: string, start: string): ExternalEvent => ({
  uid,
  recurrenceId: null,
  status: 'confirmed',
  time: {
    allDay: false,
    startsAt: new Date(start),
    endsAt: new Date(start),
    timeZone: 'Pacific/Auckland',
  },
  rrule: null,
  recurrence: 'none',
  exdates: [],
  cancelledOccurrences: [],
  title: uid,
  description: null,
  location: null,
  sequence: null,
  updatedAt: null,
});

describe('fakeProvider', () => {
  it('replays a sequence: the current step answers every call until the test moves on', async () => {
    const p = fakeProvider(
      SEQUENCES.returning.map((ics) => ({ ics })),
      { homeTimeZone: 'Pacific/Auckland' },
    );
    const uids = async () => (await p.fetchEvents(CONN, CAL, RANGE)).events.map((e) => e.uid);
    const first = await uids();
    expect(await uids()).toEqual(first); // same step, same answer
    p.advance();
    expect(await uids()).not.toContain('dentist-91a@example.test');
    p.advance();
    expect(await uids()).toEqual(first); // back
    p.advance(); // stays on the last step
    expect(p.step).toBe(2);
    p.goTo(1);
    expect(await uids()).not.toContain('dentist-91a@example.test');
    expect(p.calls).toBe(5);
    expect(() => p.goTo(3)).toThrow();
  });

  it('a step can be events in HOME’s shape: windowed, ordered and hashed as the adapter does', async () => {
    const a = fakeProvider(
      [
        {
          events: [
            ev('b', '2026-10-15T00:00:00Z'),
            ev('a', '2026-10-16T00:00:00Z'),
            ev('old', '2020-01-01T00:00:00Z'),
          ],
        },
      ],
      {
        homeTimeZone: 'Pacific/Auckland',
      },
    );
    const b = fakeProvider(
      [{ events: [ev('a', '2026-10-16T00:00:00Z'), ev('b', '2026-10-15T00:00:00Z')] }],
      {
        homeTimeZone: 'Pacific/Auckland',
      },
    );
    const ra = await a.fetchEvents(CONN, CAL, RANGE);
    expect(ra.events.map((e) => e.uid)).toEqual(['a', 'b']);
    expect(ra).toEqual(await b.fetchEvents(CONN, CAL, RANGE));
  });

  it('the events it is given are not changed by reading them', async () => {
    const given = [ev('a', '2026-10-16T00:00:00Z')];
    const before = JSON.stringify(given);
    await fakeProvider([{ events: given }], { homeTimeZone: 'Pacific/Auckland' }).fetchEvents(
      CONN,
      CAL,
      RANGE,
    );
    expect(JSON.stringify(given)).toBe(before);
  });

  it('a failure step fails every call with that code; the next step recovers', async () => {
    const p = fakeProvider([{ fail: 'unreachable' }, { ics: SEQUENCES.initial[0] }], {
      homeTimeZone: 'Pacific/Auckland',
    });
    await expect(p.fetchEvents(CONN, CAL, RANGE)).rejects.toMatchObject({ code: 'unreachable' });
    await expect(p.listCalendars(CONN)).rejects.toMatchObject({ code: 'unreachable' });
    p.advance();
    expect((await p.fetchEvents(CONN, CAL, RANGE)).events.length).toBeGreaterThan(0);
  });

  it('approves the address as the real adapter does', async () => {
    const p = fakeProvider([{ ics: SEQUENCES.initial[0] }], { homeTimeZone: 'Pacific/Auckland' });
    await expect(
      p.fetchEvents({ kind: 'ics', address: 'https://evil.example.test/x.ics' }, CAL, RANGE),
    ).rejects.toMatchObject({ code: 'address_rejected' });
  });

  it('needs at least one step', () => {
    expect(() => fakeProvider([], { homeTimeZone: 'Pacific/Auckland' })).toThrow();
  });
});
