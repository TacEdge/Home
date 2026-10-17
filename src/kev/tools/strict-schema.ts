import 'server-only';

// The provider's strict JSON Schema subset (M8 live verification #1, 2026-10-17;
// ADR 0012 §50). Kev's tools are sent with `strict: true` and its answer as
// `output_config.format`; both take only a subset of JSON Schema, and a
// schema outside it is refused with HTTP 400 on the Messages API and on the
// token-counting endpoint (G22's preflight), which is how run #1 failed.
// Source: the provider's Structured outputs page, "JSON Schema limitations"
// (verified 2026-10-17): numerical constraints (`minimum`, `maximum`,
// `multipleOf`), string constraints (`minLength`, `maxLength`) and array
// constraints beyond `minItems` of 0 or 1 are not supported;
// `additionalProperties` must be `false` on every object; string formats
// are a closed list. Complexity limits across all strict schemas in one
// request: 20 strict tools, 24 optional parameters, 16 parameters with a
// union type.
//
// Only the provider's copy of a schema loses these keywords: the Zod schema
// it was generated from still checks every call, so no limit HOME enforces
// is relaxed (a value outside one is refused as `bad_input`).

/** Validation keywords the strict subset does not take. */
const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'prefixItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'not',
  'if',
  'then',
  'else',
]);

/** The string formats the strict subset supports. */
const SUPPORTED_FORMATS: ReadonlySet<string> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** The complexity limits across every strict schema in one request. */
export const STRICT_LIMITS = Object.freeze({
  strictTools: 20,
  optionalParameters: 24,
  unionParameters: 16,
});

const isObject = (n: unknown): n is Record<string, unknown> =>
  n !== null && typeof n === 'object' && !Array.isArray(n);

/** Whether `minItems` is one the subset takes (0 or 1). */
const supportedMinItems = (v: unknown) => v === 0 || v === 1;

/**
 * The schema with only the unsupported validation keywords removed:
 * types, properties and their names, `required`, `additionalProperties`,
 * `enum`, `const`, `anyOf`, `format`, `description` and a `minItems` of 0
 * or 1 are kept exactly. Names under `properties` are property names, never
 * keywords, so a property called `maximum` is kept.
 */
export function toStrictSubset(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSubset);
  if (!isObject(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    if (k === 'minItems' && !supportedMinItems(v)) continue;
    if ((k === 'properties' || k === '$defs' || k === 'definitions') && isObject(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, toStrictSubset(s)]));
      continue;
    }
    out[k] = toStrictSubset(v);
  }
  return out;
}

/**
 * Every way a schema leaves the strict subset, as `path: problem` lines
 * (empty when it is inside): an unsupported keyword, a `minItems` above 1,
 * an object without `additionalProperties: false`, an unsupported format.
 */
export function strictSchemaViolations(schema: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => out.push(...strictSchemaViolations(s, `${path}[${i}]`)));
    return out;
  }
  if (!isObject(schema)) return out;
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) out.push(`${path}: ${k} is not supported`);
    if (k === 'minItems' && !supportedMinItems(v)) out.push(`${path}: minItems ${String(v)}`);
    if (k === 'format' && (typeof v !== 'string' || !SUPPORTED_FORMATS.has(v)))
      out.push(`${path}: format ${String(v)}`);
    if (k === 'additionalProperties' && v !== false)
      out.push(`${path}: additionalProperties must be false`);
    if ((k === 'properties' || k === '$defs' || k === 'definitions') && isObject(v)) {
      for (const [n, s] of Object.entries(v))
        out.push(...strictSchemaViolations(s, `${path}.${k}.${n}`));
      continue;
    }
    if (isObject(v) || Array.isArray(v)) out.push(...strictSchemaViolations(v, `${path}.${k}`));
  }
  const objectTyped = schema.type === 'object' || isObject(schema.properties);
  if (objectTyped && schema.additionalProperties !== false)
    out.push(`${path}: an object needs additionalProperties: false`);
  return out;
}

/**
 * The complexity totals the limits count, over a request's strict schemas:
 * optional parameters (a property its object does not list in `required`)
 * and parameters with a union type (`anyOf`, or a `type` array).
 */
export function strictComplexity(schemas: readonly unknown[]): {
  optionalParameters: number;
  unionParameters: number;
} {
  let optional = 0;
  let union = 0;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObject(n)) return;
    if (isObject(n.properties)) {
      const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
      for (const [name, p] of Object.entries(n.properties)) {
        if (!required.has(name)) optional += 1;
        if (isObject(p) && (Array.isArray(p.anyOf) || Array.isArray(p.type))) union += 1;
      }
    }
    for (const v of Object.values(n)) walk(v);
  };
  schemas.forEach(walk);
  return { optionalParameters: optional, unionParameters: union };
}
