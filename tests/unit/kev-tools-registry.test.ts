import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REF_TYPES as CONTENT_REF_TYPES,
  TOOL_ERROR_CODES as CONTENT_ERROR_CODES,
  TOOL_NAMES as CONTENT_TOOL_NAMES,
  refSchema as contentRefSchema,
  traceEntrySchema,
} from '@/domain/kev-bookkeeping/schema';
import { stablePrefix } from '@/kev/context/assemble';
import { offersEscalate } from '@/kev/router';
import {
  AUTHORITY_CLASSES,
  createToolRunner,
  defineRegistry,
  jsonSchemaOf,
  REGISTRY,
  RegistryError,
  toolDefinitions,
} from '@/kev/tools/registry';
import {
  ContextRefusal,
  homeInstant,
  MAX_ITEMS,
  REF_TYPES,
  refSchema,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
  untrusted,
  untrustedSchema,
} from '@/kev/tools/types';
import {
  CANARY,
  FAMILY_EVENTS,
  FAMILY_NOTES,
  FAMILY_PEOPLE,
  FAMILY_PROJECTS,
  FAMILY_TASKS,
} from '../fixtures/family';
import { ALEX, SAM } from '../fixtures/users';

// Kev's tool registry and its static surface (M8 contract §4.5, §6.1, §6.2,
// §7.3, §9.8, §15.1; matrix rows T15, T22, T23, T24, N14 and the input half
// of T15/T17). Pure: nothing here reads a database. Every invalid input is
// refused by the strict Zod schema before any domain call: the runner is
// given a deps whose database throws on any use, so a call that reached a
// service would surface as `unavailable`, never `bad_input`.

const SNAPSHOT = join('tests', 'unit', 'kev-tool-schemas.json');
const ZONE = 'Pacific/Auckland';
const NOW = new Date('2026-10-13T18:03:00Z');
const UUID = '7d2b1e04-9f53-4c1a-8e8a-2f3d4c5b6a71';

/** A database that fails the test if anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('the database must not be reached');
    },
  },
) as never;

const runner = () =>
  createToolRunner({
    actor: { kind: 'user', userId: 'u-sam', email: SAM.email, via: 'kev', channel: 'web' },
    now: NOW,
    timeZone: ZONE,
    deps: { db: untouchable },
    attemptId: '6f1c1d5e-2a3b-4c4d-8e5f-6a7b8c9d0e1f',
  });

/** Every fixture string a schema or description must never carry (T22, N14). */
const FIXTURE_STRINGS = [
  ...Object.values(FAMILY_PEOPLE).flatMap((p) => [
    p.name,
    ...('shortName' in p ? [p.shortName] : []),
  ]),
  ...Object.values(FAMILY_EVENTS).map((e) => e.title),
  ...Object.values(FAMILY_PROJECTS).flatMap((p) => [p.title, p.summary]),
  ...Object.values(FAMILY_TASKS).map((t) => t.title),
  ...Object.values(FAMILY_NOTES).map((n) => n.body),
  ...Object.values(CANARY).map((c) => c.name),
  "Sam's mum",
  'Board meeting',
  'Parent interviews',
  'dinosaurs',
  'Bins',
  SAM.email,
  ALEX.email,
  '2026',
  'Pacific/Auckland',
];

describe('T23: the registry', () => {
  it('holds exactly the twelve read tools and escalate, in the contract’s order, all of the read class', () => {
    expect([...REGISTRY.keys()]).toEqual([...TOOL_NAMES]);
    for (const e of REGISTRY.values()) expect(e.authority, e.name).toBe('read');
    expect([...REGISTRY.values()].filter((e) => e.kind === 'control').map((e) => e.name)).toEqual([
      'escalate',
    ]);
  });

  it('names propose (M9) and refuses it, and every other class: registering one throws', () => {
    expect(AUTHORITY_CLASSES).toEqual(['read', 'propose']);
    const base = REGISTRY.get('get_today')!;
    for (const authority of ['propose', 'write', 'external', 'READ', ''])
      expect(() => defineRegistry([{ ...base, authority }]), authority).toThrow(RegistryError);
    expect(() => defineRegistry([{ ...base, name: 'delete_task' }])).toThrow(RegistryError);
    expect(() => defineRegistry([base, base])).toThrow(RegistryError);
    expect(() => defineRegistry([{ ...base, kind: 'control' }])).toThrow(RegistryError);
  });

  it('its closed sets are message content v2’s, value for value', () => {
    expect([...TOOL_NAMES]).toEqual([...CONTENT_TOOL_NAMES]);
    expect([...REF_TYPES]).toEqual([...CONTENT_REF_TYPES]);
    expect([...TOOL_ERROR_CODES]).toEqual([...CONTENT_ERROR_CODES]);
    const ref = { type: 'event', id: UUID, at: '2026-10-17T09:00:00+13:00' };
    expect(refSchema.parse(ref)).toEqual(contentRefSchema.parse(ref));
  });

  it('content v2’s trace entry carries refsTruncated only as true, beside at most 50 refs', () => {
    const entry = {
      tool: 'get_tasks',
      ok: true,
      args: {},
      resultCount: 50,
      refs: Array.from({ length: 50 }, () => ({ type: 'task', id: UUID })),
      attemptId: UUID,
    };
    expect(traceEntrySchema.safeParse(entry).success).toBe(true);
    expect(traceEntrySchema.safeParse({ ...entry, refsTruncated: true }).success).toBe(true);
    for (const bad of [false, 'true', 1])
      expect(traceEntrySchema.safeParse({ ...entry, refsTruncated: bad }).success).toBe(false);
    expect(
      traceEntrySchema.safeParse({ ...entry, refs: [...entry.refs, entry.refs[0]] }).success,
    ).toBe(false);
  });

  it('a runner exists only for a user acting through Kev: never the system, never the UI', () => {
    const base = { now: NOW, timeZone: ZONE, attemptId: UUID };
    const user = {
      kind: 'user' as const,
      userId: 'u-sam',
      email: SAM.email,
      channel: 'web' as const,
    };
    const refusal = (make: () => unknown) => {
      try {
        make();
      } catch (e) {
        // A closed code and nothing else: no record, value or detail in its message.
        expect(e).toBeInstanceOf(ContextRefusal);
        expect((e as ContextRefusal).message).toBe((e as ContextRefusal).code);
        return (e as ContextRefusal).code;
      }
      return 'made';
    };
    expect(refusal(() => createToolRunner({ ...base, actor: { ...user, via: 'ui' } }))).toBe(
      'not_kev_actor',
    );
    expect(refusal(() => createToolRunner({ ...base, actor: { ...user, via: 'sync' } }))).toBe(
      'not_kev_actor',
    );
    expect(
      refusal(() =>
        createToolRunner({ ...base, actor: { kind: 'system', via: 'system' } as never }),
      ),
    ).toBe('not_kev_actor');
    expect(
      refusal(() => createToolRunner({ ...base, actor: { kind: 'user', via: 'kev' } as never })),
    ).toBe('made');
    expect(refusal(() => createToolRunner({ ...base, actor: null as never }))).toBe(
      'not_kev_actor',
    );
  });

  it('a runner exists only in the home zone the shared agenda loader reads with', () => {
    const base = { now: NOW, attemptId: UUID, deps: { db: untouchable } };
    const actor = {
      kind: 'user' as const,
      userId: 'u-sam',
      email: SAM.email,
      via: 'kev' as const,
      channel: 'web' as const,
    };
    for (const timeZone of ['Europe/London', 'UTC', 'Pacific/Chatham', '', 'pacific/auckland']) {
      let code = 'made';
      try {
        createToolRunner({ ...base, actor, timeZone });
      } catch (e) {
        expect(e).toBeInstanceOf(ContextRefusal);
        code = (e as ContextRefusal).code;
      }
      expect(code, timeZone).toBe('zone_mismatch');
    }
    expect(() => createToolRunner({ ...base, actor, timeZone: ZONE })).not.toThrow();
  });
});

describe('T22: every tool’s JSON schema', () => {
  const defs = toolDefinitions({ escalate: true });

  it('is static and byte-stable: the committed snapshot, generated twice to the same bytes', () => {
    const text = JSON.stringify(defs);
    expect(JSON.stringify(toolDefinitions({ escalate: true }))).toBe(text);
    // The snapshot is formatted by Prettier; its content must be these bytes exactly.
    if (process.env.KEV_SCHEMA_SNAPSHOT === 'write') writeFileSync(SNAPSHOT, `${text}\n`);
    expect(existsSync(SNAPSHOT)).toBe(true);
    expect(JSON.stringify(JSON.parse(readFileSync(SNAPSHOT, 'utf8')))).toBe(text);
  });

  it('closes every object (additionalProperties: false) and carries no $schema', () => {
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      expect(o.$schema, path).toBeUndefined();
      if (o.type === 'object') expect(o.additionalProperties, path).toBe(false);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    for (const d of defs) {
      expect(d.inputSchema.type, d.name).toBe('object');
      walk(d.inputSchema, d.name);
    }
  });

  it('carries no fixture name, title, date, email or other record value, in schemas or descriptions', () => {
    const text = JSON.stringify(defs);
    for (const s of FIXTURE_STRINGS) expect(text, s).not.toContain(s);
    // Person and record ids are plain uuid strings: no enum of people anywhere.
    for (const d of defs)
      expect(JSON.stringify(d.inputSchema), d.name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('get_context has no sensitivity parameter; no tool takes an actor, user or visibility', () => {
    for (const d of defs) {
      const props = Object.keys((d.inputSchema.properties as Record<string, unknown>) ?? {});
      for (const p of props)
        expect(p, `${d.name}.${p}`).not.toMatch(/sensitiv|actor|user|visib|email|archiv|include/i);
    }
  });

  it('is generated from the input schema that checks every call', () => {
    for (const e of REGISTRY.values())
      expect(jsonSchemaOf(e.input), e.name).toEqual(
        toolDefinitions({ escalate: true }).find((d) => d.name === e.name)!.inputSchema,
      );
  });
});

describe('T24 and N14: the tool list and the stable prefix', () => {
  it('no escalate on deep, and none on fast at 80% of the cap or paused; on fast while open', () => {
    const names = (tier: 'fast' | 'deep', month: 'open' | 'deep_withdrawn' | 'paused') =>
      toolDefinitions({ escalate: offersEscalate(tier, month) }).map((d) => d.name);
    expect(names('fast', 'open')).toContain('escalate');
    expect(names('deep', 'open')).not.toContain('escalate');
    expect(names('fast', 'deep_withdrawn')).not.toContain('escalate');
    expect(names('fast', 'paused')).not.toContain('escalate');
    expect(names('deep', 'open')).toEqual(TOOL_NAMES.filter((n) => n !== 'escalate'));
  });

  it('N14: the stable prefix takes no actor and no date, and is byte-identical every time it is built', () => {
    expect(stablePrefix.length).toBe(1);
    const a = JSON.stringify(stablePrefix({ escalate: true }));
    const b = JSON.stringify(stablePrefix({ escalate: true }));
    expect(a).toBe(b);
    for (const s of FIXTURE_STRINGS) expect(a, s).not.toContain(s);
  });
});

describe('T15: invalid input is refused before any domain call', () => {
  const valid: Record<string, unknown> = {
    get_today: {},
    get_agenda: { from: '2026-10-17', to: '2026-10-18' },
    get_conflicts: { from: '2026-10-15', to: '2026-10-15' },
    get_insights: { surface: 'today' },
    get_tasks: {},
    get_projects: {},
    get_people: {},
    get_context: {},
    get_calendar_health: {},
    get_weather: { from: '2026-10-17', to: '2026-10-18' },
    get_gaps: { from: '2026-10-17', to: '2026-10-17', scope: 'household' },
    search: { query: 'fence' },
    escalate: { reason: 'long_range' },
  };
  const invalid: [string, unknown][] = [
    ['get_today', { extra: 1 }],
    ['get_today', null],
    ['get_today', 'today'],
    ['get_agenda', { from: '2026-10-17' }],
    ['get_agenda', { from: '17/10/2026', to: '2026-10-18' }],
    ['get_agenda', { from: '2026-02-30', to: '2026-10-18' }],
    ['get_agenda', { from: '2026-10-17', to: '2026-10-18', person_ids: [] }],
    ['get_agenda', { from: '2026-10-17', to: '2026-10-18', person_ids: Array(7).fill(UUID) }],
    ['get_agenda', { from: '2026-10-17', to: '2026-10-18', person_ids: ['Milo'] }],
    ['get_agenda', { from: '2026-10-17', to: '2026-10-18', userId: 'u-alex' }],
    ['get_conflicts', { from: '2026-10-15', to: '2026-10-15', person: UUID }],
    ['get_insights', { surface: 'forward_month' }],
    ['get_insights', {}],
    ['get_tasks', { status: 'dropped' }],
    ['get_tasks', { assignee: 'Sam' }],
    ['get_tasks', { assignee: 'me', actor: 'u-alex' }],
    ['get_tasks', { due_before: 'tomorrow' }],
    ['get_projects', { project_id: 'fence' }],
    ['get_projects', { status: 'archived' }],
    ['get_people', { person_id: 42 }],
    ['get_people', { include_archived: true }],
    ['get_context', { include_sensitive: true }],
    ['get_context', { sensitivity: 'sensitive' }],
    ['get_context', { subject_type: 'event' }],
    ['get_calendar_health', { calendar_id: UUID }],
    ['get_weather', { from: '2026-10-17', to: '2026-10-18', lat: -41.29 }],
    ['get_gaps', { from: '2026-10-17', to: '2026-10-17', scope: 'everyone' }],
    ['get_gaps', { from: '2026-10-17', to: '2026-10-17', scope: 'household', min_minutes: 59 }],
    ['get_gaps', { from: '2026-10-17', to: '2026-10-17', scope: 'household', min_minutes: 90.5 }],
    [
      'get_gaps',
      { from: '2026-10-17', to: '2026-10-17', scope: 'household', needs: ['two_people'] },
    ],
    ['get_gaps', { from: '2026-10-17', to: '2026-10-17', scope: 'household', rank: 'best' }],
    ['search', { query: 'f' }],
    ['search', { query: 'x'.repeat(61) }],
    ['search', { query: 'fence', types: ['note'] }],
    ['escalate', { reason: 'because I said so' }],
    ['escalate', {}],
  ];

  it.each(invalid)('%s %j: bad_input, no domain call', async (name, input) => {
    const out = await runner().run(name, input);
    expect(out.kind).toBe('ran');
    if (out.kind !== 'ran') return;
    expect(out.result).toEqual({ ok: false, code: 'bad_input' });
    expect(out.content).toBe('{"error":"bad_input"}');
    expect(out.trace).toMatchObject({ ok: false, code: 'bad_input', resultCount: 0, refs: [] });
    expect(traceEntrySchema.safeParse(out.trace).success).toBe(true);
  });

  it('every tool has a valid example that passes its schema, and an unknown field that does not', () => {
    for (const e of REGISTRY.values()) {
      expect(e.input.safeParse(valid[e.name]).success, e.name).toBe(true);
      expect(
        e.input.safeParse({ ...(valid[e.name] as object), unexpected: true }).success,
        e.name,
      ).toBe(false);
    }
  });

  it('S7 (registry half): an unknown tool name is refused, counted and runs nothing', async () => {
    const r = runner();
    for (const name of [
      'delete_task',
      'send_message',
      'get_today ',
      'GET_TODAY',
      '__proto__',
      'constructor',
    ])
      expect(await r.run(name, {})).toEqual({
        kind: 'unknown_tool',
        result: { ok: false, code: 'bad_input' },
        content: '{"error":"bad_input"}',
      });
    expect(r.unknownRefused).toBe(6);
  });

  it('escalate is the orchestrator’s: valid, it is never run here', async () => {
    const out = await runner().run('escalate', { reason: 'long_range' });
    expect(out.kind === 'ran' && out.result).toEqual({ ok: false, code: 'unavailable' });
    expect(out.kind === 'ran' && out.trace.args).toEqual({ reason: 'long_range' });
  });
});

describe('labelled text and instants', () => {
  it('cuts a labelled string to its cap on code points and says so', () => {
    expect(untrusted('Football', 200)).toEqual({ untrusted_text: 'Football' });
    const long = untrusted('🦕'.repeat(201), 200);
    expect(long.truncated).toBe(true);
    expect(Array.from(long.untrusted_text)).toHaveLength(200);
    expect(untrustedSchema(200).safeParse(long).success).toBe(true);
    expect(untrustedSchema(5).safeParse({ untrusted_text: 'x'.repeat(6) }).success).toBe(false);
    expect(untrustedSchema(5).safeParse({ untrusted_text: 'x', note: 'y' }).success).toBe(false);
  });

  it('writes instants in the home zone with its offset, across both DST changes', () => {
    expect(homeInstant(new Date('2026-10-16T20:00:00Z'), ZONE)).toBe('2026-10-17T09:00:00+13:00');
    // NZST before 27 September 2026 at 02:00, NZDT after (02:00 → 03:00).
    expect(homeInstant(new Date('2026-09-26T13:59:00Z'), ZONE)).toBe('2026-09-27T01:59:00+12:00');
    expect(homeInstant(new Date('2026-09-26T14:00:00Z'), ZONE)).toBe('2026-09-27T03:00:00+13:00');
    // NZDT ends 5 April 2026 at 03:00 (→ 02:00): the repeated hour keeps each offset.
    expect(homeInstant(new Date('2026-04-04T13:30:00Z'), ZONE)).toBe('2026-04-05T02:30:00+13:00');
    expect(homeInstant(new Date('2026-04-04T14:30:00Z'), ZONE)).toBe('2026-04-05T02:30:00+12:00');
    expect(
      refSchema.safeParse({ type: 'event', id: UUID, at: homeInstant(NOW, ZONE) }).success,
    ).toBe(true);
  });

  it('bounds lists at 50 items', () => {
    expect(MAX_ITEMS).toBe(50);
  });
});
