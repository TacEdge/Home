import { after } from 'next/server';
import { requestNow } from '@/app/_agenda/now';
import { getActor } from '@/trust/session';
import { handleTurnRequest } from './handle';

// POST /kev/turn (M8 contract §11.4; D17; ADR 0012 §33): Kev's turn, as Server-
// Sent Events with JavaScript, or a form post that runs to completion and
// returns to /kev without it. The whole adapter is ./handle.ts.
//
// Node, never cached. `maxDuration` is 90 seconds (subject to G3, the
// Vercel plan's maximum): the user-facing deadline is 55 seconds and the
// rest is for settling and recording on the failure path (§11.4). The turn
// is kept alive past the response with `after()`, so a client disconnect
// never stops it settling and recording (G4); cancellation is never enabled
// for this route (no `supportsCancellation` in vercel.json).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: Request): Promise<Response> {
  return handleTurnRequest(req, {
    getActor,
    now: requestNow,
    after: (task) => after(task),
  });
}
