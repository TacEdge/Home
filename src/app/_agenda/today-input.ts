import type { DayPerson } from '@/domain/engines/day-facts';
import type { TodayCalendar, TodayInput, TodayTask } from '@/domain/engines/today';
import type { LoadedAgenda } from './load';

// What the Today engine is given (M5 Package 3, ADR 0008 §32): the records
// the shared agenda loader already read, handed over as they are. No
// filtering, no interpretation and no second read: the services applied
// visibility and archive before any of this existed, and the engine decides
// everything else.

export function todayInput(
  agenda: Pick<LoadedAgenda, 'days' | 'events' | 'people' | 'records'>,
  now: Date,
  timeZone: string,
  capturesWaiting: number,
): TodayInput {
  const people: DayPerson[] = [...agenda.people.values()].map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role as DayPerson['role'],
    inHousehold: p.inHousehold,
  }));
  const tasks: TodayTask[] = agenda.records.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    scheduledStartsAt: t.scheduledStartsAt,
  }));
  const calendars: TodayCalendar[] = agenda.records.calendars.map((c) => ({
    id: c.id,
    name: c.name,
    archivedAt: c.archivedAt,
    lastAttemptAt: c.lastAttemptAt,
    lastSyncedAt: c.lastSyncedAt,
    lastSyncStatus: c.lastSyncStatus,
  }));
  return {
    now,
    timeZone,
    days: agenda.days,
    events: agenda.events,
    people,
    tasks,
    calendars,
    capturesWaiting,
  };
}
