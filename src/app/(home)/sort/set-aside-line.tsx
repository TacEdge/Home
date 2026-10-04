'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';

// "Set aside. Nothing is deleted. Undo", in place after Not needed, with
// focus on Undo on arrival (the same pattern as To do's Undo).

export function SetAsideLine({
  action,
  captureId,
  words,
}: {
  action: FormAction;
  captureId: string;
  words: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }, []);
  const described = `aside-${captureId}`;
  return (
    <form ref={ref} action={dispatch} className="mb-4 flex flex-wrap items-baseline gap-x-3">
      <input type="hidden" name="id" value={captureId} />
      <span id={described} role="status" className="text-ink-2">
        Set aside. Nothing is deleted.
      </span>
      <Button variant="quiet" ariaLabel={`Undo: ${words}`} ariaDescribedBy={described}>
        Undo
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
