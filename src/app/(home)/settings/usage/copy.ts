import { formatIsoDate, longDate, parseIsoDate } from '@/lib/dates';

// Settings › Usage (M8 contract §11.2, §13.6; D19; the owner's presentation
// boundary of 2026-10-15, ADR 0012 §43, I5). Fixed copy, written by code.
// What an adult sees is the household's recorded month only: the cap, the
// month's recorded usage, the threshold state from that recorded total and
// the date Kev resumes; never a reservation, an unreconciled or late-settled
// count, a tier, or anything that moves while the other adult's turn is in
// flight. Pure.

export const USAGE_TITLE = 'Usage';
export const USAGE_INTRO = 'What Kev has cost the household this month, as HOME has recorded it.';

export function monthLine(aboutNzd: bigint, capNzd: bigint): string {
  return `This month: about NZ$${aboutNzd} of NZ$${capNzd} (both of you).`;
}

export function ownLine(questions: number): string {
  if (questions === 0) return 'You haven’t asked Kev anything yet this month.';
  return questions === 1
    ? 'You’ve asked Kev one question this month.'
    : `You’ve asked Kev ${questions.toLocaleString('en-NZ')} questions this month.`;
}

export const RECORDED_NOTE =
  'These are the costs HOME records as Kev answers. The provider’s own bill can differ slightly.';
export const SIMPLER = 'Kev is keeping answers simpler until the 1st.';

/** The first day of the next home-zone month, in words: the day Kev resumes. */
export function resumesOn(today: string): string {
  const d = parseIsoDate(today);
  const next =
    d.month === 12
      ? { year: d.year + 1, month: 1, day: 1 }
      : { year: d.year, month: d.month + 1, day: 1 };
  return longDate(formatIsoDate(next));
}
export function pausedLine(today: string): string {
  return `Kev has reached this month’s limit and will be back on ${resumesOn(today)}.`;
}
export const ZERO_CAP = 'Kev is paused for this month.';

export const ABOUT_LABEL = 'About Kev';
export const ABOUT = [
  'When you ask Kev something, HOME sends Anthropic, its AI provider, only what your question calls for: your words, your last few exchanges with Kev, and the records Kev reads to answer, as you can see them. Never sensitive notes, the other adult’s private records, your home’s location, dates of birth or contact details.',
  'Kev’s answers are produced by Anthropic in the United States, so what HOME sends leaves New Zealand whenever Kev runs. Anthropic doesn’t train on it. How long Anthropic keeps it is set by HOME’s agreement with them, which the household records before Kev is used with family records.',
  'In HOME, each message in your conversation is kept for 90 days and then deleted. Only you can see your conversation.',
  'Clearing your conversation deletes your words and Kev’s answers at once. It keeps the usage records and the activity log (neither holds any words), anything you kept in To sort, and any copies Anthropic holds under its own terms.',
] as const;

/** Every fixed string, for the copy test. */
export function usageCopy(): string[] {
  return [
    USAGE_TITLE,
    USAGE_INTRO,
    monthLine(12n, 100n),
    ownLine(0),
    ownLine(1),
    ownLine(14),
    RECORDED_NOTE,
    SIMPLER,
    pausedLine('2026-10-16'),
    ZERO_CAP,
    ABOUT_LABEL,
    ...ABOUT,
  ];
}
