import { expect, test } from '@playwright/test';
import { signInAsFixtureAdult } from './fixture-adults';

// Refresh-on-use (M4 contract §3.3, ADR 0007 §12, §42): the route the shell
// will call. With no calendar connected it answers "no change"; it is never
// cached, refuses cross-site posts and needs a session. No calendar content.

test('POST /calendars/refresh: same-origin, signed in, never cached, no calendar content', async ({
  page,
  request,
}) => {
  await signInAsFixtureAdult(page, 'sam');
  const ok = await page.request.post('/calendars/refresh');
  expect(ok.status()).toBe(200);
  expect(ok.headers()['cache-control']).toBe('no-store');
  expect(await ok.json()).toEqual({ changed: false });

  const cross = await page.request.post('/calendars/refresh', {
    headers: { origin: 'https://elsewhere.example' },
  });
  expect(cross.status()).toBe(403);

  const anon = await request.post('/calendars/refresh', { maxRedirects: 0 });
  expect([401, 303, 307]).toContain(anon.status());
  expect(await anon.text()).not.toContain('changed');
});
