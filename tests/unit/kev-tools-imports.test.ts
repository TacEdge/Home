import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// S11 (M8 contract §9.7, §15.1; ADR 0012 §25): Kev's tools may import only
// read services. Nothing under src/kev/tools (or the context assembly, which
// reads through them) imports a write function, the bookkeeping path, the
// database, an integration or the app. Every value imported from the domain
// is on this closed list of reads and pure helpers, reviewed here; a new
// import fails until it is added deliberately, and nothing whose name is a
// write verb can be added at all.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const FILES = [...walk(join('src', 'kev', 'tools')), ...walk(join('src', 'kev', 'context'))].filter(
  (f) => /\.(ts|tsx)$/.test(f),
);

/** Reads (they take the actor and only read) and pure engines, constants and types. */
const APPROVED = new Set([
  // Reads through the domain services, as the adult.
  'loadAgenda',
  'readAgendaInputs',
  'listCaptures',
  'listCalendars',
  'listContext',
  'getPerson',
  'getProject',
  'listPeople',
  'listProjects',
  'listTasks',
  'listNotes',
  'readConflicts',
  'readForecast',
  'insightsFor',
  'forwardInsights',
  'searchTitles',
  // Pure: engines and compositions over records already read.
  'todayInput',
  'today',
  'conflictPlacements',
  'conflictsOver',
  'insightsInput',
  'gapsOver',
  'coverageOf',
  'daylightOver',
  'openingWeatherFrom',
  'forecastFor',
  'dayOutlook',
  'atHome',
  'ageOn',
  'nextBirthday',
  'regularWeek',
  'stalenessOf',
  // Constants and error classes.
  'LOOKAHEAD_DAYS',
  'CONFLICT_DAYS',
  'HOUSEHOLD',
  'WEEKDAYS',
  'EVENT_KINDS',
  'PERSON_ROLES',
  'PROJECT_STATUSES',
  'TASK_NEEDS',
  'TASK_STATUSES',
  'CONTEXT_CATEGORIES',
  'SEARCH_LIMIT',
  'SEARCH_TYPES',
  'NotFoundError',
  'NotPermittedError',
  'GapRangeError',
  'GapScopeError',
]);

const WRITE_VERB =
  /^(create|update|archive|restore|set|remove|edit|link|unlink|connect|reconnect|disconnect|refresh|respond|dismiss|capture|record|reserve|settle|purge|clear|confirm|retire|reinstate|approve|reject|add|start|skip|put|change|sync|organise|execute|expire|delete|write|insert|lock|mark|apply|send)/i;

/** Every non-type import: its specifier and the value names it brings in. */
function imports(src: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  for (const m of src.matchAll(/import\s+(type\s+)?([^'";]*?)\s+from\s+'([^']+)'/g)) {
    if (m[1]) continue;
    const clause = m[2]!;
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
    const names = named
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('type '))
      .map((s) => s.split(/\s+as\s+/)[0]!.trim());
    const def = clause
      .replace(/\{[^}]*\}/, '')
      .replace(',', '')
      .trim();
    if (def && def !== '*') names.push(`default:${def}`);
    if (clause.includes('*')) names.push('*');
    out.push({ spec: m[3]!, names });
  }
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g))
    out.push({ spec: m[1]!, names: ['dynamic'] });
  return out;
}

describe('S11: Kev’s tools import only reads', () => {
  it('finds the tool files', () => {
    expect(FILES.length).toBeGreaterThan(12);
  });

  it.each(FILES)('%s: no bookkeeping path, database, integration or app', (f) => {
    for (const { spec } of imports(readFileSync(f, 'utf8'))) {
      expect(spec, f).not.toMatch(
        /kev-bookkeeping|kev-usage|^@\/db|^@\/integrations|^@\/app|proposals|conversations|executor/,
      );
    }
  });

  it.each(FILES)('%s: every value from the domain is an approved read or pure helper', (f) => {
    for (const { spec, names } of imports(readFileSync(f, 'utf8'))) {
      if (!spec.startsWith('@/domain')) continue;
      for (const name of names) {
        expect(name, `${f}: ${name} from ${spec}`).not.toMatch(WRITE_VERB);
        expect(APPROVED.has(name), `${f}: ${name} from ${spec} is not on the reviewed list`).toBe(
          true,
        );
      }
    }
  });

  it('the list itself holds no write function', () => {
    for (const name of APPROVED) expect(name).not.toMatch(WRITE_VERB);
  });
});
