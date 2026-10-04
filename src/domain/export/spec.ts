import { z } from 'zod';

// HOME export, version 1 (ADR 0006 §6, M3 contract §7.1). This file is the
// whole contract of the format: which record types it carries, in which
// order, which columns of each, and which tables and columns are left out
// on purpose. tests/unit/export-completeness.test.ts compares it with the
// Drizzle schema, so a new table or column cannot silently fall out of the
// export: it must be listed here, exported or excluded with a reason.
// Pure: no database, no server code.

export const EXPORT_FORMAT = 'home-export';
export const EXPORT_VERSION = 1;

/** Record types in export order; each names its table and how it sorts. */
export const EXPORT_TYPES = {
  people: { table: 'person', sortBy: 'createdAt' },
  events: { table: 'event', sortBy: 'createdAt' },
  eventPeople: { table: 'event_person', sortBy: 'createdAt' },
  projects: { table: 'project', sortBy: 'createdAt' },
  tasks: { table: 'task', sortBy: 'createdAt' },
  notes: { table: 'note', sortBy: 'createdAt' },
  context: { table: 'context', sortBy: 'createdAt' },
  captures: { table: 'capture', sortBy: 'createdAt' },
  proposals: { table: 'proposal', sortBy: 'createdAt' },
  conversations: { table: 'conversation', sortBy: 'createdAt' },
  messages: { table: 'message', sortBy: 'createdAt' },
  insightResponses: { table: 'insight_response', sortBy: 'respondedAt' },
  kevUsage: { table: 'kev_usage', sortBy: 'at' },
  activity: { table: 'audit_log', sortBy: 'at' },
} as const;

export type ExportType = keyof typeof EXPORT_TYPES;

/** The columns each record type carries, by Drizzle property name, in output order. */
export const EXPORTED_COLUMNS: Record<ExportType, readonly string[]> = {
  people: [
    'id',
    'name',
    'shortName',
    'role',
    'relationship',
    'inHousehold',
    'dateOfBirth',
    'stageNote',
    'colour',
    'userId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  events: [
    'id',
    'title',
    'description',
    'location',
    'kind',
    'domain',
    'allDay',
    'startsAt',
    'endsAt',
    'timeZone',
    'startDate',
    'endDate',
    'rrule',
    'exdates',
    'source',
    'calendarSourceId',
    'externalUid',
    'externalEtag',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  eventPeople: ['id', 'eventId', 'personId', 'role', 'createdBy', 'createdVia', 'createdAt'],
  projects: [
    'id',
    'title',
    'summary',
    'domain',
    'status',
    'targetDate',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  tasks: [
    'id',
    'title',
    'notes',
    'status',
    'projectId',
    'domain',
    'assigneePersonId',
    'aboutPersonId',
    'dueDate',
    'estimateMinutes',
    'needs',
    'scheduledStartsAt',
    'scheduledEndsAt',
    'completedAt',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  notes: [
    'id',
    'body',
    'subjectType',
    'subjectId',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  context: [
    'id',
    'subjectType',
    'subjectId',
    'content',
    'category',
    'sensitivity',
    'status',
    'sourceType',
    'sourceUserId',
    'sourceRef',
    'lastConfirmedAt',
    'validUntil',
    'retiredAt',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  captures: [
    'id',
    'text',
    'channel',
    'messageId',
    'status',
    'organisedInto',
    'organisedAt',
    'dismissedAt',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  proposals: [
    'id',
    'action',
    'payload',
    'summary',
    'status',
    'expiresAt',
    'captureId',
    'conversationId',
    'requestedByUserId',
    'decidedBy',
    'decidedAt',
    'decidedChannel',
    'resultRef',
    'failureReason',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  conversations: ['id', 'userId', 'createdAt', 'updatedAt', 'lastMessageAt', 'archivedAt'],
  messages: ['id', 'conversationId', 'role', 'channel', 'content', 'tier', 'model', 'createdAt'],
  insightResponses: ['id', 'userId', 'insightKey', 'response', 'respondedAt'],
  kevUsage: [
    'id',
    'at',
    'userId',
    'conversationId',
    'tier',
    'model',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'costUsdMicros',
    'escalated',
  ],
  activity: [
    'id',
    'at',
    'actorUserId',
    'actorVia',
    'actorChannel',
    'event',
    'subjectType',
    'subjectId',
    'summary',
    'meta',
  ],
};

/** Columns of exported tables left out on purpose, with the reason. */
export const EXCLUDED_COLUMNS: Record<string, Record<string, string>> = {
  audit_log: {
    visibility: 'P-1 snapshot used to decide who sees the row; Activity never shows it',
    visibleToUserId: 'P-1 snapshot used to decide who sees the row; Activity never shows it',
  },
};

/** Tables left out of the export entirely, with the reason. */
export const EXCLUDED_TABLES: Record<string, string> = {
  user: 'authentication account (Better Auth); the adult is named by exportedBy',
  session: 'authentication secret: session tokens',
  account: 'authentication secret: provider credentials',
  verification: 'authentication secret: sign-in link tokens',
  rate_limit: 'sign-in rate-limit counters, not family data',
};

/** Version 1 of the export, as a schema: what an export file must look like. */
export const exportV1 = z
  .object({
    format: z.literal(EXPORT_FORMAT),
    version: z.literal(EXPORT_VERSION),
    exportedAt: z.iso.datetime(),
    timeZone: z.string().min(1),
    exportedBy: z.object({ personId: z.uuid().nullable() }).strict(),
    includesSensitive: z.boolean(),
    records: z
      .object(
        Object.fromEntries(
          (Object.keys(EXPORT_TYPES) as ExportType[]).map((t) => [
            t,
            z.array(
              z
                .object(
                  Object.fromEntries(
                    EXPORTED_COLUMNS[t].map((c) => [
                      c,
                      c === 'id' ? z.string().min(1) : z.unknown(),
                    ]),
                  ),
                )
                .strict(),
            ),
          ]),
        ) as Record<ExportType, z.ZodArray<z.ZodObject>>,
      )
      .strict(),
  })
  .strict();

export type HomeExport = z.infer<typeof exportV1>;
