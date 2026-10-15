import { purgeExpiredMessages } from '@/domain/kev-bookkeeping/service';
import { cronSecret } from '@/lib/env';
import { log } from '@/lib/log';
import { systemActor } from '@/trust/actor';
import { authorised } from './authorised';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// At most 20 bounded statements of 1,000 rows each: seconds, never minutes.
export const maxDuration = 60;

// The daily retention cleanup (M8 contract §7.2, O6, D13; matrix rows
// C19–C22). The one scheduled job M8 adds, and it is not Kev: it calls no
// model, reads no table but `message` (and writes its one audit row), reads
// no message content, and sends nothing. It deletes messages more than 90
// days old, for every adult, in bounded batches, through the bookkeeping
// path's one system function.
//
// Outside the signed-in group: it is called by a scheduler, never a person.
// Its only credential is CRON_SECRET, as `Authorization: Bearer <value>`,
// compared in constant time; anything else is 401 and does nothing. With
// CRON_SECRET unset (an environment without Kev), it does nothing and
// returns 404. `POST` for a manual or alternative scheduler; `GET` because
// that is what Vercel's cron sends.
//
// The schedule: none yet. G18 (the owner's Vercel plan, whether cron runs
// there, and that the platform sends CRON_SECRET) is NOT VERIFIED, so no
// `crons` entry is added to vercel.json (contract §2.2, §7.2): until the
// owner decides, expiry stays exact through read-time filtering and purge on
// each adult's next turn.

const noStore = { 'Cache-Control': 'no-store' };

async function run(req: Request): Promise<Response> {
  const secret = cronSecret();
  if (!secret) return new Response(null, { status: 404, headers: noStore });
  if (!authorised(req.headers.get('authorization'), secret))
    return new Response(null, { status: 401, headers: noStore });
  const { deleted, batches } = await purgeExpiredMessages(systemActor);
  // One line per run, counts only (contract §7.2).
  log.info('kev_retention', { deleted, batches });
  return Response.json({ deleted, batches }, { status: 200, headers: noStore });
}

export const POST = run;
export const GET = run;
