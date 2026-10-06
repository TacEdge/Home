import { describe, expect, it } from 'vitest';
import {
  MAX_EXTERNAL_UID_BYTES,
  MAX_SKIPPED_UIDS,
  importWindow,
  uidFits,
  type ExternalEvent,
} from '@/domain/calendar/provider';
import { readFeed } from '@/integrations/calendar/ics/feed';
import { normaliseFeed } from '@/integrations/calendar/ics/normalise';
import { fakeProvider } from '@/integrations/calendar/fake';
import { SYNTHETIC_ADDRESS, googleFeed, nzEvent, vevent } from '../../fixtures/calendars/google';
import { TODAY } from '../../fixtures/calendars/sequences';

// The external UID is bounded in UTF-8 bytes, not characters (ADR 0007 §35):
// the synced-identity index cannot hold an entry over about 2,700 bytes, so a
// valid-looking 1,000-character UID of multi-byte characters would fail the
// refresh's write. Such an event is skipped and counted; it is never
// truncated (truncation could merge two identities) and never fatal.

const ZONE = 'Pacific/Auckland';
const RANGE = importWindow(TODAY);
// Three-byte characters (CJK) and four-byte ones (emoji), synthetic.
const cjk = (n: number) =>
  Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + ((i * 7919) % 20000))).join('');
const emoji = (n: number) =>
  Array.from({ length: n }, (_, i) => String.fromCodePoint(0x1f600 + (i % 64))).join('');

const event = (uid: string, summary: string) =>
  nzEvent({ uid, start: '20261021T100000', end: '20261021T110000', summary });

describe('the UID byte limit', () => {
  it('is 512 UTF-8 bytes, counted in bytes, not characters', () => {
    expect(MAX_EXTERNAL_UID_BYTES).toBe(512);
    expect(uidFits('a'.repeat(512))).toBe(true);
    expect(uidFits('a'.repeat(513))).toBe(false);
    expect(uidFits(cjk(170))).toBe(true); // 510 bytes
    expect(uidFits(cjk(171))).toBe(false); // 513 bytes, 171 characters
    expect(uidFits(emoji(128))).toBe(true); // 512 bytes
    expect(uidFits(emoji(129))).toBe(false);
    expect(uidFits('')).toBe(false);
  });

  it('skips and counts a hostile multi-byte UID in a feed; the rest of the feed reads', () => {
    const feed = googleFeed([
      event(`${cjk(1000)}@example.test`, 'Hostile CJK'), // 1,000 characters, 3,000+ bytes
      event(`${emoji(300)}@example.test`, 'Hostile emoji'),
      event(`${cjk(171)}`, 'Just over'),
      event(`${cjk(170)}`, 'Just within'),
      event('ordinary-1@example.test', 'Ordinary'),
    ]);
    const r = normaliseFeed(readFeed(feed), RANGE, ZONE);
    expect(r.events.map((e) => e.title).sort()).toEqual(['Just within', 'Ordinary']);
    expect(r.skipped).toBe(3);
    for (const e of r.events) expect(Buffer.byteLength(e.uid)).toBeLessThanOrEqual(512);
    // Never truncated: the kept UIDs are exactly as written.
    expect(r.events.map((e) => e.uid)).toContain(cjk(170));
  });

  it('applies to any provider: the fake provider’s ready-made events are bounded the same way', async () => {
    const base: ExternalEvent = {
      uid: 'x',
      recurrenceId: null,
      status: 'confirmed',
      time: {
        allDay: false,
        startsAt: new Date('2026-10-20T21:00:00Z'),
        endsAt: new Date('2026-10-20T22:00:00Z'),
        timeZone: ZONE,
      },
      rrule: null,
      recurrence: 'none',
      exdates: [],
      cancelledOccurrences: [],
      title: 'x',
      description: null,
      location: null,
      sequence: null,
      updatedAt: null,
    };
    const p = fakeProvider(
      [
        {
          events: [
            { ...base, uid: emoji(200), title: 'Too long' },
            { ...base, uid: 'fine', title: 'Fine' },
          ],
          skipped: 1,
        },
      ],
      { homeTimeZone: ZONE },
    );
    const r = await p.fetchEvents(
      { kind: 'ics', address: SYNTHETIC_ADDRESS },
      { id: 'default', name: null },
      RANGE,
    );
    expect(r.events.map((e) => e.title)).toEqual(['Fine']);
    expect(r.skipped).toBe(2);
  });
});

describe('well-formed UIDs (ADR 0007 §42)', () => {
  it('refuses lone surrogates and control characters, whatever the length', () => {
    expect(uidFits('ok-uid@example.test')).toBe(true);
    expect(uidFits('lone-\uD800-high')).toBe(false);
    expect(uidFits('lone-\uDC00-low')).toBe(false);
    expect(uidFits('pair-\uD83D\uDE00-ok')).toBe(true);
    for (const c of ['\u0000', '\u0009', '\u000A', '\u001F', '\u007F', '\u0085'])
      expect(uidFits(`ctl${c}x`), JSON.stringify(c)).toBe(false);
  });

  it('a fake provider’s malformed UIDs are skipped as unidentified, never stored or repaired', async () => {
    const base = {
      recurrenceId: null,
      status: 'confirmed' as const,
      time: { allDay: true as const, startDate: '2026-10-20', endDate: '2026-10-21' },
      rrule: null,
      recurrence: 'none' as const,
      exdates: [],
      cancelledOccurrences: [],
      title: 'x',
      description: null,
      location: null,
      sequence: null,
      updatedAt: null,
    };
    const p = fakeProvider(
      [
        {
          events: [
            { ...base, uid: 'odd-\uD800' },
            { ...base, uid: 'bell\u0007' },
            { ...base, uid: 'fine' },
          ],
        },
      ],
      { homeTimeZone: ZONE },
    );
    const r = await p.fetchEvents(
      { kind: 'ics', address: SYNTHETIC_ADDRESS },
      { id: 'default', name: null },
      RANGE,
    );
    expect(r.events.map((e) => e.uid)).toEqual(['fine']);
    expect(r).toMatchObject({ skipped: 2, skippedUnidentified: 2, skippedUids: [] });
  });
});

describe('skipped identities (ADR 0007 §42)', () => {
  const broken = (uid?: string) =>
    vevent({ ...(uid ? { UID: uid } : {}), DTSTART: ';VALUE=DATE:20261332', SUMMARY: 'Broken' });

  it('reports the UID of a skipped event when it can be read, and counts one that cannot', () => {
    const r = normaliseFeed(
      readFeed(
        googleFeed([
          broken('a@example.test'),
          broken('a@example.test'),
          broken(),
          event('ok', 'Ok'),
        ]),
      ),
      RANGE,
      ZONE,
    );
    expect(r.events.map((e) => e.uid)).toEqual(['ok']);
    expect(r).toMatchObject({
      skipped: 3,
      skippedUids: ['a@example.test'],
      skippedUnidentified: 1,
    });
  });

  it('is bounded: beyond MAX_SKIPPED_UIDS a skipped UID counts as unidentified', () => {
    const many = Array.from({ length: MAX_SKIPPED_UIDS + 5 }, (_, i) =>
      broken(`b-${i}@example.test`),
    );
    const r = normaliseFeed(readFeed(googleFeed(many)), RANGE, ZONE);
    expect(r.skippedUids).toHaveLength(MAX_SKIPPED_UIDS);
    expect(r.skippedUnidentified).toBe(5);
    expect(r.skipped).toBe(MAX_SKIPPED_UIDS + 5);
  });
});
