import { z } from 'zod';
import { TASK_NEEDS, TASK_STATUSES } from '@/db/schema/task';
import {
  domain,
  instant,
  isoDate,
  longText,
  recordId,
  requiredText,
  visibility,
  isDates,
} from '../common/inputs';

// Task inputs, mirroring the database's checks: estimate positive, needs a
// set drawn from the four known needs, a scheduled window both ends or none
// and ending after it starts. `completedAt` is never an input: the service
// sets it when the status becomes done and clears it when it stops being done.

export const scheduledWindow = z
  .object({ startsAt: instant, endsAt: instant })
  .strict()
  // Zod runs object refinements even after a field failed; compare only Dates.
  .refine((w) => !isDates(w.startsAt, w.endsAt) || w.endsAt.getTime() > w.startsAt.getTime(), {
    message: 'must end after it starts',
    path: ['endsAt'],
  });

const fields = {
  title: requiredText(200),
  notes: longText.nullable(),
  status: z.enum(TASK_STATUSES),
  projectId: recordId.nullable(),
  domain: domain.nullable(),
  assigneePersonId: recordId.nullable(),
  aboutPersonId: recordId.nullable(),
  dueDate: isoDate.nullable(),
  estimateMinutes: z.number().int().min(1).max(10_080).nullable(),
  needs: z
    .array(z.enum(TASK_NEEDS))
    .max(TASK_NEEDS.length)
    .refine((n) => new Set(n).size === n.length, 'needs must not repeat'),
  scheduled: scheduledWindow.nullable(),
  visibility,
};

export const createTaskInput = z
  .object({
    ...fields,
    notes: fields.notes.optional(),
    status: fields.status.default('open'),
    projectId: fields.projectId.optional(),
    domain: fields.domain.optional(),
    assigneePersonId: fields.assigneePersonId.optional(),
    aboutPersonId: fields.aboutPersonId.optional(),
    dueDate: fields.dueDate.optional(),
    estimateMinutes: fields.estimateMinutes.optional(),
    needs: fields.needs.default([]),
    scheduled: fields.scheduled.optional(),
    visibility: fields.visibility.default('household'),
  })
  .strict();
export type CreateTaskInput = z.input<typeof createTaskInput>;

export const updateTaskInput = z.object(fields).partial().strict();
export type UpdateTaskInput = z.input<typeof updateTaskInput>;
