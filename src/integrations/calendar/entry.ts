import 'server-only';
import { calendarBoundary } from '@/domain/calendar/errors';
import { refreshCalendar, refreshStaleCalendars } from '@/domain/calendar/sync';
import { env } from '@/lib/env';
import { icsProvider } from './ics/provider';
import { testFeedDirectory, testFeedFetcher } from './test-feeds';

// The calendar composition root (ADR 0007 §42). The one place the domain's
// calendar refresh meets the real provider: the domain never imports an
// integration, and app code never sees a provider. App may import this
// module and no other in integrations (eslint.config.mjs's one exception,
// held by tests/unit/layer-exceptions.test.ts). Server-only. Everything
// that crosses it is structural: HOME's refusal codes, input validation,
// or a CalendarUnexpectedError with no message, cause or parameters.

type Actor = Parameters<typeof refreshCalendar>[0];

let provider: ReturnType<typeof icsProvider> | null = null;
/**
 * The real `ics` provider: Google's secret address, through Package 2's
 * guarded fetch. In a local or CI run with HOME_TEST_CALENDAR_FEEDS set, the
 * feed comes from synthetic files instead (test-feeds.ts; refused in any
 * deployed environment).
 */
const real = () =>
  (provider ??= icsProvider({
    homeTimeZone: env.HOME_TIMEZONE,
    ...(testFeedDirectory() ? { fetchFeed: testFeedFetcher(testFeedDirectory()!) } : {}),
  }));

/** Refresh one calendar now (Settings › Calendars' Refresh now). */
export function refreshCalendarNow(actor: Actor, calendarId: string) {
  return calendarBoundary('refreshCalendarNow', () => refreshCalendar(actor, calendarId, real()));
}

/** Refresh-on-use: every calendar this adult can see that is older than 15 minutes. */
export function refreshStaleCalendarsNow(actor: Actor) {
  return calendarBoundary('refreshStaleCalendarsNow', () => refreshStaleCalendars(actor, real()));
}
