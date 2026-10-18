import 'server-only';
import type { ScriptEntry, ScriptStep } from '../providers/scripted';
import type { NeutralToolResult, ProviderRequest } from '../providers/types';
import type { Ref } from '../tools/types';
import type { FactSpec, FixtureKey, RefSpec, ScopeSpec, StepSpec, TurnSpec } from './types';

// Layer 2's half of a scenario (M8 contract §12.1): its symbolic script made
// into the scripted provider's steps, with fixture ids and records found in
// the call's own tool results filled in. Local and CI only, with the
// scripted provider (which refuses to exist anywhere deployed).

export type FixtureIds = Readonly<Record<FixtureKey, string>>;

/** The tool results of a request's last message, parsed, in order. */
export function toolResultsOf(req: ProviderRequest): unknown[] {
  const m = req.messages.at(-1);
  if (!m || m.role !== 'user' || !('content' in m)) return [];
  return m.content
    .filter((b): b is NeutralToolResult => b.type === 'tool_result')
    .map((b) => JSON.parse(b.content) as unknown);
}

/** Every tool result of the request (the attempt's reads so far), newest last. */
function allResults(req: ProviderRequest): unknown[] {
  const out: unknown[] = [];
  for (const m of req.messages)
    if (m.role === 'user' && 'content' in m)
      for (const b of m.content)
        if (b.type === 'tool_result') out.push(JSON.parse((b as NeutralToolResult).content));
  return out;
}

function findRef(node: unknown, needle: string, type: string | undefined): Ref | null {
  if (Array.isArray(node)) {
    for (const v of node) {
      const r = findRef(v, needle, type);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;
  const o = node as Record<string, unknown>;
  const ref = o.ref as Ref | undefined;
  if (
    ref &&
    typeof ref === 'object' &&
    typeof ref.id === 'string' &&
    (type === undefined || ref.type === type) &&
    JSON.stringify(o).includes(needle)
  )
    return ref;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'ref') continue;
    const r = findRef(v, needle, type);
    if (r) return r;
  }
  return null;
}

export function resolveRef(spec: RefSpec, ids: FixtureIds, req?: ProviderRequest): Ref {
  if ('fixture' in spec) {
    const type =
      spec.fixture === 'note'
        ? 'note'
        : ['fence', 'garage', 'shed', 'garden'].includes(spec.fixture)
          ? 'project'
          : ['paint', 'light'].includes(spec.fixture)
            ? 'task'
            : ['dinosaurs', 'bins'].includes(spec.fixture)
              ? 'context'
              : ['sam', 'alex', 'milo', 'isla', 'nana'].includes(spec.fixture)
                ? 'person'
                : 'event';
    return spec.at ? { type, id: ids[spec.fixture], at: spec.at } : { type, id: ids[spec.fixture] };
  }
  if ('forecast' in spec) return { type: 'forecast', id: `forecast:${spec.forecast}` };
  const found = req ? findRef(allResults(req), spec.find, spec.type) : null;
  // A record the script expected and the reads did not return: cited as is,
  // so the checker (cite.unknown) shows the scenario is wrong.
  return found ?? { type: (spec.type ?? 'event') as Ref['type'], id: 'not-returned' };
}

const fill = (input: Record<string, unknown>, ids: FixtureIds): unknown =>
  JSON.parse(
    JSON.stringify(input, (_k, v) =>
      typeof v === 'string' && v.startsWith('$') && v.slice(1) in ids
        ? ids[v.slice(1) as FixtureKey]
        : v,
    ),
  );

const wire = (r: Ref) => ({ type: r.type, id: r.id, at: r.at ?? null });

function step(spec: StepSpec, ids: FixtureIds): ScriptEntry {
  if ('tools' in spec)
    return {
      kind: 'answer',
      toolUses: spec.tools.map(([name, input]) => ({ name, input: fill(input, ids) })),
    };
  if ('decline' in spec)
    return {
      kind: 'answer',
      text: [JSON.stringify({ lead: null, facts: [], view: null, decline: spec.decline })],
    };
  if ('text' in spec) return { kind: 'answer', text: [spec.text] };
  if ('refusal' in spec) return { kind: 'refusal' };
  const p = spec.plan;
  const scope = (sc: ScopeSpec) => ({
    of: sc.of,
    from: sc.from ?? null,
    to: sc.to ?? null,
    people: (sc.people ?? []).map((k) => ids[k]),
    part: sc.part ?? null,
    else: sc.else ?? false,
  });
  const fact = (f: FactSpec, req: ProviderRequest) => {
    if ('record' in f) {
      const r = resolveRef(f.record, ids, req);
      return { kind: r.type, ref: wire(r), show: f.show ?? [], scope: null };
    }
    if ('absence' in f) return { kind: 'absence', ref: null, show: [], scope: scope(f.absence) };
    return { kind: 'count', ref: null, show: [], scope: scope(f.count) };
  };
  return (req: ProviderRequest): ScriptStep => ({
    kind: 'answer',
    text: [
      JSON.stringify({
        lead: p.words ?? p.lead,
        facts: p.facts.map((f) => fact(f, req)),
        view: p.view ?? null,
        decline: null,
      }),
    ],
  });
}

/** A turn's script for the scripted provider. */
export function scriptFor(turn: TurnSpec, ids: FixtureIds): ScriptEntry[] {
  return turn.script.map((s) => step(s, ids));
}
