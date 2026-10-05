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
