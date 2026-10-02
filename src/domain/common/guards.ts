import type { UserActor } from '@/trust/actor';
import { NotPermittedError } from './errors';

/**
 * Kev never writes directly (CLAUDE.md rule 3, M2 contract §5.3). Every write
 * in a domain service starts here; the only exceptions are the verbatim
 * capture and creating a proposal, which say so explicitly.
 */
export function assertCanWrite(actor: UserActor): void {
  if (actor.via === 'kev') throw new NotPermittedError('kev_cannot_write');
}
