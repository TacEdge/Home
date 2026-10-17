import { describe, expect, it } from 'vitest';
import {
  detailOfMessage,
  diagnosticLine,
  MAX_MESSAGE_SCAN,
  MAX_PATHS,
  MAX_SEGMENTS,
  PATH_ROOTS,
  PATH_SEGMENTS,
  PROVIDER_ERROR_TYPES,
  providerDiagnostic,
  providerErrorType,
  providerMessageOf,
  schemaNamesOf,
  SIGNAL_CODES,
  validRequestId,
} from '@/kev/providers/diagnostics';

// Provider error diagnostics (ADR 0012 §52): the structural fields every
// failed call keeps, and the probe path's recognised detail of a provider
// message. Synthetic strings only; the canaries stand for a provider key, a
// family's question and arbitrary provider text.

const KEY_CANARY = 'sk-ant-api03-CANARYkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-BBBBBB';
const PROMPT_CANARY = 'Whats on for the Harbourfamily canaryprompt Saturday';
const TEXT_CANARY = 'zebracanarytext';
const CANARIES = [
  KEY_CANARY,
  'CANARYkey',
  PROMPT_CANARY,
  'Harbourfamily',
  'canaryprompt',
  TEXT_CANARY,
];
const NAMES = schemaNamesOf({
  tools: [
    {
      name: 'get_tasks',
      input_schema: {
        type: 'object',
        properties: { assignee: { anyOf: [{ type: 'string' }] }, status: { type: 'string' } },
      },
    },
  ],
  output_config: { format: { type: 'json_schema', schema: { properties: { lead: {} } } } },
});

describe('the structural diagnostic (every call, production included)', () => {
  it('keeps a documented category, marks any other string unrecognised, and drops the rest', () => {
    for (const t of PROVIDER_ERROR_TYPES) expect(providerErrorType(t)).toBe(t);
    for (const t of ['invalid_request_error ', 'Invalid_Request_Error', `x ${KEY_CANARY}`, ''])
      expect(providerErrorType(t), t).toBe('unrecognised');
    for (const t of [undefined, null, 400, {}, ['invalid_request_error']])
      expect(providerErrorType(t)).toBeNull();
  });

  it('keeps a request id only in the provider’s shape, bounded', () => {
    for (const id of ['req_011CSHoEeqs5C35K2UUqR7Fy', 'req_ABCDEFGH', `req_${'a'.repeat(64)}`])
      expect(validRequestId(id), id).toBe(id);
    for (const id of [
      'req_short',
      `req_${'a'.repeat(65)}`,
      'req_synthetic_1',
      'REQ_011CSHoEeqs5C35K2UUqR7Fy',
      ' req_011CSHoEeqs5C35K2UUqR7Fy',
      'req_011CSHoEeqs5C35K2UUqR7Fy\n',
      `req_${TEXT_CANARY} ${PROMPT_CANARY}`,
      KEY_CANARY,
      '',
    ])
      expect(validRequestId(id), id).toBeNull();
    for (const id of [undefined, null, 12345678, {}]) expect(validRequestId(id)).toBeNull();
  });

  it('takes the status, the body’s category and request id (else the header’s), and never the message', () => {
    const body = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `${TEXT_CANARY} ${KEY_CANARY} ${PROMPT_CANARY}`,
      },
      request_id: 'req_011CSHoEeqs5C35K2UUqR7Fy',
    };
    const d = providerDiagnostic({ status: 400, body, headerRequestId: 'req_HEADER0001' });
    expect(d).toEqual({
      status: 400,
      type: 'invalid_request_error',
      requestId: 'req_011CSHoEeqs5C35K2UUqR7Fy',
    });
    const text = JSON.stringify(d);
    for (const c of CANARIES) expect(text).not.toContain(c);
    // The header's id when the body has none, or one in another shape.
    expect(
      providerDiagnostic({
        status: 400,
        body: { ...body, request_id: 'bad id' },
        headerRequestId: 'req_HEADER0001',
      }).requestId,
    ).toBe('req_HEADER0001');
    // Neither in the provider's shape: none.
    expect(
      providerDiagnostic({ status: 400, body: { ...body, request_id: 7 }, headerRequestId: 'nope' })
        .requestId,
    ).toBeNull();
  });

  it('a malformed body or status leaves only what is well formed', () => {
    for (const body of [undefined, null, 'text body', [], { error: 'x' }, { error: { type: 5 } }])
      expect(providerDiagnostic({ status: 400, body, headerRequestId: null })).toEqual({
        status: 400,
        type: null,
        requestId: null,
      });
    for (const status of [undefined, null, 200, 399, 600, 400.5, '400'])
      expect(
        providerDiagnostic({ status, body: null, headerRequestId: null }).status,
        String(status),
      ).toBeNull();
    expect(providerDiagnostic({ status: 529, body: null, headerRequestId: null }).status).toBe(529);
  });
});

describe('the probe path’s message detail: recognised paths and signals, never text', () => {
  it('keeps a documented schema refusal as its path and signals', () => {
    const d = detailOfMessage(
      'tools.4.custom.input_schema: Schema is too complex for compilation',
      NAMES,
    )!;
    expect(d.paths).toEqual(['tools.4.custom.input_schema']);
    expect(d.signals).toEqual(
      expect.arrayContaining(['schema_too_complex', 'compilation', 'schema']),
    );
    expect(d.chars).toBe(66);
  });

  it('keeps HOME’s own schema names, the API’s field names and keywords; anything else is *', () => {
    const d = detailOfMessage(
      `tools.2.custom.input_schema.properties.assignee.anyOf.0: 'const' is not supported; ` +
        `output_config.format.schema.properties.lead: invalid; tools.0.custom.input_schema.properties.${TEXT_CANARY}.minItems`,
      NAMES,
    )!;
    expect(d.paths).toEqual([
      'tools.2.custom.input_schema.properties.assignee.anyOf.0',
      'output_config.format.schema.properties.lead',
      'tools.0.custom.input_schema.properties.*.minItems',
    ]);
    expect(d.signals).toEqual(
      expect.arrayContaining([
        'not_supported',
        'invalid',
        'keyword:const',
        'keyword:anyOf',
        'keyword:minItems',
      ]),
    );
  });

  it('a path not under a request field is not a path; neither is a bare word', () => {
    const d = detailOfMessage(
      'see docs.anthropic.com and example.test; model does not exist; messages must alternate',
      NAMES,
    )!;
    expect(d.paths).toEqual([]);
  });

  it('a secret, a prompt or provider free text never comes out, wherever it sits', () => {
    const messages = [
      `${KEY_CANARY}`,
      `messages.0.content.0.text: ${PROMPT_CANARY}`,
      `messages.0.content.0.${PROMPT_CANARY.replace(/ /g, '.')}`,
      `tools.0.${KEY_CANARY}.input_schema`,
      `tools.0.custom.input_schema.properties.${TEXT_CANARY}: ${TEXT_CANARY}`,
      `system.0.text.${TEXT_CANARY}.${TEXT_CANARY}`,
      `"${PROMPT_CANARY}" is not valid under any of the given schemas (${KEY_CANARY})`,
    ];
    for (const m of messages) {
      const text =
        JSON.stringify(detailOfMessage(m, NAMES)) +
        diagnosticLine(
          { status: 400, type: 'invalid_request_error', requestId: null },
          detailOfMessage(m, NAMES),
        );
      for (const c of CANARIES) expect(text, m).not.toContain(c);
    }
  });

  it('every kept segment is an index, *, a request field, a fixed word or HOME’s own name (fuzzed)', () => {
    // Deterministic pseudo-random messages mixing vocabulary, canaries and noise.
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const words = [
      ...PATH_ROOTS,
      ...[...PATH_SEGMENTS].slice(0, 20),
      'assignee',
      '0',
      '17',
      TEXT_CANARY,
      'canaryprompt',
      'CANARYkey',
      'sk-ant',
      'Harbourfamily',
      'é',
      '$ref',
    ];
    const seps = ['.', '.', '.', ' ', ': ', ', ', '..', '\n'];
    const allowed = (s: string) =>
      /^(?:0|[1-9][0-9]{0,3})$/.test(s) ||
      s === '*' ||
      PATH_ROOTS.has(s) ||
      PATH_SEGMENTS.has(s) ||
      NAMES.has(s);
    for (let i = 0; i < 2_000; i++) {
      let m = '';
      const n = 1 + Math.floor(rand() * 30);
      for (let j = 0; j < n; j++)
        m += words[Math.floor(rand() * words.length)]! + seps[Math.floor(rand() * seps.length)]!;
      const d = detailOfMessage(m, NAMES)!;
      for (const p of d.paths)
        for (const s of p.split('.')) expect(allowed(s), `${s} in ${m}`).toBe(true);
      for (const s of d.signals) expect(SIGNAL_CODES).toContain(s);
      const text = JSON.stringify(d);
      for (const c of [TEXT_CANARY, 'canaryprompt', 'CANARYkey', 'Harbourfamily', 'sk-ant'])
        expect(text).not.toContain(c);
    }
  });

  it('a malformed message is no detail; an oversized one is read only so far, and bounded', () => {
    for (const m of [undefined, null, 42, {}, ['tools.0.custom'], Buffer.from('tools.0.custom')])
      expect(detailOfMessage(m, NAMES)).toBeNull();
    expect(detailOfMessage('', NAMES)).toEqual({ paths: [], signals: [], chars: 0 });
    const late = `${'x'.repeat(MAX_MESSAGE_SCAN)} tools.1.custom.input_schema too complex`;
    expect(detailOfMessage(late, NAMES)).toMatchObject({ paths: [], signals: [] });
    const huge = 'y'.repeat(1_000_000);
    expect(detailOfMessage(huge, NAMES)!.chars).toBe(100_000);
    const many = Array.from({ length: 50 }, (_, i) => `tools.${i}.custom`).join(' ');
    expect(detailOfMessage(many, NAMES)!.paths).toHaveLength(MAX_PATHS);
    const deep = `tools.${Array.from({ length: 40 }, () => 'items').join('.')}`;
    expect(detailOfMessage(deep, NAMES)!.paths[0]!.split('.')).toHaveLength(MAX_SEGMENTS);
    const long = `tools.0.custom.input_schema.properties.${'a'.repeat(41)}`;
    expect(detailOfMessage(long, new Set(['a'.repeat(41)]))!.paths).toEqual([
      'tools.0.custom.input_schema.properties.*',
    ]);
  });

  it('the message is read from the provider’s body only', () => {
    expect(providerMessageOf({ type: 'error', error: { type: 'x', message: 'm' } })).toBe('m');
    for (const b of [undefined, null, 'm', { message: 'm' }, { error: 'm' }])
      expect(providerMessageOf(b)).toBeUndefined();
  });

  it('HOME’s own names: tool names and every property name it sent, nothing else', () => {
    expect([...NAMES].sort()).toEqual(['assignee', 'get_tasks', 'lead', 'status']);
    expect(schemaNamesOf({})).toEqual(new Set());
  });

  it('one line: structural fields, recognised detail, the message’s length and nothing of it', () => {
    const d = detailOfMessage(`tools.3.custom.input_schema: too complex ${TEXT_CANARY}`, NAMES);
    const line = diagnosticLine(
      { status: 400, type: 'invalid_request_error', requestId: 'req_011CSHoEeqs5C35K2UUqR7Fy' },
      d,
    );
    expect(line).toBe(
      'status 400; type invalid_request_error; request-id req_011CSHoEeqs5C35K2UUqR7Fy; ' +
        'paths tools.3.custom.input_schema; signals schema_too_complex schema; message 56 chars (not kept)',
    );
    expect(line).not.toContain(TEXT_CANARY);
    expect(diagnosticLine({ status: null, type: null, requestId: null }, null)).toBe(
      'status —; type —; request-id —',
    );
  });
});
