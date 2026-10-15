import 'server-only';
import { LIMITS } from '../config';
import { estimateTokens } from './tokens';

// The conversation window (M8 contract §7.2, §7.4; O3; matrix rows C5, C6,
// C16). What the model sees of the adult's earlier turns: complete
// exchanges (their words and Kev's checked reply) from the last 12 hours
// (the bookkeeping read applies that bound, in instants, on the database's
// clock, together with the 90-day expiry), at most 10 of them and at most
// 6,000 tokens by HOME's estimate, the oldest dropped first, whole. Each
// earlier Kev message is replayed as its stored, validated `say` and blocks,
// each text labelled `untrusted_text` (I-7), with its citation refs as ids
// only (type, id, `at`): never a tool result, trace, usage, thinking or
// anything provider-shaped. No summary, ever (D12).

export type StoredMessage = Readonly<{ role: 'user' | 'kev'; content: unknown }>;

export type Exchange = Readonly<{ user: string; kev: string; tokens: number }>;

type RefLike = { type: string; id: string; at?: string };
const refOnly = (r: unknown): RefLike | null => {
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  if (typeof o.type !== 'string' || typeof o.id !== 'string') return null;
  return typeof o.at === 'string'
    ? { type: o.type, id: o.id, at: o.at }
    : { type: o.type, id: o.id };
};

/** The person's words, from content v2 (or v1's text). */
function userText(content: unknown): string | null {
  const c = content as { v?: unknown; text?: unknown } | null;
  return c && (c.v === 2 || c.v === 1) && typeof c.text === 'string' && c.text.trim() !== ''
    ? c.text
    : null;
}

/** Text as replayed: labelled, because an earlier answer may quote a record's own words. */
const labelled = (t: string) => ({ untrusted_text: t });

/**
 * Kev's reply as replayed: the validated `say` and blocks, with refs as ids
 * only, in the answer format's shape. Nothing else of the stored content
 * (trace, calls, limits, codes) is ever replayed. Every replayed text is
 * labelled `untrusted_text` (Package 3 review, I-7): an earlier answer may
 * quote a record's title or name word for word, and such text, written by a
 * person or a calendar, must reach the next turn as data, never as the
 * assistant's own words. The label is structural, whatever the text says.
 */
function kevText(content: unknown): string | null {
  const c = content as Record<string, unknown> | null;
  if (!c) return null;
  if (c.v === 2 && typeof c.say === 'string') {
    const blocks = Array.isArray(c.blocks) ? c.blocks : [];
    const cites = Array.isArray(c.cites) ? c.cites : [];
    return JSON.stringify({
      say: { text: labelled(c.say), cites: cites.map(refOnly).filter(Boolean) },
      blocks: blocks
        .map((b) => b as Record<string, unknown>)
        .filter((b) => (b.kind === 'fact' || b.kind === 'view') && typeof b.text === 'string')
        .map((b) => ({
          kind: b.kind,
          text: labelled(b.text as string),
          cites: (Array.isArray(b.cites) ? b.cites : []).map(refOnly).filter(Boolean),
        })),
    });
  }
  if (c.v === 1 && typeof c.text === 'string')
    return JSON.stringify({ say: { text: labelled(c.text), cites: [] }, blocks: [] });
  return null;
}

/**
 * The window from the adult's messages of the last 12 hours, oldest first:
 * each person's message paired with Kev's reply that follows it (a message
 * Kev never answered is left out, and so is an unpaired reply), then the
 * newest 10 exchanges, then the newest of those within 6,000 tokens.
 */
export function selectWindow(
  messages: readonly StoredMessage[],
  limits: { exchanges: number; tokens: number } = {
    exchanges: LIMITS.windowExchanges,
    tokens: LIMITS.windowTokens,
  },
): Exchange[] {
  const pairs: Exchange[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i]!;
    const next = messages[i + 1]!;
    if (m.role !== 'user' || next.role !== 'kev') continue;
    const user = userText(m.content);
    const kev = kevText(next.content);
    if (user === null || kev === null) continue;
    pairs.push({ user, kev, tokens: estimateTokens(user) + estimateTokens(kev) });
    i++;
  }
  const recent = pairs.slice(-limits.exchanges);
  const kept: Exchange[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i]!;
    if (total + e.tokens > limits.tokens) break;
    total += e.tokens;
    kept.unshift(e);
  }
  return kept;
}
