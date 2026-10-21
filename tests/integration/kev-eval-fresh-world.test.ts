import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMessage, listConversations } from '@/domain/conversations/service';
import { clearConversation } from '@/domain/kev-bookkeeping/service';
import { WEATHER_VARIABLES, WELLINGTON, weatherEnv } from '../fixtures/weather';
import { adminDb, testDb } from './db';
import { buildEvalWorld } from './kev-eval-world';
import { clearKevFixture, type KevFixture } from './kev-fixture';

// The live runner's order on the real clock (live verification #5,
// 2026-10-18): the evaluation world is built, and the first scenario starts
// seconds later. The other evaluation suites build the world and then move
// the database clock years ahead, so nothing the world wrote can still look
// recent; the runner's database has the real clock only. A world that
// leaves an adult's message unanswered and under 70 seconds old is a turn
// in flight (contract §7.2, L12): the scenario's fresh conversation (Clear)
// is refused, and so is its first turn, before any model call.
//
// Clear is what is tested: the harness's first step for every scenario,
// and HOME's own in-flight check with nothing else in front of it (a turn's
// admission checks the adult's daily limit first, which other suites spend
// on the real clock). Synthetic only.

const { db, close } = testDb();
const admin = adminDb();
const savedEnv = { ...process.env };
let f: KevFixture;

beforeAll(async () => {
  for (const k of WEATHER_VARIABLES) delete process.env[k];
  Object.assign(process.env, weatherEnv(WELLINGTON));
  f = (await buildEvalWorld(db, admin.db)).f;
  // The runner's database is its own and new: no reservation in it is open.
  // This one is shared, and a suite before this one may have left an adult's
  // reservation open on a clock of its own (the privacy suite's, in 2030),
  // which the real clock reads as an attempt still running. Closed as the
  // sweep closes a stale one, so only what the world wrote is tested.
  await admin.db.execute(sql`
    update kev_budget_reservation set status = 'unreconciled', closed_at = created_at
     where status = 'open' and user_id in (${f.kev.sam.userId}, ${f.kev.alex.userId})`);
});
afterAll(async () => {
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
  await clearKevFixture(db, admin.db);
  await close();
  await admin.close();
});

describe('straight after the evaluation world is built', () => {
  it('no adult has a turn in flight: each scenario’s fresh conversation is allowed', async () => {
    for (const adult of ['sam', 'alex'] as const)
      expect(await clearConversation(f.kev[adult], { db }), adult).toMatchObject({ ok: true });
  });

  it('a message really unanswered and recent is still a turn in flight', async () => {
    for (const adult of ['sam', 'alex'] as const) {
      const [conversation] = await listConversations(f.h[adult], {}, { db });
      await addMessage(
        f.h[adult],
        conversation!.id,
        { role: 'user', content: { v: 1, text: 'What is on this weekend?' } },
        { db },
      );
      expect(await clearConversation(f.kev[adult], { db }), adult).toEqual({
        ok: false,
        code: 'turn_in_flight',
      });
    }
  });
});
