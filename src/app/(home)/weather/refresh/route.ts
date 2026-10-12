import { NotPermittedError } from '@/domain/common/errors';
import { refreshWeatherNow } from '@/integrations/weather/entry';
import { getActor } from '@/trust/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The whole refresh runs inside this request (M7 contract §5.1, ADR 0011
// §15): a 10-second fetch and 5-second statements fit well within it. No
// background work of any kind: nothing here continues after the response.
export const maxDuration = 30;

// POST /weather/refresh (M7 contract §5.1; ADR 0011 §10, §15, §16):
// refresh-on-use for the household's forecast, shaped like
// /calendars/refresh. A page that showed weather asks once, after render,
// when the server said a refresh is due; rendering never fetches. Same-origin
// only, signed in, never cached, and it answers only `{ changed }`, so the
// page knows to re-read itself: never a forecast, a location or an error's
// detail. A refusal (the closed gate in Production, Kev) is simply "no
// change"; the service has already logged any failure by its code alone.

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
    const { changed } = await refreshWeatherNow(actor);
    return Response.json({ changed }, { status: 200, headers: noStore });
  } catch (e) {
    if (e instanceof NotPermittedError)
      return Response.json({ changed: false }, { status: 200, headers: noStore });
    // WeatherUnexpectedError: already logged as `unexpected` by the service.
    return Response.json({ changed: false }, { status: 500, headers: noStore });
  }
}
