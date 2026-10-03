import 'server-only';
import { ZodError } from 'zod';
import type { ProposalAction } from '@/db/schema/proposal';
import type { UserActor } from '@/trust/actor';
import { dismissCapture } from '../captures/service';
import { NotFoundError, NotPermittedError } from '../common/errors';
import type { Deps } from '../common/write';
import { confirmContext, createContext, retireContext, updateContext } from '../context/service';
import { createEvent, setEventPerson, updateEvent } from '../events/service';
import { createNote } from '../notes/service';
import { createProject, updateProject } from '../projects/service';
import { createTask, updateTask } from '../tasks/service';
import { PROPOSAL_PAYLOADS } from './schema';

// The proposal executor (M2 contract §5.7). It turns an approved proposal's
// payload into exactly one call to the target record's own domain service,
// as the approving person, so every rule those services enforce applies:
// visibility, references, sensitivity, synced events, the write discipline
// and the audit. It never writes a table itself. `deps` carries the
// transaction and the execution token (provenance only).

export type ResultRef = { type: string; id: string };

const ref = (type: string, id: string): ResultRef[] => [{ type, id }];

/** Runs one approved action. Throws on any failure; the caller rolls it back and records why. */
export async function execute(
  actor: UserActor,
  action: ProposalAction,
  payload: unknown,
  deps: Deps,
): Promise<ResultRef[]> {
  // Re-validate (the payload was stored as given); services parse it again.
  PROPOSAL_PAYLOADS[action].parse(payload);
  const p = payload as never;
  const q = payload as { id: string; patch?: never; scheduled?: never; op?: string };
  switch (action) {
    case 'task.create':
      return ref('task', (await createTask(actor, p, deps)).id);
    case 'task.update':
      return ref('task', (await updateTask(actor, q.id, q.patch ?? {}, deps)).id);
    case 'task.schedule':
      return ref('task', (await updateTask(actor, q.id, { scheduled: q.scheduled }, deps)).id);
    case 'event.create':
      return ref('event', (await createEvent(actor, p, deps)).id);
    case 'event.update':
      return ref('event', (await updateEvent(actor, q.id, q.patch ?? {}, deps)).id);
    case 'event_person.set':
      // An annotation is part of its event (ADR 0005 §24).
      return ref('event', (await setEventPerson(actor, p, deps)).eventId);
    case 'project.create':
      return ref('project', (await createProject(actor, p, deps)).id);
    case 'project.update':
      return ref('project', (await updateProject(actor, q.id, q.patch ?? {}, deps)).id);
    case 'note.create':
      return ref('note', (await createNote(actor, p, deps)).id);
    case 'context.create':
      return ref('context', (await createContext(actor, p, deps)).id);
    case 'context.update': {
      const row =
        q.op === 'confirm'
          ? await confirmContext(actor, q.id, deps)
          : q.op === 'retire'
            ? await retireContext(actor, q.id, deps)
            : await updateContext(actor, q.id, q.patch ?? {}, deps);
      return ref('context', row.id);
    }
    case 'capture.dismiss':
      return ref('capture', (await dismissCapture(actor, q.id, deps)).id);
  }
}

/** Why an execution failed, as a fixed code (proposal_failure_reason_check). Never error text. */
export function failureCode(e: unknown): string {
  if (e instanceof NotFoundError) return 'not_found';
  if (e instanceof NotPermittedError) return e.code;
  if (e instanceof ZodError) return 'invalid_payload';
  const code =
    (e as { cause?: { code?: unknown }; code?: unknown })?.cause?.code ??
    (e as { code?: unknown })?.code;
  if (typeof code === 'string' && code.startsWith('23')) return 'constraint_violation';
  return 'execution_error';
}
