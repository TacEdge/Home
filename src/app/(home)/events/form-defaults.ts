import { defaultWeekdays, type Occurrence } from '@/domain/engines/recurrence';
import { startOf } from '@/domain/events/occurrences';
import type { Event, EventPerson } from '@/domain/events/service';
import { addDays, clockOf, isoDateInZone, type IsoDate } from '@/lib/dates';
import type { EventFormDefaults } from './event-form';
import { recurrenceFields } from './event-form-data';

// What the event form shows before anyone types: a new event today at
// 09:00–10:00, or an existing event as it is stored, in its own zone. The
// weekday controls start on the first date's weekday (the engine's default)
// until a rule says otherwise.

export function newEventDefaults(today: IsoDate): EventFormDefaults {
  return {
    startDate: today,
    startTime: '09:00',
    endDate: '',
    endTime: '10:00',
    allDay: false,
    repeat: 'none',
    weekdays: new Set(defaultWeekdays({ allDay: true, startDate: today }).map(String)),
    ends: 'never',
    endsOn: '',
    endsAfter: '',
    attending: new Set(),
    responsible: new Set(),
  };
}

export function existingEventDefaults(e: Event, annotations: EventPerson[]): EventFormDefaults {
  const r = recurrenceFields(e);
  let time: Pick<EventFormDefaults, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'allDay'>;
  if (e.allDay) {
    const last = addDays(e.endDate!, -1);
    time = {
      allDay: true,
      startDate: e.startDate!,
      endDate: last === e.startDate ? '' : last,
      startTime: '09:00',
      endTime: '10:00',
    };
  } else {
    const tz = e.timeZone!;
    const startDate = isoDateInZone(e.startsAt!, tz);
    const endDate = isoDateInZone(e.endsAt!, tz);
    time = {
      allDay: false,
      startDate,
      startTime: clockOf(e.startsAt!, tz),
      endDate: endDate === startDate ? '' : endDate,
      endTime: clockOf(e.endsAt!, tz),
    };
  }
  return {
    ...time,
    repeat: r.repeat,
    weekdays: r.weekdays.size ? r.weekdays : new Set(defaultWeekdays(startOf(e)).map(String)),
    ends: r.ends,
    endsOn: r.endsOn,
    endsAfter: r.endsAfter,
    attending: new Set(annotations.filter((a) => a.role === 'attending').map((a) => a.personId)),
    responsible: new Set(
      annotations.filter((a) => a.role === 'responsible').map((a) => a.personId),
    ),
  };
}

/** "Change this one" before anyone types: that occurrence's own date and time, nothing repeating. */
export function occurrenceDefaults(o: Occurrence): EventFormDefaults {
  const none = {
    repeat: 'none',
    weekdays: new Set<string>(),
    ends: 'never',
    endsOn: '',
    endsAfter: '',
    attending: new Set<string>(),
    responsible: new Set<string>(),
  };
  if (o.allDay) {
    const last = addDays(o.endDate, -1);
    return {
      ...none,
      allDay: true,
      startDate: o.startDate,
      endDate: last === o.startDate ? '' : last,
      startTime: '09:00',
      endTime: '10:00',
    };
  }
  const startDate = isoDateInZone(o.startsAt, o.timeZone);
  const endDate = isoDateInZone(o.endsAt, o.timeZone);
  return {
    ...none,
    allDay: false,
    startDate,
    startTime: clockOf(o.startsAt, o.timeZone),
    endDate: endDate === startDate ? '' : endDate,
    endTime: clockOf(o.endsAt, o.timeZone),
  };
}
