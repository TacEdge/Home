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
  | 'linked_person' // a linked person must stay a household parent
  | 'references_private' // a household record may not point at a private one (contract §5.5)
  | 'referenced_by_household' // a record household records point at cannot become private
  | 'synced_event' // synced events are read-only until M4's sync path
  | 'not_home_domain' // V0.1 projects are home projects
  | 'sensitive_context' // sensitive context is read and written only by a person, directly (D15)
  | 'proposal_not_pending' // a decided or expired proposal can never be approved or rejected
  | 'kev_cannot_author' // Kev captures only a person's own message, never text it supplies
  | 'not_recurring' // skip applies only to a repeating event
  | 'not_an_occurrence' // skip names a date the event's rule does not put it on
  | 'not_skipped' // put back names a date that was not skipped
  | 'not_owner' // only a calendar's owner may change, disconnect or reconnect it (M4 §3.2)
  | 'not_a_person' // connecting and refreshing calendars is a person's own act, never Kev's or the sync actor's
  | 'sync_actor' // the sync actor writes only synced events, through the sync service (M4 §3.4)
  | 'address_not_accepted' // only Google's secret iCal address is accepted (M4 §4.2)
  | 'calendar_already_connected' // that exact address is already a live connection (M4 §4.4)
  | 'calendar_can_reconnect' // that address is one of your own disconnected calendars: reconnect it instead (ADR 0007 §42)
  | 'calendar_address_mismatch' // reconnecting needs the same address the calendar was connected with
  | 'calendar_keys_unavailable' // HOME_CREDENTIALS_KEY or HOME_FINGERPRINT_KEY is missing or invalid (M4 §4.1)
  | 'calendar_credential_unreadable' // the stored credential no longer opens with HOME's keys
  | 'calendar_disconnected' // a disconnected calendar is not refreshed
  | 'real_data_closed'; // Production refuses family-domain writes until the real-data gate opens (ADR 0006 §2)

export class NotPermittedError extends Error {
  constructor(public readonly code: NotPermittedCode) {
    super(`not permitted: ${code}`);
    this.name = 'NotPermittedError';
  }
}
