// Untrusted provider text to bounded plain text (M4 contract §4.5, ADR 0007
// §9). Everything a feed says is data: markup is removed rather than
// rendered, entities are decoded once (so `&lt;script&gt;` stays the words
// "<script>", which React then escapes), nothing is ever turned into a link
// or a URL, and the result fits the event's own limits. Pure.

export const TEXT_LIMITS = Object.freeze({ title: 200, location: 500, description: 10_000 });

/** Above this many characters the raw value is cut before any work is done on it. */
const RAW_CAP = 200_000;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === '#') {
      const n =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Not a character, a surrogate half or a control character: dropped.
      if (!Number.isInteger(n) || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '';
      return String.fromCodePoint(n);
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** Markup to text: whole script, style and similar elements go, line-breaking tags become breaks, every other tag goes. */
function stripMarkup(s: string): string {
  return (
    s
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(
        /<(script|style|iframe|object|template|noscript|svg|math)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
        ' ',
      )
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      // A tag is `<` then a letter, `/` or `!`; a lone `<` (as in "a < b") is text.
      .replace(/<[a-z!/?][^<>]*>?/gi, '')
  );
}

/**
 * Bidi controls (Trojan Source), zero-width and other invisible formatting,
 * the byte-order mark, and every control character except line breaks and tabs.
 */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;

/** Cut to at most `max` UTF-16 units without splitting a character, marking the cut. */
function bound(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max - 1;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // never leave half a surrogate pair
  return `${s.slice(0, cut).trimEnd()}…`;
}

/**
 * A provider's text as HOME stores it, or null when nothing readable is left.
 * `line`: one line (titles, places); `block`: line breaks kept (details).
 */
export function plainText(raw: unknown, max: number, shape: 'line' | 'block'): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.length > RAW_CAP ? raw.slice(0, RAW_CAP) : raw;
  s = s.toWellFormed(); // a lone surrogate half becomes U+FFFD
  s = s.replace(/\r\n?/g, '\n');
  s = stripMarkup(s);
  s = decodeEntities(s);
  s = s.normalize('NFC');
  s = s.replace(INVISIBLE, '').replace(/\t/g, ' ');
  if (shape === 'line') s = s.replace(/\s+/g, ' ').trim();
  else
    s = s
      .split('\n')
      .map((l) => l.replace(/[  ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  if (s === '') return null;
  return bound(s, max);
}
