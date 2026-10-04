// What "Show sensitive items" returns to the page that asked: the items for
// this response only. Never stored, never in a URL, gone on navigation.

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
};

export type RevealState =
  | { status: 'idle' }
  | { status: 'shown'; items: SensitiveItem[] }
  | { status: 'error'; message: string };

export const revealIdle: RevealState = { status: 'idle' };
