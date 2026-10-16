import { expect, test, type Page } from '@playwright/test';
import { NARROW_URL } from '../../playwright.config';
import { CANARY_MARK } from '../fixtures/family';
import { expectAccessible, expectNoHorizontalScroll } from './a11y';
import { fixtureAdultContext, signInAsFixtureAdult, VIEWPORTS } from './fixture-adults';
import { ask, askWithoutJs, clearKev, q, roomToAsk, USER } from './kev-helpers';

// Kev's screen in a browser (M8 Package 4; contract §11, §15.4; matrix rows
// U1, U2, U5, U6, U8, U9, U11, U12, U13, C14 and S9), on the main server,
// where Kev runs with the scripted provider (no key, no network to any
// provider; playwright.config.ts), and on the narrow server, where Kev is
// off. The scripted model answers from the turn's own reads of the fixture
// family (src/kev/evals/local.ts); every answer still passes HOME's checker.
// Failure states are asked for with the test-only `x-home-test-kev` header,
// which the route accepts only with the scripted provider. Synthetic only.

const PHONE = VIEWPORTS.phone;
// Turns are paced by the per-adult limit (six a minute, counted from audit rows).
test.describe.configure({ timeout: 180_000 });
const ANSWERED = /Here’s today\./;

test.describe('U2: the entry points, Kev on', () => {
  test('Today has its one line and the bar row ends with Ask Kev; Forward only the button; Settings lists Usage', async ({
    page,
  }) => {
    await signInAsFixtureAdult(page, 'sam');
    await page.goto('/today');
    const line = page.getByRole('link', { name: 'Ask Kev about today ›' });
    await expect(line).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Ask Kev', exact: true })).toHaveCount(1);
    await page.goto('/forward');
    await expect(page.getByRole('link', { name: 'Ask Kev about today ›' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask Kev', exact: true })).toHaveCount(1);
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /Usage/ })).toHaveCount(1);
    await page.goto('/today');
    await page.getByRole('link', { name: 'Ask Kev about today ›' }).click();
    await page.waitForURL(/\/kev\?focus=today$/);
    await expect(page.getByTestId('kev-privacy')).toHaveText('Only you can see this conversation.');
    await expect(page.getByTestId('kev-focus')).toHaveText('About today');
    // One input on Kev's screen: no capture bar, no second Ask Kev.
    await expect(page.locator('#capture-text')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask Kev', exact: true })).toHaveCount(0);
  });
});

test.describe('the conversation with JavaScript (Sam, phone)', () => {
  test('U12, U9, U5, U6, U11, C14: clear, first open, a checked answer, a decline kept in To sort', async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', PHONE);
    await clearKev(page);
    // First open (an empty conversation): the introduction, the disclosure, suggestions.
    await expect(page.getByTestId('kev-intro')).toContainText(
      'I’m Kev. Ask me about what’s recorded in HOME.',
    );
    await expect(page.getByTestId('kev-intro')).toContainText('Anthropic');
    await expect(page.getByRole('link', { name: /What’s sent, and for how long/ })).toHaveAttribute(
      'href',
      '/settings/usage',
    );
    const suggestion = page.getByRole('button', { name: 'What’s happening today?' });
    await expect(suggestion).toBeVisible();

    // A suggestion asks it: the words appear at once, the answer once checked.
    await roomToAsk('sam');
    await suggestion.click();
    await expect(page.getByTestId('kev-pending')).toHaveCount(0, { timeout: 20_000 });
    const answer = page.getByTestId('kev-answer').last();
    await expect(answer.getByTestId('kev-say')).toHaveText(ANSWERED);
    await expect(page.getByTestId('kev-announce')).toContainText('Here’s today.');
    await expect(page.locator('#kev-text')).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
    // U6: what it rested on, in plain words; never a tool, model or token.
    await answer.getByText('What’s this based on?').click();
    const based = answer.getByTestId('kev-based-on');
    await expect(based).toContainText('Today’s agenda');
    const text = (await based.textContent()) ?? '';
    for (const leak of ['get_', 'claude', 'token', 'tier']) expect(text).not.toContain(leak);
    // U11: no Keep in To sort under a plain answer.
    await expect(page.getByTestId('kev-turn').last().getByTestId('kev-keep')).toHaveCount(0);

    // A memory decline: the template, and Keep in To sort under the person's words.
    await ask(page, 'sam', 'Remember that Milo likes trains now.');
    const turn = page.getByTestId('kev-turn').last();
    await expect(turn.getByTestId('kev-say')).toHaveText(
      'I can’t save that. Keep in To sort keeps your words, and you can add it to What Kev knows yourself.',
    );
    const before = await q(
      `select count(*)::int as n from capture where created_by = $1 and status = 'new' and archived_at is null`,
      [USER.sam],
    );
    await turn.getByRole('button', { name: 'Keep in To sort' }).click();
    await expect(turn.getByTestId('kev-kept')).toContainText('Kept');
    const kept = await q(
      `select text, created_via from capture where created_by = $1 and text = $2`,
      [USER.sam, 'Remember that Milo likes trains now.'],
    );
    expect(kept).toEqual([{ text: 'Remember that Milo likes trains now.', created_via: 'ui' }]);
    const after = await q(
      `select count(*)::int as n from capture where created_by = $1 and status = 'new' and archived_at is null`,
      [USER.sam],
    );
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) + 1);
    // Reload: kept, and still only once.
    await page.reload();
    await expect(page.getByTestId('kev-turn').last().getByTestId('kev-kept')).toBeVisible();
    await expect(page.getByTestId('kev-turn').last().getByTestId('kev-keep')).toHaveCount(0);
    await page.getByRole('link', { name: 'in To sort' }).last().click();
    await page.waitForURL('**/sort');
    await expect(page.getByText('Remember that Milo likes trains now.')).toBeVisible();
    await context.close();
  });

  test('U9: the error and refusal states, in HOME’s words; Keep in To sort where it applies', async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'sam', PHONE);
    await page.goto('/kev');
    const turns = page.getByTestId('kev-turn');

    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'down' });
    await ask(page, 'sam', 'What’s on tomorrow?');
    await expect(page.getByTestId('kev-error')).toHaveText(
      'Kev isn’t answering right now. What you asked is kept here.',
    );
    await expect(turns.last().getByRole('button', { name: 'Keep in To sort' })).toBeVisible();

    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'refusal' });
    await ask(page, 'sam', 'Something it refuses');
    await expect(turns.last().getByTestId('kev-say')).toHaveText('I can’t help with that one.');
    await expect(turns.last().getByTestId('kev-keep')).toHaveCount(0);

    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'invalid' });
    await ask(page, 'sam', 'Something it cannot answer reliably');
    await expect(turns.last().getByTestId('kev-say')).toHaveText(
      /^I can’t answer that reliably right now\./,
    );
    await expect(turns.last().getByRole('button', { name: 'Keep in To sort' })).toBeVisible();

    // The working line: HOME's fixed text, while a slow model works.
    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'slow' });
    await roomToAsk('sam');
    const box = page.locator('#kev-text');
    await box.fill('What’s happening today?');
    await box.press('Enter');
    await expect(page.getByTestId('kev-working')).toHaveText(/^Looking at /);
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(page.getByTestId('kev-pending')).toHaveCount(0, { timeout: 20_000 });
    await expect(turns.last().getByTestId('kev-say')).toHaveText(ANSWERED);

    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'timeout' });
    await ask(page, 'sam', 'What’s on tomorrow?');
    await expect(page.getByTestId('kev-error')).toHaveText(
      'That took too long. What you asked is kept here.',
      { timeout: 20_000 },
    );
    await context.close();
  });
});

test.describe('without JavaScript (U8, U12; Alex)', () => {
  test('the form posts, the page returns with the answer; details open; Clear and Keep in To sort work', async ({
    browser,
  }) => {
    const { context, page } = await fixtureAdultContext(browser, 'alex', PHONE, {
      javaScriptEnabled: false,
    });
    await page.goto('/kev');
    // Clear without JavaScript: the confirmation is a <details>, the action a form.
    await page.getByText('Clear conversation', { exact: true }).click();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.waitForURL(/\/kev\?cleared=1/);
    await expect(page.getByTestId('kev-turn')).toHaveCount(0);

    await askWithoutJs(page, 'alex', 'What’s happening today?');
    const answer = page.getByTestId('kev-answer').last();
    await expect(answer.getByTestId('kev-say')).toHaveText(ANSWERED);
    await answer.getByText('What’s this based on?').click();
    await expect(answer.getByTestId('kev-based-on')).toHaveAttribute('open', '');
    await expect(answer.getByTestId('kev-based-on')).toContainText('Today’s agenda');

    await askWithoutJs(page, 'alex', 'Remember the bins go out on Tuesday.');
    const turn = page.getByTestId('kev-turn').last();
    await expect(turn.getByTestId('kev-say')).toContainText('I can’t save that.');
    await turn.getByRole('button', { name: 'Keep in To sort' }).click();
    await page.waitForLoadState('load');
    await expect(page.getByTestId('kev-turn').last().getByTestId('kev-kept')).toBeVisible();

    // An error without JavaScript is said once, on the page it returns to.
    await page.setExtraHTTPHeaders({ 'x-home-test-kev': 'down' });
    await askWithoutJs(page, 'alex', 'What’s on tomorrow?');
    await expect(page.getByTestId('kev-error')).toHaveText(
      'Kev isn’t answering right now. What you asked is kept here.',
    );
    await expect(
      page.getByTestId('kev-turn').last().getByRole('button', { name: 'Keep in To sort' }),
    ).toBeVisible();
    await context.close();
  });
});

test.describe('U13: the two-adult sweep', () => {
  test('Alex’s screen never shows Sam’s words, canaries or counts; the privacy line is always there', async ({
    browser,
  }) => {
    const sam = await fixtureAdultContext(browser, 'sam', PHONE);
    await sam.page.goto('/kev');
    await ask(sam.page, 'sam', 'Remember the p4 sweep marker 5c2e.');
    await sam.context.close();
    const alex = await fixtureAdultContext(browser, 'alex', PHONE);
    for (const path of ['/kev', '/settings/usage', '/kev?weeks=13']) {
      await alex.page.goto(path);
      const body = (await alex.page.locator('body').textContent()) ?? '';
      expect(body, path).not.toContain('p4 sweep marker');
      expect(body, path).not.toContain(CANARY_MARK.sam);
    }
    await alex.page.goto('/kev');
    await expect(alex.page.getByTestId('kev-privacy')).toBeVisible();
    await alex.context.close();
  });
});

test.describe('citations re-read as the reader', () => {
  test('a cited row links to its page; once the record is archived the row goes and the screen says so', async ({
    browser,
  }) => {
    const today = (
      await q(`select to_char(now() at time zone 'Pacific/Auckland', 'YYYY-MM-DD') as today`)
    )[0]!.today!;
    const id = (await q(
      `insert into event (title, kind, created_by, created_via, visibility, all_day, start_date, end_date)
       values ('p4 library books', 'other', 'fixture-sam', 'ui', 'household', true, $1::date, $1::date + 1)
       returning id`,
      [today],
    ))[0]!.id!;
    try {
      const { context, page } = await fixtureAdultContext(browser, 'sam', PHONE);
      await page.goto('/kev');
      await ask(page, 'sam', 'What’s happening today?');
      const turn = page.getByTestId('kev-turn').last();
      const row = turn.getByRole('link', { name: /p4 library books/ });
      await expect(row).toHaveAttribute('href', `/events/${id}`);
      await row.click();
      await page.waitForURL(`**/events/${id}`);
      await q(`update event set archived_at = now() where id = $1`, [id]);
      await page.goto('/kev');
      const again = page.getByTestId('kev-turn').last();
      await expect(again.getByRole('link', { name: /p4 library books/ })).toHaveCount(0);
      await expect(again.getByTestId('kev-gone')).toHaveText(
        'One record this answer rested on is gone from your view of HOME.',
      );
      // The answer as stored is the reader's own history; nothing links from its text.
      await expect(again.getByTestId('kev-fact').first()).toBeVisible();
      await context.close();
    } finally {
      await q(`update event set archived_at = now() where id = $1 and archived_at is null`, [id]);
    }
  });
});

test.describe('U1: the screen at four viewports', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`${name}: axe clean, no horizontal scroll, 44px targets`, async ({ browser }) => {
      const { context, page } = await fixtureAdultContext(browser, 'sam', viewport);
      await page.goto('/kev');
      await page.waitForLoadState('networkidle');
      for (const d of await page.locator('details').all())
        await d.evaluate((el) => el.setAttribute('open', ''));
      await expectNoHorizontalScroll(page, `/kev ${name}`);
      await expectAccessible(page, `/kev ${name}`);
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'main a[href], main button, main textarea, main summary',
          ),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              (r.height < 43.5 || r.width < 43.5) &&
              !el.classList.contains('sr-only')
            );
          })
          .map((el) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`),
      );
      expect(small, `${name}: small targets`).toEqual([]);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await page.goto('/settings/usage');
      await expectNoHorizontalScroll(page, `/settings/usage ${name}`);
      await expectAccessible(page, `/settings/usage ${name}`);
      await context.close();
    });
  }

  test('text at 200% (desktop) reflows without horizontal scroll; reduced motion: nothing animates', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: VIEWPORTS.desktop,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await signInAsFixtureAdult(page, 'sam');
    await page.goto('/kev');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await expectNoHorizontalScroll(page, '/kev at 200%');
    const animations = await page.evaluate(() => document.getAnimations().length);
    expect(animations).toBe(0);
    await context.close();
  });
});

async function offPage(page: Page, path: string) {
  await page.goto(`${NARROW_URL}${path}`);
}

test.describe('S9, U2: Kev off (the narrow server)', () => {
  test('no Ask Kev, no Today line, no Usage; Kev’s screen says so with no input; the route refuses', async ({
    page,
  }) => {
    await page.goto(`${NARROW_URL}/sign-in`);
    await signInAsFixtureAdult(page, 'alex');
    await offPage(page, '/today');
    await expect(page.getByRole('link', { name: 'Ask Kev about today ›' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask Kev', exact: true })).toHaveCount(0);
    await expect(page.locator('#capture-text')).toHaveCount(1);
    await offPage(page, '/settings');
    await expect(page.getByRole('link', { name: /Usage/ })).toHaveCount(0);
    await offPage(page, '/kev');
    await expect(page.getByTestId('kev-off')).toHaveText('Kev isn’t switched on here.');
    await expect(page.locator('textarea')).toHaveCount(0);
    const res = await page.request.post(`${NARROW_URL}/kev/turn`, {
      headers: { 'content-type': 'application/json', origin: NARROW_URL },
      data: { text: 'What’s happening today?' },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ code: 'off', message: 'Kev isn’t switched on here.' });
  });
});
