import 'server-only';
import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

// Outbound mail is used for exactly one thing in M1: magic links.
//   provider — Postmark over its HTTP API (owner-supplied MAIL_API_KEY/MAIL_FROM).
//   test     — appends the message to a mailbox file in the OS temp directory
//              so Playwright can read the link. lib/env refuses this in production.

export type Mail = { to: string; subject: string; text: string };

export const TEST_MAILBOX_PATH = join(tmpdir(), 'home-test-mailbox.jsonl');

async function sendViaPostmark(mail: Mail): Promise<void> {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': env.MAIL_API_KEY ?? '',
    },
    body: JSON.stringify({
      From: env.MAIL_FROM,
      To: mail.to,
      Subject: mail.subject,
      TextBody: mail.text,
      MessageStream: 'outbound',
    }),
  });
  if (!res.ok) {
    // Status only: the response body may echo the recipient address.
    log.error('mail.send_failed', { status: res.status });
    throw new Error(`mail provider responded ${res.status}`);
  }
}

async function sendViaTestMailbox(mail: Mail): Promise<void> {
  await mkdir(tmpdir(), { recursive: true });
  await appendFile(
    TEST_MAILBOX_PATH,
    JSON.stringify({ ...mail, at: new Date().toISOString() }) + '\n',
  );
}

export async function sendMail(mail: Mail): Promise<void> {
  if (env.HOME_MAIL_TRANSPORT === 'test') return sendViaTestMailbox(mail);
  return sendViaPostmark(mail);
}
