import 'server-only';
import { messageContentV1 } from '@/domain/conversations/schema';
import { kevContentV2, userContentV2, type KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import { isoDateInZone } from '@/lib/dates';
import { DECLINE_TEXT, KEEPABLE_DECLINES } from '@/kev/answer/language';

// The Kev screen's model of the conversation (M8 contract §7.2, §11.2, §11.3;
// D6): the adult's stored messages, paired into turns, each turn on its home
// day, and whether "Keep in To sort" applies to the person's words. Pure
// over what the conversation read returned; the screen renders it, and the
// Keep action checks it again on the server before keeping anything.
//
// Keep in To sort applies only where the contract says (D6, §9.9): Kev
// declined the message as something to add or remember (the `write` and
// `memory` templates), or could not answer it (the safe fallback, or no
// answer stored at all: the cap, the provider down or timing out, a failure
// after the words were stored). Never under a plain answer, a decline of
// another kind, or a refusal, and not while Kev is still answering it.

export type Ref = { type: string; id: string; at?: string };

export type UserView = { id: string; text: string; createdAt: Date; focus: boolean };

export type KevView =
  | {
      kind: 'v2';
      id: string;
      createdAt: Date;
      content: KevContentV2;
    }
  | { kind: 'v1'; id: string; createdAt: Date; text: string };

export type Turn = {
  /** The home date the turn is shown under. */
  day: string;
  user: UserView | null;
  kev: KevView | null;
  /** "Keep in To sort" applies to the person's words. */
  keepable: boolean;
  /** The latest turn, with no answer yet, while the one-turn guard still holds it. */
  answering: boolean;
};

type Row = { id: string; role: string; content: unknown; createdAt: Date };

/** The decline templates Keep in To sort follows (D6), by their stored words. */
const KEEPABLE_DECLINE_TEXT = new Set([...KEEPABLE_DECLINES].map((c) => DECLINE_TEXT[c]));

/** Whether a stored Kev reply leaves the person's words keepable. */
export function replyKeepable(kev: KevView): boolean {
  if (kev.kind !== 'v2') return false;
  const c = kev.content;
  if (c.outcome === 'fallback') return true;
  if (c.outcome === 'declined') return KEEPABLE_DECLINE_TEXT.has(c.say);
  return false;
}

function userOf(r: Row): UserView | null {
  const v2 = userContentV2.safeParse(r.content);
  if (v2.success)
    return {
      id: r.id,
      text: v2.data.text,
      createdAt: r.createdAt,
      focus: v2.data.focus === 'today',
    };
  const v1 = messageContentV1.safeParse(r.content);
  if (v1.success && v1.data.text.length > 0)
    return { id: r.id, text: v1.data.text, createdAt: r.createdAt, focus: false };
  return null;
}

function kevOf(r: Row): KevView | null {
  const v2 = kevContentV2.safeParse(r.content);
  if (v2.success) return { kind: 'v2', id: r.id, createdAt: r.createdAt, content: v2.data };
  const v1 = messageContentV1.safeParse(r.content);
  if (v1.success && v1.data.text.length > 0)
    return { kind: 'v1', id: r.id, createdAt: r.createdAt, text: v1.data.text };
  return null;
}

/**
 * The messages (oldest first) as turns: each person's message with the Kev
 * message that follows it, if any; a Kev message with no person's message
 * before it stands alone. `inFlight` is the one-turn guard's reading for the
 * adult's conversation now.
 */
export function toTurns(rows: readonly Row[], inFlight: boolean, timeZone: string): Turn[] {
  const turns: Turn[] = [];
  for (const r of rows) {
    if (r.role === 'user') {
      const user = userOf(r);
      if (!user) continue;
      turns.push({
        day: isoDateInZone(r.createdAt, timeZone),
        user,
        kev: null,
        keepable: false,
        answering: false,
      });
    } else if (r.role === 'kev') {
      const kev = kevOf(r);
      if (!kev) continue;
      const last = turns.at(-1);
      if (last && last.user && !last.kev) last.kev = kev;
      else
        turns.push({
          day: isoDateInZone(r.createdAt, timeZone),
          user: null,
          kev,
          keepable: false,
          answering: false,
        });
    }
  }
  turns.forEach((t, i) => {
    if (!t.user) return;
    if (t.kev) t.keepable = replyKeepable(t.kev);
    else if (i === turns.length - 1 && inFlight) t.answering = true;
    else t.keepable = true;
  });
  return turns;
}

/** Turns grouped by their home day, in order. */
export function byDay(turns: readonly Turn[]): { day: string; turns: Turn[] }[] {
  const out: { day: string; turns: Turn[] }[] = [];
  for (const t of turns) {
    const last = out.at(-1);
    if (last && last.day === t.day) last.turns.push(t);
    else out.push({ day: t.day, turns: [t] });
  }
  return out;
}
