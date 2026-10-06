import { expect, test, type Page } from '@playwright/test';
import { SEQUENCES } from '../fixtures/calendars/sequences';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { addressFor, failFeed, holdFeed, seedCalendar, writeFeed } from './calendar-feeds';
import { fixtureAdultContext, signInAsFixtureAdult } from './fixture-adults';
import { withDb } from './helpers';

// Settings › Calendars (M4 contract §5.1, §8.5; ADR 0007 §43), over the
// seeded synthetic family and synthetic Google-shaped feeds. Every address
// here is synthetic; none is a real calendar.

const TOKEN = 'e2esamwork0000000000000000000000';
const TOKEN2 = 'e2ealexfamily000000000000000000';
const SECRET = addressFor(TOKEN);
const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);

const calendarIdNamed = async (name: string) =>
  (await q(`select id from calendar_source where name = $1`, [name]))[0]?.id;

async function connect(page: Page, name: string, address: string, visibility = 'household') {
  await page.goto('/settings/calendars/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Google Calendar address').fill(address);
  await page.getByLabel('Who can see it').selectOption(visibility);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForURL(/\/settings\/calendars\/[0-9a-f-]{36}\?connected=1$/);
  return page.url().match(/calendars\/([0-9a-f-]{36})/)![1]!;
}

test.beforeAll(() => {
  writeFeed(TOKEN, SEQUENCES.added[0]!);
  writeFeed(TOKEN2, SEQUENCES.initial[0]!);
});

test('Settings lists Calendars; the list starts calm and says HOME only reads', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Calendars' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Calendars' })).toBeVisible();
  await expect(page.getByText('HOME only reads calendars.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a calendar' })).toBeVisible();
  await expectAccessible(page, 'calendars list');
  await expectNoHorizontalScroll(page, 'calendars list');
});

test('connect: the address is asked for once, never shown again, and the calendar’s page reads calmly', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.goto('/settings/calendars/new');
  await expect(page.getByLabel('Google Calendar address')).toHaveAttribute('type', 'password');
  await expect(page.getByText('It never changes anything in Google Calendar.')).toBeVisible();
  await page.locator('summary', { hasText: 'Where to find the address' }).click();
  await expect(page.getByText('Secret address in iCal format')).toBeVisible();

  // A refusal keeps the other answers, clears the secret and says so; focus lands on the field.
  await page.getByLabel('Name', { exact: true }).fill('Sam’s work');
  await page.getByLabel('Google Calendar address').fill('https://example.test/not-google.ics');
  await page.getByLabel('Usual kind').selectOption('work');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('That isn’t a Google Calendar secret address.')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Sam’s work');
  await expect(page.getByLabel('Usual kind')).toHaveValue('work');
  await expect(page.getByLabel('Google Calendar address')).toHaveValue('');
  await expect(page.getByText('Please paste it again.')).toBeVisible();
  expect(await page.content()).not.toContain('not-google.ics');

  await page.getByLabel('Google Calendar address').fill(SECRET);
  await page.getByRole('checkbox', { name: /Milo/ }).check();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForURL(/\?connected=1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sam’s work' })).toBeVisible();
  await expect(page.getByText('Connected. Its events arrive with the first update.')).toBeVisible();
  await expect(page.getByText('Yours · Everyone at home')).toBeVisible();
  // The secret, its token and any machinery are nowhere in the page.
  const html = await page.content();
  for (const s of [TOKEN, 'calendar.google.com', 'private-', 'hc1.', 'fp2.'])
    expect(html, s).not.toContain(s);
  await expect(page.getByRole('link', { name: 'Change settings' })).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Disconnect' })).toBeVisible();
  await expectAccessible(page, 'calendar page');
});

test('Refresh now: events arrive, freshness reads in words; an unchanged refresh is calm; the list shows it', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s work');
  await page.goto(`/settings/calendars/${id}`);
  // The page may already have refreshed on use; Refresh now works either way.
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByText('Updated just now')).toBeVisible();
  const events = await q(`select title from event where calendar_source_id = $1 order by title`, [
    id,
  ]);
  expect(events.map((e) => e.title)).toContain('Swimming');
  await page.goto('/settings/calendars');
  await expect(page.getByRole('link', { name: /Sam’s work/ })).toContainText(
    'Updated just now · Everyone at home',
  );
});

test('a second refresh while one is running reads “Already updating”', async ({ browser }) => {
  const id = await calendarIdNamed('Sam’s work');
  const a = await fixtureAdultContext(browser, 'sam', { width: 1024, height: 768 });
  const b = await fixtureAdultContext(browser, 'alex', { width: 1024, height: 768 });
  await a.page.goto(`/settings/calendars/${id}`);
  await b.page.goto(`/settings/calendars/${id}`);
  holdFeed(TOKEN, true);
  try {
    const first = a.page.getByRole('button', { name: 'Refresh now' }).click();
    await b.page.waitForTimeout(800);
    await b.page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(b.page.getByText('Already updating. Give it a moment.')).toBeVisible();
    holdFeed(TOKEN, false);
    await first;
    await a.page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  } finally {
    holdFeed(TOKEN, false);
    await a.context.close();
    await b.context.close();
  }
});

test('failure reads in household words and keeps what HOME had; a partial refresh says a few things were skipped', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s work');
  const before = (
    await q(
      `select count(*)::int as n from event where calendar_source_id = $1 and archived_at is null`,
      [id],
    )
  )[0]!.n;
  for (const [code, words] of [
    ['unreachable', 'Couldn’t update just now.'],
    ['address_rejected', 'The Google Calendar address needs attention'],
    ['bad_response', 'HOME couldn’t read this calendar'],
    ['too_large', 'more history than HOME can read at once'],
  ] as const) {
    failFeed(TOKEN, code);
    await page.goto(`/settings/calendars/${id}`);
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
    await expect(page.getByText(words)).toBeVisible();
    const html = await page.content();
    for (const raw of [code, 'unreachable', 'bad_response', 'SafeFetch', 'Error:'])
      expect(html, raw).not.toContain(raw);
  }
  failFeed(TOKEN, null);
  expect(
    (
      await q(
        `select count(*)::int as n from event where calendar_source_id = $1 and archived_at is null`,
        [id],
      )
    )[0]!.n,
  ).toBe(before);
  writeFeed(TOKEN, SEQUENCES.malformed[0]!);
  await page.goto(`/settings/calendars/${id}`);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByText(/with a few things skipped/)).toBeVisible();
  writeFeed(TOKEN, SEQUENCES.added[0]!);
});

test('change settings, connected: name, who can see it, kind and people; the events follow', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s work');
  await page.goto(`/settings/calendars/${id}`);
  await page.getByRole('link', { name: 'Change settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Change Sam’s work' })).toBeVisible();
  expect(await page.content()).not.toContain('Google Calendar address');
  await page.getByLabel('Name', { exact: true }).fill('Sam’s work (renamed)');
  await page.getByLabel('Usual kind').selectOption('appointment');
  await page.getByRole('checkbox', { name: /Milo/ }).uncheck();
  await page.getByRole('checkbox', { name: /Isla/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Sam’s work (renamed)' })).toBeVisible();
  await expect(page.getByText('Appointment')).toBeVisible();
  await expect(page.getByText('Isla')).toBeVisible();
  expect(
    (await q(`select distinct kind from event where calendar_source_id = $1`, [id])).map(
      (r) => r.kind,
    ),
  ).toEqual(['appointment']);
  await page.goto(`/settings/calendars/${id}/edit`);
  await page.getByLabel('Name', { exact: true }).fill('Sam’s work');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
});

test('duplicate: the same live address is refused for either adult; a private calendar is the owner’s alone', async ({
  browser,
}) => {
  const sam = await fixtureAdultContext(browser, 'sam', { width: 375, height: 812 });
  await sam.page.goto('/settings/calendars/new');
  await sam.page.getByLabel('Name', { exact: true }).fill('Again');
  await sam.page
    .getByLabel('Google Calendar address')
    .fill(SECRET.replace('https://', 'webcal://'));
  await sam.page.getByRole('button', { name: 'Connect' }).click();
  await expect(sam.page.getByText('That calendar is already connected in HOME.')).toBeVisible();
  await sam.context.close();

  const alex = await fixtureAdultContext(browser, 'alex', { width: 375, height: 812 });
  await alex.page.goto('/settings/calendars/new');
  await alex.page.getByLabel('Name', { exact: true }).fill('Again');
  await alex.page.getByLabel('Google Calendar address').fill(SECRET);
  await alex.page.getByRole('button', { name: 'Connect' }).click();
  await expect(alex.page.getByText('That calendar is already connected in HOME.')).toBeVisible();
  const privateId = await connect(alex.page, 'Alex private', addressFor(TOKEN2), 'private');
  await alex.page.goto('/settings/calendars');
  await expect(alex.page.getByRole('link', { name: /Alex private/ })).toContainText('Just me');
  await alex.context.close();

  const sam2 = await fixtureAdultContext(browser, 'sam', { width: 375, height: 812 });
  for (const path of [
    `/settings/calendars/${privateId}`,
    `/settings/calendars/${privateId}/edit`,
    `/settings/calendars/${privateId}/reconnect`,
  ]) {
    const r = await sam2.page.request.get(path);
    expect(r.status(), path).toBe(404);
    expect(await r.text()).not.toContain('Alex private');
  }
  expect(await (await sam2.page.request.get('/settings/calendars')).text()).not.toContain(
    'Alex private',
  );
  await sam2.context.close();
});

test('the other adult sees a household calendar, may refresh it, and gets no controls to manage it', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  const id = await calendarIdNamed('Sam’s work');
  await page.goto(`/settings/calendars/${id}`);
  await expect(page.getByText('Sam’s · Everyone at home')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change settings' })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Disconnect' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reconnect' })).toHaveCount(0);
  expect((await page.request.get(`/settings/calendars/${id}/edit`)).status()).toBe(404);
  expect((await page.request.get(`/settings/calendars/${id}/reconnect`)).status()).toBe(404);
});

test('disconnect, then edit while disconnected (the privacy recovery), then reconnect with the same address', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s work');
  // A person Sam added (only the adder can change who sees a person).
  await page.goto('/people/new');
  await page.getByLabel('Name', { exact: true }).fill('Coach Rehearsal');
  await page.getByLabel('Role').selectOption('other');
  await page.getByRole('button', { name: 'Add them' }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]+$/);
  await page.goto(`/settings/calendars/${id}/edit`);
  await page.getByRole('checkbox', { name: /Coach Rehearsal/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));

  await page.locator('summary', { hasText: 'Disconnect' }).click();
  await expect(
    page.getByText('What HOME already knows is kept, and you can reconnect it later.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('Disconnected.', { exact: true })).toBeVisible();
  await expect(page.getByText('HOME isn’t reading this calendar at the moment.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reconnect' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change settings' })).toBeVisible();
  expect(
    (
      await q(
        `select count(*)::int as n from event where calendar_source_id = $1 and archived_at is null`,
        [id],
      )
    )[0]!.n,
  ).toBe(0);
  expect(
    (await q(`select count(*)::int as n from event where calendar_source_id = $1`, [id]))[0]!.n,
  ).toBeGreaterThan(0);

  // The coach is named by a disconnected household calendar: can't go private until let go.
  const coach = (await q(`select id from person where name = 'Coach Rehearsal'`))[0]!.id;
  await page.goto(`/people/${coach}/edit`);
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Who can see this').selectOption('private');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('Things everyone can see point to this, so it can’t be made private yet.'),
  ).toBeVisible();

  await page.goto(`/settings/calendars/${id}/edit`);
  await expect(page.getByText('Disconnected. Its settings can still be changed.')).toBeVisible();
  await page.getByRole('checkbox', { name: /Coach Rehearsal/ }).uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByText('Disconnected.', { exact: true })).toBeVisible(); // still
  await page.goto(`/people/${coach}/edit`);
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Who can see this').selectOption('private');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/people/${coach}$`));
  await page.goto(`/people/${coach}/edit`);
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Who can see this').selectOption('household');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/people/${coach}$`));

  // Connecting the same address anew is refused and points at reconnecting.
  await page.goto('/settings/calendars/new');
  await page.getByLabel('Name', { exact: true }).fill('Same again');
  await page.getByLabel('Google Calendar address').fill(SECRET);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('You connected that calendar before.')).toBeVisible();

  await page.goto(`/settings/calendars/${id}`);
  await page.getByRole('link', { name: 'Reconnect' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}/reconnect$`));
  await page.goto(`/settings/calendars/${id}/reconnect`); // a full load: the HTML, not the last page's
  await expect(page.getByRole('heading', { level: 1, name: 'Reconnect Sam’s work' })).toBeVisible();
  expect(await page.content()).not.toContain('Who can see it');
  await page
    .getByLabel('Google Calendar address')
    .fill(addressFor('wrongaddress00000000000000000000'));
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(
    page.getByText('That isn’t the address this calendar was connected with.'),
  ).toBeVisible();
  expect(await page.content()).not.toContain('wrongaddress');
  await page.getByLabel('Google Calendar address').fill(SECRET);
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await page.waitForURL(/\?reconnected=1$/);
  await expect(page.getByText('Connected again.')).toBeVisible();
  await expect(page.getByText('Appointment')).toBeVisible(); // settings intact
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  expect(
    (
      await q(
        `select count(*)::int as n from event where calendar_source_id = $1 and archived_at is null`,
        [id],
      )
    )[0]!.n,
  ).toBeGreaterThan(0);
});

test('the secret address is in no log line, audit row or export', async ({ page }) => {
  await signInAsFixtureAdult(page, 'sam');
  const audit = await q(
    `select coalesce(summary, '') || coalesce(meta::text, '') as t from audit_log`,
  );
  for (const r of audit) {
    expect(r.t).not.toContain(TOKEN);
    expect(r.t).not.toContain('calendar.google.com');
  }
  const res = await page.request.post('/settings/export/download', { form: {} });
  const body = await res.text();
  for (const s of [TOKEN, 'calendar.google.com', 'hc1.', 'fp2.', 'credentials'])
    expect(body, s).not.toContain(s);
  expect(body).toContain('"calendars"');
  expect(body).toContain('Sam’s work');
});

test('without JavaScript: connect, change settings, refresh, disconnect and reconnect all work', async ({
  browser,
}) => {
  const token = 'e2enojs0000000000000000000000000';
  writeFeed(token, SEQUENCES.initial[0]!);
  const { context, page } = await fixtureAdultContext(
    browser,
    'alex',
    { width: 375, height: 812 },
    { javaScriptEnabled: false },
  );
  const id = await connect(page, 'No-script calendar', addressFor(token));
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByText('Updated just now')).toBeVisible();
  await page.goto(`/settings/calendars/${id}/edit`);
  await page.getByLabel('Name', { exact: true }).fill('No-script calendar 2');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'No-script calendar 2' })).toBeVisible();
  await page.locator('summary', { hasText: 'Disconnect' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForURL(new RegExp(`/settings/calendars/${id}$`));
  await expect(page.getByText('Disconnected.', { exact: true })).toBeVisible();
  await page.goto(`/settings/calendars/${id}/reconnect`);
  await page.getByLabel('Google Calendar address').fill(addressFor(token));
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await page.waitForURL(/\?reconnected=1$/);
  await context.close();
});

test('refresh on use: a stale calendar is refreshed after the list renders, without blocking it', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const id = await calendarIdNamed('Sam’s work');
  await q(
    `update calendar_source set last_attempt_at = now() - interval '20 minutes', last_synced_at = now() - interval '20 minutes', feed_hash = null where id = $1`,
    [id],
  );
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith('/calendars/refresh') && r.request().method() === 'POST',
  );
  await page.goto('/settings/calendars');
  await expect(page.getByRole('link', { name: /Sam’s work/ })).toBeVisible(); // shown at once, with last-known state
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole('link', { name: /Sam’s work/ })).toContainText('Updated just now');
});

test('a calendar seeded for the sweeps shows a calm line when its stored address cannot be read', async ({
  page,
}) => {
  const id = await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sweep calendar',
    visibility: 'household',
    fingerprintTag: 'sweepconnected',
  });
  await signInAsFixtureAdult(page, 'sam');
  await page.goto(`/settings/calendars/${id}`);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(page.getByText('HOME can’t read this calendar’s address any more.')).toBeVisible();
});
