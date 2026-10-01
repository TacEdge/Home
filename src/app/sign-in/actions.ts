'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { log } from '@/lib/log';
import { getAuth } from '@/trust/auth';

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// Whatever happens — allowed, not allowed, rate-limited, malformed — the person
// sees the same calm confirmation. Nothing here reveals who is in the household.
export async function requestLinkAction(formData: FormData): Promise<void> {
  const parsed = input.safeParse({ email: formData.get('email') });
  if (parsed.success) {
    try {
      await getAuth().api.signInMagicLink({
        body: {
          email: parsed.data.email,
          callbackURL: '/today',
          errorCallbackURL: '/sign-in',
        },
        headers: await headers(),
      });
    } catch (err) {
      log.warn('auth.link_request_failed', { error: err });
    }
  }
  redirect('/sign-in?sent=1');
}
