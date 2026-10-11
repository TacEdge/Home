import type { ConflictMark } from '@/domain/engines/insights';
import { Disclosure } from './disclosure';
import { InsightExplanation } from './explanation';
import type { FactLookup } from './facts';
import { FOLDED_FULL } from './folds';
import { DismissButton, NotUsefulButton } from './responses';

// Conflicts, said on their items (Today, Forward's Week, a person's Coming up) (contract §4.5, ADR 0009 §18): a
// small Sun mark and the other commitment, as recorded ("overlaps Art club
// 15:00"), with Why holding the facts, Dismiss and Not useful, all without
// JavaScript. No colour but the one Sun mark, no alarm, nothing about why or
// what anyone should do. A crowded item shows two, then the rest in place:
// the first `FOLDED_FULL` of those with their Why and forms, any beyond as
// the sentence and mark alone, with the count exact and a line saying that
// responding to the ones in full brings the rest forward (ADR 0009 §35).

/** How many marks an item shows before "+ N more overlaps". */
export const MARKS_SHOWN = 2;

export function ConflictMarks({
  marks,
  lookup,
  surface = 'today',
  returnTo = '/today',
}: {
  marks: readonly ConflictMark[] | undefined;
  lookup: FactLookup;
  surface?: 'today' | 'forward' | 'person';
  returnTo?: string;
}) {
  const where = { surface, returnTo };
  if (!marks || marks.length === 0) return null;
  const shown = marks.slice(0, MARKS_SHOWN);
  const rest = marks.slice(MARKS_SHOWN);
  return (
    <div className="pb-2 pl-1">
      <ul>
        {shown.map((m) => (
          <Mark key={m.insight.key} mark={m} lookup={lookup} {...where} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <Disclosure label={`+ ${rest.length} more ${rest.length === 1 ? 'overlap' : 'overlaps'}`}>
          <ul>
            {rest.map((m, n) => (
              <Mark
                key={m.insight.key}
                mark={m}
                lookup={lookup}
                full={n < FOLDED_FULL}
                {...where}
              />
            ))}
          </ul>
          {rest.length > FOLDED_FULL ? (
            <p className="text-ink-2 pl-4 text-[15px]">
              Respond to the ones above and the rest come forward.
            </p>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}

function Mark({
  mark,
  lookup,
  surface,
  returnTo,
  full = true,
}: {
  mark: ConflictMark;
  lookup: FactLookup;
  surface: 'today' | 'forward' | 'person';
  returnTo: string;
  /** With its Why, Dismiss and Not useful; else the sentence and mark alone. */
  full?: boolean;
}) {
  return (
    <li data-conflict={mark.insight.rule} className="text-[15px]">
      <p className="flex items-baseline gap-2">
        <span aria-hidden="true" className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full" />
        <span className="min-w-0 break-words">{mark.text}</span>
      </p>
      {full ? (
        <div className="pl-4">
          <Disclosure label="Why" className="open:basis-full">
            <InsightExplanation insight={mark.insight} lookup={lookup} />
            <div className="flex flex-wrap gap-x-6">
              <DismissButton insight={mark.insight} surface={surface} returnTo={returnTo} />
              <NotUsefulButton insight={mark.insight} surface={surface} returnTo={returnTo} />
            </div>
          </Disclosure>
        </div>
      ) : null}
    </li>
  );
}
