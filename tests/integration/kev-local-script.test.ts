import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localScript } from '@/kev/evals/local';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { clockedPool, dropTestClock } from './clock';
import { adminDb, testDb } from './db';
import {
  at,
  buildKevFixture,
  clearKevFixture,
  writeForecast,
  type KevFixture,
} from './kev-fixture';
import { clockForward, clockTo, createTickingClock, runTurn } from './kev-turn-helpers';

// The local scripted model (src/kev/evals/local.ts) through kev.handle() and
// HOME's real answer checker, on every day of the fixture's week, Monday 12
// to Sunday 18 October 2026, and on 19, 20 and 21 October around Nana Jo's
// birthday (the 20th), at 07:03, with both clocks pinned: the turn's
// own `now`, and the database's (a ticking test clock, for turn limits and
// bookkeeping). Each approved scenario is answered on its first try: one
// read, one answer the checker accepts, no regeneration and no escalation.
// The browser suite asks these on whatever day it runs; on a Sunday "today"
// was refused (an "anything else" absence beside nothing shown) and escalated
// to a tier the script had no step for. On the 20th "today" (and on the 19th
// "tomorrow") was refused the same way: the script cited the day's events but
// not the birthday its own read returned, so "nothing else" was unsupported.
// Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const { pool: clockedHandle, db: clocked } = clockedPool();
const savedEnv = { ...process.env };
let f: KevFixture;

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  process.env.HOME_KEV_MONTHLY_CAP_NZD = '300';
  f = await buildKevFixture(db, admin.db);
  await createTickingClock(admin);
  await clockTo(admin, '2045-02-01T00:00:00Z');
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await clockedHandle.end();
  await dropTestClock(admin);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

const WEEK = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
] as const;
const SCENARIOS = [
  'What’s happening today?',
  'What’s on tomorrow?',
  'What have we got this weekend?',
  'Help me think through our weekend.',
  'What’s the weather doing?',
] as const;

describe('the scripted model on every day of the week', () => {
  for (const date of WEEK)
    it(`${date}: each scenario is answered, first time, by a plan the checker accepts`, async () => {
      // A forecast fetched that morning, so the weather reads are fresh.
      await writeForecast(admin.db, at(date, '06:55'));
      const now = at(date, '07:03');
      for (const q of SCENARIOS) {
        const l = localScript(q, { now, timeZone: 'Pacific/Auckland' });
        await clockForward(admin, 2);
        const t = await runTurn(f.kev.sam, q, l.script, { now, db: clocked });
        expect(t.done, `${date} ${q}`).toMatchObject({ outcome: 'answer', escalated: false });
        // The read, the read phase's end and the answer phase (ADR 0012
        // §54): no regeneration after a refused plan.
        expect(t.provider.requests.length, `${date} ${q}`).toBe(3);
      }
    });
});
