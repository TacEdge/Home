// Activity in plain words (M3 contract §3.1, §3.9): what happened, never
// what was written. A row's event is "type.action"; anything unmapped reads
// as its type and action in words rather than a raw code.

const THING: Record<string, string> = {
  auth: 'Sign-in',
  person: 'A person',
  event: 'An event',
  event_person: 'Who’s at an event',
  project: 'A project',
  task: 'A task',
  note: 'A note',
  context: 'Something to know',
  capture: 'Something captured',
  proposal: 'A suggestion',
  conversation: 'A conversation with Kev',
  message: 'A message to Kev',
  kev_usage: 'Kev',
  insight_response: 'An insight',
  export: 'Export',
  calendar_source: 'A calendar',
};

const EXACT: Record<string, string> = {
  'auth.link_requested': 'Sign-in link requested',
  'auth.sign_in': 'Signed in',
  'auth.sign_in_denied': 'Sign-in refused (address not in the household)',
  'auth.sign_out': 'Signed out',
  'export.download': 'Data exported',
  'person.link_self': 'Linked to a person as themselves',
  'person.unlink_self': 'Unlinked from a person',
  'event.skip': 'One time of an event skipped',
  'event.put_back': 'A skipped time of an event put back',
  'event_person.set': 'Someone added to an event',
  'event_person.remove': 'Someone taken off an event',
  'context.confirm': 'Something to know confirmed as still true',
  'context.retire': 'Something to know marked no longer true',
  'context.reinstate': 'Something to know reinstated',
  'context.sensitive_read': 'Sensitive items shown, on request',
  'capture.create': 'Something told to HOME',
  'capture.dismiss': 'A capture set aside',
  'capture.undismiss': 'A capture brought back to To sort',
  'capture.organise': 'A capture made into something',
  'proposal.create': 'A suggestion made',
  'proposal.approve': 'A suggestion approved',
  'proposal.reject': 'A suggestion declined',
  'proposal.fail': 'A suggestion could not be applied',
  'proposal.expire': 'A suggestion expired',
  'conversation.start': 'A conversation with Kev started',
  'message.add': 'A message in a conversation with Kev',
  'kev_usage.record': 'Kev ran',
  'insight_response.respond': 'An insight answered',
  'calendar.connect': 'A calendar connected',
  'calendar.reconnect': 'A calendar connected again',
  'calendar.disconnect': 'A calendar disconnected',
  'calendar.sync': 'A calendar refreshed',
  'calendar_source.create': 'A calendar added',
  'calendar_source.archive': 'A calendar put away (disconnected)',
  'calendar_source.restore': 'A calendar back (connected again)',
  'calendar_source.update': 'A calendar’s settings changed',
};

const ACTION: Record<string, string> = {
  create: 'added',
  update: 'changed',
  archive: 'archived',
  restore: 'restored',
  dismiss: 'set aside',
};

export function describeEvent(event: string): string {
  const exact = EXACT[event];
  if (exact) return exact;
  const [type, action] = event.split('.');
  const thing = THING[type ?? ''] ?? type ?? event;
  const did = ACTION[action ?? ''] ?? (action ?? '').replace(/_/g, ' ');
  return did ? `${thing} ${did}` : thing;
}

export function describeVia(via: string): string {
  switch (via) {
    case 'ui':
      return 'by hand';
    case 'kev':
      return 'through Kev';
    case 'sync':
      return 'from a calendar';
    case 'system':
      return 'HOME';
    default:
      return via;
  }
}
