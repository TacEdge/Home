import { z } from 'zod';
import { CHANNELS } from '@/db/schema/common';
import { CAPTURE_STATUSES } from '@/db/schema/capture';
import { recordId } from '../common/inputs';

// Capture inputs. Capture first, organise second (CLAUDE.md): the text is the
// user's own words and is stored exactly as given. Nothing here trims,
// normalises or rewrites it; the only checks are that it is not blank and
// not longer than the limit (contract §4.1, §5.6).

export const captureText = z
  .string()
  .max(10_000)
  .refine((s) => /\S/.test(s), 'must not be blank');

export const captureInput = z
  .object({
    text: captureText,
    channel: z.enum(CHANNELS).default('web'),
    messageId: recordId.optional(),
  })
  .strict();
export type CaptureInput = z.input<typeof captureInput>;

export const captureStatus = z.enum(CAPTURE_STATUSES);
