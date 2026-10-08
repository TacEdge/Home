import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSIGHT_RULES } from '@/domain/engines/insights';
import { HEADLINE_RULES } from '@/domain/engines/today';
import {
  at,
  fresh,
  ID,
  PEOPLE,
  PROJECTS,
  ROUTINE,
  run,
  TASKS,
  timed,
  WEDNESDAY,
} from './household';

// Explainability and restraint (ADR 0008 §5, §6; M5 contract §8.1): every
// sentence the engines can say is traced to a documented rule and to input
// records, matches its rule's wording, and never claims a need, an
// arrangement, availability, character or reassurance. The engines are pure.

const WED = [...ROUTINE, ...WEDNESDAY];
const TITLES = [
  ...new Set([
    ...WED.map((e) => e.title),
    ...PROJECTS.map((p) => p.title),
    ...TASKS.map((t) => t.title),
  ]),
];
const NAMES = PEOPLE.map((p) => p.name);

/** Every sentence across the week, each time of day, with and without stale calendars. */
function everything() {
  const out: { rule: string; text: string; facts: { kind: string }[]; stale: boolean }[] = [];
  for (let d = 12; d <= 21; d++)
    for (const t of ['00:30', '07:03', '12:00', '15:20', '20:40', '23:30'])
      for (const stale of [false, true]) {
        const now = at(`2026-10-${d}T${t}:00+13:00`);
        const calendars = stale
          ? [fresh(now, { lastSyncedAt: at('2026-10-01T09:00:00+13:00') })]
          : [fresh(now)];
        const r = run({ events: WED, calendars }, now);
        const m = r.today;
        const add = (x: { rule: string; text: string; facts: { kind: string }[] }) =>
          out.push({ rule: x.rule, text: x.text, facts: x.facts, stale });
        add(m.headline);
        if (m.headline.late) add(m.headline.late);
        for (const l of m.personLines) for (const e of l.entries) add(e);
        for (const i of r.insights.all) add(i);
      }
  return out;
}

/** Words the engines must never say themselves (contract §5.3, §8.1). Titles and names are the household's own. */
const FORBIDDEN = [
  /\bneeds?\b/i,
  /needs you/i,
  /nobody'?’?s down/i,
  /\bwho\?/i,
  /\blift\b/i,
  /\bpick(ing)? up\b/i,
  /\bdrop(ping)? off\b/i,
  /\btaking\b/i,
  /\bdriving\b/i,
  /\bfree\b/i,
  /\bavailable\b/i,
  /\bout\b/i,
  /\beasy\b/i,
  /\bbusy\b/i,
  /\bfull\b/i,
  /\bcalm\b/i,
  /\bstress/i,
  /\bcovered\b/i,
  /\bsorted\b/i,
  /nothing needs/i,
  /\bshould\b/i,
  /\bprobably\b/i,
  /nothing prepared/i,
  /\burgent/i,
  /\bdon'?’?t forget\b/i,
];

const own = (text: string) => {
  let s = text;
  for (const t of [...TITLES, ...NAMES].sort((a, b) => b.length - a.length))
    s = s.split(t).join('');
  return s;
};

describe('restraint', () => {
  const said = everything();

  it('covers every headline and insight rule', () => {
    const rules = new Set(said.map((s) => s.rule));
    for (const r of [
      'headline.counted',
      'headline.listed',
      'headline.usual',
      'headline.nothing',
      'headline.evening',
      'headline.late',
    ])
      expect(rules).toContain(r);
  });

  it('never says a forbidden word of its own', () => {
    for (const s of said) for (const f of FORBIDDEN) expect(own(s.text), s.text).not.toMatch(f);
  });

  it('a child’s event with nobody recorded as responsible is said only as recorded', () => {
    const pickup = said.filter((s) => s.text.includes('Isla pickup'));
    expect(pickup.length).toBeGreaterThan(0);
    for (const s of pickup)
      expect(s).toMatchObject({ rule: 'person_line.item', text: '15:00 Isla pickup' });
  });
});

describe('wording matches its rule', () => {
  const pattern: Record<string, RegExp> = {
    'headline.first_run': /^HOME is quiet because it doesn’t know your calendars yet\.$/,
    'headline.evening': /^Nothing else on today(, as far as HOME knows)?\.$/,
    'headline.listed': /^.+ at \d\d:\d\d(, then .+ at \d\d:\d\d)?(, as far as HOME knows)?\.$/,
    'headline.counted':
      /^[A-Z]\w* things? on today(, besides the usual)?(, as far as HOME knows)?\.$/,
    'headline.usual': /^Just the usual today(, as far as HOME knows)?\.$/,
    'headline.nothing': /^Nothing on today(, as far as HOME knows)?\.$/,
    'headline.late': /^.+ (both|all) have something on after 6\.$/,
    'person_line.routine': /^(School|Work|Work till \d\d:\d\d|.+)$/,
    'person_line.item': /^(\d\d:\d\d .+|.+ until \d\d:\d\d|.+, all day|.+)$/,
    'person_line.birthday': /^Birthday$/,
  };

  it('every headline and line sentence has its rule’s shape and stands on records', () => {
    for (const s of everything()) {
      if (!(s.rule in pattern)) continue;
      expect(s.text, s.rule).toMatch(pattern[s.rule]!);
      expect(s.facts.length, s.rule).toBeGreaterThan(0);
    }
    expect(
      run({ events: [], calendars: [] }, at('2026-10-14T07:00:00+13:00')).today.headline.text,
    ).toMatch(pattern['headline.first_run']!);
  });

  it('the qualifier is there exactly when a visible calendar is stale or failing', () => {
    const headlines = everything().filter(
      (s) => s.rule.startsWith('headline.') && s.rule !== 'headline.late',
    );
    expect(headlines.some((s) => s.stale)).toBe(true);
    for (const s of headlines) {
      expect(s.text.includes('as far as HOME knows'), s.text).toBe(s.stale);
      if (s.stale) expect(s.facts.some((f) => f.kind === 'calendar')).toBe(true);
    }
  });

  it('every rule the engines can give is written down in the contract', () => {
    const contract = readFileSync('docs/m5/M5-BUILD-CONTRACT.md', 'utf8');
    for (const r of [...HEADLINE_RULES, 'headline.late', ...INSIGHT_RULES, 'routine.regular_week'])
      expect(contract, r).toContain(`\`${r}\``);
  });
});

describe('the engines are pure', () => {
  const files = [
    'src/domain/engines/today.ts',
    'src/domain/engines/day-facts.ts',
    'src/domain/engines/insights/index.ts',
  ];

  it('no clock, no randomness, no database, screen, Kev or server-only import', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Date\.now\(/);
      expect(src, f).not.toMatch(/new Date\(\)/);
      expect(src, f).not.toMatch(/Math\.random/);
      for (const m of src.matchAll(/^import (type )?.* from '([^']+)';$/gm)) {
        const [, typeOnly, from] = m;
        expect(from, f).not.toMatch(
          /^@\/(app|kev|ui|integrations|trust)\b|^drizzle|^server-only$|^@\/db\/client/,
        );
        if (from!.startsWith('@/db')) expect(typeOnly, `${f}: ${from}`).toBe('type ');
      }
    }
  });
});

describe('performance', () => {
  it('a household-scale week, from the shared agenda, in well under a second', () => {
    // 120 weekly series and 180 one-offs over the week ahead, across the household.
    const who = [ID.sam, ID.alex, ID.milo, ID.isla];
    const events = [
      ...Array.from({ length: 120 }, (_, k) =>
        timed(
          `s-${k}`,
          `Series ${k}`,
          `2026-10-${String(12 + (k % 7)).padStart(2, '0')}T${String(7 + (k % 12)).padStart(2, '0')}:00:00+13:00`,
          `2026-10-${String(12 + (k % 7)).padStart(2, '0')}T${String(8 + (k % 12)).padStart(2, '0')}:00:00+13:00`,
          {
            rrule: 'FREQ=WEEKLY',
            kind: k % 5 === 0 ? 'school' : 'activity',
            people: [{ personId: who[k % 4]!, role: 'attending' }],
          },
        ),
      ),
      ...Array.from({ length: 180 }, (_, k) =>
        timed(
          `o-${k}`,
          `One-off ${k}`,
          `2026-10-${String(14 + (k % 8)).padStart(2, '0')}T${String(7 + (k % 14)).padStart(2, '0')}:15:00+13:00`,
          `2026-10-${String(14 + (k % 8)).padStart(2, '0')}T${String(8 + (k % 14)).padStart(2, '0')}:00:00+13:00`,
          {
            people: [{ personId: who[k % 4]!, role: k % 3 ? 'attending' : 'responsible' }],
          },
        ),
      ),
    ];
    const now = at('2026-10-14T07:03:00+13:00');
    run({ events }, now); // warm
    const runs = 20;
    const t = performance.now();
    for (let k = 0; k < runs; k++) run({ events }, now);
    const ms = (performance.now() - t) / runs;
    console.info(
      `today + insights over ${events.length} events (agenda included): ${ms.toFixed(1)} ms per run`,
    );
    expect(ms).toBeLessThan(1000);
  });
});
