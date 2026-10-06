import { describe, expect, it } from 'vitest';
import { needsAttention, statusHelp, statusLine } from '@/app/(home)/settings/calendars/copy';

// Settings › Calendars' one status line (M4 Package 5): calm words for every
// sync status, freshness in soft time, and never a code, a provider or a hash.

const now = new Date('2026-03-10T09:40:00+13:00');
const tz = 'Pacific/Auckland';
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const view = (over: Partial<Parameters<typeof statusLine>[0]>) => ({
  lastSyncStatus: 'ok' as const,
  lastSyncedAt: ago(0),
  lastAttemptAt: ago(0),
  archivedAt: null,
  ...over,
});

describe('statusLine', () => {
  it('reads freshness in words when all is well', () => {
    expect(statusLine(view({}), now, tz)).toBe('Updated just now');
    expect(statusLine(view({ lastSyncedAt: ago(12), lastAttemptAt: ago(12) }), now, tz)).toBe(
      'Updated 12 min ago',
    );
    expect(
      statusLine(view({ lastSyncedAt: ago(60 * 24 * 9), lastAttemptAt: ago(1) }), now, tz),
    ).toMatch(/^Last updated /);
  });

  it('says what was skipped, and what could not be reached, keeping the last good time in view', () => {
    expect(statusLine(view({ lastSyncStatus: 'partial', lastSyncedAt: ago(3) }), now, tz)).toBe(
      'Updated 3 min ago, with a few things skipped',
    );
    expect(
      statusLine(view({ lastSyncStatus: 'unreachable', lastSyncedAt: ago(40) }), now, tz),
    ).toBe('Couldn’t update just now. Updated 40 min ago');
    // A read from moments ago needs no second sentence.
    expect(statusLine(view({ lastSyncStatus: 'unreachable', lastSyncedAt: ago(1) }), now, tz)).toBe(
      'Couldn’t update just now',
    );
    expect(statusLine(view({ lastSyncStatus: 'unreachable', lastSyncedAt: null }), now, tz)).toBe(
      'Couldn’t update just now',
    );
  });

  it('names what needs a person, without a code', () => {
    const lines = (['address_rejected', 'not_a_calendar', 'too_large'] as const).map((s) =>
      statusLine(view({ lastSyncStatus: s }), now, tz),
    );
    expect(lines).toEqual([
      'The Google Calendar address needs attention',
      'HOME couldn’t read this calendar',
      'This calendar has more history than HOME can read at once',
    ]);
    for (const l of lines) expect(l).not.toMatch(/ics|feed|uid|hash|fingerprint|40\d|50\d/i);
  });

  it('reads Disconnected whatever else is recorded, and not-yet-updated before the first read', () => {
    expect(
      statusLine(view({ lastSyncStatus: 'address_rejected', archivedAt: ago(5) }), now, tz),
    ).toBe('Disconnected');
    expect(
      statusLine(view({ lastSyncStatus: null, lastSyncedAt: null, lastAttemptAt: null }), now, tz),
    ).toBe('Connected, not updated yet');
  });
});

describe('needsAttention and statusHelp', () => {
  it('marks only what a person can act on, never a disconnected calendar', () => {
    expect(needsAttention(view({ lastSyncStatus: 'address_rejected' }))).toBe(true);
    expect(needsAttention(view({ lastSyncStatus: 'unreachable' }))).toBe(false);
    expect(needsAttention(view({ lastSyncStatus: 'address_rejected', archivedAt: ago(1) }))).toBe(
      false,
    );
    expect(statusHelp(view({}))).toBeNull();
    expect(statusHelp(view({ lastSyncStatus: 'unreachable' }))).toMatch(/try again/);
  });
});
