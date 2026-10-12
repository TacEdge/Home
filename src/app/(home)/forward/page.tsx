import { requestNow } from '@/app/_agenda/now';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { RefreshWeather } from '@/app/_weather/refresh-weather';
import { HORIZONS, type Horizon } from '@/domain/engines/forward';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { composeForward } from './compose';
import { ForwardView } from './forward-view';

export const dynamic = 'force-dynamic';

// Forward (M6 contract §4, ADR 0009 §15–§19, §32–§34; M7 contract §4.2). The
// composition is `compose.ts`; this renders it. A calendar older than fifteen
// minutes, and (Week only) a forecast that is due, are refreshed after the
// page has rendered; Forward never waits for either, and never for Kev.
export default async function ForwardPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const actor = await requireActor();
  const { h } = await searchParams;
  const horizon: Horizon = HORIZONS.find((x) => x === h) ?? 'week';
  const { props, calendarStale, askWeather } = await composeForward(
    actor,
    await requestNow(),
    env.HOME_TIMEZONE,
    horizon,
  );
  return (
    <>
      {calendarStale ? <RefreshOnUse /> : null}
      {askWeather ? <RefreshWeather /> : null}
      <ForwardView {...props} />
    </>
  );
}
