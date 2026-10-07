import { describe, expect, it } from 'vitest';
import { effectivePeople } from '@/domain/events/who';

// Who an event is for (ADR 0007 §14): its own annotations, else its
// calendar's usual people, derived at read time, for people the reader can see.

const visible = new Set(['milo', 'isla', 'sam']);

describe('effectivePeople', () => {
  it('an event’s own annotations win over its calendar’s usual people', () => {
    const r = effectivePeople([{ personId: 'isla', role: 'responsible' }], ['milo'], visible);
    expect(r).toEqual({ people: [{ personId: 'isla', role: 'responsible' }], derived: false });
  });

  it('with none of its own, the calendar’s usual people are shown as attending, once each', () => {
    const r = effectivePeople([], ['milo', 'sam', 'milo'], visible);
    expect(r).toEqual({
      people: [
        { personId: 'milo', role: 'attending' },
        { personId: 'sam', role: 'attending' },
      ],
      derived: true,
    });
  });

  it('a person the reader cannot see is left out, and never leaked through defaults', () => {
    expect(effectivePeople([], ['secret', 'milo'], visible)).toEqual({
      people: [{ personId: 'milo', role: 'attending' }],
      derived: true,
    });
    expect(effectivePeople([], ['secret'], visible)).toEqual({ people: [], derived: false });
  });

  it('an event whose only annotation names someone the reader no longer lists shows nobody, not the usual people (Package 6 carry-forward)', () => {
    expect(
      effectivePeople([{ personId: 'archived-kid', role: 'attending' }], ['milo'], visible),
    ).toEqual({ people: [], derived: false });
    // Some of its own people still listed: just those.
    expect(
      effectivePeople(
        [
          { personId: 'archived-kid', role: 'attending' },
          { personId: 'isla', role: 'responsible' },
        ],
        ['milo'],
        visible,
      ),
    ).toEqual({ people: [{ personId: 'isla', role: 'responsible' }], derived: false });
  });

  it('a manual event (no calendar) has only its own people', () => {
    expect(effectivePeople([], undefined, visible)).toEqual({ people: [], derived: false });
  });
});
