import { z } from 'zod';

// HOME export, version 1 (ADR 0006 §6, M3 contract §7.1). This file is the
// whole contract of the format: which record types it carries, in which
// order, which columns of each, and which tables and columns are left out
// on purpose. tests/unit/export-completeness.test.ts compares it with the
// Drizzle schema, so a new table or column cannot silently fall out of the
// export: it must be listed here, exported or excluded with a reason.
// Pure: no database, no server code.

export const EXPORT_FORMAT = 'home-export';
// Version 2 (M4 Package 4b): adds `calendars` and the events' occurrence
// fields (`recurrenceParentId`, `recurrenceOriginal`). Version 1 was M3's.
export const EXPORT_VERSION = 2;

/** Record types in export order; each names its table and how it sorts. */
export const EXPORT_TYPES = {
  people: { table: 'person', sortBy: 'createdAt' },
  calendars: { table: 'calendar_source', sortBy: 'createdAt' },
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
    'recurrenceParentId',
    'recurrenceOriginal',
    'originCaptureId',
    'visibility',
    'createdBy',
    'createdVia',
    'createdAt',
    'updatedAt',
    'archivedAt',
  ],
  // A calendar as its readers see it: never its connection, credential or
  // fingerprint (calendar_connection is excluded), nor its feed hash.
  calendars: [
    'id',
    'name',
    'visibility',
    'defaultKind',
    'defaultPersonIds',
    'lastAttemptAt',
    'lastSyncedAt',
    'lastSyncStatus',
    'lastSyncErrorCode',
    'lastSkippedCount',
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
  calendar_source: {
    connectionId:
      'points at the owner-only connection row (credential infrastructure), which is never exported',
    externalCalendarId:
      'provider bookkeeping: which calendar within the connection (ICS: always default)',
    feedHash: 'sync bookkeeping: a hash of the feed as last read, to skip unchanged refreshes',
  },
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
  // M4 (migration 0007, ADR 0007 §33, §38). The connection is credential
  // infrastructure: its sealed address, key id and address fingerprint are
  // never exported (M4 contract §4.1), whatever happens to the rest.
  calendar_connection:
    'calendar credential infrastructure: the sealed address, its key id and fingerprint are never exported',
};

/**
 * Columns that hold or identify a credential. They are never exported, by any
 * record type, under any name: tests/unit/export-completeness.test.ts checks
 * that no export lists them and that their table is excluded.
 */
export const SECRET_COLUMNS = {
  calendar_connection: ['credentialsEncrypted', 'credentialsKeyId', 'addressFingerprint'],
} as const;

/** The current version of the export, as a schema: what an export file must look like. */
export const exportSchema = z
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

export type HomeExport = z.infer<typeof exportSchema>;
