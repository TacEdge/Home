import { expect, test, type Page } from '@playwright/test';
import { CANARY_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { withDb } from './helpers';

// Home projects, To do and notes (M3 contract §3.5, §3.7), over the seeded
// synthetic family: Back fence (Sam's, under way, with "Paint the back
// fence" and a note), Garage (Alex's idea, with "Sort the garage light").
// Screenshots land in test-results/screenshots (never committed).

const SHOTS = 'test-results/screenshots';
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const openSummary = (page: Page, text: string) =>
  page.locator('summary', { hasText: text }).first().click();
const idOf = (table: string, title: string) =>
  withDb(
    async (pool) =>
      (
        await pool.query(
          `select id from ${table} where ${table === 'person' ? 'name' : 'title'} = $1 and archived_at is null limit 1`,
          [title],
        )
      ).rows[0]?.id as string,
  );

test('Home: projects grouped by where they are at, done folded away, nothing of the other adult', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  await page.getByLabel('Menu', { exact: true }).click();
  await page
    .getByRole('navigation', { name: 'More places' })
    .getByRole('link', { name: 'Home' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Under way' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back fence/ })).toContainText(
    'Paint it before summer',
  );
  await expect(page.getByRole('heading', { level: 2, name: 'Ideas' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Garage/ })).toBeVisible();
  const body = await page.textContent('main');
  expect(body).toContain(`${CANARY_MARK.sam}project`);
  expect(body).not.toContain(CANARY_MARK.alex);
  await shot(page, 'home-desktop');
});

test('a project: start, edit, mark done (folded on Home), archive and restore', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  await page.goto('/home/projects/new');
  await page.getByLabel('What', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('This can’t be empty.')).toBeVisible();
  await expect(page.getByLabel('What', { exact: true })).toBeFocused();

  await page.getByLabel('What', { exact: true }).fill('Vege beds');
  await page.getByLabel('In a line').fill('Two raised beds by the fence.');
  await page.getByLabel('Where it’s at').selectOption('active');
  await page.getByLabel('Aiming for').fill('2027-01-31');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page).toHaveURL(/\/home\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vege beds' })).toBeVisible();
  await expect(
    page.locator('main header').getByText('Under way · aiming for Sunday 31 January'),
  ).toBeVisible();
  await expect(page.getByText('Two raised beds by the fence.')).toBeVisible();
  await expect(page.getByText('Nothing to do on this yet.')).toBeVisible();
  await shot(page, 'project-detail');
  const url = page.url();

  // Its target date is on Forward, linked here.
  await page.goto('/forward');
  await expect(page.getByRole('link', { name: /Vege beds/ })).toHaveCount(0); // 2027 is past 30 days
  await page.goto(url);

  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Vege beds' })).toBeVisible();
  await shot(page, 'project-edit');
  await page.getByLabel('Where it’s at').selectOption('done');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('main header').getByText(/^Done/)).toBeVisible();
  await page.goto('/home');
  await expect(page.getByRole('link', { name: /Vege beds/ })).toBeHidden(); // folded
  await openSummary(page, 'Done');
  await expect(page.getByRole('link', { name: /Vege beds/ })).toBeVisible();

  await page.goto(url);
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(await page.textContent('main')).not.toContain('Vege beds');
  await page.goto(url);
  await expect(page.locator('main header').getByText(/archived/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await openSummary(page, 'Restore');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('main header').getByText(/archived/)).toHaveCount(0);
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('To do: open tasks by due date then project, done in one tap with undo, drop and reopen', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const fence = await idOf('project', 'Back fence');
  // Two tasks of our own: one due soon, one undated.
  await page.goto(`/tasks/new?project=${fence}`);
  await expect(page.locator('main header').getByText('Part of Back fence.')).toBeVisible();
  await page.getByLabel('What', { exact: true }).fill('Buy the fence paint');
  await openSummary(page, 'More');
  await expect(page.getByLabel('Part of')).toHaveValue(fence);
  await page.getByLabel('Due').fill('2026-09-28'); // before today: overdue
  await page.getByLabel('How long, in minutes').fill('45');
  await page.getByRole('group', { name: 'Needs' }).getByLabel('Shops open').check();
  await page.getByLabel('A window to do it').fill('2026-10-10');
  await page.getByLabel('From (optional)').fill('10:00');
  await page.getByLabel('To (optional)').fill('09:00');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.getByText('The window ends before it starts.')).toBeVisible();
  await expect(page.getByLabel('To (optional)')).toBeFocused();
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('Buy the fence paint');
  await expect(page.getByRole('group', { name: 'Needs' }).getByLabel('Shops open')).toBeChecked();
  await page.getByLabel('To (optional)').fill('11:00');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const paintUrl = page.url();
  await expect(page.getByRole('heading', { level: 1, name: 'Buy the fence paint' })).toBeVisible();
  await expect(
    page.locator('main header').getByText('To do · due Monday 28 September · 45 min'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Back fence/ })).toContainText('Part of');
  await expect(page.locator('li', { hasText: 'Needs' }).getByText('Shops open')).toBeVisible();
  await expect(page.getByText(/Saturday 10 October, until 11:00/)).toBeVisible();
  await shot(page, 'task-detail');

  await page.goto('/tasks/new');
  await page.getByLabel('What', { exact: true }).fill('Oil the deck');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);

  await page.goto('/tasks');
  await expect(page.getByRole('heading', { level: 1, name: 'To do' })).toBeVisible();
  const open = page.getByRole('list').first().getByRole('link');
  await expect(open.first()).toContainText('Buy the fence paint'); // overdue, first
  await expect(page.getByText('Overdue:')).toHaveCount(1);
  await expect(open.last()).toContainText('Oil the deck'); // undated, last
  const body = await page.textContent('main');
  expect(body).toContain('Paint the back fence');
  expect(body).toContain(`${CANARY_MARK.sam}task`);
  expect(body).not.toContain(CANARY_MARK.alex);
  expect(body).toContain('Sort the garage light'); // Alex's, but everyone's to see

  // Done in one tap, then undo.
  await page.getByRole('button', { name: 'Done: Oil the deck' }).click();
  await expect(page).toHaveURL(/\/tasks\?undo=/);
  await expect(page.getByRole('status')).toHaveText('Oil the deck: done.');
  await expect(
    page
      .getByRole('list')
      .first()
      .getByRole('link', { name: /Oil the deck/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo: Oil the deck' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page
      .getByRole('list')
      .first()
      .getByRole('link', { name: /Oil the deck/ }),
  ).toHaveCount(1);
  await page.setViewportSize(VIEWPORTS.phone);
  await shot(page, 'tasks-phone');

  // Drop from the task page, see it folded away, reopen.
  await page.getByRole('link', { name: /Oil the deck/ }).click();
  await page.getByRole('button', { name: 'Drop it' }).click();
  await expect(page).toHaveURL(/undo=/);
  await expect(page.locator('main header').getByText(/^Dropped/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo: Oil the deck' })).toBeFocused();
  await page.goto('/tasks');
  await expect(
    page
      .getByRole('list')
      .first()
      .getByRole('link', { name: /Oil the deck/ }),
  ).toHaveCount(0);
  await openSummary(page, 'Done and dropped');
  await expect(page.getByRole('link', { name: /Oil the deck/ })).toBeVisible();
  await page.getByRole('link', { name: /Oil the deck/ }).click();
  await page.getByRole('button', { name: 'Back to To do' }).click();
  await expect(page.locator('main header').getByText(/^To do/)).toBeVisible();
  // More starts folded on an existing task; a refused field inside it opens it with what was typed.
  await expect(page.getByLabel('Due')).toBeHidden();
  await openSummary(page, 'More');
  await page.getByLabel('A window to do it').fill('2026-10-17'); // a date with no times
  await page.getByLabel('Notes').fill('Needs the good brush.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This needs a time, like 09:00.')).toBeVisible();
  await expect(page.getByLabel('From (optional)')).toBeFocused();
  await expect(page.getByLabel('Notes')).toHaveValue('Needs the good brush.');
  await page.getByLabel('A window to do it').fill('');

  // Edit on the task page: the title; then archive both, so later specs see To do as seeded.
  await page.getByLabel('What', { exact: true }).fill('Oil the deck properly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Oil the deck properly' }),
  ).toBeVisible();
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.goto(paintUrl);
  await openSummary(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  expect(await page.textContent('main')).not.toContain('fence paint');
});

test('editing an unrelated field keeps an archived project and archived people on a task; Done on a project page stays there', async ({
  page,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const fence = await idOf('project', 'Back fence');
  const nana = await idOf('person', 'Nana Jo');
  const milo = await idOf('person', 'Milo');
  const task = await withDb(
    async (pool) =>
      (
        await pool.query(
          `insert into task (title, status, project_id, assignee_person_id, about_person_id, needs, created_by, created_via, visibility)
           values ('Fix the gate latch', 'open', $1, $2, $3, '[]', 'fixture-sam', 'ui', 'household') returning id`,
          [fence, nana, milo],
        )
      ).rows[0] as { id: string },
  );
  // The project and both people go away (archived), then only the title changes.
  await withDb((pool) =>
    pool.query(`update project set archived_at = now() where id = $1`, [fence]),
  );
  await withDb((pool) =>
    pool.query(`update person set archived_at = now() where id = any($1::uuid[])`, [[nana, milo]]),
  );
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole('link', { name: /Back fence/ })).toContainText('Part of');
  await openSummary(page, 'More');
  await expect(page.getByLabel('Part of')).toHaveValue(fence);
  await expect(page.locator('#field-projectId option:checked')).toHaveText('Back fence (archived)');
  await expect(page.locator('#field-assigneePersonId option:checked')).toHaveText(
    'Nana Jo (archived)',
  );
  await expect(page.locator('#field-aboutPersonId option:checked')).toHaveText('Milo (archived)');
  await page.getByLabel('What', { exact: true }).fill('Fix the gate latch properly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Fix the gate latch properly' }),
  ).toBeVisible();
  const kept = await withDb(
    async (pool) =>
      (
        await pool.query(
          `select project_id, assignee_person_id, about_person_id from task where id = $1`,
          [task.id],
        )
      ).rows[0] as Record<string, string>,
  );
  expect(kept).toEqual({ project_id: fence, assignee_person_id: nana, about_person_id: milo });
  await withDb((pool) =>
    pool.query(`update project set archived_at = null where id = $1`, [fence]),
  );
  await withDb((pool) =>
    pool.query(`update person set archived_at = null where id = any($1::uuid[])`, [[nana, milo]]),
  );

  // Done from the project page returns there, Undo focused, in context.
  await page.goto(`/home/projects/${fence}`);
  await page.getByRole('button', { name: 'Done: Fix the gate latch properly' }).click();
  await expect(page).toHaveURL(new RegExp(`/home/projects/${fence}\\?undo=`));
  await expect(page.getByRole('heading', { level: 1, name: 'Back fence' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Undo: Fix the gate latch properly' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Undo: Fix the gate latch properly' }).click();
  await expect(page).toHaveURL(new RegExp(`/home/projects/${fence}$`));
  await expect(
    page.getByRole('button', { name: 'Done: Fix the gate latch properly' }),
  ).toBeVisible();
  await withDb((pool) => pool.query(`delete from task where id = $1`, [task.id]));
});

test('notes live on their subject: add, change, archive and restore on a project; add on a person and an event', async ({
  page,
  browser,
}) => {
  await signInAsFixtureAdult(page, 'alex');
  const fence = await idOf('project', 'Back fence');
  await page.goto(`/home/projects/${fence}`);
  await expect(page.locator('p', { hasText: 'Same green as the shed.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Paint the back fence/ })).toBeVisible();
  await openSummary(page, 'Add a note');
  await page.getByLabel('A note').fill('Bunnings has the green on special this week.');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('p', { hasText: 'on special this week.' })).toBeVisible();
  await shot(page, 'project-notes');

  const note = page.locator('li', { hasText: 'Bunnings has the green' });
  await note.locator('summary', { hasText: 'Change' }).click();
  await note
    .getByLabel('Note', { exact: true })
    .fill('Bunnings has the green on special until Sunday.');
  await note.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('p', { hasText: 'on special until Sunday.' })).toBeVisible();
  const changed = page.locator('li', { hasText: 'until Sunday' });
  await changed.locator('summary', { hasText: 'Change' }).click();
  await changed.locator('summary', { hasText: 'Archive this note' }).click();
  await changed.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('p', { hasText: 'until Sunday' })).toBeHidden(); // folded away
  await openSummary(page, 'Archived notes');
  await expect(page.locator('p', { hasText: 'until Sunday' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('summary', { hasText: 'Archived notes' })).toHaveCount(0);
  await expect(page.locator('p', { hasText: 'until Sunday' })).toBeVisible();
  // Leave it as seeded.
  const again = page.locator('li', { hasText: 'until Sunday' });
  await again.locator('summary', { hasText: 'Change' }).click();
  await again.locator('summary', { hasText: 'Archive this note' }).click();
  await again.getByRole('button', { name: 'Archive' }).click();

  // A person, and a private note of our own that the other adult never sees.
  await page.goto(`/people/${await idOf('person', 'Milo')}`);
  await openSummary(page, 'Add a note');
  await page.getByLabel('A note').fill('canary-alex-milo-note');
  await page.getByLabel('Who can see this').selectOption('private');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('p', { hasText: 'canary-alex-milo-note' })).toBeVisible();
  await expect(page.getByText('· just me')).toBeVisible();

  // An event.
  const swim = await idOf('event', 'Swimming');
  await page.goto(`/events/${swim}`);
  await openSummary(page, 'Add a note');
  await page.getByLabel('A note').fill('Togs are in the blue bag.');
  await page.getByRole('button', { name: 'Add it' }).click();
  await expect(page.locator('p', { hasText: 'Togs are in the blue bag.' })).toBeVisible();

  // Sam sees the event note, not Alex's private note about Milo.
  const sam = await fixtureAdultContext(browser, 'sam', VIEWPORTS.desktop);
  await sam.page.goto(`/events/${swim}`);
  await expect(sam.page.locator('p', { hasText: 'Togs are in the blue bag.' })).toBeVisible();
  await sam.page.goto(`/people/${await idOf('person', 'Milo')}`);
  expect(await sam.page.textContent('main')).not.toContain('canary-alex-milo-note');
  await sam.context.close();
  await withDb((pool) =>
    pool.query(
      `delete from note where body in ('canary-alex-milo-note', 'Togs are in the blue bag.')`,
    ),
  );
});

test("the other adult's private project and task read as not found", async ({ page }) => {
  await signInAsFixtureAdult(page, 'alex');
  for (const [table, title] of [
    ['project', `${CANARY_MARK.sam}project`],
    ['task', `${CANARY_MARK.sam}task`],
  ] as const) {
    const id = await withDb(
      async (pool) =>
        (await pool.query(`select id from ${table} where title = $1`, [title])).rows[0]
          .id as string,
    );
    await page.goto(table === 'project' ? `/home/projects/${id}` : `/tasks/${id}`);
    await expect(page.getByRole('heading', { name: 'Nothing here.' })).toBeVisible();
  }
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`accessibility, no horizontal scroll and screenshots: ${name}`, async ({ browser }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
    const fence = await idOf('project', 'Back fence');
    const paint = await idOf('task', 'Paint the back fence');
    for (const path of [
      '/home',
      '/home/projects/new',
      `/home/projects/${fence}`,
      `/home/projects/${fence}/edit`,
      '/tasks',
      '/tasks/new',
      `/tasks/${paint}`,
    ]) {
      await page.goto(path);
      await expectNoHorizontalScroll(page, `${name} ${path}`);
      await expectAccessible(page, `${name} ${path}`);
    }
    if (name === 'phone') {
      await page.goto('/home');
      await shot(page, 'home-phone');
    }
    await context.close();
  });
}
