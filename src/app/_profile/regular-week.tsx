import { WEEKDAY_LABEL } from '@/app/(home)/events/copy';
import type { RegularWeekEntry } from '@/domain/engines/profile';
import { ItemRow, List } from '@/ui/list';
import { Label } from '@/ui/page';

// A person's regular week on their profile (M4 contract §3.6, ADR 0007 §45):
// "Usually", then each weekday that has something, with what happens then.
// A small household timetable in the agenda's own rows: no grid, no planner,
// no source labels. Nothing is shown when there is nothing regular. The
// entries come from the profile engine; this only lays them out.

export function RegularWeek({ entries }: { entries: readonly RegularWeekEntry[] }) {
  if (entries.length === 0) return null;
  const days = [...new Set(entries.map((e) => e.weekday))];
  return (
    <section aria-labelledby="usually">
      <Label id="usually">Usually</Label>
      {days.map((day) => (
        <div key={day}>
          <h3 className="text-ink-2 mt-4 mb-1 text-[15px] font-medium">{WEEKDAY_LABEL[day]}</h3>
          <List>
            {entries
              .filter((e) => e.weekday === day)
              .map((e) => (
                <ItemRow
                  key={`${e.eventId}-${day}`}
                  href={`/events/${e.eventId}`}
                  time={e.allDay ? 'All day' : e.time}
                  title={e.title}
                  detail={
                    e.cadence === 'fortnightly' ? `Every second ${WEEKDAY_LABEL[day]}` : undefined
                  }
                />
              ))}
          </List>
        </div>
      ))}
    </section>
  );
}
