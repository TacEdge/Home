import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FactLookup } from '@/app/(home)/today/facts';
import { TodayView } from '@/app/(home)/today/today-view';
import { todayInput } from '@/app/_agenda/today-input';
import type { CalendarView } from '@/domain/calendar/service';
import type { Person } from '@/domain/people/service';
import type { Task } from '@/domain/tasks/service';
import { at, fresh, ID, NZ, PEOPLE, PROJECTS, ROUTINE, run, TASKS, WEDNESDAY } from './household';

// The Today screen over the engine (M5 Package 3, ADR 0008 §32): the view
// says exactly what the model says, in the model's order, and adds nothing
// of its own. Rendered to static markup from the synthetic household; no
// browser, no database.

const WED = [...ROUTINE, ...WEDNESDAY];

const people = new Map(
  PEOPLE.map((p) => [
    p.id,
    { ...p, colour: null, userId: null, visibility: 'household' } as unknown as Person,
  ]),
);
const taskRecords = new Map(
  TASKS.map((t) => [
    t.id,
    { ...t, projectId: null, assigneePersonId: null, status: 'open' } as unknown as Task,
  ]),
);

function render(now: Date, h: Parameters<typeof run>[0] = { events: WED }, linked = true) {
  const calendars = h.calendars ?? [fresh(now)];
  const r = run({ ...h, calendars }, now);
  const lookup: FactLookup = {
    days: r.days,
    people,
    calendars: new Map(
      calendars.map((c) => [c.id, { ...c, stale: false } as unknown as CalendarView]),
    ),
    tasks: taskRecords,
    projects: new Map(PROJECTS.map((p) => [p.id, { title: p.title, targetDate: p.targetDate }])),
    timeZone: NZ,
  };
  const html = renderToStaticMarkup(
    <TodayView model={r.today} lookup={lookup} linked={linked} worth={r.insights} />,
  );
  return { html, model: r.today, worth: r.insights };
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
const headings = (html: string, level: 1 | 2) =>
  [...html.matchAll(new RegExp(`<h${level}[^>]*>(.*?)</h${level}>`, 'g'))].map((m) => text(m[1]!));

describe('the day', () => {
  const { html, model } = render(at('2026-10-14T07:03:00+13:00'));

  it('says the date, then the model’s headline word for word, then its second sentence', () => {
    expect(headings(html, 1)).toEqual(['Wednesday 14 October']);
    expect(html).toContain(model.headline.text);
    expect(model.headline.late).not.toBeNull();
    expect(html).toContain(model.headline.late!.text);
    expect(html.indexOf(model.headline.text)).toBeLessThan(html.indexOf(model.headline.late!.text));
  });

  it('puts the sections in the contract’s order, and drops the empty ones', () => {
    expect(headings(html, 2)).toEqual(['Worth knowing', 'Everyone’s day', 'To do']);
    const order = [
      'Worth knowing',
      'Everyone’s day',
      'To do',
      'things to sort',
      'The next 30 days',
    ].map((s) => text(html).indexOf(s));
    expect(order.filter((i) => i >= 0)).toEqual(order.filter((i) => i >= 0).sort((a, b) => a - b));
  });

  it('gives every person the model’s lines in the model’s order, and every entry once', () => {
    const lines = text(html);
    let from = 0;
    for (const l of model.personLines) {
      const at = lines.indexOf(l.name, from);
      expect(at, l.name).toBeGreaterThanOrEqual(from);
      from = at;
      for (const e of l.entries) expect(lines, e.text).toContain(e.text);
    }
    // “+ N more” holds exactly the entries past the second.
    for (const l of model.personLines) expect(html.includes(`+ ${l.more} more`)).toBe(l.more > 0);
  });

  it('shows who is recorded on a one-off, and no one on a routine word', () => {
    const people = html
      .slice(html.indexOf('today-day'), html.indexOf('today-todo'))
      .split('<li class="border-line')
      .slice(1)
      .map((c) => text(c.slice(c.indexOf('>') + 1)));
    const line = (name: string) => people.find((l) => l.startsWith(name));
    expect(line('Milo')).toMatch(/School 15:30 Swimming Alex/); // Alex is recorded on it
    expect(line('Isla')).toBe('Isla School 15:00 Isla pickup'); // no one recorded on the pickup
  });

  it('links every entry and every task to its own page', () => {
    for (const l of model.personLines)
      for (const e of l.entries)
        if (e.item.kind === 'event') expect(html).toContain(`href="/events/${e.item.eventId}"`);
    for (const e of model.todo.shown) expect(html).toContain(`href="/tasks/${e.task.id}"`);
    expect(html).toContain('href="/forward"');
  });

  it('says nothing of its own: no need, arrangement, urgency or availability', () => {
    expect(text(html)).not.toMatch(
      /\b(needs?|lift|driving|taking|free|available|busy|urgent|overdue|should)\b|Who\?/i,
    );
  });
});

describe('the other states', () => {
  it('first run points at where to connect a calendar; only the usual is said as the usual', () => {
    const { html, model } = render(at('2026-10-17T07:03:00+13:00'), {
      events: [],
      calendars: [],
      tasks: [],
    });
    expect(model.headline.rule).toBe('headline.first_run');
    const quiet = render(at('2026-10-15T07:03:00+13:00'), {
      events: ROUTINE.slice(0, 1),
      tasks: [],
    });
    expect(quiet.model.headline.rule).toBe('headline.usual');
    // Only the usual: the words, and everyone's day as the routine words, nothing to do.
    expect(headings(quiet.html, 2).filter((h) => h !== 'Worth knowing')).toEqual([
      'Everyone’s day',
    ]);
    expect(html).toContain('Connect a calendar ›');
    expect(html).toContain('href="/settings/calendars"');
  });

  it('nothing on today names the calendars it looked at', () => {
    const { html, model } = render(at('2026-10-17T07:03:00+13:00'), {
      events: [ROUTINE[0]!].map((e) => ({ ...e, rrule: null })),
      tasks: [],
    });
    expect(model.headline.rule).toBe('headline.nothing');
    expect(text(html)).toContain('HOME has nothing recorded for Saturday 17 October');
    expect(text(html)).toContain('Sam’s work');
  });

  it('evening leads with the model’s statement, tomorrow morning and what is due before it, with today folded', () => {
    const { html, model } = render(at('2026-10-14T21:40:00+13:00'));
    expect(model.state).toBe('evening');
    expect(html).toContain(model.headline.text);
    expect(headings(html, 2)).toEqual([
      'Worth knowing',
      'All day today',
      'Tomorrow morning',
      'Before then',
      'To do',
    ]);
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*Earlier today/);
    expect(html).not.toMatch(/<details[^>]*\sopen(=|\s|>)/);
    expect(html).not.toContain('Everyone’s day');
  });

  it('a calendar that cannot be vouched for qualifies the headline and is named in its facts', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const { html, model } = render(now, {
      events: WED,
      calendars: [fresh(now, { lastSyncedAt: at('2026-10-12T09:05:00+13:00') })],
    });
    expect(model.headline.qualified).toBe(true);
    // The qualifier is its own quiet line; the calendar is said once, in Worth knowing, with its facts.
    expect(text(html)).toContain(`${model.headline.sentence} As far as HOME knows.`);
    expect(text(html)).toContain('Sam’s work hasn’t updated since Monday.');
    expect(text(html)).toContain('Sam’s work Last updated Monday 12 October, 09:05');
    expect(text(html)).not.toContain('Sam’s work · last updated');
  });

  it('asks an unlinked adult which one they are, only then', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    expect(render(now, { events: WED }, false).html).toContain('Which one is you? ›');
    expect(render(now, { events: WED }, true).html).not.toContain('Which one is you?');
  });
});

describe('the loader’s records become the engine’s input untouched', () => {
  it('passes people in order, tasks with their schedule and calendars with their freshness, and nothing is dropped', () => {
    const now = at('2026-10-14T07:03:00+13:00');
    const r = run({ events: WED }, now);
    const input = todayInput(
      {
        days: r.days,
        events: WED,
        people,
        records: {
          tasks: [...taskRecords.values()],
          projects: [],
          calendars: [{ ...fresh(now), stale: false } as unknown as CalendarView],
        },
      },
      now,
      NZ,
      3,
    );
    expect(input.people.map((p) => p.id)).toEqual(PEOPLE.map((p) => p.id));
    expect(input.tasks).toHaveLength(TASKS.length);
    expect(input.tasks.find((t) => t.id === ID.nana)).toBeUndefined();
    expect(input.tasks.find((t) => t.id === 't-plumber')!.scheduledStartsAt).toEqual(
      new Date('2026-10-14T10:00:00+13:00'),
    );
    expect(input.calendars[0]).toMatchObject({ id: 'c-sam-work', lastSyncStatus: 'ok' });
    expect(input.capturesWaiting).toBe(3);
    expect(input.now).toBe(now);
  });
});

describe('the view is presentation only', () => {
  const files = [
    'src/app/(home)/today/today-view.tsx',
    'src/app/(home)/today/facts.tsx',
    'src/app/_agenda/today-input.ts',
  ];
  it('reads no clock, imports no database, auth or Kev, and decides nothing by time', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(|Math\.random/);
      for (const m of src.matchAll(/^import (type )?[^;]* from '([^']+)';$/gm))
        if (!m[1])
          expect(m[2], f).not.toMatch(/^@\/(db|kev|trust|integrations)\b|^drizzle|\/service$/);
    }
  });
});
