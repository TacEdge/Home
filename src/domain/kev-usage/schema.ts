import { z } from 'zod';
import { KEV_TIERS } from '@/db/schema/conversation';
import { recordId } from '../common/inputs';

// One Kev run's usage (FAMILY-DATA-MODEL §3, KevUsage). Cost is the
// provider's cost in micro-US-dollars, exactly as reported, as a whole
// number; there is no currency field because there is no conversion (M2:
// none; the NZ$ spend cap is M8's).

const count = z.number().int().nonnegative().max(2_000_000_000).default(0);

/** Whole micro-US-dollars: a bigint, a safe non-negative integer, or a digit string. */
export const usdMicros = z
  .union([
    z.bigint().nonnegative(),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^\d{1,18}$/),
  ])
  .transform((v) => BigInt(v));

export const recordUsageInput = z
  .object({
    conversationId: recordId.optional(),
    tier: z.enum(KEV_TIERS),
    model: z.string().trim().min(1).max(100),
    inputTokens: count,
    outputTokens: count,
    cacheReadTokens: count,
    cacheWriteTokens: count,
    costUsdMicros: usdMicros,
    escalated: z.boolean().default(false),
  })
  .strict();
export type RecordUsageInput = z.input<typeof recordUsageInput>;

/** A calendar month, YYYY-MM. */
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
