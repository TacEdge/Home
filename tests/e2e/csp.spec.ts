import { expect, test, type Page } from '@playwright/test';
import { signInAsFixtureAdult } from './fixture-adults';
import { withDb } from './helpers';

// The nonce-based script CSP (ADR 0003 §9, M4 Package 1, ADR 0007 §9–10).
// The headers as served, a nonce per response on every script, no CSP
// violation in ordinary use (signed out, signed in, server actions, client
// interactions), un-nonced markup refused, and calendar-style hostile text
// shown as inert words. The e2e servers run `next dev`, whose policy adds only
// 'unsafe-eval' (src/lib/csp.ts); the production policy is checked by
// scripts/check-csp.mjs against `next start` in CI.

const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);
const P = 'p1csp ';

const nonceOf = (policy: string | undefined) => policy?.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `) || d === name)
    ?.split(' ')
    .slice(1);

/** Records every CSP violation (with its source) and every hydration complaint or page error. */
async function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    // CSP violations are judged from the violation events below, which name
    // their source; the console is watched for hydration complaints.
    if (/hydrat/i.test(t)) problems.push(`console: ${t.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      ),
    );
  });
  return {
    problems,
    // `next dev` only: Next's development tools add their own unnonced <style>
    // tags. `next start` serves no such chunk (scripts/check-csp.mjs).
    violations: async () =>
      (await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).filter(
        (v) => !/_next_dist_compiled_next-devtools_/.test(v),
      ),
  };
}

test.afterAll(async () => {
  await q(`update event set archived_at = now() where title like '${P}%' and archived_at is null`);
  await q(`update capture set archived_at = now() where text like '${P}%' and archived_at is null`);
});

test('every response carries its own nonce, on every script, and nothing broad', async ({
  page,
  request,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const seen = new Set<string>();
  for (const [path, ctx] of [
    ['/sign-in', request],
    ['/sign-in', request],
    ['/nothing-here', request],
    ['/today', page.request],
    ['/today', page.request],
    ['/forward', page.request],
  ] as const) {
    const res = await ctx.get(path, { maxRedirects: 0 });
    const policy = res.headers()['content-security-policy'];
    expect(policy, path).toBeTruthy();
    const nonce = nonceOf(policy);
    expect(nonce, `${path} nonce`).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(seen.has(nonce!), `${path}: a nonce was reused`).toBe(false);
    seen.add(nonce!);

    // script-src: this nonce, 'strict-dynamic', and in dev only 'unsafe-eval'.
    expect(directive(policy!, 'script-src')).toEqual([
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    expect(policy).not.toMatch(/'unsafe-inline'|'unsafe-hashes'|\s\*[\s;]|https?:\/\/|data:|blob:/);
    expect(directive(policy!, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy!, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy!, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy!, 'frame-ancestors')).toEqual(["'none'"]);

    // Every script tag in the document carries this response's nonce.
    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length, `${path} has scripts`).toBeGreaterThan(0);
    expect(
      scripts.filter((s) => !s.includes(` nonce="${nonce}"`)),
      `${path}: scripts without the nonce`,
    ).toEqual([]);
    // No inline style attribute or style tag for the style-src to refuse.
    expect(html, `${path} style attribute`).not.toMatch(/<[a-z][^>]* style="/i);

    // The other security headers are unchanged.
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['x-robots-tag']).toContain('noindex');
  }
});

test('ordinary use raises no CSP violation and no hydration complaint: sign-in, places, server actions, client interactions', async ({
  page,
}) => {
  const w = await watch(page);
  await signInAsFixtureAdult(page, 'sam'); // the sign-in page and its server action
  for (const path of ['/today', '/forward', '/people', '/home', '/tasks', '/sort', '/settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  // A server action through a client form (the capture bar), confirmed by the server.
  await page.goto('/today');
  await page.getByPlaceholder('Tell HOME something…').fill(`${P}a thought to keep`);
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.locator('#capture-status')).toContainText('Kept');
  // A client component working after hydration: the ⌂ menu opens and closes by keyboard.
  await page.locator('summary[aria-label="Menu"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'More places' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'More places' })).toBeHidden();
  // Client-side navigation through a Link.
  await page.getByRole('link', { name: 'Forward' }).first().click();
  await expect(page).toHaveURL(/\/forward$/);
  await page.waitForLoadState('networkidle');
  expect(await w.violations()).toEqual([]);
  expect(w.problems).toEqual([]);
});

test('markup without the nonce is refused: an injected inline script, an event handler and a javascript: link never run', async ({
  page,
}) => {
  const w = await watch(page);
  await page.route('**/sign-in', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(
      '</body>',
      '<script>window.__injected = "script"</script>' +
        '<img src="/nothing.png" onerror="window.__injected = \'handler\'">' +
        '<a id="injected-link" href="javascript:window.__injected = \'link\'">x</a></body>',
    );
    await route.fulfill({ response: res, body });
  });
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');
  await page.locator('#injected-link').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __injected?: string }).__injected)).toBe(
    undefined,
  );
  const v = await w.violations();
  expect(v.some((x) => x.startsWith('script-src-elem inline'))).toBe(true);
  expect(v.some((x) => x.startsWith('script-src-attr inline'))).toBe(true);
  // The page itself still works: it hydrated with its own nonced scripts.
  await expect(page.getByRole('button', { name: 'Send me a link' })).toBeEnabled();
});

test('hostile calendar-style text is shown as words: no script, no handler, no javascript: link', async ({
  page,
}) => {
  const { d } = (
    await q(`select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as d`)
  )[0] as { d: string };
  const title = `${P}<script>window.__pwned='title'</script>`;
  const description =
    `<img src=x onerror="window.__pwned='img'"> <a href="javascript:window.__pwned='link'">open</a> ` +
    `<svg onload="window.__pwned='svg'"></svg> <iframe src="javascript:alert(1)"></iframe>`;
  const location = `javascript:window.__pwned='location'`;
  const [ev] = await q(
    `insert into event (title, description, location, kind, all_day, start_date, end_date, created_by, created_via, visibility, source)
     values ($1, $2, $3, 'other', true, $4, ($4::date + 1), 'fixture-sam', 'ui', 'household', 'manual') returning id`,
    [title, description, location, d],
  );
  const [cap] = await q(
    `insert into capture (text, channel, visibility, created_by, created_via)
     values ($1, 'web', 'private', 'fixture-sam', 'ui') returning id`,
    [
      `${P}<b onmouseover="window.__pwned='capture'">hover</b><script>window.__pwned='capture'</script>`,
    ],
  );

  const w = await watch(page);
  await signInAsFixtureAdult(page, 'sam');
  for (const path of [`/events/${ev!.id}`, '/today', '/forward', '/sort', `/sort/${cap!.id}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const main = page.locator('main');
    await expect(main, path).toContainText('<script>');
    for (const sel of [
      'main script',
      'main img',
      'main svg[onload]',
      'main iframe',
      'main a[href^="javascript:"]',
      'main b',
    ])
      expect(await page.locator(sel).count(), `${path}: ${sel}`).toBe(0);
    const handlers = await page.evaluate(() =>
      [...document.querySelectorAll('main *')].flatMap((el) =>
        [...el.attributes].filter((a) => a.name.startsWith('on')).map((a) => a.name),
      ),
    );
    expect(handlers, `${path}: event handler attributes`).toEqual([]);
  }
  await page.goto(`/events/${ev!.id}`);
  await expect(page.locator('main')).toContainText(`onerror="window.__pwned='img'"`);
  await expect(page.locator('main')).toContainText(location);
  await page
    .locator('main')
    .getByText('open')
    .first()
    .hover()
    .catch(() => {});
  expect(await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned)).toBe(
    undefined,
  );
  // React escaped it all, so the CSP had nothing to refuse.
  expect(await w.violations()).toEqual([]);
  expect(w.problems).toEqual([]);
});
