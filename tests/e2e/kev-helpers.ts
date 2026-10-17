import { expect, type Page } from '@playwright/test';
import type { Adult } from './fixture-adults';
import { withDb } from './helpers';

// Helpers for the Kev screen's browser tests (M8 Package 4): asking Kev with
// and without JavaScript, clearing, and staying inside the per-adult limits
// (6 turns a minute, counted from audit rows, which survive Clear and every
// spec), against the scripted provider. Synthetic only.

export const USER: Record<Adult, string> = { sam: 'fixture-sam', alex: 'fixture-alex' };

/**
 * A fixed instant for a Kev spec whose answer depends on the weekday: the
 * seeded week's Wednesday, 14 October 2026, 07:03 in Pacific/Auckland, sent
 * as the test time source's `x-home-test-now` header (src/app/_agenda/now.ts).
 * It sets the turn's own clock only: stored rows keep the database's real
 * time, so a spec that reads a stored answer's day or its forecast credit
 * (relative to when it was answered) runs on the real date instead.
 */
export const KEV_TEST_NOW = '2026-10-14T07:03:00+13:00';
export const KEV_TEST_DATE = KEV_TEST_NOW.slice(0, 10);
export const KEV_CLOCK: Readonly<Record<string, string>> = Object.freeze({
  'x-home-test-now': KEV_TEST_NOW,
});

export const q = (sql: string, a: unknown[] = []) =>
  withDb(async (pool) => (await pool.query(sql, a)).rows as Record<string, string>[]);

/** Waits until the adult has room for another turn this minute (§9.6: six a minute). */
export async function roomToAsk(adult: Adult): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const [row] = await q(
      `select count(*)::int as n from audit_log
        where actor_user_id = $1 and event = 'message.add' and meta ->> 'role' = 'user'
          and at > now() - interval '62 seconds'`,
      [USER[adult]],
    );
    if (Number(row?.n ?? 0) < 6) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`no room to ask for ${adult}`);
}

/** Asks with JavaScript: types, presses Enter, waits for the stored answer (or HOME's error line). */
export async function ask(page: Page, adult: Adult, text: string): Promise<void> {
  await roomToAsk(adult);
  const turns = await page.getByTestId('kev-turn').count();
  const box = page.locator('#kev-text');
  await box.fill(text);
  await box.press('Enter');
  await expect(page.getByTestId('kev-pending')).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(
      async () =>
        (await page.getByTestId('kev-turn').count()) > turns ||
        (await page.getByTestId('kev-error').count()) > 0,
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Asks without JavaScript: the form posts and the page returns with the stored turn. */
export async function askWithoutJs(page: Page, adult: Adult, text: string): Promise<void> {
  await roomToAsk(adult);
  await page.locator('#kev-text').fill(text);
  await Promise.all([
    page.waitForURL(/\/kev(\?|#|$)/, { timeout: 20_000 }),
    page.getByRole('button', { name: 'Send', exact: true }).click(),
  ]);
}

/** Clears the adult's conversation through the screen, if there is one to clear. */
export async function clearKev(page: Page): Promise<void> {
  await page.goto('/kev');
  const clear = page.getByText('Clear conversation', { exact: true });
  if ((await clear.count()) === 0) return;
  await clear.click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForURL(/\/kev\?cleared=1/);
  await expect(page.getByTestId('kev-cleared')).toBeVisible();
}

/** The household's recorded usage this month, in micro-US-dollars (a test read of kev_usage). */
export async function recordedMonth(): Promise<bigint> {
  const [row] = await q(
    `select coalesce(sum(cost_usd_micros), 0)::text as s from kev_usage
      where at >= date_trunc('month', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland'`,
  );
  return BigInt(row?.s ?? '0');
}

/** Adds synthetic recorded usage (an append-only row, as Kev's own would be) to reach `target` µ$. */
export async function recordUsageUpTo(target: bigint): Promise<void> {
  const now = await recordedMonth();
  if (now >= target) return;
  await q(
    `insert into kev_usage (user_id, tier, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros)
     values ('fixture-alex', 'fast', 'synthetic', 0, 0, 0, 0, $1)`,
    [(target - now).toString()],
  );
}
