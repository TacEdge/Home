import type { OrganiseAction } from '@/domain/proposals/service';

// What a capture can become, by hand (M3 contract §3.8), in the order To
// sort offers them. `as` is the path segment of the prefilled form.

export type OrganiseKind = {
  as: 'task' | 'event' | 'project' | 'note' | 'know';
  action: OrganiseAction;
  /** The choice, after "Make it a…". */
  label: string;
  /** The form's headline. */
  heading: string;
  /** What it became, in a list. */
  noun: string;
  /** Said once it is made. */
  made: string;
};

export const ORGANISE_KINDS: readonly OrganiseKind[] = [
  {
    as: 'task',
    action: 'task.create',
    label: 'Task',
    heading: 'Make it a task',
    noun: 'Task',
    made: 'Made it a task.',
  },
  {
    as: 'event',
    action: 'event.create',
    label: 'Event',
    heading: 'Make it an event',
    noun: 'Event',
    made: 'Made it an event.',
  },
  {
    as: 'project',
    action: 'project.create',
    label: 'Project',
    heading: 'Make it a project',
    noun: 'Project',
    made: 'Made it a project.',
  },
  {
    as: 'note',
    action: 'note.create',
    label: 'Note on something',
    heading: 'Make it a note',
    noun: 'Note',
    made: 'Made it a note.',
  },
  {
    as: 'know',
    action: 'context.create',
    label: 'Something to know',
    heading: 'Make it something to know',
    noun: 'Something to know',
    made: 'Kept as something to know.',
  },
];

export const kindOf = (as: string) => ORGANISE_KINDS.find((k) => k.as === as);

/** "Lunch with Ana on Friday" for a label; long words are cut at a space. */
export function shortWords(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : max)}…`;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** "Two things to sort", for Today, only when something waits (M3 contract §3.2). */
export function toSortLine(n: number): string | null {
  if (n <= 0) return null;
  return `${WORDS[n] ?? String(n)} ${n === 1 ? 'thing' : 'things'} to sort`;
}
