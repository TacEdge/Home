import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No literal invisible or bidi-control character in HOME's own code or tests
// (Trojan Source, CVE-2021-42574). Where code needs one, it is written as a
// visible escape (`\u202E`), so every character a reviewer approves is one
// they can see. Review of PR #44: the untrusted-text filter's own pattern
// held literal bidi overrides.

const PROHIBITED =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/;
const TEXT = /\.(ts|tsx|mts|mjs|cjs|js|css|json|md|sql|ics|txt|yml|yaml)$/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Every prohibited character in a text, as `line:column U+XXXX`. */
export function findInvisible(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (let c = 0; c < line.length; c++)
      if (PROHIBITED.test(line[c]!))
        out.push(
          `${i + 1}:${c + 1} U+${line.charCodeAt(c).toString(16).toUpperCase().padStart(4, '0')}`,
        );
  });
  return out;
}

describe('no literal invisible or bidi-control characters', () => {
  it('in src/ or tests/', () => {
    const files = [...walk('src'), ...walk('tests')].filter((f) => TEXT.test(f));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((f) =>
      findInvisible(readFileSync(f, 'utf8')).map((at) => `${f}:${at}`),
    );
    expect(offenders).toEqual([]);
  });

  it('the check finds each kind, and passes escapes and ordinary text', () => {
    for (const ch of [
      '\u202E',
      '\u2066',
      '\u200B',
      '\u200D',
      '\uFEFF',
      '\u00AD',
      '\u0007',
      '\u206F',
    ])
      expect(findInvisible(`const a = 'x${ch}y';`), ch.codePointAt(0)!.toString(16)).toHaveLength(
        1,
      );
    expect(
      findInvisible(String.raw`const a = /[\u202E\uFEFF]/; // ‘quotes’ – é 🏊 tabs	ok`),
    ).toEqual([]);
  });
});
