import type { TaskNeed, TaskStatus } from '@/domain/tasks/schema';

// Words for tasks: status, needs, an estimate.

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'To do',
  done: 'Done',
  dropped: 'Dropped',
};

export const taskStatusLabel = (s: string) => TASK_STATUS_LABEL[s as TaskStatus] ?? s;

export const NEED_LABEL: Record<TaskNeed, string> = {
  dry_weather: 'Dry weather',
  daylight: 'Daylight',
  two_people: 'Two people',
  shops_open: 'Shops open',
};

export const needLabel = (n: string) => NEED_LABEL[n as TaskNeed] ?? n;

/** "30 min", "2 h", "1 h 30". */
export function estimateLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}
