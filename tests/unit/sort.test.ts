import { describe, expect, it } from 'vitest';
import { FormFieldError } from '@/app/_forms/errors';
import { kindOf, ORGANISE_KINDS, shortWords, toSortLine } from '@/app/(home)/sort/copy';
import { readContext, readNote } from '@/app/(home)/sort/organise-form-data';
import { createContextInput } from '@/domain/context/schema';
import { createNoteInput } from '@/domain/notes/schema';
import { ORGANISE_ACTIONS } from '@/domain/proposals/service';
import { softWhen } from '@/lib/dates';

// To sort's pure parts (M3 contract §3.2, §3.8): the soft time, the words
// for Today, the five choices, and the two organise-only form readers.

const NZ = 'Pacific/Auckland';
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('softWhen', () => {
  const now = new Date('2026-10-14T03:00:00Z'); // Wednesday 16:00 NZDT
  it('says it softly, never as an age', () => {
    expect(softWhen(new Date('2026-10-14T02:59:40Z'), now, NZ)).toBe('just now');
    expect(softWhen(new Date('2026-10-14T02:48:00Z'), now, NZ)).toBe('12 min ago');
    expect(softWhen(new Date('2026-10-13T20:40:00Z'), now, NZ)).toBe('today, 09:40');
    expect(softWhen(new Date('2026-10-13T05:05:00Z'), now, NZ)).toBe('yesterday, 18:05');
    expect(softWhen(new Date('2026-10-10T22:00:00Z'), now, NZ)).toBe('Sunday');
    expect(softWhen(new Date('2026-10-01T22:00:00Z'), now, NZ)).toBe('2 Oct');
  });
  it('days are the home zone’s, not UTC’s', () => {
    // 23:30 NZDT on the 13th is 10:30 UTC on the 13th; at 08:00 NZDT on the 14th it was yesterday.
    expect(softWhen(new Date('2026-10-13T10:30:00Z'), new Date('2026-10-13T19:00:00Z'), NZ)).toBe(
      'yesterday, 23:30',
    );
  });
});

describe('toSortLine', () => {
  it('in words, only when something waits', () => {
    expect(toSortLine(0)).toBeNull();
    expect(toSortLine(1)).toBe('One thing to sort');
    expect(toSortLine(3)).toBe('Three things to sort');
    expect(toSortLine(12)).toBe('12 things to sort');
  });
});

describe('the five choices', () => {
  it('are exactly the organising actions the service allows', () => {
    expect(ORGANISE_KINDS.map((k) => k.action)).toEqual([...ORGANISE_ACTIONS]);
    expect(kindOf('task')?.action).toBe('task.create');
    expect(kindOf('task.update')).toBeUndefined();
  });
  it('shortWords cuts long words at a space, for labels only', () => {
    expect(shortWords('Ring the plumber')).toBe('Ring the plumber');
    expect(shortWords('a\n b')).toBe('a b');
    const long = shortWords(
      'Remember to book the car in for its warrant before the end of the month please',
    );
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(61);
  });
});

describe('organise-only form readers', () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const subjects = [`person:${P}`, 'project:22222222-2222-4222-8222-222222222222'];
  it('a note: on an offered subject, words as given', () => {
    const input = readNote(
      form({ subject: `person:${P}`, body: '  Likes  it ', visibility: 'private' }),
      subjects,
    );
    expect(input.body).toBe('  Likes  it '); // the reader passes the words on as typed
    expect(createNoteInput.parse(input)).toMatchObject({
      body: '  Likes  it', // the note schema tidies the end, as for every note
      subject: { type: 'person', id: P },
      visibility: 'private',
    });
  });
  it('refuses a subject the form did not offer', () => {
    expect(() => readNote(form({ subject: 'person:other', body: 'x' }), subjects)).toThrow(
      FormFieldError,
    );
    expect(() => readContext(form({ subject: '', content: 'x' }), ['household'])).toThrow(
      FormFieldError,
    );
  });
  it('something to know: household or an offered subject, never a sensitivity', () => {
    const h = readContext(
      form({ subject: 'household', content: 'Bins Tuesday', category: 'routine' }),
      ['household'],
    );
    expect(createContextInput.parse(h)).toMatchObject({
      subject: { type: 'household' },
      sensitivity: 'normal',
    });
    expect(h).not.toHaveProperty('sensitivity');
    const p = readContext(
      form({
        subject: `person:${P}`,
        content: 'x',
        category: 'interest',
        validUntil: '2026-12-01',
      }),
      ['household', ...subjects],
    );
    expect(p).toMatchObject({ subject: { type: 'person', id: P }, validUntil: '2026-12-01' });
  });
});
