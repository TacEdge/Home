import { ActionForm } from '@/app/_forms/action-form';
import type { Insight } from '@/domain/engines/insights';
import { dismissAction, notUsefulAction } from './actions';

// The reader's two responses to an insight (ADR 0009 §17, contract §5.9),
// each a form that works without JavaScript. Dismiss hides it; Not useful
// hides it too and records that it did not help. Not useful is the quieter
// one, inside Why, after the facts. Neither changes anything else.

const button =
  'text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4';

export function DismissButton({ insight }: { insight: Insight }) {
  return (
    <ActionForm action={dismissAction}>
      <input type="hidden" name="key" value={insight.key} />
      <button type="submit" aria-label={`Dismiss: ${insight.text}`} className={button}>
        Dismiss
      </button>
    </ActionForm>
  );
}

export function NotUsefulButton({ insight }: { insight: Insight }) {
  return (
    <ActionForm action={notUsefulAction}>
      <input type="hidden" name="key" value={insight.key} />
      <button
        type="submit"
        aria-label={`Not useful: ${insight.text}`}
        className={`${button} text-[15px]`}
      >
        Not useful
      </button>
    </ActionForm>
  );
}
