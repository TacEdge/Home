import { capitalise, numberWord } from '@/domain/engines/day-facts';
import { addDays, longDate, type IsoDate, weekdayOf } from '@/lib/dates';

// Words for Today (M3 contract §3.2): the date as the headline, and an
// overdue task's "From Tuesday", in words, never a colour.

const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Wednesday 14 October": the headline, the date and nothing more. */
export const todayHeadline = (today: IsoDate) => longDate(today);

/**
 * How an open task's due date reads on Today, sentence-style throughout:
 * "Due today", "From yesterday", "From Tuesday" within the week, then
 * "From 28 Sept".
 */
export function dueLabel(dueDate: IsoDate, today: IsoDate): string {
  if (dueDate === today) return 'Due today';
  if (dueDate === addDays(today, -1)) return 'From yesterday';
  if (dueDate > addDays(today, -7)) return `From ${WEEKDAY[weekdayOf(dueDate)]}`;
  return `From ${longDate(dueDate, 'short')}`;
}

/** "Three more to do": a count in words, never a warning (M5 contract §4.1). */
export const moreToDoLine = (n: number) => `${capitalise(numberWord(n))} more to do`;

/** What a to-do row says beside its title, in words (M5 contract §5.5): its date, never a judgement. */
export function todoDetail(
  reason: 'due_today' | 'scheduled_today' | 'carried_over' | 'due_tomorrow',
  dueDate: IsoDate | null,
  today: IsoDate,
  project: string | undefined,
): string {
  const when =
    reason === 'due_tomorrow'
      ? 'Due tomorrow'
      : dueDate !== null && dueDate <= today
        ? dueLabel(dueDate, today)
        : null;
  return [when, project].filter(Boolean).join(' · ');
}
