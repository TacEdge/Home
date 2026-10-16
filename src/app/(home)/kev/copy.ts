// The Kev screen's own copy (M8 contract §11.2, §11.3; D16, D17), written
// by code and fixed. Kev's answers, declines, errors and progress lines are
// Kev's (src/kev/answer/language.ts); this is the screen around them. Every
// string here is tested against the screen lists and Kev's own (§8.6).
// Pure: no imports from the server, so the client composer can use it.

import { addDays, longDate, weekdayOf } from '@/lib/dates';

export const KEV_TITLE = 'Kev';
export const PRIVACY_LINE = 'Only you can see this conversation.';
export const INTRO = 'I’m Kev. Ask me about what’s recorded in HOME.';
export const DISCLOSURE =
  'To answer, Kev sends what your question needs to Anthropic, HOME’s AI provider, which doesn’t train on it.';
export const DISCLOSURE_LINK = 'What’s sent, and for how long';

export const COMPOSER_LABEL = 'Ask Kev';
export const COMPOSER_PLACEHOLDER = 'Ask Kev…';
export const SEND = 'Send';
export const SENDING = 'Sending…';
export const FOCUS_TODAY = 'About today';
export const SUGGESTIONS_LABEL = 'Try asking';

export const YOU = 'You';
export const KEV = 'Kev';
export const KEVS_VIEW = 'Kev’s view';
export const BASED_ON = 'What’s this based on?';
export const BASED_ON_START = 'Today in HOME, and the people you can see';
export const KEEP = 'Keep in To sort';
export const KEPT = 'Kept';
export const KEPT_WHERE = 'in To sort';
export const STILL_ANSWERING = 'Kev’s still answering.';
export const EARLIER = 'Show the week before';
export const EARLIER_THIS_WEEK = 'Show earlier';
export const GONE_ONE = 'One record this answer rested on is gone from your view of HOME.';
export const GONE_MANY = (n: number) =>
  `${n} records this answer rested on are gone from your view of HOME.`;
export const SIMPLER_TODAY = 'Kev’s keeping answers simpler until the 1st.';
export const STREAM_DROPPED =
  'The connection dropped. What you asked is kept, and Kev’s answer will be here when you reload.';
export const RELOAD = 'Reload';

export const CLEAR_LABEL = 'Clear conversation';
export const CLEAR_QUESTION =
  'This deletes your words and Kev’s answers for good. Usage records stay, and anything you kept in To sort stays.';
export const CLEAR_CONFIRM = 'Clear';
export const CLEARED = 'Cleared.';

/** The day heading for a home date in the conversation. */
export function dayHeading(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return longDate(date);
}

/**
 * Two or three static questions, chosen by code by the time of day and the
 * weekday (§11.2; U7), never by a model: "What's happening today?" first by
 * day; "What's on tomorrow?" from 17:00; "What have we got this weekend?"
 * from Thursday to Saturday.
 */
export function suggestions(today: string, hour: number): string[] {
  const wd = weekdayOf(today); // 0 Monday … 6 Sunday
  const weekend = wd >= 3 && wd <= 5;
  const evening = hour >= 17;
  const out: string[] = evening
    ? ['What’s on tomorrow?', 'What’s happening today?']
    : ['What’s happening today?'];
  if (weekend) out.push('What have we got this weekend?');
  else out.push('What tasks have I still got outstanding?');
  return out.slice(0, 3);
}

/**
 * "What's this based on?" (§11.2; U6): what Kev looked at, in plain words,
 * from a trace entry's tool and its structural arguments. No tool names,
 * tokens or model names; dates as HOME writes them.
 */
export function basedOnLabel(
  tool: string,
  args: Record<string, string | number | boolean>,
): string | null {
  const range = () => {
    const from = typeof args.from === 'string' ? args.from : null;
    const to = typeof args.to === 'string' ? args.to : null;
    if (!from) return '';
    if (!to || to === from) return `, ${longDate(from)}`;
    return `, ${longDate(from)} to ${longDate(to)}`;
  };
  switch (tool) {
    case 'get_today':
      return 'Today’s agenda';
    case 'get_agenda':
      return `The calendar${range()}`;
    case 'get_conflicts':
      return `Overlaps HOME has marked${range()}`;
    case 'get_insights':
      return args.surface === 'forward_week'
        ? 'What HOME noticed for the week'
        : 'What HOME noticed for today';
    case 'get_tasks':
      return 'Tasks';
    case 'get_projects':
      return 'Projects';
    case 'get_people':
      return 'People';
    case 'get_context':
      return 'What Kev knows';
    case 'get_calendar_health':
      return 'How up to date the calendars are';
    case 'get_weather':
      return `The forecast${range()}`;
    case 'get_gaps':
      return `Stretches with nothing recorded${range()}`;
    case 'search':
      return 'A search of titles in HOME';
    default:
      return null;
  }
}

/** Every fixed string on the screen, for the copy test. */
export function screenCopy(): string[] {
  return [
    KEV_TITLE,
    PRIVACY_LINE,
    INTRO,
    DISCLOSURE,
    DISCLOSURE_LINK,
    COMPOSER_LABEL,
    COMPOSER_PLACEHOLDER,
    SEND,
    SENDING,
    FOCUS_TODAY,
    SUGGESTIONS_LABEL,
    YOU,
    KEVS_VIEW,
    BASED_ON,
    BASED_ON_START,
    KEEP,
    KEPT,
    KEPT_WHERE,
    STILL_ANSWERING,
    EARLIER,
    EARLIER_THIS_WEEK,
    GONE_ONE,
    GONE_MANY(2),
    SIMPLER_TODAY,
    STREAM_DROPPED,
    RELOAD,
    CLEAR_LABEL,
    CLEAR_QUESTION,
    CLEAR_CONFIRM,
    CLEARED,
    ...suggestions('2026-10-15', 19),
    ...suggestions('2026-10-14', 7),
  ];
}
