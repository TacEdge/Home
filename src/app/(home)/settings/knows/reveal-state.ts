// What "Show sensitive items" returns to the page that asked: the items for
// this response only, archived ones included (the only place they can be
// restored from: Archived is a default read). Never stored, never in a
// URL, gone on navigation.

export type SensitiveItem = {
  id: string;
  content: string;
  category: string;
  status: string;
  subjectType: string;
  subjectId: string | null;
  visibility: string;
  validUntil: string | null;
  createdAt: string;
  /** Set when the item is archived: it is offered Restore, nothing else. */
  archivedAt: string | null;
};

export type RevealState =
  | { status: 'idle' }
  | { status: 'shown'; items: SensitiveItem[] }
  | { status: 'error'; message: string };

export const revealIdle: RevealState = { status: 'idle' };
