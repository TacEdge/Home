import 'server-only';
import { env } from '@/lib/env';
import type { UserActor } from '@/trust/actor';
import { listAudit, type AuditCursor, type AuditRow } from '@/trust/audit';
import { listCaptures } from '../captures/service';
import { NotPermittedError } from '../common/errors';
import { auditRead, type Deps } from '../common/write';
import { listContext } from '../context/service';
import { listConversations, listMessages } from '../conversations/service';
import { listEventPeople, listEvents } from '../events/service';
import { listOwnResponses } from '../insights/service';
import { listOwnUsage } from '../kev-usage/service';
import { listNotes } from '../notes/service';
import { listPeople } from '../people/service';
import { listProjects } from '../projects/service';
import { listProposals } from '../proposals/service';
import { listTasks } from '../tasks/service';
import {
  EXPORT_FORMAT,
  EXPORT_TYPES,
  EXPORT_VERSION,
  EXPORTED_COLUMNS,
  type ExportType,
  type HomeExport,
} from './spec';

// The actor's export (ADR 0006 §6, M3 contract §7.1): everything this adult
// may see, read only through the domain services and Activity, so no
// visibility rule is implemented twice. Household and own-private records,
// archived ones included (their `archivedAt` marks them); the other adult's
// private records never, because no read returns them. Sensitive context
// only on an explicit request, through the context service's audited
// sensitive read. The download itself is audited, privately, with counts.

type Row = Record<string, unknown>;

/** JSON-safe values: instants as ISO strings, bigints as strings. */
function jsonValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function pick(type: ExportType, row: Row): Row {
  const out: Row = {};
  for (const c of EXPORTED_COLUMNS[type]) {
    if (!(c in row)) throw new Error(`export: ${type}.${c} missing from its read`);
    out[c] = jsonValue(row[c]);
  }
  return out;
}

/** Stable order: by the type's sort column, then id. */
function ordered(type: ExportType, rows: Row[]): Row[] {
  const key = EXPORT_TYPES[type].sortBy;
  return rows
    .map((r) => pick(type, r))
    .sort((a, b) => {
      const x = String(a[key] ?? '');
      const y = String(b[key] ?? '');
      return x < y ? -1 : x > y ? 1 : String(a.id) < String(b.id) ? -1 : 1;
    });
}

async function allActivity(actor: UserActor, deps: Deps): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  let before: AuditCursor | undefined;
  for (;;) {
    const page = await listAudit(actor, { limit: 200, before }, deps);
    out.push(...page.rows);
    if (!page.next) return out;
    before = page.next;
  }
}

export async function exportFor(
  actor: UserActor,
  opts: { includeSensitive?: boolean } = {},
  deps: Deps = {},
): Promise<HomeExport> {
  // A person's own download, from a screen: never Kev, never the system.
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  if (actor.via !== 'ui') throw new NotPermittedError('not_eligible');
  const includeSensitive = opts.includeSensitive === true;
  const all = { includeArchived: true } as const;

  const people = await listPeople(actor, all, deps);
  const events = await listEvents(actor, all, deps);
  const eventPeople = (
    await Promise.all(events.map((e) => listEventPeople(actor, e.id, all, deps)))
  ).flat();
  const context = [
    // Every status: the default read leaves retired context out.
    ...(await listContext(actor, { ...all, includeSensitive }, deps)),
    ...(await listContext(actor, { ...all, includeSensitive, status: 'retired' }, deps)),
  ];
  const conversations = await listConversations(actor, all, deps);
  const messages = (
    await Promise.all(conversations.map((c) => listMessages(actor, c.id, all, deps)))
  ).flat();

  const raw: Record<ExportType, Row[]> = {
    people,
    events,
    eventPeople,
    projects: await listProjects(actor, all, deps),
    tasks: await listTasks(actor, all, deps),
    notes: await listNotes(actor, all, deps),
    context,
    captures: await listCaptures(actor, all, deps),
    proposals: await listProposals(actor, {}, deps),
    conversations,
    messages,
    insightResponses: await listOwnResponses(actor, deps),
    kevUsage: await listOwnUsage(actor, deps),
    activity: await allActivity(actor, deps),
  };

  const records = Object.fromEntries(
    (Object.keys(EXPORT_TYPES) as ExportType[]).map((t) => [t, ordered(t, raw[t])]),
  ) as HomeExport['records'];
  const counts = Object.fromEntries(
    (Object.keys(records) as ExportType[]).map((t) => [t, records[t].length]),
  );

  // Audited as a read, privately to the actor, with structure only. Not
  // gated: taking your data away works whether or not the gate is open.
  await auditRead(actor, deps, {
    event: 'export.download',
    subjectType: 'export',
    subjectId: actor.userId,
    meta: { ...counts, sensitive: includeSensitive },
    record: { visibility: 'private', createdBy: actor.userId },
  });

  const self = people.find((p) => p.userId === actor.userId && p.archivedAt === null);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    timeZone: env.HOME_TIMEZONE,
    exportedBy: { personId: self?.id ?? null },
    includesSensitive: includeSensitive,
    records,
  };
}
