'use client';

import { useRef } from 'react';
import { Button } from './button';

// A second, inline step before something worth pausing over (archive,
// unlink). No modal: the question opens in place under the action. Built on
// <details>, so it works without JavaScript (the summary toggles it); with
// JavaScript, "Keep it" closes it too.

export function ConfirmInline({
  label,
  question,
  confirmLabel,
  cancelLabel = 'Keep it',
  action,
  hidden,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  cancelLabel?: string;
  action: (formData: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="mt-4">
      <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
        {label}
      </summary>
      <form action={action} className="border-line mt-2 border-t pt-3">
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <p className="text-ink">{question}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button>{confirmLabel}</Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => ref.current?.removeAttribute('open')}
          >
            {cancelLabel}
          </Button>
        </div>
      </form>
    </details>
  );
}
