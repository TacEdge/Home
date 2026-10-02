// Domain errors carry a fixed code and never user-authored content, so they
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
  | 'not_creator' // only the creator may change visibility or edit a private record
  | 'not_eligible' // the record does not meet the operation's rules
  | 'already_linked'; // a user or person is already linked

export class NotPermittedError extends Error {
  constructor(public readonly code: NotPermittedCode) {
    super(`not permitted: ${code}`);
    this.name = 'NotPermittedError';
  }
}
