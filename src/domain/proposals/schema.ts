import { z } from 'zod';
import { PROPOSAL_ACTIONS, PROPOSAL_STATUSES, type ProposalAction } from '@/db/schema/proposal';
import { proposedContextInput, proposedContextPatch } from '../context/schema';
import { createEventInput, eventPersonInput, updateEventInput } from '../events/schema';
import { recordId, requiredText } from '../common/inputs';
import { createNoteInput } from '../notes/schema';
import { createProjectInput, updateProjectInput } from '../projects/schema';
import { createTaskInput, scheduledWindow, updateTaskInput } from '../tasks/schema';

// Proposal inputs (FAMILY-DATA-MODEL §3 Proposal, M2 contract §5.7). Each of
// the twelve actions has one payload schema, built from the target service's
// own input schema, so a payload that validates here is exactly what that
// service accepts. Payloads are validated when the proposal is created and
// again when it is approved. Context payloads never carry `sensitive` (D15).

const target = { id: recordId };

export const PROPOSAL_PAYLOADS = {
  'task.create': createTaskInput,
  'task.update': z.object({ ...target, patch: updateTaskInput }).strict(),
  'task.schedule': z.object({ ...target, scheduled: scheduledWindow.nullable() }).strict(),
  'event.create': createEventInput,
  'event.update': z.object({ ...target, patch: updateEventInput }).strict(),
  'event_person.set': eventPersonInput,
  'project.create': createProjectInput,
  'project.update': z.object({ ...target, patch: updateProjectInput }).strict(),
  'note.create': createNoteInput,
  'context.create': proposedContextInput,
  'context.update': z.discriminatedUnion('op', [
    z.object({ op: z.literal('edit'), ...target, patch: proposedContextPatch }).strict(),
    z.object({ op: z.literal('confirm'), ...target }).strict(),
    z.object({ op: z.literal('retire'), ...target }).strict(),
  ]),
  'capture.dismiss': z.object(target).strict(),
} satisfies Record<ProposalAction, z.ZodType>;

export type ProposalPayload<A extends ProposalAction> = z.input<(typeof PROPOSAL_PAYLOADS)[A]>;

export const proposalAction = z.enum(PROPOSAL_ACTIONS);
export const proposalStatus = z.enum(PROPOSAL_STATUSES);

export const createProposalInput = z
  .object({
    action: proposalAction,
    payload: z.record(z.string(), z.unknown()),
    /** Human-readable and speakable: what approving will do. */
    summary: requiredText(500),
    captureId: recordId.optional(),
    conversationId: recordId.optional(),
  })
  .strict();
export type CreateProposalInput = z.input<typeof createProposalInput>;
