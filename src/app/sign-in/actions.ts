'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { log } from '@/lib/log';
import { clientIp } from '@/trust/client-ip';
import { handleLinkRequest } from '@/trust/sign-in-gate';

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// Whatever happens — allowed, not allowed, rate-limited, malformed — the person
// sees the same calm confirmation. Nothing here reveals who is in the household.
// The gate runs before Better Auth sees anything (contract §1.1).
export async function requestLinkAction(formData: FormData): Promise<void> {
  const parsed = input.safeParse({ email: formData.get('email') });
  if (parsed.success) {
    try {
      const h = await headers();
      await handleLinkRequest({ email: parsed.data.email, ip: clientIp(h), headers: h });
    } catch (err) {
      log.warn('auth.link_request_failed', { error: err });
    }
  }
  redirect('/sign-in?sent=1');
}
