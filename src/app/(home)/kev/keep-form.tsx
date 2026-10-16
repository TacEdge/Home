'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';
import { KEEP, KEPT, KEPT_WHERE } from './copy';

// "Keep in To sort" under the person's own message (D6): a quiet link-like
// button in a plain form, so it works without JavaScript. "Kept" is said only
// once the server has kept the words (the same words as the capture bar's).

export function Kept() {
  return (
    <p className="text-muted mt-1 text-right text-[15px]" data-testid="kev-kept">
      ✓ {KEPT} ·{' '}
      <Link href="/sort" className="inline-flex min-h-11 items-center underline underline-offset-4">
        {KEPT_WHERE}
      </Link>
    </p>
  );
}

export function KeepForm({ action, messageId }: { action: FormAction; messageId: string }) {
  const [state, dispatch] = useActionState(action, idle);
  if (state.status === 'ok') return <Kept />;
  return (
    <form action={dispatch} className="mt-1 text-right" data-testid="kev-keep">
      <input type="hidden" name="messageId" value={messageId} />
      <Button variant="quiet">{KEEP}</Button>
      <FormMessage state={state} />
    </form>
  );
}
