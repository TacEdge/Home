import 'server-only';
import { z } from 'zod';

// escalate (contract §6.2, §4.2): the fast tier hands the turn to deep. A
// control entry, not a read: it reads nothing, calls no domain service and
// takes no actor data. Its closed reason is all it carries. The registry
// lists it (with the read class, matrix row T23) so the tool list is
// complete for the orchestrator (Package 3), which handles it itself: the
// tool runner never runs it. Offered on fast only, while the month is under
// 80% of the cap (`offersEscalate`, T24).

export const ESCALATE_REASONS = ['multi_step_planning', 'many_constraints', 'long_range'] as const;

const input = z.object({ reason: z.enum(ESCALATE_REASONS) }).strict();

export const escalate = {
  name: 'escalate',
  authority: 'read',
  kind: 'control',
  description:
    'Hand this question to a more careful model, when it needs multi-step planning, weighs many constraints or spans a long range. Give one of the reasons; nothing else.',
  input,
  output: z.object({}).strict(),
  summarise: (i: z.output<typeof input>) => ({ reason: i.reason }),
} as const;
