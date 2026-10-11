import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InsightExplanation } from '@/app/_insights/explanation';
import type { FactLookup } from '@/app/_insights/facts';
import type { AgendaEventInput } from '@/domain/engines/agenda';
import type { Insight } from '@/domain/engines/insights';
import type { Person } from '@/domain/people/service';
import { at, fresh, ID, NZ, PEOPLE, run, timed } from '../today/household';

// A conflict's Why at render (ADR 0009 §14; acceptance R-7): the rule in one
// plain sentence with the person and the overlap; for a standing conflict,
// that both repeat and the next date; then the two commitments as recorded,
// each linked, with its own date and times and the person's role. Never a
// place, travel, a reason, availability or what anyone should do. The
// fixture is the contract's (§5.7.4): Swimming and Tutoring on Wednesdays,
// Art club and Dentist on Thursday. Synthetic only.

const WED_0703 = at('2026-10-14T07:03:00+13:00');
const WEEKLY_WE = 'FREQ=WEEKLY;BYDAY=WE';
const att = (...ids: string[]) => ids.map((personId) => ({ personId, role: 'attending' as const }));
const resp = (...ids: string[]) =>
  ids.map((personId) => ({ personId, role: 'responsible' as const }));

const swimming = timed(
  'e-swim',
  'Swimming',
  '2026-10-14T15:30:00+13:00',
  '2026-10-14T16:15:00+13:00',
  { kind: 'activity', rrule: WEEKLY_WE, people: [...att(ID.milo), ...resp(ID.alex)] },
);
const tutoring = timed(
  'e-tutor',
  'Tutoring',
  '2026-10-14T15:45:00+13:00',
  '2026-10-14T16:30:00+13:00',
  { kind: 'activity', rrule: WEEKLY_WE, people: [...att(ID.milo), ...resp(ID.alex)] },
);
const artClub = timed(
  'e-art',
  'Art club',
  '2026-10-15T15:00:00+13:00',
  '2026-10-15T16:00:00+13:00',
  { kind: 'activity', people: att(ID.milo) },
);
const dentist = timed(
  'e-dentist',
  'Dentist',
  '2026-10-15T15:30:00+13:00',
  '2026-10-15T16:30:00+13:00',
  { kind: 'appointment', people: att(ID.milo) },
);

function why(events: AgendaEventInput[], personId: string) {
  const r = run({ events, calendars: [fresh(WED_0703)] }, WED_0703);
  const insight = r.insights.all.find(
    (i): i is Insight => i.kind === 'conflict' && i.conflict?.person.id === personId,
  )!;
  expect(insight).toBeDefined();
  const lookup: FactLookup = {
    days: r.days,
    people: new Map(PEOPLE.map((p) => [p.id, { ...p, colour: null } as unknown as Person])),
    calendars: new Map(),
    tasks: new Map(),
    projects: new Map(),
    timeZone: NZ,
  };
  const html = renderToStaticMarkup(<InsightExplanation insight={insight} lookup={lookup} />);
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, text, insight };
}

/** Each commitment row: its link, its title, its date, times and the person's role. */
function rows(html: string) {
  return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    ([, href, body]) => ({
      href,
      text: body!
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }),
  );
}

/** Words the Why must never say of its own (contract §5.5, M5 §8.1): titles and names are exempt. */
const FORBIDDEN =
  /\b(place|where|travel|drive|driving|lift|pick(ing)? up|drop(ping)? off|should|must|needs?|because|instead|free|available|unavailable|away|busy|can['’]t|cannot|clash|double-booked|in two places|problem|impossible|worth deciding|probably)\b/i;
const own = (t: string) =>
  ['Swimming', 'Tutoring', 'Art club', 'Dentist', 'Milo', 'Alex'].reduce(
    (x, w) => x.split(w).join(''),
    t,
  );

describe('a conflict’s Why, rendered', () => {
  it('standing overlap: the person and the overlap, that both repeat and the next date, both commitments as recorded', () => {
    const { html, text, insight } = why([swimming, tutoring], ID.milo);
    expect(insight.conflict!.identity).toBe('standing');
    expect(text).toContain(
      'Milo is recorded on both of these, and their times overlap from 15:45 to 16:15.',
    );
    expect(text).toContain(
      'Both repeat, and they overlap at this time each time. The next is Wednesday 14 October.',
    );
    expect(rows(html)).toEqual([
      {
        href: '/events/e-swim',
        text: '15:30 Swimming Wednesday 14 October, 15:30–16:15 · Milo attending ›',
      },
      {
        href: '/events/e-tutor',
        text: '15:45 Tutoring Wednesday 14 October, 15:45–16:30 · Milo attending ›',
      },
    ]);
    expect(own(text)).not.toMatch(FORBIDDEN);
  });

  it('standing responsible: "recorded as responsible for both of these", each row with the role', () => {
    const { html, text, insight } = why([swimming, tutoring], ID.alex);
    expect(insight.conflict!.rule).toBe('conflict.responsible');
    expect(text).toContain(
      'Alex is recorded as responsible for both of these, and their times overlap from 15:45 to 16:15.',
    );
    expect(text).toContain(
      'Both repeat, and they overlap at this time each time. The next is Wednesday 14 October.',
    );
    expect(rows(html)).toEqual([
      {
        href: '/events/e-swim',
        text: '15:30 Swimming Wednesday 14 October, 15:30–16:15 · Alex responsible ›',
      },
      {
        href: '/events/e-tutor',
        text: '15:45 Tutoring Wednesday 14 October, 15:45–16:30 · Alex responsible ›',
      },
    ]);
    expect(own(text)).not.toMatch(FORBIDDEN);
  });

  it('occurrence-level: no repeat sentence; each commitment’s own date, times and role', () => {
    const { html, text, insight } = why([artClub, dentist], ID.milo);
    expect(insight.conflict!.identity).toBe('occurrence');
    expect(text).toContain(
      'Milo is recorded on both of these, and their times overlap from 15:30 to 16:00.',
    );
    expect(text).not.toContain('Both repeat');
    expect(rows(html)).toEqual([
      {
        href: '/events/e-art',
        text: '15:00 Art club Thursday 15 October, 15:00–16:00 · Milo attending ›',
      },
      {
        href: '/events/e-dentist',
        text: '15:30 Dentist Thursday 15 October, 15:30–16:30 · Milo attending ›',
      },
    ]);
    expect(own(text)).not.toMatch(FORBIDDEN);
  });
});
