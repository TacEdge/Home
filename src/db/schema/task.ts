import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { capture } from './capture';
import { commonColumns, CREATED_VIA, DOMAINS, oneOf, VISIBILITY } from './common';
import { person } from './person';
import { project } from './project';

// Something to do (FAMILY-DATA-MODEL §3, Task; M2 contract §4.2). Links to a
// project and to people are provenance, not ownership: deleting either
// leaves the task with the link cleared (§4.4).

export const TASK_STATUSES = ['open', 'done', 'dropped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_NEEDS = ['dry_weather', 'daylight', 'two_people', 'shops_open'] as const;
export type TaskNeed = (typeof TASK_NEEDS)[number];

const needsList = `'${JSON.stringify(TASK_NEEDS)}'::jsonb`;

export const task = pgTable(
  'task',
  {
    ...commonColumns(() => user.id),
    // Provenance: the capture it was organised from (migration 0005, §4.4).
    originCaptureId: uuid('origin_capture_id').references(() => capture.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status').notNull().default('open'),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    domain: text('domain'),
    assigneePersonId: uuid('assignee_person_id').references(() => person.id, {
      onDelete: 'set null',
    }),
    aboutPersonId: uuid('about_person_id').references(() => person.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    estimateMinutes: integer('estimate_minutes'),
    needs: jsonb('needs').$type<TaskNeed[]>().notNull().default([]),
    scheduledStartsAt: timestamp('scheduled_starts_at', { withTimezone: true }),
    scheduledEndsAt: timestamp('scheduled_ends_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('task_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('task_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('task_status_check', oneOf(t.status, TASK_STATUSES)),
    check('task_domain_check', oneOf(t.domain, DOMAINS)),
    check(
      'task_estimate_positive_check',
      sql`${t.estimateMinutes} is null or ${t.estimateMinutes} > 0`,
    ),
    // A JSON array drawn only from the known needs.
    check(
      'task_needs_check',
      sql`jsonb_typeof(${t.needs}) = 'array' and ${t.needs} <@ ${sql.raw(needsList)}`,
    ),
    // A scheduled window has both ends or neither, and ends after it starts.
    check(
      'task_scheduled_window_check',
      sql`(${t.scheduledStartsAt} is null) = (${t.scheduledEndsAt} is null)
       and (${t.scheduledEndsAt} is null or ${t.scheduledEndsAt} > ${t.scheduledStartsAt})`,
    ),
    index('task_project_id_idx').on(t.projectId),
    index('task_assignee_person_id_idx').on(t.assigneePersonId),
    index('task_about_person_id_idx').on(t.aboutPersonId),
    index('task_origin_capture_id_idx').on(t.originCaptureId),
    index('task_created_by_idx').on(t.createdBy),
    index('task_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('task_archived_at_idx').on(t.archivedAt),
  ],
);
