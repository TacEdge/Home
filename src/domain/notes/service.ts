import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { event, note, person, project } from '@/db/schema';
import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from '../common/errors';
import { assertCanWrite } from '../common/guards';
import { records } from '../common/records';
import { checkReferences, type Ref } from '../common/references';
import { auditedWrite, provenanceOf, type Deps } from '../common/write';
import {
  createNoteInput,
  noteSubject,
  updateNoteInput,
  type CreateNoteInput,
  type NoteSubject,
  type UpdateNoteInput,
} from './schema';

// Notes (FAMILY-DATA-MODEL §3, M2 contract §5). Same write discipline as
// every record. A note's subject (project, person or event) is a reference:
// visible to the actor, not archived, and household whenever the note is.

export type Note = typeof note.$inferSelect;
type ReadOpts = { includeArchived?: boolean };

const R = records(note, 'note');
const audit = (name: string, row: Note, meta?: Record<string, string | string[] | null>) => ({
  event: `note.${name}`,
  subjectType: 'note',
  subjectId: row.id,
  meta,
  record: row,
});

const SUBJECT_TABLES = { project, person, event } as const;
const refOf = (s: NoteSubject | null | undefined): Ref | null =>
  s ? { table: SUBJECT_TABLES[s.type], entity: s.type, id: s.id } : null;
const subjectColumns = (s: NoteSubject | null | undefined) =>
  s === undefined ? {} : { subjectType: s?.type ?? null, subjectId: s?.id ?? null };

export async function createNote(
  actor: UserActor,
  input: CreateNoteInput,
  deps: Deps = {},
): Promise<Note> {
  assertCanWrite(actor);
  const { subject, ...data } = createNoteInput.parse(input);
  return auditedWrite(actor, deps, async (tx) => {
    await checkReferences(tx, actor, data.visibility, [refOf(subject)]);
    const [row] = await tx
      .insert(note)
      .values({
        ...data,
        ...subjectColumns(subject),
        createdBy: actor.userId,
        ...provenanceOf(deps),
      })
      .returning();
    if (!row) throw new Error('note insert returned no row');
    return {
      result: row,
      audit: audit('create', row, { subjectType: row.subjectType, visibility: row.visibility }),
    };
  });
}

export async function getNote(actor: UserActor, id: string, opts: ReadOpts = {}, deps: Deps = {}) {
  return R.get(deps.db ?? getDb(), actor, id, opts.includeArchived ? 'include' : 'exclude');
}

/** Notes, newest first, optionally about one subject. */
export async function listNotes(
  actor: UserActor,
  opts: ReadOpts & { subject?: NoteSubject } = {},
  deps: Deps = {},
): Promise<Note[]> {
  const db = deps.db ?? getDb();
  const subject = opts.subject ? noteSubject.parse(opts.subject) : undefined;
  return db
    .select()
    .from(note)
    .where(
      and(
        R.readable(actor, opts.includeArchived ? 'include' : 'exclude'),
        subject
          ? and(eq(note.subjectType, subject.type), eq(note.subjectId, subject.id))
          : undefined,
      ),
    )
    .orderBy(desc(note.createdAt), desc(note.id));
}

export async function updateNote(
  actor: UserActor,
  id: string,
  patch: UpdateNoteInput,
  deps: Deps = {},
): Promise<Note> {
  assertCanWrite(actor);
  const parsed = updateNoteInput.parse(patch);
  const { subject, ...data } = parsed;
  const fields = Object.keys(parsed).sort();
  if (fields.length === 0) return getNote(actor, id, {}, deps);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const next = data.visibility ?? current.visibility;
    if (next !== current.visibility && current.createdBy !== actor.userId) {
      throw new NotPermittedError('not_creator');
    }
    if (subject !== undefined || (next === 'household' && current.visibility === 'private')) {
      const target =
        subject !== undefined
          ? subject
          : current.subjectType && current.subjectId
            ? noteSubject.parse({ type: current.subjectType, id: current.subjectId })
            : null;
      await checkReferences(tx, actor, next, [refOf(target)]);
    }
    const row = await R.update(tx, actor, current.id, 'exclude', {
      ...data,
      ...subjectColumns(subject),
    });
    return { result: row, audit: audit('update', row, { fields }) };
  });
}

export async function archiveNote(actor: UserActor, id: string, deps: Deps = {}): Promise<Note> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'exclude');
    const row = await R.update(tx, actor, current.id, 'exclude', { archivedAt: sql`now()` });
    return { result: row, audit: audit('archive', row) };
  });
}

export async function restoreNote(actor: UserActor, id: string, deps: Deps = {}): Promise<Note> {
  assertCanWrite(actor);
  return auditedWrite(actor, deps, async (tx) => {
    const current = await R.lock(tx, actor, id, 'include');
    if (current.archivedAt === null) throw new NotPermittedError('not_archived');
    const row = await R.update(tx, actor, current.id, 'only', { archivedAt: null });
    return { result: row, audit: audit('restore', row) };
  });
}
