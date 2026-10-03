import { z } from 'zod';
import { PROJECT_STATUSES } from '@/db/schema/project';
import { isoDate, longText, requiredText, visibility } from '../common/inputs';

// Project inputs. V0.1 projects are home projects (FAMILY-DATA-MODEL §3), so
// the only accepted domain is `home`, although the column takes all four.

const fields = {
  title: requiredText(200),
  summary: longText.nullable(),
  domain: z.literal('home'),
  status: z.enum(PROJECT_STATUSES),
  targetDate: isoDate.nullable(),
  visibility,
};

export const createProjectInput = z
  .object({
    ...fields,
    summary: fields.summary.optional(),
    domain: fields.domain.default('home'),
    status: fields.status.default('idea'),
    targetDate: fields.targetDate.optional(),
    visibility: fields.visibility.default('household'),
  })
  .strict();
export type CreateProjectInput = z.input<typeof createProjectInput>;

export const updateProjectInput = z.object(fields).partial().strict();
export type UpdateProjectInput = z.input<typeof updateProjectInput>;
