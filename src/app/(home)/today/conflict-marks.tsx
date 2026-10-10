import type { ConflictMark } from '@/domain/engines/insights';
import { Disclosure } from './disclosure';
import { InsightExplanation } from './explanation';
import type { FactLookup } from './facts';
import { DismissButton, NotUsefulButton } from './responses';

// Today's conflicts, said on their items (contract §4.5, ADR 0009 §18): a
// small Sun mark and the other commitment, as recorded ("overlaps Art club
// 15:00"), with Why holding the facts, Dismiss and Not useful, all without
// JavaScript. No colour but the one Sun mark, no alarm, nothing about why or
// what anyone should do. A crowded item shows two, then the rest in place.

/** How many marks an item shows before "+ N more overlaps". */
export const MARKS_SHOWN = 2;

export function ConflictMarks({
  marks,
  lookup,
}: {
  marks: readonly ConflictMark[] | undefined;
  lookup: FactLookup;
}) {
  if (!marks || marks.length === 0) return null;
  const shown = marks.slice(0, MARKS_SHOWN);
  const rest = marks.slice(MARKS_SHOWN);
  return (
    <div className="pb-2 pl-1">
      <ul>
        {shown.map((m) => (
          <Mark key={m.insight.key} mark={m} lookup={lookup} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <Disclosure label={`+ ${rest.length} more ${rest.length === 1 ? 'overlap' : 'overlaps'}`}>
          <ul>
            {rest.map((m) => (
              <Mark key={m.insight.key} mark={m} lookup={lookup} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

function Mark({ mark, lookup }: { mark: ConflictMark; lookup: FactLookup }) {
  return (
    <li data-conflict={mark.insight.rule} className="text-[15px]">
      <p className="flex items-baseline gap-2">
        <span aria-hidden="true" className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full" />
        <span className="min-w-0 break-words">{mark.text}</span>
      </p>
      <div className="pl-4">
        <Disclosure label="Why" className="open:basis-full">
          <InsightExplanation insight={mark.insight} lookup={lookup} />
          <div className="flex flex-wrap gap-x-6">
            <DismissButton insight={mark.insight} />
            <NotUsefulButton insight={mark.insight} />
          </div>
        </Disclosure>
      </div>
    </li>
  );
}
