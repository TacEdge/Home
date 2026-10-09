import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { seedCalendar } from './calendar-feeds';
import { fixtureAdultContext, VIEWPORTS, type Adult } from './fixture-adults';
import { withDb } from './helpers';

// The Today screen (M5 Package 3, ADR 0008 §32), over seeded scenarios on a
// fixed day: Thursday 11 February 2027 in Pacific/Auckland (NZDT, UTC+13), a
// date no fixture record falls on. The request time is frozen per request
// with the test-only `x-home-test-now` header (src/app/_agenda/now.ts; local
// and CI servers only). Everything else on the day is held aside for the
// duration and put back, so each scenario is exactly the records it creates.
// Synthetic throughout. Screenshots land in test-results/screenshots (never
// committed).

const SHOTS = 'test-results/screenshots';
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const DAY = '2027-02-11';
const NEXT = '2027-02-12';
const PREV = '2027-02-10';
const NZ = 'Pacific/Auckland';
const at = (date: string, clock: string) => `${date}T${clock}:00+13:00`;
const P3 = 'p3 ';

type Adult2 = Exclude<Adult, never>;
type Made = { events: string[]; tasks: string[]; captures: string[] };
let made: Made = { events: [], tasks: [], captures: [] };
const held = {
  events: [] as string[],
  tasks: [] as string[],
  sources: [] as string[],
  captures: [] as string[],
};
const who: Record<string, string> = {};

async function personId(name: string): Promise<string> {
  who[name] ??= (
    await q(`select id from person where name = $1 and archived_at is null`, [name])
  )[0]!.id!;
  return who[name]!;
}

type EventSpec = {
  title: string;
  by?: 'fixture-sam' | 'fixture-alex';
  kind?: string;
  visibility?: 'household' | 'private';
  rrule?: string;
  people?: (string | [string, 'attending' | 'responsible'])[];
} & (
  | { start: string; end: string }
  | { allDay: [string, string] }
  | { change: { series: string; original: string; start: string; end: string } }
);

async function event(spec: EventSpec): Promise<string> {
  const by = spec.by ?? 'fixture-sam';
  const common = [spec.title, spec.kind ?? 'other', by, spec.visibility ?? 'household'];
  let id: string;
  if ('allDay' in spec)
    id = (
      await q(
        `insert into event (title, kind, all_day, start_date, end_date, rrule, created_by, created_via, visibility, source)
         values ($1, $2, true, $5, $6, $7, $3, 'ui', $4, 'manual') returning id`,
        [...common, spec.allDay[0], spec.allDay[1], spec.rrule ?? null],
      )
    )[0]!.id!;
  else if ('change' in spec)
    id = (
      await q(
        `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source, recurrence_parent_id, recurrence_original)
         values ($1, $2, false, $5::timestamptz, $6::timestamptz, $9, $3, 'ui', $4, 'manual', $7, $8) returning id`,
        [
          ...common,
          spec.change.start,
          spec.change.end,
          spec.change.series,
          spec.change.original,
          NZ,
        ],
      )
    )[0]!.id!;
  else
    id = (
      await q(
        `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, rrule, created_by, created_via, visibility, source)
         values ($1, $2, false, $5::timestamptz, $6::timestamptz, $8, $7, $3, 'ui', $4, 'manual') returning id`,
        [...common, spec.start, spec.end, spec.rrule ?? null, NZ],
      )
    )[0]!.id!;
  for (const p of spec.people ?? []) {
    const [name, role] = typeof p === 'string' ? [p, 'attending'] : p;
    await q(
      `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, $3, $4, 'ui')`,
      [id, await personId(name), role, by],
    );
  }
  made.events.push(id);
  return id;
}

async function task(
  title: string,
  o: {
    due?: string;
    scheduled?: [string, string];
    by?: 'fixture-sam' | 'fixture-alex';
    visibility?: string;
  } = {},
) {
  const [row] = await q(
    `insert into task (title, status, due_date, scheduled_starts_at, scheduled_ends_at, needs, created_by, created_via, visibility)
     values ($1, 'open', $2, $3::timestamptz, $4::timestamptz, '[]', $5, 'ui', $6) returning id`,
    [
      title,
      o.due ?? null,
      o.scheduled?.[0] ?? null,
      o.scheduled?.[1] ?? null,
      o.by ?? 'fixture-sam',
      o.visibility ?? 'household',
    ],
  );
  made.tasks.push(row!.id!);
}

async function capture(text: string, by: 'fixture-sam' | 'fixture-alex' = 'fixture-sam') {
  const [row] = await q(
    `insert into capture (text, channel, visibility, created_by, created_via) values ($1, 'web', 'private', $2, 'ui') returning id`,
    [P3 + text, by],
  );
  made.captures.push(row!.id!);
}

const archive = async (table: string, ids: string[]) =>
  ids.length ? q(`update ${table} set archived_at = now() where id = any($1::uuid[])`, [ids]) : [];
const restore = async (table: string, ids: string[]) =>
  ids.length ? q(`update ${table} set archived_at = null where id = any($1::uuid[])`, [ids]) : [];

test.beforeAll(async () => {
  // Hold aside everything live, so a scenario is only what it creates.
  held.events = (await q(`select id from event where archived_at is null`)).map((r) => r.id!);
  held.tasks = (await q(`select id from task where archived_at is null`)).map((r) => r.id!);
  held.sources = (await q(`select id from calendar_source where archived_at is null`)).map(
    (r) => r.id!,
  );
  held.captures = (await q(`select id from capture where archived_at is null`)).map((r) => r.id!);
  await archive('event', held.events);
  await archive('task', held.tasks);
  await archive('calendar_source', held.sources);
  await archive('capture', held.captures);
});

test.afterAll(async () => {
  await archive('event', made.events);
  await archive('task', made.tasks);
  await archive('capture', made.captures);
  await q(
    `update calendar_source set archived_at = now() where name like 'p3 %' and archived_at is null`,
  );
  await restore('event', held.events);
  await restore('task', held.tasks);
  await restore('calendar_source', held.sources);
  await restore('capture', held.captures);
});

test.beforeEach(() => {
  made = { events: [], tasks: [], captures: [] };
});

test.afterEach(async () => {
  await archive('event', made.events);
  await archive('task', made.tasks);
  await archive('capture', made.captures);
  await q(
    `update calendar_source set archived_at = now() where name like 'p3 %' and archived_at is null`,
  );
});

/** A signed-in context whose requests are all made at `clock` on the scenario day. */
async function open(
  browser: Parameters<typeof fixtureAdultContext>[0],
  clock: string,
  o: {
    adult?: Adult2;
    viewport?: { width: number; height: number };
    js?: boolean;
    date?: string;
  } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await fixtureAdultContext(
    browser,
    o.adult ?? 'sam',
    o.viewport ?? VIEWPORTS.phone,
    { javaScriptEnabled: o.js ?? true },
  );
  await context.setExtraHTTPHeaders({ 'x-home-test-now': at(o.date ?? DAY, clock) });
  await page.goto('/today');
  return { context, page };
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/today-${name}.png`, fullPage: true });
const headline = (page: Page) => page.getByTestId('headline');
const section = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}"]`);
const rowsOf = (page: Page, id: string) => section(page, id).locator('li > a, li > div');

/** The ordinary Thursday: routine, a changed time, a multi-person event, a late evening. */
async function ordinaryWeekday() {
  const weekdays = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  await event({
    title: 'School',
    kind: 'school',
    rrule: weekdays,
    start: at('2027-02-01', '08:45'),
    end: at('2027-02-01', '15:00'),
    people: ['Milo', 'Isla'],
  });
  await event({
    title: 'Work',
    kind: 'work',
    rrule: weekdays,
    start: at('2027-02-01', '09:00'),
    end: at('2027-02-01', '14:30'),
    people: ['Alex'],
  });
  await event({
    title: 'Client site',
    kind: 'work',
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    allDay: ['2027-02-04', '2027-02-05'],
    people: ['Sam'],
  });
  await event({
    title: 'Swimming',
    kind: 'activity',
    start: at(DAY, '15:30'),
    end: at(DAY, '16:15'),
    people: ['Milo', ['Alex', 'responsible']],
  });
  await event({
    title: 'Isla pickup',
    start: at(DAY, '15:00'),
    end: at(DAY, '15:15'),
    people: ['Isla'],
  });
  await event({
    title: 'Pilates',
    kind: 'activity',
    start: at(DAY, '18:15'),
    end: at(DAY, '19:15'),
    people: ['Alex'],
  });
  await event({
    title: 'Board meeting',
    kind: 'work',
    start: at(DAY, '19:00'),
    end: at(DAY, '21:00'),
    people: ['Sam'],
  });
  await task('Pay swimming term fees', { due: DAY });
  await capture('remember the thing');
  await capture('another thing');
  await seedFreshCalendar();
}

/** A calendar that has been refreshed an hour before the scenario's frozen time. */
async function seedFreshCalendar() {
  const id = await seedCalendar({
    owner: 'fixture-sam',
    name: `${P3}calendar`,
    visibility: 'household',
    fingerprintTag: 'p3screencal',
  });
  await q(
    `update calendar_source set archived_at = null, last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz, last_sync_status = 'ok' where id = $1`,
    [id, at(DAY, '06:00')],
  );
}

test('an ordinary weekday: the headline, then everyone’s day, to do and to sort, in that order', async ({
  browser,
}) => {
  await ordinaryWeekday();
  const { context, page } = await open(browser, '07:03');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thursday 11 February');
  await expect(headline(page)).toHaveText('Four things on today, besides the usual.');
  await expect(page.getByText('Alex and Sam both have something on after 6.')).toBeVisible();

  // Everyone's day: the people in People's order, each with their own two lines, routine as a word.
  const lines = section(page, 'today-day').locator(':scope > ul > li');
  await expect(lines).toHaveCount(4);
  const text = await lines.evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
  );
  expect(text[0]).toMatch(/^Alex Work till 14:30 15:30 Swimming Milo \+ 1 more/);
  expect(text[1]).toMatch(/^Isla School 15:00 Isla pickup$/);
  expect(text[2]).toMatch(/^Milo School 15:30 Swimming Alex$/);
  expect(text[3]).toMatch(/^Sam Client site 19:00 Board meeting$/);
  // Alex is shown on Swimming because Alex is recorded on it, and no one is
  // shown on Isla's pickup because no one is recorded. Nothing is said about either.
  const main = (await page.textContent('main')) ?? '';
  expect(main).not.toMatch(/\b(needs?|lift|driving|taking|free|available|busy)\b/i);
  expect(main).not.toMatch(/\bWho\?/);

  await expect(section(page, 'today-todo').getByRole('link')).toHaveText([
    /Pay swimming term fees.*Due today/,
  ]);
  await expect(page.getByRole('link', { name: 'Two things to sort ›' })).toHaveAttribute(
    'href',
    '/sort',
  );
  await expect(page.getByRole('link', { name: 'The next 30 days ›' })).toHaveAttribute(
    'href',
    '/forward',
  );
  // The reading order is the page order: headline, day, to do, to sort, Forward.
  const order = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main h1, main h2, main a[href="/sort"], main a[href="/forward"]',
      ),
    ].map((e) => e.textContent?.trim()),
  );
  expect(order).toEqual([
    'Thursday 11 February',
    'Everyone’s day',
    'To do',
    'Two things to sort ›',
    'The next 30 days ›',
  ]);
  await shot(page, 'ordinary-phone');
  await context.close();
});

test('the headline expands to the records it stands on, and Alex’s “+ 1 more” to the rest of the day, without JavaScript', async ({
  browser,
}) => {
  await ordinaryWeekday();
  const { context, page } = await open(browser, '07:03', { js: false });
  const based = page.locator('details', { hasText: 'What this is based on' });
  await expect(based).not.toHaveAttribute('open', '');
  await based.locator('summary').click();
  const rows = based.getByRole('link');
  // The four events the sentence counted, and the two that make the second sentence true.
  await expect(rows.filter({ hasText: 'Swimming' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Isla pickup' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Pilates' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Board meeting' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'School' })).toHaveCount(0);
  const more = page.locator('summary', { hasText: '+ 1 more' });
  await more.click();
  await expect(
    section(page, 'today-day').getByRole('link', { name: '18:15 Pilates' }),
  ).toBeVisible();
  // Links and navigation work with no script at all.
  await page.getByRole('link', { name: 'Two things to sort ›' }).click();
  await expect(page).toHaveURL(/\/sort$/);
  await context.close();
});

test('nothing is lost: every event of the day, every task due, and the to-sort line are all there', async ({
  browser,
}) => {
  await ordinaryWeekday();
  await task('Book the car in', { due: PREV });
  const { context, page } = await open(browser, '07:03');
  const main = (await page.textContent('main')) ?? '';
  for (const t of [
    'School',
    'Work till 14:30',
    'Client site',
    '15:30 Swimming',
    '15:00 Isla pickup',
    '18:15 Pilates',
    '19:00 Board meeting',
    'Pay swimming term fees',
    'Book the car in',
    'Two things to sort',
  ])
    expect(main, t).toContain(t);
  // Overdue is a date in words, never a judgement.
  await expect(
    section(page, 'today-todo').getByRole('link', { name: /Book the car in/ }),
  ).toContainText('From yesterday');
  expect(main).not.toMatch(/\boverdue\b|\blate\b|\burgent\b/i);
  await context.close();
});

test('a full day: the headline counts, the day stays two lines a person, three tasks and “N more to do”', async ({
  browser,
}) => {
  await ordinaryWeekday();
  for (const [i, who] of [
    ['a', 'Sam'],
    ['b', 'Sam'],
    ['c', 'Milo'],
  ] as const)
    await event({
      title: `Extra ${i}`,
      start: at(DAY, i === 'a' ? '10:00' : i === 'b' ? '11:00' : '12:00'),
      end: at(DAY, i === 'a' ? '10:30' : i === 'b' ? '11:30' : '12:30'),
      people: [who],
    });
  for (const [t, d] of [
    ['Task one', DAY],
    ['Task two', DAY],
    ['Task three', PREV],
    ['Task four', PREV],
    ['Task five', '2027-02-09'],
  ] as const)
    await task(t, { due: d });
  const { context, page } = await open(browser, '07:03');
  await expect(headline(page)).toHaveText('Seven things on today, besides the usual.');
  await expect(rowsOf(page, 'today-todo')).toHaveCount(3);
  const more = section(page, 'today-todo').getByRole('link', { name: /more to do/ });
  await expect(more).toHaveText('Three more to do ›');
  await expect(more).toHaveAttribute('href', '/tasks');
  // At most two lines a person on the surface; the rest folds into “+ N more”.
  for (const li of await section(page, 'today-day').locator(':scope > ul > li').all())
    expect(await li.locator(':scope > div > ul > li').count()).toBeLessThanOrEqual(2);
  await shot(page, 'full-phone');
  await context.close();
});

test('a quiet day says so, and shows only what is there: no sections, no containers', async ({
  browser,
}) => {
  await capture('one thing waiting');
  await seedFreshCalendar();
  const { context, page } = await open(browser, '07:03');
  await expect(headline(page)).toHaveText('Nothing on today.');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'One thing to sort ›' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'The next 30 days ›' })).toBeVisible();
  // The record that nothing was found is there to be read, not asserted.
  const based = page.locator('details', { hasText: 'What this is based on' });
  await based.locator('summary').click();
  await expect(based).toContainText('HOME has nothing recorded for Thursday 11 February');
  await expect(based).toContainText('p3 calendar');
  await shot(page, 'quiet-phone');
  await context.close();
});

test('first run: HOME says it does not know the calendars yet, and where to connect one', async ({
  browser,
}) => {
  const { context, page } = await open(browser, '07:03');
  await expect(headline(page)).toHaveText(
    'HOME is quiet because it doesn’t know your calendars yet.',
  );
  await expect(page.getByRole('link', { name: 'Connect a calendar ›' })).toHaveAttribute(
    'href',
    '/settings/calendars',
  );
  await expect(page.locator('details')).toHaveCount(1); // the places menu only
  await shot(page, 'first-run-phone');
  await context.close();
});

test('a calendar not updated for more than a day: every statement says “as far as HOME knows”, and the facts name it', async ({
  browser,
}) => {
  await ordinaryWeekday();
  await q(
    `update calendar_source set last_attempt_at = $1::timestamptz, last_synced_at = $1::timestamptz where name = $2`,
    [at(PREV.replace('10', '08'), '09:00'), `${P3}calendar`],
  );
  const { context, page } = await open(browser, '07:03');
  await expect(headline(page)).toHaveText(
    'Four things on today, besides the usual, as far as HOME knows.',
  );
  const based = page.locator('details', { hasText: 'What this is based on' });
  await based.locator('summary').click();
  await expect(based).toContainText('p3 calendar · last updated Monday 8 February, 09:00');
  await shot(page, 'stale-phone');
  await context.close();
});

test('evening: the timed events are over, so tomorrow morning and what is due before it come first', async ({
  browser,
}) => {
  await ordinaryWeekday();
  await task('Sign Milo’s camp form', { due: NEXT });
  const { context, page } = await open(browser, '21:40');
  // The all-day Client site is recorded for today: the headline says only what is true of the timed events.
  await expect(headline(page)).toHaveText('Today’s timed events have finished.');
  await expect(section(page, 'today-allday').getByRole('link')).toContainText(['Client site']);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'All day today',
    'Tomorrow morning',
    'Before then',
    'To do',
  ]);
  await expect(rowsOf(page, 'today-tomorrow').first()).toContainText('School');
  await expect(rowsOf(page, 'today-before')).toContainText(['Sign Milo’s camp form']);
  // Earlier today is folded, with every timed event of the day inside it.
  const earlier = page.locator('details', { hasText: 'Earlier today' });
  await expect(earlier).not.toHaveAttribute('open', '');
  await earlier.locator('summary').click();
  await expect(earlier.getByRole('link')).toHaveCount(6);
  await expect(page.getByTestId('headline')).not.toContainText('Nothing else');
  await shot(page, 'evening-phone');
  await context.close();
});

test('evening without an all-day event says “Nothing else on today.”', async ({ browser }) => {
  await event({
    title: 'Dentist',
    start: at(DAY, '14:00'),
    end: at(DAY, '14:30'),
    people: ['Sam'],
  });
  await seedFreshCalendar();
  const { context, page } = await open(browser, '20:00');
  await expect(headline(page)).toHaveText('Nothing else on today.');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  await context.close();
});

test('overnight: a late shift is still on the morning after, never described as finished, and last night’s carry-over does not make it evening', async ({
  browser,
}) => {
  await event({
    title: 'Late shift',
    kind: 'work',
    start: at(PREV, '22:00'),
    end: at(DAY, '01:00'),
    people: ['Sam'],
  });
  await event({
    title: 'Dentist',
    start: at(DAY, '14:00'),
    end: at(DAY, '14:30'),
    people: ['Sam'],
  });
  await seedFreshCalendar();

  // 07:03: the shift ended at 01:00; it is on Sam's line as recorded and is not what the headline counts.
  let { context, page } = await open(browser, '07:03');
  await expect(headline(page)).toHaveText('Dentist at 14:00.');
  const sam = section(page, 'today-day').locator(':scope > ul > li').filter({ hasText: 'Sam' });
  await expect(sam).toContainText('Late shift until 01:00');
  await expect(sam).toContainText('14:00 Dentist');
  await context.close();

  // 00:30: the shift is still running, so it counts and nothing says it is over.
  ({ context, page } = await open(browser, '00:30'));
  await expect(headline(page)).toHaveText('Two things on today.');
  await expect(page.getByTestId('headline')).not.toContainText('finished');
  await context.close();
});

test('a changed occurrence is said as it now is, and a multi-day event says which day it is', async ({
  browser,
}) => {
  const series = await event({
    title: 'Choir',
    kind: 'activity',
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    start: at('2027-02-04', '16:00'),
    end: at('2027-02-04', '17:00'),
    people: ['Milo'],
  });
  await event({
    title: 'Choir moved',
    kind: 'activity',
    change: {
      series,
      original: '2027-02-11T03:00:00Z',
      start: at(DAY, '17:30'),
      end: at(DAY, '18:30'),
    },
  });
  await event({
    title: 'Camp',
    start: at(PREV, '18:00'),
    end: at(NEXT, '14:00'),
    people: ['Isla', 'Milo'],
  });
  await seedFreshCalendar();
  const { context, page } = await open(browser, '09:00');
  const milo = section(page, 'today-day')
    .locator(':scope > ul > li')
    .filter({ has: page.getByRole('link', { name: 'Milo', exact: true }) });
  await expect(milo).toContainText('17:30 Choir moved');
  await expect(milo).not.toContainText('16:00');
  await expect(milo).toContainText('Camp, all day');
  await context.close();
});

test('items nobody is recorded on are in Also today, once, with their link', async ({
  browser,
}) => {
  await event({ title: 'Plumber', start: at(DAY, '10:00'), end: at(DAY, '11:00') });
  await event({
    title: 'Garden day',
    allDay: [DAY, NEXT],
    people: [],
  });
  await event({
    title: 'Dentist',
    start: at(DAY, '14:00'),
    end: at(DAY, '14:30'),
    people: ['Sam'],
  });
  await seedFreshCalendar();
  const { context, page } = await open(browser, '07:03');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Everyone’s day',
    'Also today',
  ]);
  const also = rowsOf(page, 'today-also');
  await expect(also).toHaveCount(2);
  await expect(also.first()).toContainText('Garden day');
  await expect(also.nth(1)).toContainText('Plumber');
  await also.nth(1).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  // Repeated nowhere else.
  await page.goBack();
  await expect(section(page, 'today-also').getByText('Plumber')).toHaveCount(1);
  await expect(section(page, 'today-day').getByText('Plumber')).toHaveCount(0);
  await context.close();
});

test('the other adult’s private records change nothing about what an adult sees, and Alex sees their own', async ({
  browser,
}) => {
  await ordinaryWeekday();
  const sam = await open(browser, '07:03');
  const before = {
    headline: await headline(sam.page).textContent(),
    main: (await sam.page.textContent('main')) ?? '',
  };
  await sam.context.close();

  await event({
    title: `${CANARY_MARK.alex}ev`,
    by: 'fixture-alex',
    visibility: 'private',
    start: at(DAY, '12:00'),
    end: at(DAY, '12:30'),
    people: ['Alex'],
  });
  await task(`${CANARY_MARK.alex}task`, { due: DAY, by: 'fixture-alex', visibility: 'private' });
  await capture(`${CANARY_MARK.alex}capture`, 'fixture-alex');
  await event({
    title: `${SENSITIVE_MARK}hidden`,
    visibility: 'private',
    by: 'fixture-alex',
    allDay: [DAY, NEXT],
  });

  const again = await open(browser, '07:03');
  expect(await headline(again.page).textContent()).toBe(before.headline);
  const after = (await again.page.textContent('main')) ?? '';
  expect(after).toBe(before.main);
  expect(after).not.toContain(CANARY_MARK.alex);
  expect(after).not.toContain(SENSITIVE_MARK);
  await again.context.close();

  const alex = await open(browser, '07:03', { adult: 'alex' });
  const alexMain = (await alex.page.textContent('main')) ?? '';
  expect(alexMain).toContain(`${CANARY_MARK.alex}ev`);
  expect(alexMain).toContain(`${CANARY_MARK.alex}task`);
  expect(alexMain).toContain('Six things on today'); // the private event counts for Alex alone
  await alex.context.close();
});

test('an unlinked adult is asked which one they are, and only then', async ({ browser }) => {
  await seedFreshCalendar();
  const [me] = await q(
    `select id from person where user_id = 'fixture-alex' and archived_at is null`,
  );
  try {
    let { context, page } = await open(browser, '07:03', { adult: 'alex' });
    await expect(page.getByRole('link', { name: 'Which one is you? ›' })).toHaveCount(0);
    await context.close();
    await q(`update person set user_id = null where id = $1`, [me!.id]);
    ({ context, page } = await open(browser, '07:03', { adult: 'alex' }));
    await expect(page.getByRole('link', { name: 'Which one is you? ›' })).toHaveAttribute(
      'href',
      '/settings/you',
    );
    await context.close();
  } finally {
    await q(`update person set user_id = 'fixture-alex' where id = $1`, [me!.id]);
  }
});

test('the keyboard reaches every control in reading order, with a visible focus, and opens the disclosures', async ({
  browser,
}) => {
  await ordinaryWeekday();
  const { context, page } = await open(browser, '07:03');
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const el = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const s = getComputedStyle(e);
      return {
        text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2,
        inMain: !!e.closest('main'),
        height: e.getBoundingClientRect().height,
        tag: e.tagName,
      };
    });
    if (!el.inMain) continue;
    expect(el.outline, `focus is visible on ${el.text}`).toBe(true);
    expect(el.height, `${el.text} is a tappable height`).toBeGreaterThanOrEqual(43.5);
    seen.push(el.text);
    if (el.text.startsWith('What this is based on')) {
      await page.keyboard.press('Enter');
      await expect(
        page.locator('details').filter({ hasText: 'What this is based on' }),
      ).toHaveAttribute('open', '');
    }
    if (el.text.startsWith('The next 30 days')) break;
  }
  expect(seen[0]).toContain('What this is based on');
  expect(seen.some((t) => t.startsWith('Alex'))).toBe(true);
  expect(seen[seen.length - 1]).toContain('The next 30 days');
  await context.close();
});

test('the longest headline wraps inside a 320px phone, and nothing scrolls sideways', async ({
  browser,
}) => {
  await ordinaryWeekday();
  await q(
    `update calendar_source set last_attempt_at = $1::timestamptz, last_synced_at = $1::timestamptz where name = $2`,
    [at('2027-02-08', '09:00'), `${P3}calendar`],
  );
  await event({
    title: 'An event with a very long title that has to wrap somewhere sensible on a small screen',
    start: at(DAY, '12:00'),
    end: at(DAY, '12:30'),
    people: ['Sam'],
  });
  const { context, page } = await open(browser, '07:03', { viewport: { width: 320, height: 640 } });
  await expect(headline(page)).toHaveText(
    'Five things on today, besides the usual, as far as HOME knows.',
  );
  const box = await headline(page).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await expectNoHorizontalScroll(page, '320px /today');
  await expectAccessible(page, '320px /today');
  await shot(page, 'narrow-320');
  await context.close();
});

const SWEEP: [string, string, () => Promise<void>][] = [
  ['ordinary', '07:03', ordinaryWeekday],
  [
    'quiet',
    '07:03',
    async () => {
      await seedFreshCalendar();
    },
  ],
  [
    'evening',
    '21:40',
    async () => {
      await ordinaryWeekday();
      await task('Sign Milo’s camp form', { due: NEXT });
    },
  ],
  ['first-run', '07:03', async () => {}],
];
for (const [name, viewport] of Object.entries(VIEWPORTS))
  for (const [scenario, clock, seed] of SWEEP)
    test(`accessibility, no horizontal scroll, capture bar clear: ${scenario} at ${name}`, async ({
      browser,
    }) => {
      await seed();
      const { context, page } = await open(browser, clock, { viewport });
      const where = `${scenario} ${name} /today`;
      await expectNoHorizontalScroll(page, where);
      await expectAccessible(page, where);
      // The screen as it first appears, closed, for the owner's review.
      if (name === 'phone' || name === 'tablet-portrait' || name === 'desktop')
        await shot(page, `${scenario}-${name}`);
      // Open every disclosure: what is inside is part of the screen.
      for (const s of await page.locator('main summary').all()) await s.click();
      await expectNoHorizontalScroll(page, `${where} (open)`);
      // Tall enough that nothing is under the sticky capture bar: axe reads a control partly
      // beneath it as too small, which says nothing about a page that scrolls.
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: viewport.width, height: tall + 120 });
      await expectAccessible(page, `${where} (open)`);
      await page.setViewportSize(viewport);
      // One h1, a single column on a phone, and the capture bar never over the last control.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const last = page.locator('main a, main summary').last();
      await last.focus();
      const clear = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const bar = document
          .querySelector('#capture-text')
          ?.closest('.sticky') as HTMLElement | null;
        return (
          !el || !bar || el.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1
        );
      });
      expect(clear, `${where}: the last control is clear of the capture bar`).toBe(true);
      // Two columns only where there are two things to put in them.
      const columns = await page.evaluate(() => {
        const s = document.querySelector('main [data-wide]');
        return s ? getComputedStyle(s).gridTemplateColumns.split(' ').length : 1;
      });
      expect(columns).toBe(scenario === 'ordinary' && viewport.width >= 768 ? 2 : 1);
      await context.close();
    });
