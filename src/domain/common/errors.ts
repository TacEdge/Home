// Domain errors carry a fixed code and never user-written content, so they
// can be logged, audited and shown as calm messages without leaking anything.

/** The record does not exist, or this actor may not see it: indistinguishable (M2 contract §5.2). */
export class NotFoundError extends Error {
  constructor(public readonly entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export type NotPermittedCode =
  | 'kev_cannot_write' // CLAUDE.md rule 3: Kev proposes, people approve
  | 'not_a_user' // domain writes are by a signed-in person, never the system actor
  | 'not_creator' // only the creator may change a record's visibility
  | 'not_eligible' // the record does not meet the operation's rules
  | 'not_archived' // restore applies only to an archived record
  | 'already_linked' // the person or the user is already linked
  | 'linked_person'; // a linked person must stay a household parent

export class NotPermittedError extends Error {
  constructor(public readonly code: NotPermittedCode) {
    super(`not permitted: ${code}`);
    this.name = 'NotPermittedError';
  }
}
