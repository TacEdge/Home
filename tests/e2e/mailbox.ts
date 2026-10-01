import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Reads the test mail transport's mailbox (src/trust/mail.ts writes it).
export const MAILBOX_PATH = join(tmpdir(), 'home-test-mailbox.jsonl');

export type MailEntry = { to: string; subject: string; text: string; at: string };

export async function readMailbox(): Promise<MailEntry[]> {
  try {
    const raw = await readFile(MAILBOX_PATH, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as MailEntry);
  } catch {
    return [];
  }
}

export const linkIn = (entry: MailEntry) => entry.text.match(/https?:\/\/\S+/)?.[0] ?? null;

/** Waits for a new message to `to` sent after `since`, or returns null after `timeoutMs`. */
export async function waitForLink(
  to: string,
  since: Date,
  timeoutMs = 5000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = (await readMailbox())
      .filter((m) => m.to === to && new Date(m.at) >= since)
      .at(-1);
    if (entry) return linkIn(entry);
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
