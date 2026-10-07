import type { NotPermittedCode } from '@/domain/common/errors';

// What a person reads when a write can't happen (M3 contract §4.3). Calm,
// specific, NZ English, no exclamation marks, and never anything from the
// record itself: a not-found and an invisible record read the same. Typed as
// a complete record, so a new domain error code cannot ship without copy.

export const NOT_PERMITTED_COPY: Record<NotPermittedCode, string> = {
  real_data_closed: 'HOME isn’t open for family data yet.',
  kev_cannot_write: 'Kev can suggest this, but a person needs to make the change.',
  not_a_user: 'Only a signed-in person can make this change.',
  not_creator: 'Only the person who added this can change who sees it.',
  not_eligible: 'That can’t be done with this one.',
  not_archived: 'This one isn’t archived.',
  already_linked: 'Someone’s already linked to that person.',
  linked_person: 'This is someone’s own record, so it stays a parent everyone can see.',
  references_private: 'Something private can’t be linked to something everyone sees.',
  referenced_by_household:
    'Things everyone can see point to this, so it can’t be made private yet.',
  synced_event: 'This comes from a calendar, so change it there.',
  not_home_domain: 'Projects here are home projects.',
  sensitive_context: 'Sensitive details can only be handled by you, directly.',
  proposal_not_pending: 'That’s already been decided.',
  kev_cannot_author: 'Kev can only keep what you said, in your words.',
  not_recurring: 'This happens once, so there’s nothing to skip.',
  not_an_occurrence: 'That isn’t one of the times this happens.',
  not_skipped: 'That one wasn’t skipped.',
  not_owner: 'Only the person who connected this calendar can change it.',
  not_a_person: 'Only a signed-in person can do this, by hand.',
  sync_actor: 'Only a calendar refresh can change that.',
  address_not_accepted:
    'That isn’t a Google Calendar secret address. It starts with https://calendar.google.com and ends in basic.ics.',
  calendar_already_connected: 'That calendar is already connected in HOME.',
  calendar_can_reconnect:
    'You’ve connected this calendar before. Connect it again from its page, and its people and notes come back.',
  calendar_address_mismatch:
    'That isn’t the address this calendar was connected with. Use the same secret address, or connect it as a new calendar.',
  calendar_keys_unavailable: 'Calendars can’t be connected here just now.',
  calendar_credential_unreadable:
    'HOME can’t read this calendar’s address any more. Connect it again to carry on.',
  calendar_disconnected: 'This calendar is disconnected. Connect it again to refresh it.',
};

export const NOT_FOUND_COPY = 'That isn’t here any more.';
export const INVALID_COPY = 'A few details need another look.';
export const UNEXPECTED_COPY =
  'Something went wrong, so nothing was changed. Try again in a moment.';

/** Per-field copy for a validation issue, by Zod issue code. */
export function fieldCopy(issue: {
  code: string;
  input?: unknown;
  minimum?: unknown;
  message?: string;
}): string {
  if (issue.code === 'custom' && issue.message === 'must not be blank')
    return 'This can’t be empty.';
  switch (issue.code) {
    case 'too_small':
      return issue.minimum === 1 ? 'This can’t be empty.' : 'That’s too short.';
    case 'too_big':
      return 'That’s too long.';
    case 'invalid_type':
      return issue.input === undefined ? 'This is needed.' : 'That doesn’t look right.';
    default:
      return 'That doesn’t look right.';
  }
}
