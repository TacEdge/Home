import { z } from 'zod';
import { EVENT_KINDS } from '@/db/schema/event';
import { recordId, requiredText, visibility } from '../common/inputs';

// Calendar inputs (M4 contract §3.2, §5.1): one schema per input, shared by
// the Settings › Calendars forms (Package 5) and these services. The address
// is the only secret, and is never echoed back.

/** A calendar's own name: something a person reads, never an address. */
const calendarName = requiredText(200).refine((s) => !s.includes('://'), 'must not be an address');

/** Whose events these usually are: people, at most a household's worth. */
const defaultPersonIds = z
  .array(recordId)
  .max(20)
  .transform((ids) => [...new Set(ids)]);

export const connectCalendarInput = z
  .object({
    // Normalised and approved by src/lib/calendar-address.ts; bounded here first.
    address: z.string().min(1).max(2048),
    name: calendarName,
    visibility: visibility.default('household'),
    defaultKind: z.enum(EVENT_KINDS).nullable().default(null),
    defaultPersonIds: defaultPersonIds.default([]),
  })
  .strict();
export type ConnectCalendarInput = z.input<typeof connectCalendarInput>;

export const updateCalendarInput = z
  .object({
    name: calendarName,
    visibility,
    defaultKind: z.enum(EVENT_KINDS).nullable(),
    defaultPersonIds,
  })
  .partial()
  .strict();
export type UpdateCalendarInput = z.input<typeof updateCalendarInput>;
