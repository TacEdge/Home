import type { Insight } from '@/domain/engines/insights';
import { Label } from '@/ui/page';
import { Disclosure } from './disclosure';
import { InsightExplanation } from './explanation';
import type { FactLookup } from './facts';
import { DismissButton, NotUsefulButton } from './responses';

// Worth knowing (M5 contract §4.1, ADR 0008 §33): up to three of the
// reader's insights, in the engine's order, each a sentence with a quiet
// "Why" (its rule and records, without JavaScript) and Dismiss (a form that
// works without JavaScript). The rest are under "+ N more". M5's insights
// are ○ good to know, a hollow mark; a conflict (M6, contract §5.8) is the
// one small Sun mark, beside the same factual wording. Not useful sits
// inside every insight's Why, after the facts (ADR 0009 §17). Absent when
// empty.

export function WorthKnowing({
  shown,
  rest,
  lookup,
}: {
  shown: readonly Insight[];
  rest: readonly Insight[];
  lookup: FactLookup;
}) {
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="today-worth">
      <Label id="today-worth">Worth knowing</Label>
      <ul className="border-line border-b">
        {shown.map((i) => (
          <InsightRow key={i.key} insight={i} lookup={lookup} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <Disclosure label={`+ ${rest.length} more`}>
          <ul className="border-line border-b">
            {rest.map((i) => (
              <InsightRow key={i.key} insight={i} lookup={lookup} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

function InsightRow({ insight, lookup }: { insight: Insight; lookup: FactLookup }) {
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
      <div className="flex flex-wrap items-start gap-x-6 pl-5">
        <Disclosure label="Why" className="open:basis-full">
          <InsightExplanation insight={insight} lookup={lookup} />
          <NotUsefulButton insight={insight} />
        </Disclosure>
        <DismissButton insight={insight} />
      </div>
    </li>
  );
}
