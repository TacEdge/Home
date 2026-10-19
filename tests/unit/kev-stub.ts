import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

// A local stand-in for the Messages API (M8 contract §15.1, "the network
// policy"): plain HTTP on 127.0.0.1, reached only through HOME's provider
// test fetch, which keeps production's URL, method, path, header, size and
// redirect rules and replaces only the connection. Synthetic content only.

export type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };
export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export type Stub = {
  port: number;
  /** Requests to POST /v1/messages (and any other path but the count). */
  seen: Seen[];
  /** Handlers for the next requests, in order; a request with none left gets a 500. */
  queue: Handler[];
  /** Requests to POST /v1/messages/count_tokens (G22), kept apart from `seen`. */
  counts: Seen[];
  /**
   * Handlers for the next count requests, in order; with none left a count
   * is answered `{"input_tokens": defaultCount}`, so a test about the call
   * itself need not script its preflight.
   */
  countQueue: Handler[];
  defaultCount: number;
  closed: number;
  close(): Promise<void>;
};

export async function startStub(): Promise<Stub> {
  const stub: Stub = {
    port: 0,
    seen: [],
    queue: [],
    counts: [],
    countQueue: [],
    defaultCount: 1_234,
    closed: 0,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const seen = { method: req.method, url: req.url, headers: req.headers, body };
      res.on('close', () => (stub.closed += 1));
      if (req.url === '/v1/messages/count_tokens') {
        stub.counts.push(seen);
        const c = stub.countQueue.shift();
        if (c) return c(req, res, body);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ input_tokens: stub.defaultCount }));
      }
      stub.seen.push(seen);
      const h = stub.queue.shift();
      if (!h) {
        res.writeHead(500);
        return res.end();
      }
      h(req, res, body);
    });
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  stub.port = (server.address() as AddressInfo).port;
  return stub;
}

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  inference_geo?: string | null;
};

export const ev = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

export function messageStart(
  model: string,
  usage: Usage = {},
  extra: Record<string, unknown> = {},
) {
  const u: Record<string, unknown> = {
    input_tokens: 4_100,
    output_tokens: 1,
    cache_creation_input_tokens: 5_000,
    cache_read_input_tokens: 0,
    inference_geo: 'us',
    ...usage,
  };
  if (usage.inference_geo === undefined && 'inference_geo' in usage) delete u.inference_geo;
  return ev('message_start', {
    message: {
      id: 'msg_synthetic',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: u,
      ...extra,
    },
  });
}

export const textBlock = (index: number, text: string) =>
  ev('content_block_start', { index, content_block: { type: 'text', text: '' } }) +
  ev('content_block_delta', { index, delta: { type: 'text_delta', text } }) +
  ev('content_block_stop', { index });

export const toolBlock = (index: number, id: string, name: string, input: unknown) =>
  ev('content_block_start', { index, content_block: { type: 'tool_use', id, name, input: {} } }) +
  ev('content_block_delta', {
    index,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
  }) +
  ev('content_block_stop', { index });

export const messageEnd = (stop: string, outputTokens = 450) =>
  ev('message_delta', {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }) + ev('message_stop', {});

/** A complete, successful streamed answer. */
export function okStream(
  model: string,
  opts: { text?: string; usage?: Usage; stop?: string } = {},
): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      messageStart(model, opts.usage) +
        textBlock(0, opts.text ?? 'Synthetic reply.') +
        messageEnd(opts.stop ?? 'end_turn'),
    );
  };
}

/** An error status with a JSON error body. */
export function status(
  code: number,
  type: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Handler {
  return (_req, res) => {
    res.writeHead(code, { 'content-type': 'application/json', ...headers });
    res.end(
      JSON.stringify({ type: 'error', error: { type, message: 'synthetic error body', ...extra } }),
    );
  };
}

/** A count response: `{"input_tokens": n}`, or any JSON body as given. */
export function countJson(body: unknown, statusCode = 200): Handler {
  return (_req, res) => {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}
