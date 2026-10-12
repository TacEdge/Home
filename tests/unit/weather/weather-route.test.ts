import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotPermittedError } from '@/domain/common/errors';
import { WeatherUnexpectedError } from '@/domain/weather/service';
import { LOCATION_LEAKS } from '../../fixtures/weather';

// POST /weather/refresh (M7 contract §5.1, §8.1, §8.6 W13, W23, P8) and its
// client (built in Package 1b, placed on screens in Package 4).

const ROUTE = 'src/app/(home)/weather/refresh/route.ts';
const CLIENT = 'src/app/_weather/refresh-weather.tsx';

const state: { actor: unknown; outcome: unknown; calls: number } = {
  actor: null,
  outcome: null,
  calls: 0,
};
vi.mock('@/trust/session', () => ({ getActor: async () => state.actor }));
vi.mock('@/integrations/weather/entry', () => ({
  refreshWeatherNow: async () => {
    state.calls++;
    if (state.outcome instanceof Error) throw state.outcome;
    return state.outcome;
  },
}));

const SAM = { kind: 'user', userId: 'u-sam', email: 'sam@example.test', via: 'ui', channel: 'web' };
const post = async (headers: Record<string, string> = { origin: 'http://localhost:3000' }) => {
  const { POST } = await import('@/app/(home)/weather/refresh/route');
  return POST(
    new Request('http://localhost:3000/weather/refresh', {
      method: 'POST',
      headers: { host: 'localhost:3000', ...headers },
    }),
  );
};

beforeEach(() => {
  state.actor = SAM;
  state.outcome = { status: 'ok', changed: true };
  state.calls = 0;
});

describe('the route’s configuration (static)', () => {
  const text = readFileSync(ROUTE, 'utf8');
  it('exports maxDuration = 30, nodejs, dynamic', async () => {
    const mod = await import('@/app/(home)/weather/refresh/route');
    expect(mod.maxDuration).toBe(30);
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
    expect(text).toMatch(/^export const maxDuration = 30;$/m);
  });
  it('imports neither after nor waitUntil, and nothing that runs after the response', () => {
    expect(text).not.toMatch(
      /\bafter\b\s*[,}]|\bafter\(|waitUntil|unstable_after|@vercel\/functions/,
    );
    expect(text).not.toMatch(/from 'next\/server'/);
  });
  it('the whole request path has no background work: the service and entry neither', () => {
    for (const f of [
      'src/integrations/weather/entry.ts',
      'src/domain/weather/service.ts',
      'src/integrations/weather/open-meteo.ts',
    ])
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /waitUntil|unstable_after|from 'next\/server'|setTimeout|setInterval|queueMicrotask/,
      );
  });
  it('logs nothing itself (the service logs codes only)', () => {
    expect(text).not.toMatch(/\blog\.|console\./);
  });
});

describe('refusals, in the shapes of /calendars/refresh', () => {
  it('unauthenticated: 401, no body, no refresh', async () => {
    state.actor = null;
    const r = await post();
    expect(r.status).toBe(401);
    expect(await r.text()).toBe('');
    expect(state.calls).toBe(0);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it.each([
    [{ origin: 'https://evil.example' }],
    [{ origin: 'not a url' }],
    [{ 'sec-fetch-site': 'cross-site' }],
  ])('cross-origin %j: 403, no body, no refresh', async (headers) => {
    const r = await post(headers);
    expect(r.status).toBe(403);
    expect(await r.text()).toBe('');
    expect(state.calls).toBe(0);
  });
  it('W13: the gate closed (real_data_closed): 200 { changed: false }', async () => {
    state.outcome = new NotPermittedError('real_data_closed');
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ changed: false });
  });
  it('P8: Kev (kev_cannot_write): 200 { changed: false }', async () => {
    state.outcome = new NotPermittedError('kev_cannot_write');
    expect(await (await post()).json()).toEqual({ changed: false });
  });
});

describe('answers: only { changed }', () => {
  it.each([
    [{ status: 'ok', changed: true }, { changed: true }],
    [{ status: 'not_due', changed: false }, { changed: false }],
    [{ status: 'busy', changed: false }, { changed: false }],
    [{ status: 'rate_limited', changed: false }, { changed: false }],
    [{ status: 'not_configured', changed: false }, { changed: false }],
  ])('%j → %j', async (outcome, body) => {
    state.outcome = outcome;
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(body);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('W23: an unexpected failure is 500 { changed: false }, with nothing location-bearing', async () => {
    state.outcome = new WeatherUnexpectedError();
    const r = await post();
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ changed: false });
    for (const leak of LOCATION_LEAKS) expect(text).not.toContain(leak);
  });
  it('any other thrown error is the same generic failure, never its message', async () => {
    state.outcome = new Error('https://api.open-meteo.com/v1/forecast?latitude=-41.29');
    const r = await post();
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('{"changed":false}');
  });
});

describe('the client', () => {
  it('posts once to /weather/refresh, same-origin, and re-reads the page only when changed', async () => {
    const { askWeatherRefresh, WEATHER_REFRESH_PATH } =
      await import('@/app/_weather/refresh-weather');
    expect(WEATHER_REFRESH_PATH).toBe('/weather/refresh');
    for (const [response, refreshed] of [
      [Response.json({ changed: true }), 1],
      [Response.json({ changed: false }), 0],
      [new Response(null, { status: 401 }), 0],
      [Response.json({ changed: false }, { status: 500 }), 0],
      [new Response('not json', { status: 200 }), 0],
    ] as const) {
      const calls: [string, RequestInit][] = [];
      let n = 0;
      await askWeatherRefresh(
        async (path, init) => {
          calls.push([path, init]);
          return response.clone();
        },
        () => n++,
      );
      expect(calls).toEqual([['/weather/refresh', { method: 'POST', credentials: 'same-origin' }]]);
      expect(n).toBe(refreshed);
    }
    let n = 0;
    await askWeatherRefresh(
      async () => {
        throw new TypeError('network');
      },
      () => n++,
    );
    expect(n).toBe(0);
  });

  it('asks once per mount, after render (an effect), and renders nothing', () => {
    const text = readFileSync(CLIENT, 'utf8');
    expect(text).toMatch(/^'use client';/);
    expect(text).toMatch(/useEffect\(/);
    expect(text).toMatch(/asked\.current = true/);
    expect(text).toMatch(/return null;/);
  });

  it('is not mounted on any page in Package 1b (Package 4 places it)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const users = walk('src')
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== CLIENT)
      .filter((f) => /_weather\/refresh-weather|RefreshWeather/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
  });
});
