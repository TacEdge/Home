import { ActionForm } from '@/app/_forms/action-form';
import type { Insight } from '@/domain/engines/insights';
import { dismissAction, notUsefulAction } from './actions';

// The reader's two responses to an insight (ADR 0009 §17, contract §5.9),
// each a form that works without JavaScript, from whichever surface shows
// the insight (`surface`, and the path to land back on). Dismiss hides it; Not useful
// hides it too and records that it did not help. Not useful is the quieter
// one, inside Why, after the facts. Neither changes anything else.

const button =
  'text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4';

type Props = {
  insight: Insight;
  /** Where the response is given from (the service checks what may be listed there). */
  surface?: 'today' | 'forward' | 'person';
  /** The path to land back on. */
  returnTo?: string;
};

function Hidden({ insight, surface, returnTo }: Required<Props>) {
  return (
    <>
      <input type="hidden" name="key" value={insight.key} />
      <input type="hidden" name="surface" value={surface} />
      <input type="hidden" name="return" value={returnTo} />
    </>
  );
}

export function DismissButton({ insight, surface = 'today', returnTo = '/today' }: Props) {
  return (
    <ActionForm action={dismissAction}>
      <Hidden insight={insight} surface={surface} returnTo={returnTo} />
      <button type="submit" aria-label={`Dismiss: ${insight.text}`} className={button}>
        Dismiss
      </button>
    </ActionForm>
  );
}

export function NotUsefulButton({ insight, surface = 'today', returnTo = '/today' }: Props) {
  return (
    <ActionForm action={notUsefulAction}>
      <Hidden insight={insight} surface={surface} returnTo={returnTo} />
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
