import { z } from 'zod';
import { NOTE_SUBJECT_TYPES } from '@/db/schema/note';

export { NOTE_SUBJECT_TYPES };
import { longText, recordId, visibility } from '../common/inputs';

// Note inputs. A note's subject is a type and an id together, or none, as
// the database's note_subject_pair_check requires.

export const noteSubject = z.object({ type: z.enum(NOTE_SUBJECT_TYPES), id: recordId }).strict();
export type NoteSubject = z.output<typeof noteSubject>;

const fields = { body: longText, subject: noteSubject.nullable(), visibility };

export const createNoteInput = z
  .object({
    ...fields,
    subject: fields.subject.optional(),
    visibility: fields.visibility.default('household'),
  })
  .strict();
export type CreateNoteInput = z.input<typeof createNoteInput>;

export const updateNoteInput = z.object(fields).partial().strict();
export type UpdateNoteInput = z.input<typeof updateNoteInput>;
