import { z } from 'zod';
import { CHANNELS } from '@/db/schema/common';
import { KEV_TIERS } from '@/db/schema/conversation';
import { recordId } from '../common/inputs';

// Conversation and message inputs (FAMILY-DATA-MODEL §3, M2 contract §4.2).
// Message content is HOME's provider-neutral format, versioned so it can be
// replayed without any provider's shapes (CLAUDE.md, Kev specifics). The
// database checks only that it is an object with a numeric `v`; this schema
// is the version's definition.

const ref = z.object({ type: z.string().min(1).max(40), id: recordId }).strict();

export const messageContentV1 = z
  .object({
    v: z.literal(1),
    text: z.string().max(20_000),
    citations: z.array(ref).max(50).optional(),
    toolSummaries: z
      .array(z.object({ tool: z.string().min(1).max(60), summary: z.string().max(500) }).strict())
      .max(20)
      .optional(),
    proposalIds: z.array(recordId).max(20).optional(),
    captureIds: z.array(recordId).max(20).optional(),
  })
  .strict();
export type MessageContent = z.output<typeof messageContentV1>;

const channel = z.enum(CHANNELS).default('web');

/** A person's message carries no tier or model; Kev's always carries both (message_author_check). */
export const addMessageInput = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), channel, content: messageContentV1 }).strict(),
  z
    .object({
      role: z.literal('kev'),
      channel,
      content: messageContentV1,
      tier: z.enum(KEV_TIERS),
      model: z.string().trim().min(1).max(100),
    })
    .strict(),
]);
export type AddMessageInput = z.input<typeof addMessageInput>;
