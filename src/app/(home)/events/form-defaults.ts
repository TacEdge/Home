import { defaultWeekdays } from '@/domain/engines/recurrence';
import { startOf } from '@/domain/events/occurrences';
import type { Event, EventPerson } from '@/domain/events/service';
import { addDays, wallClockOf, type IsoDate } from '@/lib/dates';
import type { EventFormDefaults } from './event-form';
import { recurrenceFields } from './event-form-data';

// What the event form shows before anyone types: a new event today at
// 09:00–10:00, or an existing event as it is stored, in its own zone. The
// weekday controls start on the first date's weekday (the engine's default)
// until a rule says otherwise.

const hhmm = (w: { hour: number; minute: number }) =>
  `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
const dateOf = (w: { year: number; month: number; day: number }) =>
  `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;

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
    const s = wallClockOf(e.startsAt!, e.timeZone!);
    const t = wallClockOf(e.endsAt!, e.timeZone!);
    time = {
      allDay: false,
      startDate: dateOf(s),
      startTime: hhmm(s),
      endDate: dateOf(t) === dateOf(s) ? '' : dateOf(t),
      endTime: hhmm(t),
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
