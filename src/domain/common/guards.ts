import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from './errors';

/**
 * Kev never writes directly (CLAUDE.md rule 3, M2 contract §5.3). Every write
 * in a domain service starts here. The only exceptions, in later packages,
 * are the verbatim capture and creating a proposal.
 */
export function assertCanWrite(actor: UserActor): void {
  // The types already say UserActor; this holds at runtime too, so a system
  // actor passed through a cast can never write as a person.
  if ((actor as { kind: string }).kind !== 'user') throw new NotPermittedError('not_a_user');
  if (actor.via === 'kev') throw new NotPermittedError('kev_cannot_write');
}
