import { requestNow } from '@/app/_agenda/now';
import { RefreshOnUse } from '@/app/_calendar/refresh-on-use';
import { kevSwitchedOn } from '@/app/_kev/status';
import { RefreshWeather } from '@/app/_weather/refresh-weather';
import { env } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { composeToday } from './compose';
import { TodayView } from './today-view';

export const dynamic = 'force-dynamic';

// Today (M5 contract §4, ADR 0008 §32; M7 contract §4.1). The composition is
// `compose.ts`; this renders it. A calendar older than fifteen minutes, and a
// forecast that is due, are refreshed after the page has rendered (M4, M7):
// Today never waits for either, and never for Kev.
export default async function TodayPage() {
  const actor = await requireActor();
  const { props, calendarStale, askWeather } = await composeToday(
    actor,
    await requestNow(),
    env.HOME_TIMEZONE,
  );
  return (
    <>
      {calendarStale ? <RefreshOnUse /> : null}
      {askWeather ? <RefreshWeather /> : null}
      <TodayView {...props} askKev={kevSwitchedOn()} />
    </>
  );
}
