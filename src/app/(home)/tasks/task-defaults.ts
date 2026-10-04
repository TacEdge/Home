import type { Task } from '@/domain/tasks/service';
import { clockOf, isoDateInZone } from '@/lib/dates';
import type { TaskFormDefaults } from './task-form';

// What the task form shows before anyone types: a new task, perhaps already
// part of a project; or an existing one, its window in the home zone.

export function newTaskDefaults(projectId = ''): TaskFormDefaults {
  return { projectId, windowDate: '', windowFrom: '', windowTo: '' };
}

export function existingTaskDefaults(t: Task, timeZone: string): TaskFormDefaults {
  const has = t.scheduledStartsAt && t.scheduledEndsAt;
  return {
    projectId: t.projectId ?? '',
    windowDate: has ? isoDateInZone(t.scheduledStartsAt!, timeZone) : '',
    windowFrom: has ? clockOf(t.scheduledStartsAt!, timeZone) : '',
    windowTo: has ? clockOf(t.scheduledEndsAt!, timeZone) : '',
  };
}
