import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { seedCalendar, seedSyncedEvent } from './calendar-feeds';
import { withDb } from './helpers';

// M3 acceptance (contract §4.5, §10 items 10 and 11): the accessibility and
// device pass over every M3 screen, at the four approved viewports. Each
// screen: no serious or critical axe violation (with every folded section
// in the page opened, so what More hides is checked too; the ⌂ menu stays
// closed, since opened it lies over the page by design), no horizontal
// scroll, and every control a 44×44px target. Then the key flows by
// keyboard alone, focus after a refusal kept clear of the sticky header and
// capture bar, and reduced motion. Synthetic data only.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const one = async (sql: string) => (await q(sql))[0]?.id;

/** One of each M3 screen, over the seeded family, as Sam sees it. */
async function screens(): Promise<string[]> {
  const person = await one(`select id from person where name = 'Milo'`);
  const event = await one(`select id from event where title = 'Swimming'`);
  const project = await one(`select id from project where title = 'Back fence'`);
  const task = await one(`select id from task where title = 'Paint the back fence'`);
  const capture = await one(
    `select id from capture where created_by = 'fixture-sam' and status in ('new', 'proposed') and archived_at is null order by created_at limit 1`,
  );
  const archivedPerson = await one(
    `select id from person where name like 'canary-archived-%' and archived_at is not null`,
  );
  for (const id of [person, event, project, task, capture, archivedPerson])
    expect(id, 'a seeded record for the sweep').toBeTruthy();
  // M4 Package 5: a connected and a disconnected calendar of Sam's.
  const calendar = await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sweep calendar',
    visibility: 'household',
    fingerprintTag: 'sweepconnected',
  });
  const disconnected = await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sweep calendar (disconnected)',
    visibility: 'household',
    disconnected: true,
    fingerprintTag: 'sweepdisconnected',
  });
  // M4 Package 6: a synced event with no people and no detail (the one-line
  // row) on Today and Forward, and a timed one, with their own pages.
  const { d, f } = (
    await q(
      `select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d,
              to_char(now() at time zone 'Pacific/Auckland' + interval '2 days', 'YYYY-MM-DD') as f`,
    )
  )[0] as { d: string; f: string };
  const oneLine = await seedSyncedEvent({
    calendarId: calendar,
    owner: 'fixture-sam',
    visibility: 'household',
    uid: 'sweep-one-line@example.test',
    title: 'Bins out',
    date: d,
  });
  await seedSyncedEvent({
    calendarId: calendar,
    owner: 'fixture-sam',
    visibility: 'household',
    uid: 'sweep-timed@example.test',
    title: 'Sweep clinic',
    startsAt: `${f}T10:00:00+13:00`,
    endsAt: `${f}T11:00:00+13:00`,
  });
  return [
    '/today',
    '/forward',
    `/events/${oneLine}`,
    `/events/${oneLine}/people`,
    '/people',
    '/people/new',
    `/people/${person}`,
    `/people/${person}/edit`,
    `/people/${archivedPerson}`,
    '/home',
    '/home/projects/new',
    `/home/projects/${project}`,
    `/home/projects/${project}/edit`,
    '/tasks',
    '/tasks/new',
    `/tasks/${task}`,
    '/events/new',
    `/events/${event}`,
    `/events/${event}/edit`,
    '/sort',
    `/sort/${capture}`,
    ...['task', 'event', 'project', 'note', 'know'].map((as) => `/sort/${capture}/${as}`),
    '/settings',
    '/settings/you',
    '/settings/calendars',
    '/settings/calendars/new',
    `/settings/calendars/${calendar}`,
    `/settings/calendars/${calendar}/edit`,
    `/settings/calendars/${disconnected}`,
    `/settings/calendars/${disconnected}/edit`,
    `/settings/calendars/${disconnected}/reconnect`,
    '/settings/knows',
    '/settings/archived',
    '/settings/activity',
    '/settings/export',
    '/nothing-here',
  ];
}

/**
 * Every visible control smaller than 44×44px. A checkbox counts as its label
 * (the label is the target). The skip link is measured when focused, where it
 * is seen. Links inside a sentence (WCAG 2.5.8's inline exception) are listed
 * by the caller.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type=hidden]), select, textarea, summary',
    );
    for (const el of Array.from(controls)) {
      if (el.closest('[data-inline-link]')) continue;
      if (el.classList.contains('sr-only') && document.activeElement !== el) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const input = el as HTMLInputElement;
      const box =
        (input.type === 'checkbox' || input.type === 'radio') && input.labels?.[0]
          ? input.labels[0].getBoundingClientRect()
          : el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < 43.5 || box.height < 43.5) {
        const name = (el.textContent || input.name || el.getAttribute('aria-label') || '').trim();
        out.push(`${el.tagName.toLowerCase()} "${name.slice(0, 40)}" ${box.width}×${box.height}`);
      }
    }
    return out;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`every M3 and M4 screen at ${name}: accessible, no horizontal scroll, 44px targets`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    const small: string[] = [];
    for (const path of await screens()) {
      await page.goto(path);
      await page.waitForLoadState('networkidle'); // hydrated before folds are opened
      await page.evaluate(() =>
        document.querySelectorAll('main details').forEach((d) => d.setAttribute('open', '')),
      );
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
      small.push(...(await smallTargets(page)).map((s) => `${path}: ${s}`));
    }
    // Every event row on Today and Forward, the one-line synced row among
    // them, is a 44px target (M4 Package 6).
    for (const path of ['/today', '/forward']) {
      await page.goto(path);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main ul li a')].map((a) => ({
          text: (a.textContent ?? '').trim().slice(0, 30),
          height: a.getBoundingClientRect().height,
        })),
      );
      expect(rows.length, `${name} ${path} has event rows`).toBeGreaterThan(0);
      expect(
        rows.filter((r) => r.height < 44).map((r) => `${path}: ${r.text} ${r.height}px`),
        `${name}: event rows under 44px`,
      ).toEqual([]);
    }
    // The skip link, where it is seen: focused.
    await page.goto('/today');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    small.push(...(await smallTargets(page)).filter((s) => s.includes('Skip to content')));
    expect(small, `${name}: controls under 44×44px`).toEqual([]);
    await context.close();
  });
}

/** Tab until the focused element matches, within a bound; fails if it never does. */
async function tabTo(page: Page, matches: (el: Element) => boolean, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((src) => {
      const el = document.activeElement;
      return el ? new Function('el', `return (${src})(el)`)(el) : false;
    }, matches.toString());
    if (hit) return;
  }
  throw new Error('never reached by Tab');
}

test('by keyboard alone: skip to content, keep a capture, add a task, mark it done and undo', async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/today');

  // The first Tab is the skip link; it moves focus past the header.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#content$/);

  // Capture: Tab to the bar, type, Enter.
  const words = 'p10 keyboard: call the plumber about the tap';
  await tabTo(page, (el) => el.id === 'capture-text');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
  await expect(page.locator('#capture-status')).toContainText('Kept');

  // A task: the form by keyboard, submitted with Enter.
  await page.goto('/tasks/new');
  await tabTo(page, (el) => (el as HTMLInputElement).name === 'title');
  const title = 'p10 keyboard task';
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

  // Done from To do, by keyboard; Undo is focused and puts it back.
  await page.goto('/tasks');
  await tabTo(page, (el) => (el.getAttribute('aria-label') ?? '').includes('p10 keyboard task'));
  await page.keyboard.press('Enter');
  const undo = page.getByRole('button', { name: /Undo/ });
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toContainText(title);

  // The ⌂ menu opens and closes by keyboard.
  await page.goto('/today');
  await tabTo(page, (el) => el.tagName === 'SUMMARY' || el.getAttribute('aria-haspopup') !== null);
  await page.keyboard.press('Enter');
  const places = page.getByRole('navigation', { name: 'More places' });
  await expect(places.getByRole('link', { name: 'To sort', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(places.getByRole('link', { name: 'To sort', exact: true })).toBeHidden();

  await q(`update task set archived_at = now() where title = $1`, [title]);
  await q(`update capture set archived_at = now() where text = $1`, [words]);
});

/** The focused element is fully in view and nothing (header, capture bar) sits on top of it. */
async function focusUnobscured(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'nothing focused';
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) return `out of view: ${r.top}–${r.bottom}`;
    for (const [x, y] of [
      [r.left + 2, r.top + 2],
      [r.right - 2, r.bottom - 2],
      [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
    ] as const) {
      const at = document.elementFromPoint(x, y);
      if (!at || !(el === at || el.contains(at) || at.contains(el)))
        return `covered at ${Math.round(x)},${Math.round(y)} by ${at?.tagName}.${at?.className}`;
    }
    return null;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`after a refusal, focus lands on the field and is not hidden: ${name}`, async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'alex', viewport);
    // A field refusal at the top of a long form.
    await page.goto('/people/new');
    await page.getByLabel('Name', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'Add them' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
    expect(await focusUnobscured(page), `${name} /people/new`).toBeNull();

    // A field refusal lower down: an event that ends before it starts.
    await page.goto('/events/new');
    await page.getByLabel('What', { exact: true }).fill('p10 refusal');
    await page.getByLabel('From', { exact: true }).fill('10:00');
    await page.getByLabel('To', { exact: true }).fill('09:00');
    await page.getByRole('button', { name: /Add it|Save|Add the event/ }).click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
    expect(await focusUnobscured(page), `${name} /events/new`).toBeNull();

    // A refusal that names no field: the form's message takes focus.
    const milo = await one(`select id from person where name = 'Milo'`);
    await page.goto(`/people/${milo}/edit`);
    await page.locator('summary', { hasText: 'More' }).click();
    await page.getByLabel('Who can see this').selectOption('private');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-form-message]')).toBeFocused();
    expect(await focusUnobscured(page), `${name} person edit`).toBeNull();

    // M4 Package 5: a field refusal on the connect form (a name that is an
    // address), with the secret field cleared; and a refusal that names no
    // field on the reconnect form (the wrong address), focusing the message.
    const sam = await fixtureAdultContext(browser, 'sam', viewport);
    await sam.page.goto('/settings/calendars/new');
    await sam.page.getByLabel('Name', { exact: true }).fill('p10 https://refusal');
    await sam.page
      .getByLabel('Google Calendar address')
      .fill(
        'https://calendar.google.com/calendar/ical/synthetic%40example.test/private-p10refusal0000000000000000/basic.ics',
      );
    await sam.page.getByRole('button', { name: 'Connect' }).click();
    await expect(sam.page.getByLabel('Name', { exact: true })).toBeFocused();
    expect(await focusUnobscured(sam.page), `${name} /settings/calendars/new`).toBeNull();
    await expect(sam.page.getByLabel('Google Calendar address')).toHaveValue('');
    const disconnected = await seedCalendar({
      owner: 'fixture-sam',
      name: 'Sweep calendar (disconnected)',
      visibility: 'household',
      disconnected: true,
      fingerprintTag: 'sweepdisconnected',
    });
    await sam.page.goto(`/settings/calendars/${disconnected}/reconnect`);
    await sam.page
      .getByLabel('Google Calendar address')
      .fill(
        'https://calendar.google.com/calendar/ical/synthetic%40example.test/private-p10wrong00000000000000000000/basic.ics',
      );
    await sam.page.getByRole('button', { name: 'Reconnect' }).click();
    await expect(sam.page.locator('[data-form-message]')).toBeFocused();
    expect(await focusUnobscured(sam.page), `${name} calendar reconnect`).toBeNull();
    await sam.context.close();

    // The capture bar's own refusal keeps focus in the box, in view.
    await page.locator('#capture-text').fill('   ');
    await page.getByRole('button', { name: 'Keep' }).click();
    await expect(page.locator('#capture-text')).toBeFocused();
    expect(await focusUnobscured(page), `${name} capture bar`).toBeNull();
    await context.close();
  });
}

test('reduced motion: animation and transition are switched off when asked, scrolling is instant', async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await signInAsFixtureAdult(page, 'sam');
  for (const path of ['/today', '/tasks', '/settings/knows']) {
    await page.goto(path);
    const moving = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const s = getComputedStyle(el);
        const long = (v: string) =>
          v.split(',').some((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000) > 0.01);
        if (long(s.transitionDuration) || long(s.animationDuration))
          out.push(`${el.tagName}.${el.className}`);
      }
      if (getComputedStyle(document.documentElement).scrollBehavior !== 'auto')
        out.push('html scroll-behavior');
      return out;
    });
    expect(moving, path).toEqual([]);
  }
  await context.close();
});
