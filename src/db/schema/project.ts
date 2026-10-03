import { check, date, index, pgTable, text } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { commonColumns, CREATED_VIA, DOMAINS, oneOf, VISIBILITY } from './common';

// A home project (FAMILY-DATA-MODEL §3, Project; M2 contract §4.2). The
// column takes any domain; V0.1 services accept only `home`.

export const PROJECT_STATUSES = ['idea', 'active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const project = pgTable(
  'project',
  {
    ...commonColumns(() => user.id),
    title: text('title').notNull(),
    summary: text('summary'),
    domain: text('domain').notNull().default('home'),
    status: text('status').notNull().default('idea'),
    targetDate: date('target_date'),
  },
  (t) => [
    check('project_created_via_check', oneOf(t.createdVia, CREATED_VIA)),
    check('project_visibility_check', oneOf(t.visibility, VISIBILITY)),
    check('project_domain_check', oneOf(t.domain, DOMAINS)),
    check('project_status_check', oneOf(t.status, PROJECT_STATUSES)),
    index('project_created_by_idx').on(t.createdBy),
    index('project_visibility_created_by_idx').on(t.visibility, t.createdBy),
    index('project_archived_at_idx').on(t.archivedAt),
  ],
);
