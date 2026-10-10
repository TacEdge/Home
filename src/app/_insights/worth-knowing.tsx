import type { Insight } from '@/domain/engines/insights';
import { Label } from '@/ui/page';
import { Disclosure } from './disclosure';
import { InsightExplanation } from './explanation';
import type { FactLookup } from './facts';
import { DismissButton, NotUsefulButton } from './responses';

// Worth knowing (M5 contract §4.1, ADR 0008 §33; Forward, M6 contract §4.1):
// up to three (Forward: two) of the reader's insights, in the engine's order, each a sentence with a quiet
// "Why" (its rule and records, without JavaScript) and Dismiss (a form that
// works without JavaScript). The rest are under "+ N more". M5's insights
// are ○ good to know, a hollow mark; a conflict (M6, contract §5.8) is the
// one small Sun mark, beside the same factual wording. Not useful sits
// inside every insight's Why, after the facts (ADR 0009 §17). Absent when
// empty.
//
// "+ N more" always counts them all, but only the first `FOLDED_FULL` inside it
// carry their Why and forms: a long fold is bounded, so a page of many
// conflicts stays light. Any beyond are still a sentence and a mark each, in
// the engine's order, and the item each is about is on the page.

/** How many insights inside "+ N more" are rendered in full (Why, Dismiss, Not useful). */
export const FOLDED_FULL = 12;

type Surface = 'today' | 'forward' | 'person';

export function WorthKnowing({
  shown,
  rest,
  lookup,
  id = 'today-worth',
  surface = 'today',
  returnTo = '/today',
}: {
  shown: readonly Insight[];
  rest: readonly Insight[];
  lookup: FactLookup;
  /** The heading's id, for the section's name. */
  id?: string;
  surface?: Surface;
  returnTo?: string;
}) {
  const where = { surface, returnTo };
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <Label id={id}>Worth knowing</Label>
      <ul className="border-line border-b">
        {shown.map((i) => (
          <InsightRow key={i.key} insight={i} lookup={lookup} {...where} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <Disclosure label={`+ ${rest.length} more`}>
          <ul className="border-line border-b">
            {rest.map((i, n) => (
              <InsightRow
                key={i.key}
                insight={i}
                lookup={lookup}
                full={n < FOLDED_FULL}
                {...where}
              />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

function InsightRow({
  insight,
  lookup,
  full = true,
  surface,
  returnTo,
}: {
  insight: Insight;
  lookup: FactLookup;
  full?: boolean;
  surface: Surface;
  returnTo: string;
}) {
  return (
    <li className="border-line border-t pt-3" data-insight={insight.rule}>
      <p className="flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className={
            insight.kind === 'conflict'
              ? 'bg-accent inline-block h-2 w-2 shrink-0 rounded-full'
              : 'border-ink-2 inline-block h-2 w-2 shrink-0 rounded-full border'
          }
        />
        <span className="min-w-0 break-words">{insight.text}</span>
      </p>
      {full ? (
        <div className="flex flex-wrap items-start gap-x-6 pl-5">
          <Disclosure label="Why" className="open:basis-full">
            <InsightExplanation insight={insight} lookup={lookup} />
            <NotUsefulButton insight={insight} surface={surface} returnTo={returnTo} />
          </Disclosure>
          <DismissButton insight={insight} surface={surface} returnTo={returnTo} />
        </div>
      ) : null}
    </li>
  );
}
