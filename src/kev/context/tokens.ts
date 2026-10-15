import 'server-only';
import type { ProviderRequest, ProviderToolDefinition } from '../providers/types';

// HOME's own token accounting (M8 contract §7.2, §7.4, §13.4; matrix rows
// C5 and L4's first half). A deliberately conservative estimate, used to
// size the conversation window (6,000 tokens) and to keep each assembled
// request under the 32,000-token cap before it is sent: one token for every
// two bytes of UTF-8. Ordinary English and JSON run nearer three or four
// bytes a token, so this over-counts them; it is HOME's planning bound, not
// a claim about any tokenizer. The provider's preflight count (G22) is the
// check before every call, and its own count at `message_start` (I4) the
// authoritative backstop.

export const BYTES_PER_TOKEN = 2;

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN);
}

/** The stable prefix's estimate: the system prompt, the tool definitions and the answer's schema. */
export function prefixTokens(
  system: string,
  tools: readonly ProviderToolDefinition[],
  outputFormat?: Readonly<Record<string, unknown>>,
): number {
  return (
    estimateTokens(system) +
    estimateTokens(JSON.stringify(tools)) +
    (outputFormat ? estimateTokens(JSON.stringify(outputFormat)) : 0)
  );
}

/**
 * A whole request's estimate. A replayed assistant turn of this attempt (its
 * thinking, text and tool calls, which HOME cannot see inside) is counted at
 * what the provider reported as that call's output, passed in `replayTokens`
 * in the order the replays appear.
 */
export function requestTokens(request: ProviderRequest, replayTokens: readonly number[]): number {
  let n = prefixTokens(request.system, request.tools, request.outputFormat);
  let r = 0;
  for (const m of request.messages) {
    if ('replay' in m) {
      n += replayTokens[r++] ?? 0;
      continue;
    }
    for (const b of m.content) n += estimateTokens(b.type === 'text' ? b.text : b.content);
  }
  return n;
}
