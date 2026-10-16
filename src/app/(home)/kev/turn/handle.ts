import 'server-only';
import { kevConfig } from '@/lib/env';
import { log } from '@/lib/log';
import { ERROR_TEXT, ESCALATED_TEXT, WORKING_TEXT } from '@/kev/answer/language';
import { handle, type KevDeps, type KevEvent, type KevRequest } from '@/kev/orchestrator';
import type { KevProvider } from '@/kev/providers/types';
import type { UserActor } from '@/trust/actor';

// Kev's web channel adapter (M8 contract §4.2, §9.6, §11.4; D17; ADR 0012
// §33; CLAUDE.md rule 12): POST /kev/turn, as one function the route file
// wraps (so it can be tested with the session and the time source given).
// It knows HTTP and the event stream's wire format and nothing of Kev's
// reasoning; Kev knows nothing of HTTP.
//
// - Same origin (as /weather/refresh), then a body of at most 8 KiB, then
//   the signed-in, allowlisted adult; then Kev on, before any read.
// - With JavaScript (a JSON body, `Accept: text/event-stream`): Server-Sent
//   Events. Only code-approved text crosses: `started`; each `working` line
//   (HOME's fixed string for the tool, never the model's); `escalated`
//   ("Give me a moment…"); then exactly one outcome event, after the answer
//   checker has passed it and it is stored: `answer`, `declined`, `fallback`
//   or `refused` with the stored lead and rendered blocks, or `error` with
//   HOME's line. Never a tool's arguments or result, a ref, a trace, a model
//   or provider name, a provider's body or a token count. Kev's `say`,
//   `detail` and `cite` are held until `done`, so nothing of an answer
//   reaches the browser before the whole turn has passed (U3).
// - Without JavaScript (a form post): the same turn, run to completion,
//   then 303 to /kev, which renders the stored conversation. A turn that
//   ended in an error carries the error's closed code (never words) and
//   when it was said, so the page says it once, not on a later visit.
// - The turn is never tied to the connection (G4): it runs to completion,
//   settles and records whether or not anyone is still listening, kept alive
//   past the response with `after()`, and writes to a closed stream are
//   ignored. Cancellation is never enabled for this route.
// - Nothing is logged here: the orchestrator's one structural `kev_turn`
//   line is the turn's log (§9.5).

/** Request body cap (contract §9.6). */
export const MAX_BODY_BYTES = 8 * 1024;

const noStore = { 'Cache-Control': 'no-store' } as const;

export type TurnRouteDeps = {
  /** The session's adult, or null (src/trust/session.ts). */
  getActor: () => Promise<UserActor | null>;
  /** The adapter's time source (src/app/_agenda/now.ts). */
  now: () => Promise<Date>;
  /** Keeps the turn running after the response (Next's `after`); tests pass their own. */
  after: (task: Promise<unknown>) => void;
  /** Test seams (refused on a deployed process by the orchestrator). */
  db?: KevDeps['db'];
  provider?: KevProvider;
  turnDeadlineMs?: number;
};

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The body, read to at most MAX_BODY_BYTES + 1 bytes: null when it is larger. */
async function boundedBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type Parsed = { text: string; focus?: 'today'; form: boolean };

/** The question and its focus, from a JSON body or a form post. Anything else: null. */
function parse(req: Request, body: string): Parsed | null {
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'application/json') {
    let v: unknown;
    try {
      v = JSON.parse(body);
    } catch {
      return null;
    }
    if (typeof v !== 'object' || v === null) return null;
    const { text, focus } = v as { text?: unknown; focus?: unknown };
    if (typeof text !== 'string') return null;
    return { text, ...(focus === 'today' ? { focus: 'today' as const } : {}), form: false };
  }
  if (type === 'application/x-www-form-urlencoded') {
    const f = new URLSearchParams(body);
    const text = f.get('text');
    if (text === null) return null;
    return { text, ...(f.get('focus') === 'today' ? { focus: 'today' as const } : {}), form: true };
  }
  return null;
}

/** One Server-Sent Event: a closed name and a JSON payload HOME wrote. */
export function sse(event: string, data: Record<string, unknown> = {}): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** What a finished turn says, collected from its events. */
type Ending = {
  say?: string;
  blocks: { kind: 'fact' | 'view'; text: string }[];
  error?: { code: string; message: string };
  done?: Extract<KevEvent, { type: 'done' }>;
};

function collect(e: KevEvent, end: Ending): void {
  if (e.type === 'say') end.say = e.text;
  else if (e.type === 'detail') end.blocks = e.blocks.map((b) => ({ kind: b.kind, text: b.text }));
  else if (e.type === 'error')
    end.error = { code: e.code, message: ERROR_TEXT[e.code] ?? ERROR_TEXT.provider_unavailable };
  else if (e.type === 'done') end.done = e;
}

/** The outcome event, once the turn is done (the only event that carries an answer). */
export function outcomeEvent(end: Ending): string {
  const done = end.done;
  if (!done || done.outcome === 'error' || end.error) {
    const code = end.error?.code ?? 'provider_unavailable';
    return sse('error', {
      code,
      message: end.error?.message ?? ERROR_TEXT.provider_unavailable,
      keepable: done?.keepable ?? false,
    });
  }
  return sse(done.outcome, {
    say: end.say ?? '',
    blocks: end.blocks,
    keepable: done.keepable,
  });
}

/** The progress events, as fixed strings chosen by code. */
function progressEvent(e: KevEvent): string | null {
  if (e.type === 'started') return sse('started');
  if (e.type === 'working') return sse('working', { text: WORKING_TEXT[e.label] });
  if (e.type === 'escalated') return sse('escalated', { text: ESCALATED_TEXT });
  return null;
}

export async function handleTurnRequest(req: Request, deps: TurnRouteDeps): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403, headers: noStore });
  const body = await boundedBody(req);
  if (body === null) return new Response(null, { status: 413, headers: noStore });
  const actor = await deps.getActor();
  if (!actor) return new Response(null, { status: 401, headers: noStore });
  const parsed = parse(req, body);
  if (!parsed) return new Response(null, { status: 400, headers: noStore });

  // Kev off: refused before any read (S9). The form goes back to /kev, which says so.
  const status = kevConfig().status;
  const on = status === 'on' || status === 'scripted' || deps.provider !== undefined;
  if (!on) {
    if (parsed.form) return redirect('/kev');
    return Response.json(
      { code: 'off', message: ERROR_TEXT.off },
      { status: 403, headers: noStore },
    );
  }

  const now = await deps.now();
  const kevDeps: KevDeps = {
    ...(deps.db ? { db: deps.db } : {}),
    ...(deps.provider ? { provider: deps.provider } : {}),
    ...(deps.turnDeadlineMs ? { turnDeadlineMs: deps.turnDeadlineMs } : {}),
  };
  // Locally and in CI only (the scripted provider; never deployed, N3): the
  // scripted model's book, and a test's request for a failure state.
  if (!deps.provider && status === 'scripted') {
    const [{ localScript }, { createScriptedProvider }, { env }] = await Promise.all([
      import('@/kev/evals/local'),
      import('@/kev/providers/scripted'),
      import('@/lib/env'),
    ]);
    const local = localScript(parsed.text, {
      now,
      timeZone: env.HOME_TIMEZONE,
      mode: req.headers.get('x-home-test-kev'),
    });
    kevDeps.provider = createScriptedProvider(local.script, local.opts ?? {});
    if (local.turnDeadlineMs) kevDeps.turnDeadlineMs = local.turnDeadlineMs;
  }

  const kevReq: KevRequest = {
    actor: { ...actor, via: 'kev' },
    channel: 'web',
    input: { text: parsed.text },
    ...(parsed.focus ? { focus: { kind: parsed.focus } } : {}),
    intent: 'chat',
    now,
  };

  if (parsed.form) {
    // No JavaScript: run to completion, then show the stored conversation.
    const end: Ending = { blocks: [] };
    try {
      for await (const e of handle(kevReq, kevDeps)) collect(e, end);
    } catch {
      log.error('kev_route_failed', { stage: 'form' });
      end.error = { code: 'not_saved', message: ERROR_TEXT.not_saved };
    }
    if (end.error || end.done?.outcome === 'error')
      return redirect(
        `/kev?e=${encodeURIComponent(end.error?.code ?? 'provider_unavailable')}&at=${now.getTime()}#latest`,
      );
    return redirect('/kev#latest');
  }

  // With JavaScript: the event stream. The turn is not the stream's: it
  // runs to the end whatever happens to the connection.
  let closed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true; // the client went away: ignored, the turn goes on
    }
  };
  const close = () => {
    if (closed || !controller) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // already closed by the client
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  const turn = (async () => {
    const end: Ending = { blocks: [] };
    try {
      for await (const e of handle(kevReq, kevDeps)) {
        collect(e, end);
        const progress = progressEvent(e);
        if (progress) write(progress);
      }
    } catch {
      log.error('kev_route_failed', { stage: 'stream' });
      end.error = end.error ?? { code: 'not_saved', message: ERROR_TEXT.not_saved };
    }
    write(outcomeEvent(end));
    close();
  })();
  deps.after(turn);
  return new Response(stream, {
    status: 200,
    headers: {
      ...noStore,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { ...noStore, Location: location } });
}
