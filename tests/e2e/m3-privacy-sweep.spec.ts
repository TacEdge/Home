import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ARCHIVED_MARK, CANARY_MARK, SENSITIVE_MARK } from '../fixtures/family';
import { fixtureAdultContext, type Adult } from './fixture-adults';
import { seedCalendar } from './calendar-feeds';
import { withDb } from './helpers';

// M3 acceptance (contract §8.3, §10 items 4, 5 and 8): the two-adult privacy
// sweep. Signed in as each adult, every M3 route is fetched as the browser
// receives it (the whole HTML, including the data a page hands to its client
// components, not only the visible text) and searched for the other adult's
// canary strings, for sensitive markers and, outside the places that show
// put-away records, for archived markers. Activity is checked row by row
// against the audit rows about the other adult's private records, and each
// adult's export, plain and with sensitive items, record by record against
// what that adult may see. Synthetic data only.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const USER = { sam: 'fixture-sam', alex: 'fixture-alex' } as const;
const OTHER = { sam: 'alex', alex: 'sam' } as const;
const P10 = 'p10-';
const SORT_AS = ['task', 'event', 'project', 'note', 'know'] as const;

const STATIC_ROUTES = [
  '/today',
  '/forward',
  '/people',
  '/people/new',
  '/home',
  '/home/projects/new',
  '/tasks',
  '/tasks/new',
  '/events/new',
  '/sort',
  '/settings',
  '/settings/you',
  '/settings/calendars',
  '/settings/calendars/new',
  '/settings/knows',
  '/settings/archived',
  '/settings/activity',
  '/settings/export',
];

/** Records one adult may see by the visibility rule: household, or their own private. */
async function visibleIds(adult: Adult, archived: boolean) {
  const me = USER[adult];
  const arch = archived ? 'archived_at is not null' : 'archived_at is null';
  const rows = async (table: string) =>
    (
      await q(
        `select id from ${table} where ${arch} and (visibility = 'household' or created_by = $1)`,
        [me],
      )
    ).map((r) => r.id!);
  return {
    people: await rows('person'),
    events: await rows('event'),
    projects: await rows('project'),
    tasks: await rows('task'),
    captures: (await q(`select id from capture where ${arch} and created_by = $1`, [me])).map(
      (r) => r.id!,
    ),
    // M4: calendars this adult can see; their own, whichever state, are managed too.
    calendars: await rows('calendar_source'),
    ownCalendars: (
      await q(`select id from calendar_source where ${arch} and created_by = $1`, [me])
    ).map((r) => r.id!),
  };
}

/** The other adult's private records of every type, by id (never by text). */
async function privateIdsOf(adult: Adult) {
  const them = USER[adult];
  const ids: Record<string, string[]> = {};
  for (const t of ['person', 'event', 'project', 'task', 'note', 'context', 'calendar_source'])
    ids[t] = (
      await q(`select id from ${t} where visibility = 'private' and created_by = $1`, [them])
    ).map((r) => r.id!);
  ids.capture = (await q(`select id from capture where created_by = $1`, [them])).map((r) => r.id!);
  ids.proposal = (await q(`select id from proposal where created_by = $1`, [them])).map(
    (r) => r.id!,
  );
  ids.conversation = (await q(`select id from conversation where user_id = $1`, [them])).map(
    (r) => r.id!,
  );
  return ids;
}

/** Every route of M3, for one adult: the fixed places and each record's pages. */
async function routesFor(adult: Adult) {
  const live = await visibleIds(adult, false);
  const put = await visibleIds(adult, true);
  const routes: { path: string; archived: boolean }[] = STATIC_ROUTES.map((path) => ({
    path,
    archived: false,
  }));
  const add = (paths: string[], archived: boolean) =>
    routes.push(...paths.map((path) => ({ path, archived })));
  for (const [ids, archived] of [
    [live, false],
    [put, true],
  ] as const) {
    add(
      ids.people.flatMap((id) => [`/people/${id}`, ...(archived ? [] : [`/people/${id}/edit`])]),
      archived,
    );
    add(
      ids.events.flatMap((id) => [`/events/${id}`, ...(archived ? [] : [`/events/${id}/edit`])]),
      archived,
    );
    add(
      ids.projects.flatMap((id) => [
        `/home/projects/${id}`,
        ...(archived ? [] : [`/home/projects/${id}/edit`]),
      ]),
      archived,
    );
    add(
      ids.tasks.map((id) => `/tasks/${id}`),
      archived,
    );
  }
  add(
    live.captures.flatMap((id) => [`/sort/${id}`, ...SORT_AS.map((as) => `/sort/${id}/${as}`)]),
    false,
  );
  // A calendar's page is read by whoever can see it; its owner also edits and
  // reconnects it, connected or not (so these pages are never "archived").
  for (const [ids, own] of [
    [live.calendars, live.ownCalendars],
    [put.calendars, put.ownCalendars],
  ] as const) {
    add(
      ids.map((id) => `/settings/calendars/${id}`),
      false,
    );
    add(
      own.flatMap((id) => [
        `/settings/calendars/${id}/edit`,
        `/settings/calendars/${id}/reconnect`,
      ]),
      false,
    );
  }
  return routes;
}

async function html(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  return { status: res.status(), body: await res.text(), url: res.url() };
}

/** Every Activity row id this adult is shown, following "Earlier ›" to the end. */
async function activityIds(request: APIRequestContext): Promise<Set<string>> {
  const ids = new Set<string>();
  let path: string | null = '/settings/activity';
  for (let pageNo = 0; path && pageNo < 500; pageNo++) {
    const { body } = await html(request, path);
    for (const m of body.matchAll(/data-id="([0-9a-f-]{36})"/g)) ids.add(m[1]!);
    const next = body.match(/href="(\/settings\/activity\?before=[0-9a-f-]{36})"/);
    path = next ? next[1]! : null;
  }
  return ids;
}

test.beforeAll(async () => {
  // M4: a private calendar for each adult carrying their canary mark, and a
  // household one of Sam's, connected and disconnected.
  for (const adult of ['sam', 'alex'] as const)
    await seedCalendar({
      owner: USER[adult] as 'fixture-sam' | 'fixture-alex',
      name: `${CANARY_MARK[adult]}${P10}calendar`,
      visibility: 'private',
      fingerprintTag: `p10private${adult}`,
    });
  await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sweep calendar',
    visibility: 'household',
    fingerprintTag: 'sweepconnected',
  });
  await seedCalendar({
    owner: 'fixture-sam',
    name: 'Sweep calendar (disconnected)',
    visibility: 'household',
    disconnected: true,
    fingerprintTag: 'sweepdisconnected',
  });
  // Records dated today, for each adult, so Today and Forward have the other
  // adult's private items on the very day the sweep runs: an event, a timed
  // event, a task due today, an overdue task and a waiting capture, private
  // to their owner. Archived ones dated today too, which must show to nobody
  // outside Archived and their own pages.
  const { d, y } = (
    await q(
      `select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d,
            to_char(now() at time zone 'Pacific/Auckland' - interval '1 day', 'YYYY-MM-DD') as y`,
    )
  )[0] as { d: string; y: string };
  for (const adult of ['sam', 'alex'] as const) {
    const by = USER[adult];
    const mark = `${CANARY_MARK[adult]}${P10}`;
    await q(
      `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
       values ($1, 'other', true, $2, ($2::date + 1), $3, 'ui', 'private', 'manual')`,
      [`${mark}event-today`, d, by],
    );
    await q(
      `insert into event (title, kind, all_day, starts_at, ends_at, time_zone, created_by, created_via, visibility, source)
       values ($1, 'appointment', false, ($2 || 'T10:00:00')::timestamp at time zone 'Pacific/Auckland',
               ($2 || 'T11:00:00')::timestamp at time zone 'Pacific/Auckland', 'Pacific/Auckland', $3, 'ui', 'private', 'manual')`,
      [`${mark}timed-today`, d, by],
    );
    for (const [title, due] of [
      [`${mark}task-due-today`, d],
      [`${mark}task-overdue`, y],
    ] as const)
      await q(
        `insert into task (title, status, due_date, needs, created_by, created_via, visibility)
         values ($1, 'open', $2, '[]', $3, 'ui', 'private')`,
        [title, due, by],
      );
    await q(
      `insert into capture (text, channel, visibility, created_by, created_via) values ($1, 'web', 'private', $2, 'ui')`,
      [`${mark}capture-waiting`, by],
    );
  }
  await q(
    `insert into event (title, kind, all_day, start_date, end_date, created_by, created_via, visibility, source, archived_at)
     values ($1, 'other', true, $2, ($2::date + 1), 'fixture-sam', 'ui', 'household', 'manual', now())`,
    [`${ARCHIVED_MARK}${P10}event-today`, d],
  );
  await q(
    `insert into task (title, status, due_date, needs, created_by, created_via, visibility, archived_at)
     values ($1, 'open', $2, '[]', 'fixture-sam', 'ui', 'household', now())`,
    [`${ARCHIVED_MARK}${P10}task-overdue`, y],
  );
});

test.afterAll(async () => {
  await q(
    `update event set archived_at = now() where title like '%${P10}%' and archived_at is null`,
  );
  await q(
    `update task set archived_at = now() where title like '%${P10}%' and archived_at is null`,
  );
  await q(
    `update capture set archived_at = now() where text like '%${P10}%' and archived_at is null`,
  );
});

for (const adult of ['sam', 'alex'] as const) {
  const other = OTHER[adult];

  test(`every M3 route, as ${adult}: nothing of ${other}'s private records, nothing sensitive, nothing archived outside Archived`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page } = await fixtureAdultContext(browser, adult, {
      width: 1280,
      height: 800,
    });
    const routes = await routesFor(adult);
    expect(routes.length).toBeGreaterThan(STATIC_ROUTES.length + 20);
    const failures: string[] = [];
    const seenOwn = new Set<string>();
    for (const { path, archived } of routes) {
      const { status, body, url } = await html(page.request, path);
      if (status !== 200) failures.push(`${path}: status ${status}`);
      if (new URL(url).pathname === '/sign-in') failures.push(`${path}: signed out`);
      if (body.includes(CANARY_MARK[other])) failures.push(`${path}: ${other}'s private canary`);
      if (body.includes(SENSITIVE_MARK)) failures.push(`${path}: a sensitive marker`);
      const archivedAllowed = archived || path === '/settings/archived';
      if (!archivedAllowed && body.includes(ARCHIVED_MARK))
        failures.push(`${path}: an archived marker`);
      if (body.includes(`${CANARY_MARK[adult]}${P10}`)) seenOwn.add(path);
    }
    expect(failures, `${adult}'s sweep`).toEqual([]);
    // Not vacuous: the adult's own private records of today are where they belong.
    for (const place of ['/today', '/forward', '/tasks', '/sort'])
      expect(seenOwn.has(place), `${adult} sees their own private items on ${place}`).toBe(true);
    await context.close();
  });

  test(`${other}'s private records, by address, as ${adult}: every page reads "Nothing here."`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { context, page } = await fixtureAdultContext(browser, adult, {
      width: 375,
      height: 812,
    });
    const theirs = await privateIdsOf(other);
    const paths = [
      ...theirs.person!.flatMap((id) => [`/people/${id}`, `/people/${id}/edit`]),
      ...theirs.event!.flatMap((id) => [`/events/${id}`, `/events/${id}/edit`]),
      ...theirs.project!.flatMap((id) => [`/home/projects/${id}`, `/home/projects/${id}/edit`]),
      ...theirs.task!.map((id) => `/tasks/${id}`),
      ...theirs.calendar_source!.flatMap((id) => [
        `/settings/calendars/${id}`,
        `/settings/calendars/${id}/edit`,
        `/settings/calendars/${id}/reconnect`,
      ]),
      ...theirs.capture!.flatMap((id) => [
        `/sort/${id}`,
        ...SORT_AS.map((as) => `/sort/${id}/${as}`),
      ]),
    ];
    expect(paths.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const path of paths) {
      const { status, body } = await html(page.request, path);
      if (status !== 404) failures.push(`${path}: status ${status}`);
      if (!body.includes('Nothing here.')) failures.push(`${path}: not the not-found page`);
      if (body.includes(CANARY_MARK[other])) failures.push(`${path}: ${other}'s canary`);
    }
    expect(failures).toEqual([]);
    await context.close();
  });
}

test('Activity: neither adult is shown a row about the other’s private records or anything sensitive; each sees their own', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const aboutPrivate = async (adult: Adult) => {
    const ids = Object.values(await privateIdsOf(adult)).flat();
    return (await q(`select id from audit_log where subject_id = any($1::text[])`, [ids])).map(
      (r) => r.id!,
    );
  };
  const aboutSensitive = (
    await q(
      `select a.id from audit_log a join context c on c.id::text = a.subject_id
       where a.subject_type = 'context' and c.sensitivity = 'sensitive'`,
    )
  ).map((r) => r.id!);
  expect(aboutSensitive.length).toBeGreaterThan(0);
  for (const adult of ['sam', 'alex'] as const) {
    const { context, page } = await fixtureAdultContext(browser, adult, {
      width: 1280,
      height: 800,
    });
    const shown = await activityIds(page.request);
    expect(shown.size).toBeGreaterThan(0);
    const theirs = await aboutPrivate(OTHER[adult]);
    expect(
      theirs.length,
      `audit rows exist about ${OTHER[adult]}'s private records`,
    ).toBeGreaterThan(10);
    expect(theirs.filter((id) => shown.has(id))).toEqual([]);
    expect(aboutSensitive.filter((id) => shown.has(id))).toEqual([]);
    // Filtering, not absence: the adult's own private rows (sensitive ones aside) are listed.
    const mine = (await aboutPrivate(adult)).filter((id) => !aboutSensitive.includes(id));
    expect(mine.length).toBeGreaterThan(10);
    expect(mine.filter((id) => !shown.has(id))).toEqual([]);
    await context.close();
  }
});

for (const adult of ['sam', 'alex'] as const) {
  test(`export, as ${adult}: valid v2, only what ${adult} may see, sensitive only when asked; audited with counts`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { context, page } = await fixtureAdultContext(browser, adult, {
      width: 1280,
      height: 800,
    });
    const theirs = await privateIdsOf(OTHER[adult]);
    const theirIds = new Set(Object.values(theirs).flat());
    const sensitive = (await q(
      `select id, visibility, created_by from context where sensitivity = 'sensitive'`,
    )) as {
      id: string;
      visibility: string;
      created_by: string;
    }[];
    const mayReveal = sensitive
      .filter((c) => c.visibility === 'household' || c.created_by === USER[adult])
      .map((c) => c.id);
    expect(mayReveal.length).toBeGreaterThan(0);
    await mkdir('test-results/exports', { recursive: true });

    for (const includeSensitive of [false, true]) {
      const res = await page.request.post('/settings/export/download', {
        form: includeSensitive ? { includeSensitive: 'on' } : {},
      });
      expect(res.status()).toBe(200);
      const text = await res.text();
      // The owner's checker (DEPLOY.md §E item 9) validates it against version 1.
      const file = `test-results/exports/${adult}-${includeSensitive ? 'sensitive' : 'plain'}.json`;
      await writeFile(file, text);
      const check = spawnSync('node', ['scripts/check-export.mts', file], { encoding: 'utf8' });
      expect(check.status, check.stderr).toBe(0);
      expect(check.stdout).toContain(
        `check-export: valid home-export v2, sensitive included: ${includeSensitive}`,
      );

      const data = JSON.parse(text) as {
        includesSensitive: boolean;
        records: Record<
          string,
          { id?: string; sensitivity?: string; archivedAt?: string | null }[]
        >;
      };
      expect(data.includesSensitive).toBe(includeSensitive);
      const ids = Object.values(data.records)
        .flat()
        .map((r) => r.id)
        .filter((id): id is string => Boolean(id));
      expect(
        ids.filter((id) => theirIds.has(id)),
        `${OTHER[adult]}'s private records`,
      ).toEqual([]);
      expect(text).not.toContain(CANARY_MARK[OTHER[adult]]);
      expect(text).toContain(CANARY_MARK[adult]); // their own private records are in it
      expect(data.records.people!.some((p) => p.archivedAt)).toBe(true); // archived, marked
      const shownSensitive = data.records.context!.filter((c) => c.sensitivity === 'sensitive');
      if (includeSensitive)
        expect(shownSensitive.map((c) => c.id).sort()).toEqual([...mayReveal].sort());
      else {
        expect(shownSensitive).toEqual([]);
        expect(text).not.toContain(SENSITIVE_MARK);
      }
      // Its Activity section follows Activity's rule.
      const theirAudit = (
        await q(`select id from audit_log where subject_id = any($1::text[])`, [[...theirIds]])
      ).map((r) => r.id!);
      const exportedAudit = new Set((data.records.activity ?? []).map((r) => r.id));
      expect(theirAudit.filter((id) => exportedAudit.has(id))).toEqual([]);
    }

    // Each download is audited privately, with structural meta only.
    const audits = (await q(
      `select meta, visibility, visible_to_user_id, summary from audit_log
       where event = 'export.download' and actor_user_id = $1 order by at desc limit 2`,
      [USER[adult]],
    )) as unknown as {
      meta: Record<string, unknown>;
      visibility: string;
      visible_to_user_id: string;
      summary: string | null;
    }[];
    expect(audits).toHaveLength(2);
    for (const a of audits) {
      expect(a.visibility).toBe('private');
      expect(a.visible_to_user_id).toBe(USER[adult]);
      for (const [k, v] of Object.entries(a.meta))
        expect(typeof v === 'number' || typeof v === 'boolean', `meta ${k}`).toBe(true);
    }
    expect(audits.map((a) => a.meta.sensitive).sort()).toEqual([false, true]);
    await context.close();
  });
}

test('no audit row anywhere carries written words: summaries and meta are structural', async () => {
  const leaks = await q(
    `select id, event from audit_log
     where coalesce(summary, '') ~ '(canary-|p9 |p10-|Rehearsal)' or coalesce(meta::text, '') ~ '(canary-|p9 |p10-|Rehearsal)'`,
  );
  expect(leaks).toEqual([]);
  expect(Number((await q(`select count(*) as n from audit_log`))[0]!.n)).toBeGreaterThan(50);
});
