import 'server-only';
import { listCalendars } from '@/domain/calendar/service';
import type { UserActor } from '@/trust/actor';

// Whether a page should ask for a refresh on use (M4 contract §3.3, ADR
// 0007 §12): a connected calendar this adult can see is older than the
// stale threshold. Read as the actor through the calendar service; the
// page renders at once with what HOME has, and RefreshOnUse asks afterwards.
export async function hasStaleCalendar(actor: UserActor): Promise<boolean> {
  const calendars = await listCalendars(actor);
  return calendars.some((c) => c.stale && c.archivedAt === null);
}
