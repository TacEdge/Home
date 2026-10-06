import 'server-only';

// A tiny structured logger (contract §5.8). One JSON object per line; events
// and IDs, never content. Keys on the redaction list are replaced wherever
// they appear, at any depth, including inside arrays; and every string value,
// error message and key is scrubbed of calendar secrets by its content.

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;

export const REDACTED_KEYS = [
  'email',
  'token',
  'url',
  'text',
  'body',
  'name',
  'cookie',
  'authorization',
  'password',
  'secret',
  'apikey',
  'api_key',
  // Calendar credentials (M4 contract §4.1): the secret address and everything
  // made from it or used to protect it.
  'address',
  'credential',
  'credentials',
  'ciphertext',
  'sealed',
  'fingerprint',
  'nonce',
  'key',
  // Where an address tends to travel under another name.
  'location',
  'href',
  'uri',
  'link',
] as const;

/** A field whose name contains one of these is redacted wherever the word sits. */
export const REDACTED_WORDS = [
  'credential',
  'secret',
  'ciphertext',
  'password',
  'sealed',
  'feed',
] as const;

// Value-based scrubbing (M4 contract §4.1): whatever a field is called, a
// string that carries a secret calendar address, a sealed credential or an
// address fingerprint has that part replaced, in free text, error messages
// and nested values alike. The rest of the string, which is structural
// (an event name, a code, the words around it), is kept.
const SECRET_PATTERNS: [RegExp, string][] = [
  // Any URL (any scheme) whose path goes through Google's calendar export,
  // or carries a private token; and the same without a scheme.
  [
    /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*?(?:\/calendar\/ical\/|private-)[^\s"'<>]*/gi,
    '[calendar-address]',
  ],
  [/[^\s"'<>]*\/calendar\/ical\/[^\s"'<>]*/gi, '[calendar-address]'],
  [/private-[A-Za-z0-9]{8,}/g, '[calendar-address]'],
  // A sealed credential: hc<version>.<key id>.<iv>.<ciphertext>.<tag>.
  [/\bhc\d+(?:\.[A-Za-z0-9_+/=-]+){4}/g, '[credential]'],
  // An address fingerprint.
  [/\bfp\d+\.[A-Za-z0-9_-]{16,}/g, '[fingerprint]'],
];

/** A string with every secret calendar address, sealed credential and fingerprint replaced. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

const redactedSet = new Set<string>(REDACTED_KEYS);
const shouldRedact = (key: string) => {
  const k = key.toLowerCase();
  return (
    redactedSet.has(k) ||
    [...redactedSet].some((r) => k.endsWith(`_${r}`) || k.endsWith(r)) ||
    REDACTED_WORDS.some((w) => k.includes(w))
  );
};

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return scrubSecrets(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error)
    return { name: scrubSecrets(value.name), message: scrubSecrets(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[scrubSecrets(k)] = shouldRedact(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Free text from a library (M1.1 contract §2.4): strip anything that could
 * carry an address, a link or a credential, then cap the length. Used for
 * Better Auth's log messages, which may interpolate URLs and emails.
 */
export function sanitiseMessage(message: unknown): string {
  const text = scrubSecrets(typeof message === 'string' ? message : String(message ?? ''));
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z0-9_+/=-]{20,}/g, '[token]')
    .slice(0, 200);
}

export type Sink = (line: string, level: Level) => void;

const defaultSink: Sink = (line, level) => {
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(opts: { sink?: Sink; minLevel?: Level; base?: Fields } = {}) {
  const sink = opts.sink ?? defaultSink;
  const min = order[opts.minLevel ?? 'info'];
  const base = opts.base ?? {};
  const emit = (level: Level, event: string, fields?: Fields) => {
    if (order[level] < min) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      // The event is meant to be a fixed name, but it is scrubbed like every
      // other string, so a secret passed as the message itself cannot leak.
      event: scrubSecrets(typeof event === 'string' ? event : String(event)),
      ...(redact({ ...base, ...fields }) as Fields),
    };
    sink(JSON.stringify(entry), level);
  };
  return {
    debug: (event: string, fields?: Fields) => emit('debug', event, fields),
    info: (event: string, fields?: Fields) => emit('info', event, fields),
    warn: (event: string, fields?: Fields) => emit('warn', event, fields),
    error: (event: string, fields?: Fields) => emit('error', event, fields),
    child: (extra: Fields) =>
      createLogger({ sink, minLevel: opts.minLevel, base: { ...base, ...extra } }),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export const log: Logger = createLogger();
