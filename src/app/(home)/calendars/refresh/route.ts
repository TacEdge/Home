import { NotFoundError, NotPermittedError } from '@/domain/common/errors';
import { refreshStaleCalendarsNow } from '@/integrations/calendar/entry';
import { log } from '@/lib/log';
import { getActor } from '@/trust/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /calendars/refresh (M4 contract §2.2, §3.3; ADR 0007 §12, §42):
// refresh-on-use. The shell (Package 6) calls it without waiting when a
// calendar the signed-in adult can see is older than 15 minutes; rendering
// never writes. Same-origin only, never cached, and it answers only whether
// anything changed (a calendar was refreshed: its freshness or status moved,
// whether or not its events did), so the page knows to re-read itself: never
// a calendar's name, address or events, never an error's detail. A refusal
// (the closed gate in Production, Kev, missing keys) is simply "no change".

const noStore = { 'Cache-Control': 'no-store' };

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403, headers: noStore });
  const actor = await getActor();
  if (!actor) return new Response(null, { status: 401, headers: noStore });
  try {
    const results = await refreshStaleCalendarsNow(actor);
    const changed = results.some(({ outcome: o }) => 'counts' in o);
    return Response.json({ changed }, { status: 200, headers: noStore });
  } catch (e) {
    if (e instanceof NotPermittedError || e instanceof NotFoundError)
      return Response.json({ changed: false }, { status: 200, headers: noStore });
    // Structural only: the entry point's errors carry no message or parameters.
    log.error('calendar_refresh_failed', { error: e instanceof Error ? e.name : typeof e });
    return Response.json({ changed: false }, { status: 500, headers: noStore });
  }
}
