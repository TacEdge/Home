import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import type { NOTE_SUBJECT_TYPES } from '@/domain/notes/schema';
import type { Note } from '@/domain/notes/service';
import { isoDateInZone, longDate } from '@/lib/dates';
import { env } from '@/lib/env';
import { Button } from '@/ui/button';
import { Label, Quiet } from '@/ui/page';
import {
  archiveNoteAction,
  createNoteAction,
  restoreNoteAction,
  updateNoteAction,
} from './actions';
import { NoteForm } from './note-form';

// Notes on a subject (M3 contract §3.7, ADR 0006 §30): listed newest first,
// each with Edit and Archive in place; archived ones folded away with
// Restore; a new one written at the foot. The caller read the notes as the
// signed-in adult, so a private note of the other adult is never here.

export function NotesSection({
  notes,
  subject,
  subjectVisibility,
  returnTo,
  readOnly = false,
}: {
  /** The subject's notes, archived included. */
  notes: Note[];
  subject: { type: (typeof NOTE_SUBJECT_TYPES)[number]; id: string };
  subjectVisibility: string;
  returnTo: string;
  /** An archived subject: notes are read, not written. */
  readOnly?: boolean;
}) {
  const live = notes.filter((n) => n.archivedAt === null);
  const archived = notes.filter((n) => n.archivedAt !== null);
  const subjectPrivate = subjectVisibility === 'private';
  const when = (n: Note) => longDate(isoDateInZone(n.createdAt, env.HOME_TIMEZONE), 'short');

  return (
    <>
      <Label>Notes</Label>
      {live.length === 0 ? <Quiet>No notes yet.</Quiet> : null}
      {live.length > 0 ? (
        <ul className="border-line border-b">
          {live.map((n) => (
            <li key={n.id} className="border-line border-t py-3">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="text-muted mt-1 text-[14px]">
                {when(n)}
                {n.visibility === 'private' ? ' · just me' : ''}
              </p>
              {readOnly ? null : (
                <details className="mt-1">
                  <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
                    Change
                  </summary>
                  <NoteForm
                    action={updateNoteAction.bind(null, n.id, returnTo)}
                    idPrefix={`note-${n.id}`}
                    body={n.body}
                    visibility={n.visibility}
                    subjectPrivate={subjectPrivate}
                    label="Note"
                    submitLabel="Save"
                  />
                  <ConfirmAction
                    action={archiveNoteAction.bind(null, returnTo)}
                    hidden={{ id: n.id }}
                    label="Archive this note"
                    question="Put this note away? Nothing is deleted."
                    confirmLabel="Archive"
                  />
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {readOnly ? null : (
        <details className="mt-4">
          <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
            Add a note
          </summary>
          <NoteForm
            action={createNoteAction.bind(null, subject.type, subject.id, returnTo)}
            idPrefix="note-new"
            visibility={subjectPrivate ? 'private' : 'household'}
            subjectPrivate={subjectPrivate}
            label="A note"
            submitLabel="Add it"
          />
        </details>
      )}
      {archived.length > 0 ? (
        <details className="mt-4">
          <summary className="text-muted inline-flex min-h-11 cursor-pointer items-center font-mono text-[11.5px] tracking-[0.14em] uppercase">
            Archived notes · {archived.length}
          </summary>
          <ul className="border-line border-b">
            {archived.map((n) => (
              <li
                key={n.id}
                className="border-line flex flex-wrap items-baseline justify-between gap-3 border-t py-3"
              >
                <p className="text-ink-2 min-w-0 flex-1 whitespace-pre-wrap">{n.body}</p>
                {readOnly ? null : (
                  <ActionForm action={restoreNoteAction.bind(null, returnTo)}>
                    <input type="hidden" name="id" value={n.id} />
                    <Button variant="quiet">Restore</Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
