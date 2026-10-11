import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { seedCalendar } from './calendar-feeds';
import { fixtureAdultContext, VIEWPORTS, type Adult } from './fixture-adults';
import { withDb } from './helpers';

// Forward (M6 Package 4; contract §4.1, §4.3, §4.5, §5.3, §5.8; ADR 0009):
// Week, Month and Season over the engine's model, with conflicts said on
// Week's rows and listed in Month's and Season's Worth knowing, The usual
// folded away, and a person's page marking their own Coming up. A response is
// the reader's own. Works without JavaScript where it must.
// On a fixed day (Wednesday 5 May 2027, NZST, UTC+12) through the test-only
// `x-home-test-now` header; every record is the spec's own (titles `fw `) and
// is put away afterwards. Counts are relative to what this spec seeds.
// Synthetic only. Screenshots land in test-results/screenshots (never committed).

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const DAY = '2027-05-05';
const TOMORROW = '2027-05-06';
const NEXT_TUE = '2027-05-11';
const WEEK3 = '2027-05-20';
const FAR = '2027-07-04';
const TARGET = '2027-05-25';
const at = (date: string, clock: string) => `${date}T${clock}:00+12:00`;
const SHOTS = 'test-results/screenshots';

const NUMBERS: Record<string, number> = {
  no: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

async function personId(name: string): Promise<string> {
  const [row] = await q(`select id from person where name = $1 and archived_at is null`, [name]);
  return row!.id!;
}

type Spec = {
  title: string;
  people: (string | [string, 'attending' | 'responsible'])[];
  by?: 'fixture-sam' | 'fixture-alex';
  visibility?: 'household' | 'private';
  rrule?: string;
} & ({ start: string; end: string } | { allDay: [string, string] });

async function event(spec: Spec): Promise<string> {
  const by = spec.by ?? 'fixture-sam';
  const vis = spec.visibility ?? 'household';
  const [row] =
    'allDay' in spec
      ? await q(
          `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
           values ($1, 'activity', true, $2, $3, $4, 'ui', $5, 'manual') returning id`,
          [spec.title, spec.allDay[0], spec.allDay[1], by, vis],
        )
      : await q(
          `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, rrule, created_by, created_via, visibility, source)
           values ($1, 'activity', false, $2::timestamptz, $3::timestamptz, 'Pacific/Auckland', $6, $4, 'ui', $5, 'manual') returning id`,
          [spec.title, spec.start, spec.end, by, vis, spec.rrule ?? null],
        );
  for (const p of spec.people) {
    const [name, role] = typeof p === 'string' ? [p, 'attending'] : p;
    await q(
      `insert into event_person (event_id, person_id, role, created_by, created_via) values ($1, $2, $3, $4, 'ui')`,
      [row!.id, await personId(name), role, by],
    );
  }
  return row!.id!;
}

let ids: { milo: string; sam: string };

test.beforeAll(async () => {
  ids = { milo: await personId('Milo'), sam: await personId('Sam') };
  // Tomorrow: one occurrence conflict for Milo.
  await event({
    title: 'fw Art club',
    people: ['Milo'],
    start: at(TOMORROW, '15:00'),
    end: at(TOMORROW, '16:00'),
  });
  await event({
    title: 'fw Dentist',
    people: ['Milo'],
    start: at(TOMORROW, '15:30'),
    end: at(TOMORROW, '16:30'),
  });
  // A standing conflict: weekly Wednesdays against the fixture's weekly Swimming (15:30-16:15, Milo).
  await event({
    title: 'fw Tutoring',
    people: ['Milo'],
    start: at(DAY, '15:45'),
    end: at(DAY, '16:30'),
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
  });
  // A responsible pair for Alex next Tuesday: ranks first in Worth knowing.
  await event({
    title: 'fw Working bee',
    people: [['Alex', 'responsible']],
    by: 'fixture-alex',
    start: at(NEXT_TUE, '18:00'),
    end: at(NEXT_TUE, '19:00'),
  });
  await event({
    title: 'fw Board meeting',
    people: [['Alex', 'responsible']],
    by: 'fixture-alex',
    start: at(NEXT_TUE, '18:30'),
    end: at(NEXT_TUE, '19:30'),
  });
  // A two-day all-day event in the week; one in week 3; one about sixty days out.
  await event({ title: 'fw Wellington trip', people: ['Sam'], allDay: [TOMORROW, '2027-05-08'] });
  await event({
    title: 'fw Garden day',
    people: ['Isla'],
    start: at(WEEK3, '10:00'),
    end: at(WEEK3, '11:00'),
  });
  await event({
    title: 'fw Reunion',
    people: ['Sam'],
    start: at(FAR, '11:00'),
    end: at(FAR, '12:00'),
  });
  // Sam's private event overlapping a household event Sam is on: Alex must never see either's conflict.
  await event({
    title: 'fw Sam private',
    people: ['Sam'],
    visibility: 'private',
    start: at('2027-05-07', '09:00'),
    end: at('2027-05-07', '10:00'),
  });
  await event({
    title: 'fw Sam school run',
    people: ['Sam'],
    start: at('2027-05-07', '09:30'),
    end: at('2027-05-07', '10:30'),
  });
  await q(
    `insert into project (title, status, target_date, created_by, created_via, visibility)
     values ('fw Garden project', 'active', $1, 'fixture-sam', 'ui', 'household')`,
    [TARGET],
  );
  await q(
    `insert into task (title, status, scheduled_starts_at, scheduled_ends_at, needs, created_by, created_via, visibility)
     values ('fw Phone plumber', 'open', $1::timestamptz, $2::timestamptz, '[]', 'fixture-sam', 'ui', 'household')`,
    [at(TOMORROW, '10:00'), at(TOMORROW, '10:30')],
  );
});
test.afterAll(async () => {
  await q(`update event set archived_at = now() where title like 'fw %' and archived_at is null`);
  await q(`update project set archived_at = now() where title like 'fw %' and archived_at is null`);
  await q(`update task set archived_at = now() where title like 'fw %' and archived_at is null`);
  await q(`delete from insight_response where insight_key like 'conflict.%'`);
});
// Each test starts with no responses, so none depends on another's.
test.beforeEach(async () => {
  await q(`delete from insight_response where insight_key like 'conflict.%'`);
});

async function open(
  browser: Browser,
  adult: Adult,
  path = '/forward',
  o: { js?: boolean; viewport?: { width: number; height: number } } = {},
) {
  const { context, page } = await fixtureAdultContext(
    browser,
    adult,
    o.viewport ?? VIEWPORTS.phone,
    { javaScriptEnabled: o.js ?? true },
  );
  await context.setExtraHTTPHeaders({ 'x-home-test-now': at(DAY, '07:00') });
  await page.goto(path);
  return { context, page };
}

const unit = (page: Page, date: string) => page.locator(`li[data-unit="${date}"]`);
const worthOf = (page: Page) => page.locator('section[aria-labelledby="forward-worth"]');
const overlapsOf = (page: Page) => page.getByTestId('overlaps');
const openAll = (page: Page) =>
  page.evaluate(() =>
    document.querySelectorAll('main details').forEach((d) => d.setAttribute('open', '')),
  );

/** The number the headline's overlaps sentence states ("There are four overlaps."). */
async function overlapCount(page: Page): Promise<number> {
  const text = (await overlapsOf(page).textContent()) ?? '';
  const m = /^There (?:are|is) (\w+) overlaps?\.$/.exec(text.trim());
  expect(m, `overlaps sentence: ${text}`).toBeTruthy();
  return NUMBERS[m![1]!]!;
}

async function unfoldWorth(page: Page) {
  const more = worthOf(page).locator('summary', { hasText: /^\+ \d+ more/ });
  if ((await more.count()) > 0) await more.first().click();
}

test('Week without JavaScript: the counted headline, conflicts on their rows, Not useful as a form post', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', '/forward', { js: false });
  await expect(page.getByRole('heading', { level: 1, name: 'Forward' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Horizon' });
  await expect(nav.getByRole('link')).toHaveText(['Week', 'Month', 'Season']);
  await expect(nav.getByRole('link', { name: 'Week' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('headline')).toContainText('in the next seven days');
  // Our four overlaps (Art club and Dentist, Tutoring and Swimming, the responsible pair,
  // Sam's private pair), and nothing else on these days.
  const before = await overlapCount(page);
  expect(before).toBeGreaterThanOrEqual(4);

  const tomorrow = unit(page, TOMORROW);
  await expect(tomorrow.locator('h3')).toContainText('Tomorrow');
  // Conflicted entries lead the row.
  const links = await tomorrow
    .locator('a[href^="/events/"]:not([data-conflict] a)')
    .allTextContents();
  expect(links[0]).toContain('fw Art club');
  expect(links[1]).toContain('fw Dentist');
  const marks = tomorrow.locator('[data-conflict]');
  await expect(marks).toHaveCount(2);
  const dentistMark = marks.filter({ hasText: 'overlaps fw Dentist 15:30 · Milo' });
  const artMark = marks.filter({ hasText: 'overlaps fw Art club 15:00 · Milo' });
  await expect(dentistMark).toHaveCount(1);
  await expect(artMark).toHaveCount(1);

  // Why: the lead sentence and both records, without JavaScript.
  await dentistMark.locator('summary', { hasText: 'Why' }).click();
  await expect(
    dentistMark.getByText(
      'Milo is recorded on both of these, and their times overlap from 15:30 to 16:00.',
    ),
  ).toBeVisible();
  await expect(dentistMark.getByRole('link', { name: /fw Art club/ })).toBeVisible();
  await expect(dentistMark.getByRole('link', { name: /fw Dentist/ })).toBeVisible();

  // The standing one is on Today's unit, on both of its rows.
  const today = unit(page, DAY);
  await expect(today.locator('[data-conflict]', { hasText: 'fw Tutoring 15:45' })).toHaveCount(1);
  await expect(today.locator('[data-conflict]', { hasText: 'Swimming 15:30' })).toHaveCount(1);

  await dentistMark.getByRole('button', { name: /^Not useful:/ }).click();
  await page.waitForURL(/\/forward$/);
  await expect(unit(page, TOMORROW).locator('[data-conflict]')).toHaveCount(0);
  expect(await overlapCount(page)).toBe(before - 1);
  // The standing conflict is another one, and stays.
  await expect(
    unit(page, DAY).locator('[data-conflict]', { hasText: 'fw Tutoring 15:45' }),
  ).toHaveCount(1);
  await context.close();

  // Alex still sees it: the response was Sam's alone.
  const alex = await open(browser, 'alex');
  await expect(
    unit(alex.page, TOMORROW).locator('[data-conflict]', {
      hasText: 'overlaps fw Dentist 15:30 · Milo',
    }),
  ).toHaveCount(1);
  await alex.context.close();
});

test('Month: weeks, Worth knowing ranks the responsible conflict first, rows fold, Dismiss takes a conflict everywhere', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', '/forward?h=month');
  const nav = page.getByRole('navigation', { name: 'Horizon' });
  await expect(nav.getByRole('link', { name: 'Month' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('headline')).toContainText('in the next 30 days');

  const labels = await page.locator('li[data-unit] > h3').allTextContents();
  expect(labels[0]).toMatch(/^This week/);
  for (const l of labels.slice(1))
    expect(l).toMatch(/^\d{1,2}(?: [A-Z][a-z]{2})?–\d{1,2} [A-Z][a-z]{2}/);
  // The one-off in week 3 is on its week's unit.
  await expect(unit(page, '2027-05-17').getByRole('link', { name: /fw Garden day/ })).toBeVisible();

  // Worth knowing: two shown, the rest under "+ N more"; the responsible conflict leads.
  const worth = worthOf(page);
  const rows = worth.locator('li[data-insight]');
  const total = await rows.count();
  expect(total).toBeGreaterThanOrEqual(4);
  await expect(worth.locator(':scope > ul > li')).toHaveCount(2);
  await expect(
    worth.locator('summary', { hasText: new RegExp(`^\\+ ${total - 2} more`) }),
  ).toHaveCount(1);
  const conflictRows = worth.locator('li[data-insight^="conflict."]');
  await expect(conflictRows.first()).toHaveAttribute('data-insight', 'conflict.responsible');
  await expect(conflictRows.first()).toContainText('fw Working bee');
  await expect(conflictRows.first()).toContainText('fw Board meeting');
  // Then the standing one (its next overlap is the soonest).
  await expect(conflictRows.nth(1)).toContainText('fw Tutoring');
  await expect(conflictRows.nth(1)).toContainText('overlap regularly');
  // Month's rows have no marks of their own.
  await expect(page.locator('li[data-unit] [data-conflict]')).toHaveCount(0);

  // Rows: three shown, then "+ N" holding the rest.
  const week = unit(page, DAY);
  await expect(week.locator(':scope > ul > li')).toHaveCount(3);
  const fold = week.locator('details', { hasText: /^\+ \d+/ }).first();
  const label = (await fold.locator('summary').first().textContent()) ?? '';
  const n = Number(/^\+ (\d+)/.exec(label.trim())![1]);
  expect(n).toBeGreaterThanOrEqual(3);
  await fold.locator('summary').first().click();
  await expect(fold.locator('li')).toHaveCount(n);
  await expect(week.getByRole('link', { name: /fw Wellington trip/ })).toBeVisible();

  // Dismiss the standing conflict from here.
  await page.goto('/today');
  await expect(page.locator('[data-conflict]', { hasText: 'fw Tutoring' }).first()).toBeVisible();
  await page.goto('/forward?h=month');
  await unfoldWorth(page);
  const standing = page
    .locator('li[data-insight="conflict.overlap"]', {
      hasText: 'overlap regularly',
    })
    .filter({ hasText: 'fw Tutoring' });
  await standing.getByRole('button', { name: /^Dismiss:/ }).click();
  await page.waitForURL(/\/forward\?h=month$/);
  await expect(page.locator('li[data-insight]', { hasText: 'fw Tutoring' })).toHaveCount(0);
  await page.goto('/forward');
  await expect(page.locator('[data-conflict]', { hasText: 'fw Tutoring' })).toHaveCount(0);
  await expect(page.locator('[data-conflict]', { hasText: 'Swimming 15:30' })).toHaveCount(0);
  await page.goto('/today');
  await expect(page.locator('[data-conflict]', { hasText: 'fw Tutoring' })).toHaveCount(0);
  await expect(
    page.locator('section[aria-labelledby="today-worth"] li[data-insight]', {
      hasText: 'fw Tutoring',
    }),
  ).toHaveCount(0);
  await context.close();

  // Alex still sees it.
  const alex = await open(browser, 'alex', '/forward?h=month');
  await expect(
    worthOf(alex.page).locator('li[data-insight]', { hasText: 'fw Tutoring' }),
  ).toHaveCount(1);
  await alex.context.close();
});

test('Season: months, the far one-off, the week’s items reachable, The usual lists Milo’s Swimming', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', '/forward?h=season');
  await expect(
    page.getByRole('navigation', { name: 'Horizon' }).getByRole('link', { name: 'Season' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('headline')).toContainText('in the next 90 days');
  const labels = await page.locator('li[data-unit] > h3').allTextContents();
  expect(labels.slice(0, 3).map((l) => l.split(',')[0]!.replace(/[●\s]+$/, ''))).toEqual([
    expect.stringMatching(/^May/),
    expect.stringMatching(/^June/),
    expect.stringMatching(/^July/),
  ]);
  await openAll(page);
  const july = unit(page, '2027-07-01');
  await expect(july.getByRole('link', { name: /fw Reunion/ })).toBeVisible();
  await expect(july.getByRole('link', { name: /fw Reunion/ })).toContainText('4 Jul');
  const may = unit(page, DAY);
  await expect(may.getByRole('link', { name: /fw Art club/ })).toBeVisible();
  await expect(may.getByRole('link', { name: /fw Wellington trip/ })).toContainText('6–7 May');

  const usual = page.locator('section[aria-label="The usual"]');
  await expect(usual).toHaveCount(1);
  const milo = usual
    .locator('div')
    .filter({ has: page.locator('h3', { hasText: /^Milo$/ }) })
    .last();
  await expect(milo).toContainText(/Wednesday[\s\S]*Swimming/);
  await expect(milo.getByRole('link', { name: /Swimming/ })).toBeVisible();
  await context.close();
});

test('Milo’s Coming up marks the overlap with Why; Not useful there clears it from Forward too', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', `/people/${ids.milo}`);
  const marks = page.locator('[data-conflict]', { hasText: 'overlaps fw Dentist 15:30' });
  await expect(marks).toHaveCount(1);
  // On a person's own line the person is not named again.
  await expect(marks.locator('p').first()).not.toContainText('· Milo');
  await marks.locator('summary', { hasText: 'Why' }).click();
  await expect(
    marks.getByText(
      'Milo is recorded on both of these, and their times overlap from 15:30 to 16:00.',
    ),
  ).toBeVisible();
  await marks.getByRole('button', { name: /^Not useful:/ }).click();
  await page.waitForURL(new RegExp(`/people/${ids.milo}$`));
  await expect(page.locator('[data-conflict]', { hasText: 'fw Dentist' })).toHaveCount(0);
  await expect(page.locator('[data-conflict]', { hasText: 'fw Art club' })).toHaveCount(0);
  await page.goto('/forward');
  await expect(unit(page, TOMORROW).locator('[data-conflict]')).toHaveCount(0);
  await context.close();

  const alex = await open(browser, 'alex', `/people/${ids.milo}`);
  await expect(
    alex.page.locator('[data-conflict]', { hasText: 'overlaps fw Dentist 15:30' }),
  ).toHaveCount(1);
  await alex.context.close();
});

test('privacy: Alex never sees Sam’s private title or its overlap, on any horizon or Sam’s page', async ({
  browser,
}) => {
  const sam = await open(browser, 'sam');
  const samCount = await overlapCount(sam.page);
  await sam.page.goto('/forward?h=month');
  await unfoldWorth(sam.page);
  await expect(sam.page.locator('li[data-insight]', { hasText: 'fw Sam private' })).toHaveCount(1);
  await sam.context.close();

  const alex = await open(browser, 'alex');
  const alexCount = await overlapCount(alex.page);
  // Sam's private pair is the one overlap Alex cannot see.
  expect(alexCount).toBe(samCount - 1);
  await expect(overlapsOf(alex.page)).toHaveText(
    `There ${alexCount === 1 ? 'is' : 'are'} ${Object.keys(NUMBERS).find(
      (k) => NUMBERS[k] === alexCount,
    )!} ${alexCount === 1 ? 'overlap' : 'overlaps'}.`,
  );
  for (const path of [
    '/forward',
    '/forward?h=month',
    '/forward?h=season',
    `/people/${ids.sam}`,
    '/today',
  ]) {
    await alex.page.goto(path);
    await openAll(alex.page);
    const body = (await alex.page.locator('body').innerText()) + (await alex.page.content());
    expect(body, path).not.toContain('fw Sam private');
    expect(body, path).not.toContain('Sam private');
  }
  await alex.context.close();
});

/** Every visible control shorter than 44px (summaries and links included; widths follow their words, as on Today). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button, summary'),
    )) {
      if (el.closest('[data-inline-link]')) continue;
      if (el.classList.contains('sr-only')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < 43.5)
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}" ${box.width}×${box.height}`,
        );
    }
    return out;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`devices at ${name}: every horizon accessible, no horizontal scroll, 44px targets`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page } = await open(browser, 'sam', '/forward', { viewport });
    const small: string[] = [];
    for (const [horizon, path] of [
      ['week', '/forward'],
      ['month', '/forward?h=month'],
      ['season', '/forward?h=season'],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle'); // hydrated before folds are opened
      await openAll(page);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      // The always-there capture bar is fixed to the bottom of the viewport; on a long
      // page whatever row sits behind it at the current scroll reads to axe as "partially
      // obscured" (target-size). Its own size is checked by the other sweeps, so lay it
      // in the flow here and check the page's content.
      await page.evaluate(() => {
        for (let el = document.getElementById('capture-text'); el; el = el.parentElement) {
          const pos = getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'sticky') el.style.position = 'static';
        }
      });
      await expectAccessible(page, `${name} ${path}`);
      small.push(...(await smallTargets(page)).map((s) => `${path}: ${s}`));
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main ul li a')].map((a) => ({
          text: (a.textContent ?? '').trim().slice(0, 30),
          height: a.getBoundingClientRect().height,
        })),
      );
      expect(rows.length, `${name} ${path} has rows`).toBeGreaterThan(0);
      expect(
        rows.filter((r) => r.height < 44).map((r) => `${path}: ${r.text} ${r.height}px`),
        `${name} ${path}: links under 44px`,
      ).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/forward-${horizon}-${name}.png`, fullPage: true });
    }
    expect(small, `${name}: controls under 44px high`).toEqual([]);
    await context.close();
  });
}

test('keyboard: Tab reaches the three horizon links and a summary; Enter opens it', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam');
  await page.waitForLoadState('networkidle');
  const reached = new Set<string>();
  let summary = false;
  for (let i = 0; i < 60 && !summary; i++) {
    await page.keyboard.press('Tab');
    const now = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return {
        tag: el?.tagName ?? '',
        text: (el?.textContent ?? '').trim(),
        inNav: !!el?.closest('nav[aria-label="Horizon"]'),
        inMain: !!el?.closest('main'),
      };
    });
    if (now.inNav) reached.add(now.text);
    if (now.tag === 'SUMMARY' && now.inMain) summary = true;
  }
  expect([...reached].sort()).toEqual(['Month', 'Season', 'Week']);
  expect(summary, 'a summary in the page was reached by Tab').toBe(true);
  const closed = await page.evaluate(
    () => (document.activeElement?.parentElement as HTMLDetailsElement).open,
  );
  expect(closed).toBe(false);
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(() => (document.activeElement?.parentElement as HTMLDetailsElement).open),
  ).toBe(true);
  await context.close();
});

test('nothing in the 30 days is lost on Month: every record is a row link, folded or shown, or in The usual', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', '/forward?h=month');
  await openAll(page);
  const main = page.locator('main');
  const expectLink = async (scope: Locator, name: RegExp) =>
    expect(scope.getByRole('link', { name }).first()).toBeVisible();
  await expectLink(main, /fw Art club/);
  await expectLink(main, /fw Dentist/);
  await expectLink(main, /fw Wellington trip/);
  await expectLink(main, /fw Garden day/);
  await expectLink(main, /fw Tutoring/);
  await expectLink(main, /fw Working bee/);
  await expectLink(main, /fw Board meeting/);
  await expectLink(main, /fw Sam private/);
  await expectLink(main, /fw Sam school run/);
  // The project target date and the scheduled task.
  const project = unit(page, '2027-05-24').getByRole('link', { name: /fw Garden project/ });
  await expect(project).toHaveAttribute('href', /^\/home\/projects\//);
  await expect(project).toContainText('Project target date');
  const task = unit(page, DAY).getByRole('link', { name: /fw Phone plumber/ });
  await expect(task).toHaveAttribute('href', /^\/tasks\//);
  // Swimming and Football are the usual: listed under The usual.
  const usual = page.locator('section[aria-label="The usual"]');
  await expect(usual.getByRole('link', { name: /Swimming/ }).first()).toBeVisible();
  await expect(usual.getByRole('link', { name: /Football/ }).first()).toBeVisible();
  await context.close();
});

// ---------------------------------------------------------------------------
// M6 final acceptance: evidence (R-3, R-5, R-6 here; R-2 in its own describe below).

test('a birthday insight’s Not useful, without JavaScript: gone from Today for Sam, still listed for Alex', async ({
  browser,
}) => {
  // Saturday 8 May is within the week; no fixture person's birthday is.
  const [person] = await q(
    `insert into person (name, role, in_household, date_of_birth, created_by, created_via, visibility)
     values ('fw Aunty Pip', 'other', false, '1960-05-08', 'fixture-sam', 'ui', 'household') returning id`,
  );
  const text = 'fw Aunty Pip’s birthday is Saturday.';
  const rowOf = (page: Page) =>
    page.locator('section[aria-labelledby="today-worth"] li[data-insight="preparation.birthday"]', {
      hasText: text,
    });
  try {
    const { context, page } = await open(browser, 'sam', '/today', { js: false });
    const worth = page.locator('section[aria-labelledby="today-worth"]');
    const more = worth.locator('summary', { hasText: /^\+ \d+ more/ });
    if ((await more.count()) > 0) await more.first().click();
    const row = rowOf(page);
    await expect(row).toHaveCount(1);
    await row.locator('summary', { hasText: 'Why' }).click();
    await row.getByRole('button', { name: `Not useful: ${text}` }).click();
    await page.waitForURL(/\/today$/);
    await openAll(page);
    await expect(rowOf(page)).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(text);
    await context.close();

    const alex = await open(browser, 'alex', '/today');
    await alex.page.waitForLoadState('networkidle');
    await openAll(alex.page);
    await expect(rowOf(alex.page)).toHaveCount(1);
    await alex.context.close();
  } finally {
    await q(`delete from insight_response where insight_key like $1`, [
      `preparation.birthday:${person!.id}:%`,
    ]);
    await q(`update person set archived_at = now() where id = $1`, [person!.id]);
  }
});

test('privacy, rendered: Alex’s Today, Forward (every horizon) and Milo’s page read the same before and after Sam adds private records', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const paths = [
    '/today',
    '/forward',
    '/forward?h=month',
    '/forward?h=season',
    `/people/${ids.milo}`,
  ];
  const read = async (adult: Adult, list: string[]) => {
    const { context, page } = await open(browser, adult, list[0]);
    const out: Record<string, string> = {};
    for (const path of list) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await openAll(page);
      out[path] = await page.locator('main').innerText();
    }
    await context.close();
    return out;
  };
  const alexBefore = await read('alex', paths);
  const samBefore = (await read('sam', ['/forward']))['/forward'];

  const made: { events: string[]; task?: string; project?: string } = { events: [] };
  try {
    // Sam's private records: an event overlapping a household event Sam is on (fw Sam school
    // run, Friday 09:30–10:30), a scheduled task in the week and a project with a target date.
    made.events.push(
      await event({
        title: 'fw R5 private appointment',
        people: ['Sam'],
        visibility: 'private',
        start: at('2027-05-07', '10:00'),
        end: at('2027-05-07', '11:00'),
      }),
    );
    made.task = (
      await q(
        `insert into task (title, status, scheduled_starts_at, scheduled_ends_at, needs, created_by, created_via, visibility)
         values ('fw R5 private task', 'open', $1::timestamptz, $2::timestamptz, '[]', 'fixture-sam', 'ui', 'private') returning id`,
        [at('2027-05-10', '12:00'), at('2027-05-10', '12:30')],
      )
    )[0]!.id;
    made.project = (
      await q(
        `insert into project (title, status, target_date, created_by, created_via, visibility)
         values ('fw R5 private project', 'active', $1, 'fixture-sam', 'ui', 'private') returning id`,
        ['2027-05-09'],
      )
    )[0]!.id;

    const alexAfter = await read('alex', paths);
    for (const path of paths) expect(alexAfter[path], path).toBe(alexBefore[path]);

    // Not vacuous: Sam's own Forward did change.
    const samAfter = (await read('sam', ['/forward']))['/forward']!;
    expect(samAfter).not.toBe(samBefore);
    expect(samAfter).toContain('fw R5 private appointment');
    expect(samAfter).toContain('fw R5 private task');
  } finally {
    await q(`update event set archived_at = now() where id = any($1::uuid[])`, [made.events]);
    if (made.task) await q(`update task set archived_at = now() where id = $1`, [made.task]);
    if (made.project)
      await q(`update project set archived_at = now() where id = $1`, [made.project]);
  }
});

const HORIZON_PATHS = {
  week: '/forward',
  month: '/forward?h=month',
  season: '/forward?h=season',
} as const;
const URL_OF = {
  week: /\/forward$/,
  month: /\/forward\?h=month$/,
  season: /\/forward\?h=season$/,
} as const;
const NEXT = { week: 'month', month: 'season', season: 'week' } as const;
const LABEL = { week: 'Week', month: 'Month', season: 'Season' } as const;

for (const name of ['phone', 'desktop'] as const) {
  test(`without JavaScript at ${name}: on every horizon the links navigate, a row’s “+ N” opens, Why opens, Dismiss lands back on the same horizon`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { context, page } = await open(browser, 'sam', '/forward', {
      js: false,
      viewport: VIEWPORTS[name],
    });
    const nav = page.getByRole('navigation', { name: 'Horizon' });
    for (const h of ['week', 'month', 'season'] as const) {
      await page.goto(HORIZON_PATHS[h]);
      await expect(nav.getByRole('link', { name: LABEL[h] })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // The horizon link to the next one navigates, as a plain link.
      await nav.getByRole('link', { name: LABEL[NEXT[h]] }).click();
      await page.waitForURL(URL_OF[NEXT[h]]);
      await expect(nav.getByRole('link', { name: LABEL[NEXT[h]] })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(nav.getByRole('link', { name: LABEL[h] })).not.toHaveAttribute(
        'aria-current',
        /./,
      );
      await page.goto(HORIZON_PATHS[h]);

      // A row's "+ N" opens its fold.
      const fold = page
        .locator('li[data-unit] details')
        .filter({ has: page.locator(':scope > summary', { hasText: /^\+ \d+/ }) })
        .first();
      const folded = fold.locator('a[href]').first();
      await expect(folded, `${h}: folded link`).toBeHidden();
      await fold.locator(':scope > summary').click();
      await expect(folded, `${h}: folded link`).toBeVisible();

      if (h === 'week') {
        // Week: a mark's Why, then its Dismiss.
        const mark = unit(page, TOMORROW).locator('[data-conflict]', {
          hasText: 'overlaps fw Dentist 15:30 · Milo',
        });
        await mark.locator('summary', { hasText: 'Why' }).click();
        await expect(
          mark.getByText(
            'Milo is recorded on both of these, and their times overlap from 15:30 to 16:00.',
          ),
        ).toBeVisible();
        await mark.getByRole('button', { name: /^Dismiss:/ }).click();
        await page.waitForURL(URL_OF.week);
        await expect(unit(page, TOMORROW).locator('[data-conflict]')).toHaveCount(0);
      } else {
        // Month and Season: Worth knowing's first row, its Why, then its Dismiss.
        const first = worthOf(page).locator(':scope > ul > li[data-insight]').first();
        const said = ((await first.locator(':scope > p').textContent()) ?? '').trim();
        expect(said.length, `${h}: first Worth knowing row`).toBeGreaterThan(0);
        await first.locator('summary', { hasText: 'Why' }).click();
        await expect(first.getByRole('button', { name: /^Not useful:/ })).toBeVisible();
        await first.getByRole('button', { name: /^Dismiss:/ }).click();
        await page.waitForURL(URL_OF[h]);
        await unfoldWorth(page);
        await expect(
          page.locator('li[data-insight]').filter({ has: page.getByText(said, { exact: true }) }),
        ).toHaveCount(0);
      }
    }
    await context.close();
    await q(`delete from insight_response where insight_key like 'conflict.%'`);
  });
}

test('phone, first screen on Month: the horizons, the headline and the first Worth knowing row are above the fold', async ({
  browser,
}) => {
  const { context, page } = await open(browser, 'sam', '/forward?h=month');
  const height = VIEWPORTS.phone.height;
  for (const [what, el] of [
    ['horizons', page.getByRole('navigation', { name: 'Horizon' })],
    ['headline', page.getByTestId('headline')],
    ['first Worth knowing row', worthOf(page).locator('li[data-insight]').first()],
  ] as const) {
    const box = await el.boundingBox();
    expect(box, what).toBeTruthy();
    expect(box!.y + box!.height, what).toBeLessThanOrEqual(height);
  }
  await context.close();
});

test('two columns on a tablet and desktop: Coming up sits to the right of the headline; on a phone below the header', async ({
  browser,
}) => {
  const coming = (page: Page) => page.locator('section[aria-labelledby="forward-coming"]');
  for (const viewport of [VIEWPORTS['tablet-portrait'], VIEWPORTS.desktop]) {
    const { context, page } = await open(browser, 'sam', '/forward', { viewport });
    const head = (await page.getByTestId('headline').boundingBox())!;
    const col = (await coming(page).boundingBox())!;
    expect(col.x, `${viewport.width}px`).toBeGreaterThan(head.x + head.width / 2);
    await context.close();
  }
  const { context, page } = await open(browser, 'sam', '/forward');
  const header = (await page.locator('main header').first().boundingBox())!;
  const col = (await coming(page).boundingBox())!;
  expect(col.y).toBeGreaterThanOrEqual(header.y + header.height);
  await context.close();
});

// R-2: Forward's first run, quiet and stale scenes, with everything else held aside
// (as today-screen.spec does) and put back exactly afterwards.
test.describe('held aside: Forward’s first run, quiet and stale', () => {
  const held = {
    event: [] as string[],
    task: [] as string[],
    project: [] as string[],
    calendar_source: [] as string[],
  };
  const CALENDARS = ['fw Family calendar', 'fw Quiet calendar'];
  const archiveIds = async (table: string, list: string[]) =>
    list.length
      ? q(`update ${table} set archived_at = now() where id = any($1::uuid[])`, [list])
      : [];
  const restoreIds = async (table: string, list: string[]) =>
    list.length
      ? q(`update ${table} set archived_at = null where id = any($1::uuid[])`, [list])
      : [];

  test.beforeAll(async () => {
    for (const table of Object.keys(held) as (keyof typeof held)[]) {
      held[table] = (await q(`select id from ${table} where archived_at is null`)).map(
        (r) => r.id!,
      );
      await archiveIds(table, held[table]);
    }
  });
  test.afterAll(async () => {
    await q(`update calendar_source set archived_at = now() where name = any($1::text[])`, [
      CALENDARS,
    ]);
    for (const table of Object.keys(held) as (keyof typeof held)[])
      await restoreIds(table, held[table]);
  });

  /** The fixture's two weekly series (Swimming, Football), back for one scene; returns their ids. */
  async function usualSeries(): Promise<string[]> {
    const rows = await q(
      `select id from event where id = any($1::uuid[]) and title in ('Swimming', 'Football')
         and rrule is not null and recurrence_parent_id is null`,
      [held.event],
    );
    const list = rows.map((r) => r.id!);
    expect(list.length).toBe(2);
    await restoreIds('event', list);
    return list;
  }

  /** A synthetic calendar, last updated at `synced`. */
  async function calendar(name: string, tag: string, synced: string) {
    const id = await seedCalendar({
      owner: 'fixture-sam',
      name,
      visibility: 'household',
      fingerprintTag: tag,
    });
    await q(
      `update calendar_source set archived_at = null, last_attempt_at = $2::timestamptz, last_synced_at = $2::timestamptz, last_sync_status = 'ok' where id = $1`,
      [id, synced],
    );
    return id;
  }

  test('first run: no calendar and nothing recorded says HOME doesn’t know your calendars yet', async ({
    browser,
  }) => {
    const { context, page } = await open(browser, 'sam');
    await expect(page.getByTestId('headline')).toHaveText('HOME doesn’t know your calendars yet.');
    await expect(page.getByRole('link', { name: 'Connect a calendar ›' })).toHaveAttribute(
      'href',
      '/settings/calendars',
    );
    const units = page.locator('li[data-unit]');
    await expect(units).toHaveCount(7);
    for (let n = 0; n < 7; n++)
      await expect(units.nth(n).locator(':scope > p')).toHaveText('Nothing recorded');
    await expect(page.locator('section[aria-labelledby="forward-coming"] a[href]')).toHaveCount(0);
    await expect(page.locator('[data-conflict]')).toHaveCount(0);
    await expect(page.getByTestId('qualifier')).toHaveCount(0);
    await context.close();
  });

  test('quiet: a fresh calendar and only the usual says just the usual; each day says what is recorded', async ({
    browser,
  }) => {
    const usual = await usualSeries();
    try {
      await calendar('fw Quiet calendar', 'fwquietcal', at(DAY, '06:00'));
      const { context, page } = await open(browser, 'sam');
      await expect(page.getByTestId('headline')).toHaveText(
        'Just the usual in the next seven days.',
      );
      await expect(page.getByTestId('qualifier')).toHaveCount(0);
      // Swimming is on Wednesdays, Football on Saturdays.
      const expected: Record<string, string> = {
        '2027-05-05': 'Nothing recorded besides the usual',
        '2027-05-06': 'Nothing recorded',
        '2027-05-07': 'Nothing recorded',
        '2027-05-08': 'Nothing recorded besides the usual',
        '2027-05-09': 'Nothing recorded',
        '2027-05-10': 'Nothing recorded',
        '2027-05-11': 'Nothing recorded',
      };
      await expect(page.locator('li[data-unit]')).toHaveCount(7);
      for (const [date, words] of Object.entries(expected))
        await expect(unit(page, date).locator(':scope > p'), date).toHaveText(words);
      await expect(page.locator('[data-conflict]')).toHaveCount(0);
      await expect(worthOf(page)).toHaveCount(0);
      await context.close();
    } finally {
      await archiveIds('event', usual);
      await q(`update calendar_source set archived_at = now() where name = 'fw Quiet calendar'`);
    }
  });

  test('stale: a calendar last updated two days ago is said, plainly, under the headline and in Worth knowing', async ({
    browser,
  }) => {
    const usual = await usualSeries();
    try {
      await calendar('fw Family calendar', 'fwfamilycal', at('2027-05-03', '09:00'));
      // Without JavaScript, so the page's refresh-on-use never runs and the scene stays put.
      const { context, page } = await open(browser, 'sam', '/forward', { js: false });
      await expect(page.getByTestId('headline')).toHaveText(
        'Just the usual in the next seven days.',
      );
      await expect(page.getByTestId('qualifier')).toHaveText('As far as HOME knows.');
      const health = worthOf(page).locator('[data-insight^="data_health."]');
      await expect(health).toHaveCount(1);
      await expect(health.locator(':scope > p')).toHaveText(
        'fw Family calendar hasn’t updated since Monday.',
      );
      const words = await page.locator('main').innerText();
      expect(words).not.toMatch(/\b(failed|error|broken|stale|urgent)\b/i);
      await context.close();
    } finally {
      await archiveIds('event', usual);
      await q(`update calendar_source set archived_at = now() where name = 'fw Family calendar'`);
    }
  });
});
