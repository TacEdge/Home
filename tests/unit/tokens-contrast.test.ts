import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG AA for the brand tokens (ADR 0006 §5, M3 contract §4.5): every text
// token reaches 4.5:1 on both surfaces, by day and at night, and the focus
// ring (--ink) reaches 3:1. Mist (mark) is decorative and never used as text.

const css = readFileSync('src/ui/tokens.css', 'utf8');

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block ${String(selector)}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1]!.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) out[k!] = v!;
  return out;
}

const day = block(/\n:root \{([^}]*)\}/);
const night = { ...day, ...block(/prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe.each([
  ['day', day],
  ['night', night],
])('%s tokens', (_name, t) => {
  it.each(['--ink', '--ink-2', '--muted'])('%s reaches 4.5:1 on --paper and --paper-2', (text) => {
    for (const ground of ['--paper', '--paper-2'])
      expect(ratio(t[text]!, t[ground]!), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring (--ink) reaches 3:1 on both surfaces', () => {
    for (const ground of ['--paper', '--paper-2'])
      expect(ratio(t['--ink']!, t[ground]!)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the original Mist as --muted-mark', () => {
    expect(t['--muted-mark']).toMatch(/^#/);
  });
});

it('Mist (mark) is never used for text', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f)) files.push(p);
    }
  };
  walk('src');
  for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/text-muted-mark/);
});
