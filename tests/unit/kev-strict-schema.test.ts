import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { okStream, startStub, type Handler, type Stub } from './kev-stub';

// The provider's strict JSON Schema subset (M8 live verification #1,
// 2026-10-17; ADR 0012 §50). Run #1's five tool-carrying probes were
// refused at G22's preflight count with HTTP 400 (the owner read the
// report): Kev's tool schemas, sent `strict: true`, carried keywords the
// strict subset does not take (`get_agenda` maxItems, `get_gaps`
// minimum/maximum/maxItems, `search` minLength/maxLength). Every schema Kev
// sends is now checked against the documented subset, the complexity
// limits are checked across a whole request, the run-#1 schemas are
// reproduced, and a stub that refuses what the provider refuses shows the
// preflight failing before the fix and passing after it. No test reaches
// the network.

const liveSet = new WeakSet<object>();
vi.mock('@/domain/kev-bookkeeping/service', () => ({
  isLiveReservation: (r: unknown) => typeof r === 'object' && r !== null && liveSet.has(r),
}));

const { REGISTRY, jsonSchemaOf, toolDefinitions } = await import('@/kev/tools/registry');
const { ANSWER_JSON_SCHEMA, ANSWER_TOOL } = await import('@/kev/answer/schema');
const { STRICT_LIMITS, strictComplexity, strictSchemaViolations, toStrictSubset } =
  await import('@/kev/tools/strict-schema');
const { TurnBudget } = await import('@/kev/budget');
const { TIERS } = await import('@/kev/config');
const { attemptReservation } = await import('@/kev/router');
const { createProviderFetchForTests } = await import('@/kev/providers/fetch');
const { buildAnthropicProvider } = await import('@/kev/providers/anthropic');
const { ProviderError } = await import('@/kev/providers/types');

const KEY = 'test-only-not-a-key';
const ALL_TOOLS = () => toolDefinitions({ escalate: true });

describe('every schema Kev sends is inside the strict subset', () => {
  it('every registered tool, with and without escalate', () => {
    for (const escalate of [true, false])
      for (const d of toolDefinitions({ escalate }))
        expect(strictSchemaViolations(d.inputSchema), d.name).toEqual([]);
    // Every registry entry is covered (none left out of the tool list).
    expect(
      ALL_TOOLS()
        .map((d) => d.name)
        .sort(),
    ).toEqual([...REGISTRY.keys()].sort());
  });

  it('the answer schema (structured output) and the strict answer tool', () => {
    expect(strictSchemaViolations(ANSWER_JSON_SCHEMA)).toEqual([]);
    expect(strictSchemaViolations(ANSWER_TOOL.inputSchema)).toEqual([]);
  });

  it('each request Kev can send stays within the complexity limits: every tool with the answer as structured output, or with the strict answer tool', () => {
    const tools = ALL_TOOLS().map((d) => d.inputSchema);
    // The format path: the tools plus output_config.format (contract §5.1).
    const format = strictComplexity([...tools, ANSWER_JSON_SCHEMA]);
    // The tool path (G7's fallback): the tools plus the strict `answer` tool.
    expect(tools.length + 1).toBeLessThanOrEqual(STRICT_LIMITS.strictTools);
    const tool = strictComplexity([...tools, ANSWER_TOOL.inputSchema]);
    for (const c of [format, tool]) {
      expect(c.optionalParameters).toBeLessThanOrEqual(STRICT_LIMITS.optionalParameters);
      expect(c.unionParameters).toBeLessThanOrEqual(STRICT_LIMITS.unionParameters);
    }
    // Today's totals, so growth toward a limit is a visible change.
    expect(format).toEqual({ optionalParameters: 12, unionParameters: 11 });
  });
});

describe('run #1 reproduced: the generated schemas carried unsupported keywords', () => {
  const raw = (name: string) =>
    z.toJSONSchema(REGISTRY.get(name)!.input, { io: 'input', unrepresentable: 'throw' });

  it('Zod’s own JSON schemas for get_agenda, get_gaps and search are outside the subset; HOME’s copies are not', () => {
    expect(strictSchemaViolations(raw('get_agenda'))).toEqual([
      '$.properties.person_ids: maxItems is not supported',
    ]);
    expect(strictSchemaViolations(raw('get_gaps'))).toEqual([
      '$.properties.min_minutes: minimum is not supported',
      '$.properties.min_minutes: maximum is not supported',
      '$.properties.needs: maxItems is not supported',
    ]);
    expect(strictSchemaViolations(raw('search'))).toEqual([
      '$.properties.query: minLength is not supported',
      '$.properties.query: maxLength is not supported',
    ]);
    for (const n of ['get_agenda', 'get_gaps', 'search'])
      expect(strictSchemaViolations(jsonSchemaOf(REGISTRY.get(n)!.input)), n).toEqual([]);
  });

  it('only the unsupported keywords go: names, types, required, formats, enums and minItems 1 stay', () => {
    const agenda = jsonSchemaOf(REGISTRY.get('get_agenda')!.input) as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    expect(Object.keys(agenda.properties)).toEqual(['from', 'to', 'person_ids']);
    expect(agenda.required).toEqual(['from', 'to']);
    expect(agenda.properties.person_ids).toEqual({
      minItems: 1,
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    });
    const gaps = jsonSchemaOf(REGISTRY.get('get_gaps')!.input) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(gaps.properties.min_minutes).toEqual({ type: 'integer' });
    expect(gaps.properties.needs).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['dry_weather', 'daylight'] },
    });
    expect(jsonSchemaOf(REGISTRY.get('search')!.input)).toMatchObject({
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('HOME’s Zod validation still enforces every limit the provider’s copy no longer carries', () => {
    const input = (n: string) => REGISTRY.get(n)!.input;
    const uuids = (k: number) =>
      Array.from({ length: k }, (_, i) => `7d2b1e04-9f53-4c1a-8e8a-2f3d4c5b6a7${i}`);
    expect(
      input('get_agenda').safeParse({ from: '2026-10-17', to: '2026-10-18', person_ids: uuids(7) })
        .success,
    ).toBe(false);
    expect(
      input('get_agenda').safeParse({ from: '2026-10-17', to: '2026-10-18', person_ids: [] })
        .success,
    ).toBe(false);
    const gaps = input('get_gaps');
    const base = { from: '2026-10-17', to: '2026-10-18' };
    expect(gaps.safeParse({ ...base, min_minutes: 59 }).success).toBe(false);
    expect(gaps.safeParse({ ...base, min_minutes: 721 }).success).toBe(false);
    expect(
      gaps.safeParse({ ...base, needs: ['dry_weather', 'daylight', 'dry_weather'] }).success,
    ).toBe(false);
    expect(input('search').safeParse({ query: 'a' }).success).toBe(false);
    expect(input('search').safeParse({ query: 'x'.repeat(61) }).success).toBe(false);
    expect(input('search').safeParse({ query: 'fence' }).success).toBe(true);
  });
});

describe('toStrictSubset and strictSchemaViolations', () => {
  it('a property named like a keyword is a name, never a keyword', () => {
    const s = {
      type: 'object',
      properties: { maximum: { type: 'integer', maximum: 3 }, else: { type: 'string' } },
      required: ['maximum', 'else'],
      additionalProperties: false,
    };
    expect(strictSchemaViolations(s)).toEqual(['$.properties.maximum: maximum is not supported']);
    expect(toStrictSubset(s)).toEqual({
      type: 'object',
      properties: { maximum: { type: 'integer' }, else: { type: 'string' } },
      required: ['maximum', 'else'],
      additionalProperties: false,
    });
  });

  it('minItems 0 and 1 stay; above 1 goes; every other unsupported keyword goes; nothing else changes', () => {
    const arr = (minItems: number) => ({ type: 'array', minItems, items: { type: 'string' } });
    expect(toStrictSubset(arr(0))).toEqual(arr(0));
    expect(toStrictSubset(arr(1))).toEqual(arr(1));
    expect(toStrictSubset(arr(2))).toEqual({ type: 'array', items: { type: 'string' } });
    const kept = {
      type: 'object',
      description: 'd',
      properties: {
        a: { anyOf: [{ type: 'string', enum: ['x'] }, { type: 'null' }] },
        b: { type: 'string', format: 'date', const: '2026-10-17' },
      },
      required: ['a', 'b'],
      additionalProperties: false,
    };
    expect(toStrictSubset(kept)).toEqual(kept);
    expect(strictSchemaViolations(kept)).toEqual([]);
    expect(
      toStrictSubset({
        type: 'number',
        exclusiveMinimum: 0,
        exclusiveMaximum: 9,
        multipleOf: 2,
      }),
    ).toEqual({ type: 'number' });
  });

  it('reports an open object, a non-false additionalProperties and an unsupported format', () => {
    expect(strictSchemaViolations({ type: 'object', properties: {} })).toEqual([
      '$: an object needs additionalProperties: false',
    ]);
    expect(
      strictSchemaViolations({
        type: 'object',
        properties: { f: { type: 'string', format: 'regex' } },
        additionalProperties: true,
      }),
    ).toEqual([
      '$.properties.f: format regex',
      '$: additionalProperties must be false',
      '$: an object needs additionalProperties: false',
    ]);
  });
});

describe('the preflight against a stub that refuses what the provider refuses (run #1 on the wire)', () => {
  let stub: Stub;
  beforeAll(async () => {
    stub = await startStub();
  });
  afterAll(() => stub.close());
  beforeEach(() => {
    stub.seen.length = 0;
    stub.queue.length = 0;
    stub.counts.length = 0;
    stub.countQueue.length = 0;
  });

  /** The documented behaviour: a strict schema outside the subset is a 400 invalid_request_error. */
  const strictCount: Handler = (_req, res, body) => {
    const sent = JSON.parse(body) as {
      tools?: { input_schema: unknown }[];
      output_config?: { format?: { schema?: unknown } };
    };
    const schemas = [
      ...(sent.tools ?? []).map((t) => t.input_schema),
      ...(sent.output_config?.format?.schema ? [sent.output_config.format.schema] : []),
    ];
    if (schemas.some((s) => strictSchemaViolations(s).length > 0)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'synthetic: schema not supported' },
        }),
      );
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: 4_321 }));
  };

  const budget = () => {
    const r = Object.freeze({
      reservationId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      userId: 'u',
      tier: 'fast' as const,
      reservedUsdMicros: attemptReservation('fast'),
    });
    liveSet.add(r);
    return TurnBudget.open(r, { deadline: Date.now() + 55_000 });
  };
  const provider = () =>
    buildAnthropicProvider(KEY, createProviderFetchForTests(KEY, { stubPort: stub.port }));
  const request = (
    tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[],
  ) =>
    Object.freeze({
      tier: 'fast' as const,
      system: 'You are a test.',
      tools: Object.freeze([...tools]),
      toolChoice: 'auto' as const,
      messages: Object.freeze([
        Object.freeze({
          role: 'user' as const,
          content: Object.freeze([{ type: 'text' as const, text: 'Synthetic.' }]),
        }),
      ]),
      outputFormat: ANSWER_JSON_SCHEMA,
    });

  it('before: a run-#1 schema is refused at the count with 400, classified bad_response, and no model call is made', async () => {
    stub.countQueue.push(strictCount);
    const before = ALL_TOOLS().map((d) =>
      d.name === 'search'
        ? {
            ...d,
            inputSchema: z.toJSONSchema(REGISTRY.get('search')!.input, {
              io: 'input',
            }) as Record<string, unknown>,
          }
        : d,
    );
    const b = budget();
    let err: unknown;
    try {
      await provider().run(request(before) as never, { budget: b });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as InstanceType<typeof ProviderError>).code).toBe('bad_response');
    expect((err as InstanceType<typeof ProviderError>).detail.preflight).toBe('failed');
    expect(stub.counts).toHaveLength(1);
    expect(stub.seen).toHaveLength(0);
    expect(b.modelCalls).toBe(0);
  });

  it('after: Kev’s real tools and answer schema pass the count, and the call is made', async () => {
    stub.countQueue.push(strictCount);
    stub.queue.push(okStream(TIERS.fast.model.id));
    const b = budget();
    const r = await provider().run(request(ALL_TOOLS()) as never, { budget: b });
    expect(r.countedInputTokens).toBe(4_321);
    expect(stub.counts).toHaveLength(1);
    expect(stub.seen).toHaveLength(1);
    // The bytes counted are the bytes sent: the same tools and format.
    const counted = JSON.parse(stub.counts[0]!.body) as Record<string, unknown>;
    const sent = JSON.parse(stub.seen[0]!.body) as Record<string, unknown>;
    expect(counted.tools).toEqual(sent.tools);
    expect(counted.output_config).toEqual(sent.output_config);
  });
});
