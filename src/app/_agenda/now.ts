import 'server-only';
import { headers } from 'next/headers';
import { instantFromWallClock, isoDateInZone, parseIsoDate } from '@/lib/dates';
import { env } from '@/lib/env';

// The instant a screen reads as now (M5 contract §8.4). The real clock,
// unless the local and CI end-to-end servers have switched on the test time
// source (`HOME_TEST_TIME=allow`, refused by production and Vercel in
// `parseEnv`): then an `x-home-test-now` header carrying an ISO instant sets
// it, so evening mode can be proven at a frozen time, and `HOME_TEST_CLOCK`
// gives requests without a header a steady clock on the real date. Anything
// that is not a valid instant is ignored.

export async function requestNow(): Promise<Date> {
  if (env.HOME_TEST_TIME === 'allow') {
    const raw = (await headers()).get('x-home-test-now');
    const at = raw ? new Date(raw) : null;
    if (at && !Number.isNaN(at.getTime())) return at;
    if (env.HOME_TEST_CLOCK) {
      const [hour, minute] = env.HOME_TEST_CLOCK.split(':').map(Number) as [number, number];
      const date = parseIsoDate(isoDateInZone(new Date(), env.HOME_TIMEZONE));
      return instantFromWallClock({ ...date, hour, minute, second: 0 }, env.HOME_TIMEZONE);
    }
  }
  return new Date();
}
