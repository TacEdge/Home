import { z } from 'zod';
import { INSIGHT_RESPONSES } from '@/db/schema/insight-response';

// Insight responses (FAMILY-DATA-MODEL §3, CLAUDE.md rule 15): the only
// persisted part of insights. A key is deterministic (kind + subjects +
// date), built by the detectors from ids and dates, never from user text.

export const insightKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_.-]+$/, 'must be a deterministic key (letters, digits, : _ . -)');

export const insightResponseKind = z.enum(INSIGHT_RESPONSES);
