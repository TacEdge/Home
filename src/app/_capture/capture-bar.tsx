'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActionState } from 'react';
import type { FormAction } from '@/app/_forms/action-form';
import { useRefusalFocus } from '@/app/_forms/focus';
import { formKey, idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';

// The capture bar (M3 contract §3.8): on every place, one line, "Tell HOME
// something…". A plain form, so it works without JavaScript. "✓ Kept · in
// To sort" appears only when the server says it kept the words; if it
// couldn't, the words stay in the box with a calm line and focus returns
// there. Nothing is kept on the device. The bar lives in the shell, so its
// state would otherwise outlive the page: it is keyed by the path, and
// "Kept" is said on the place where it was said, not the next one.

export function CaptureBar({ action }: { action: FormAction }) {
  const pathname = usePathname();
  return <CaptureForm key={pathname} action={action} />;
}

function CaptureForm({ action }: { action: FormAction }) {
  const [state, dispatch] = useActionState(action, idle);
  const ref = useRefusalFocus<HTMLFormElement>(state);
  const refused = state.status === 'error';
  return (
    <form key={formKey(state)} ref={ref} action={dispatch} aria-label="Capture">
      <div className="flex items-center gap-3">
        <label htmlFor="capture-text" className="sr-only">
          Tell HOME something
        </label>
        <input
          id="capture-text"
          name="text"
          type="text"
          required
          maxLength={10_000}
          autoComplete="off"
          placeholder="Tell HOME something…"
          defaultValue={refused ? (state.values?.text ?? '') : undefined}
          aria-invalid={refused ? true : undefined}
          aria-describedby="capture-status"
          className="bg-paper-2 border-line text-ink rounded-home-sm placeholder:text-muted min-h-11 w-full min-w-0 flex-1 border px-4 py-2.5 text-[17px]"
        />
        <Button>Keep</Button>
      </div>
      <p id="capture-status" role="status" className="text-ink-2 mt-1 min-h-5 text-[15px]">
        {state.status === 'ok' ? (
          <>
            ✓ Kept ·{' '}
            <Link href="/sort" className="underline underline-offset-4">
              in To sort
            </Link>
          </>
        ) : refused ? (
          <span className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"
            />
            {state.message} Your words are still here.
          </span>
        ) : null}
      </p>
    </form>
  );
}
