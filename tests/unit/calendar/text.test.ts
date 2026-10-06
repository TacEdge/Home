import { describe, expect, it } from 'vitest';
import { TEXT_LIMITS, plainText } from '@/integrations/calendar/text';

// The untrusted-text boundary (M4 contract §4.5, ADR 0007 §9).

const line = (s: unknown, max = 200) => plainText(s, max, 'line');
const block = (s: unknown, max = 10_000) => plainText(s, max, 'block');

describe('markup becomes plain text', () => {
  it('script, style and embedded elements go entirely, content and all', () => {
    expect(line(`a<script>alert('x')</script>b`)).toBe('a b');
    expect(line(`<SCRIPT type="text/javascript">evil()</SCRIPT>ok`)).toBe('ok');
    expect(line(`<style>p{color:red}</style>ok`)).toBe('ok');
    expect(line(`<iframe src="javascript:alert(1)"></iframe>ok`)).toBe('ok');
    expect(line(`<svg onload="alert(1)"><circle/></svg>ok`)).toBe('ok');
    expect(line(`<object data="x"></object><embed src="y">ok`)).toBe('ok');
    expect(line(`ok<script>never closed`)).toBe('ok');
  });

  it('tags and their attributes go, handlers and javascript: links included; link text stays', () => {
    const out = block(
      `<img src=x onerror="alert('img')"><a href="javascript:alert('link')" onclick="x()">open</a> <b onmouseover="y()">bold</b>`,
    );
    expect(out).toBe('open bold');
    for (const bad of ['onerror', 'onclick', 'onmouseover', 'href', 'javascript', 'alert', '<'])
      expect(out).not.toContain(bad);
  });

  it('line-breaking tags become breaks in details; lists read as bullets', () => {
    expect(block('<p>One</p><p>Two</p>Three<br>Four<br/>Five')).toBe('One\nTwo\nThree\nFour\nFive');
    expect(block('<ul><li>Towel</li><li>Goggles</li></ul>')).toBe('• Towel\n• Goggles');
  });

  it('comments go; a lone < is text', () => {
    expect(line('a<!-- hidden -->b')).toBe('ab');
    expect(line('a < b and c > d')).toBe('a < b and c > d');
  });

  it('javascript: and other URL text stays inert words: nothing is turned into a link', () => {
    expect(line(`javascript:alert('location')`)).toBe(`javascript:alert('location')`);
    expect(line('https://example.test/a?b=c')).toBe('https://example.test/a?b=c');
  });
});

describe('entities are decoded once', () => {
  it('named and numeric entities become characters', () => {
    expect(line('Fish &amp; chips &quot;tonight&quot; &#39;7pm&#39; &#x2014; &nbsp;ok')).toBe(
      `Fish & chips "tonight" '7pm' — ok`,
    );
  });

  it('an escaped tag stays the words of a tag (React escapes it when shown), never markup that was stripped again', () => {
    expect(line('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
    // Decoded once only: a doubly escaped entity stays an entity.
    expect(line('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('entities naming no character, a surrogate half or NUL are dropped; unknown names stay as written', () => {
    expect(line('a&#0;b&#xD800;c&#x110000;d')).toBe('abcd');
    expect(line('a&bogus;b')).toBe('a&bogus;b');
  });
});

describe('invisible and malformed characters', () => {
  it('control characters go (tabs become spaces)', () => {
    expect(line('a\u0000b\u0007c\u001bd\u007fe\tf')).toBe('abcde f');
  });

  it('bidi overrides (Trojan Source), zero-width characters and the BOM go', () => {
    expect(line('‮gnirts‬ ⁦x⁩ a​b ﻿c')).toBe('gnirts x ab c');
  });

  it('a lone surrogate half becomes U+FFFD; whole emoji stay', () => {
    expect(line('a\uD800b')).toBe('a�b');
    expect(line('a\uDC00')).toBe('a�');
    expect(line('Swim 🏊‍♀️')).toBe('Swim 🏊‍♀️');
  });

  it('text is NFC-normalised', () => {
    expect(line('Café')).toBe('Café');
  });
});

describe('shape and bounds', () => {
  it('a line is one line, whitespace collapsed; details keep line breaks, at most one blank line', () => {
    expect(line('  a\n\n b \r\n c  ')).toBe('a b c');
    expect(block('a\r\n\r\n\r\n\r\nb  \n  c')).toBe('a\n\nb\nc');
  });

  it('long text is cut to the limit with an ellipsis, never splitting a character', () => {
    for (const [field, max] of Object.entries(TEXT_LIMITS)) {
      const out = plainText('x'.repeat(max * 3), max, field === 'description' ? 'block' : 'line')!;
      expect(out.length, field).toBe(max);
      expect(out.endsWith('…')).toBe(true);
    }
    const emoji = '😀'.repeat(150); // 300 UTF-16 units
    const out = line(emoji, 200)!;
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.isWellFormed()).toBe(true);
  });

  it('huge raw input is cut before any work is done on it', () => {
    const out = block('<b>'.repeat(500_000) + 'x'.repeat(10));
    expect(out).toBeNull(); // only tags in the first 200,000 characters
  });

  it('nothing readable, or not a string, is null', () => {
    for (const v of ['', '   ', '<b></b>', '​', undefined, null, 42, { val: 'x' }, ['x']])
      expect(plainText(v, 200, 'line')).toBeNull();
  });
});
