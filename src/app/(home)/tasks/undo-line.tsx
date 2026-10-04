'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { idle } from '@/app/_forms/state';
import { Button } from '@/ui/button';

// "Oil the deck: done. Undo", offered in place after a one-tap status
// change. The page arrives fresh after the redirect, so the line would be
// easy to miss: focus lands on Undo, which also reads the status text
// beside it (aria-describedby), without a dialog or a timer. The shared
// Button reports the pending submission, so a double tap cannot post twice.

export function UndoLine({
  action,
  taskId,
  text,
  title,
}: {
  action: FormAction;
  taskId: string;
  text: string;
  title: string;
}) {
  const [state, dispatch] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
  }, []);
  const describedBy = `undo-${taskId}`;
  return (
    <form ref={ref} action={dispatch} className="mb-4 flex flex-wrap items-baseline gap-x-3">
      <input type="hidden" name="id" value={taskId} />
      <input type="hidden" name="status" value="open" />
      <span id={describedBy} role="status" className="text-ink-2">
        {text}
      </span>
      <Button variant="quiet" ariaLabel={`Undo: ${title}`} ariaDescribedBy={describedBy}>
        Undo
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
