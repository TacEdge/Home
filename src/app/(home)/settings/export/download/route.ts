import { exportFor } from '@/domain/export/service';
import { isoDateInZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { getActor } from '@/trust/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /settings/export/download (M3 contract §7.1): the signed-in adult's
// export as a JSON download. The actor comes from the session on the server;
// everything else is the domain export service. Never cached. A cross-site
// request is refused even though the session cookie would not travel with it.

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
  if (!actor) return Response.redirect(new URL('/sign-in', req.url), 303);

  const form = await req.formData().catch(() => null);
  const includeSensitive = form?.get('includeSensitive') === 'on';
  const data = await exportFor(actor, { includeSensitive });
  const day = isoDateInZone(new Date(data.exportedAt), env.HOME_TIMEZONE);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      ...noStore,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="home-export-${day}.json"`,
    },
  });
}
