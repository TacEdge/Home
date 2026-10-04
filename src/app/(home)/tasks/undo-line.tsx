'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, type FormAction } from '@/app/_forms/action-form';
import { idle } from '@/app/_forms/state';

// "Oil the deck: done. Undo", offered in place after a one-tap status
// change. The page arrives fresh after the redirect, so the line would be
// easy to miss: focus lands on Undo, which also reads the status text
// beside it (aria-describedby), without a dialog or a timer.

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
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <form action={dispatch} className="mb-4 flex flex-wrap items-baseline gap-x-3">
      <input type="hidden" name="id" value={taskId} />
      <input type="hidden" name="status" value="open" />
      <span id={`undo-${taskId}`} role="status" className="text-ink-2">
        {text}
      </span>
      <button
        ref={ref}
        type="submit"
        aria-label={`Undo: ${title}`}
        aria-describedby={`undo-${taskId}`}
        className="text-ink-2 min-h-11 px-1 py-2 underline-offset-4 hover:underline"
      >
        Undo
      </button>
      <FormMessage state={state} />
    </form>
  );
}
