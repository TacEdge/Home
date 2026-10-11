import Link from 'next/link';
import { FactsInPlace, type FactLookup } from '@/app/_insights/facts';
import { WorthKnowing } from '@/app/_insights/worth-knowing';
import type { Fact } from '@/domain/engines/day-facts';
import type { ForwardModel } from '@/domain/engines/forward';
import type { ConflictMark, Insights } from '@/domain/engines/insights';
import { ComingUp } from './coming-up';
import { HorizonSwitch } from './horizon-switch';
import { TheUsual } from './the-usual';

// The Forward screen (M6 contract §4.1, §4.3): presentation of what the
// Forward engine decided. It orders nothing, counts nothing and words nothing
// of its own: the headline, the units, the rows, their load and the usual are
// the model's, rendered as given. One hierarchy on every horizon: headline,
// Worth knowing, Coming up, The usual, then back to Today. On a tablet Coming
// up takes the second column.

const link = 'text-ink-2 inline-flex min-h-11 items-center underline underline-offset-4';

export type ForwardViewProps = {
  model: ForwardModel;
  lookup: FactLookup;
  worth: Pick<Insights, 'shown' | 'rest'>;
  /** Week's conflicts on their rows, by `placement`. */
  marks: ReadonlyMap<string, readonly ConflictMark[]>;
  returnTo: string;
};

export function ForwardView({ model, lookup, worth, marks, returnTo }: ForwardViewProps) {
  const { headline } = model;
  // A calendar Worth knowing already speaks about is not listed again under
  // the headline's facts: its health is said once (as on Today).
  const saidBelow = new Set(
    [...worth.shown, ...worth.rest]
      .filter((i) => i.kind === 'data_health')
      .flatMap((i) => i.facts)
      .filter((f): f is Extract<Fact, { kind: 'calendar' }> => f.kind === 'calendar')
      .map((f) => f.id),
  );

  return (
    <div
      data-wide=""
      className="md:grid md:max-w-none md:grid-cols-2 md:grid-rows-[auto_auto_auto_1fr] md:gap-x-10"
    >
      <header className="md:col-start-1 md:row-start-1">
        <h1 className="text-ink-2 text-[15px] leading-6">Forward</h1>
        <HorizonSwitch current={model.horizon} />
        <p
          data-testid="headline"
          className="font-display mt-2 text-[27px] leading-[1.18] font-normal tracking-[-0.015em] text-balance break-words md:text-[34px]"
        >
          {headline.sentence}
        </p>
        {headline.qualified ? (
          <p data-testid="qualifier" className="text-ink-2 mt-1 text-[17px]">
            As far as HOME knows.
          </p>
        ) : null}
        {headline.conflicts ? (
          <p
            data-testid="overlaps"
            className="font-display text-ink-2 mt-2 text-[20px] leading-[1.3] text-balance break-words"
          >
            {headline.conflicts.text}
          </p>
        ) : null}
        {model.firstRun ? (
          <p className="mt-3">
            <Link href="/settings/calendars" className={link}>
              Connect a calendar ›
            </Link>
          </p>
        ) : (
          <FactsInPlace
            facts={[...headline.facts, ...(headline.conflicts?.facts ?? [])].filter(
              (f) =>
                !(
                  f.kind === 'calendar' &&
                  saidBelow.has(f.id) &&
                  headline.rule !== 'forward.headline.nothing'
                ),
            )}
            lookup={lookup}
          />
        )}
      </header>
      <div className="md:col-start-1 md:row-start-2">
        <WorthKnowing
          shown={worth.shown}
          rest={worth.rest}
          lookup={lookup}
          id="forward-worth"
          surface="forward"
          returnTo={returnTo}
        />
      </div>
      <div className="md:col-start-2 md:row-span-4 md:row-start-1">
        <ComingUp model={model} lookup={lookup} marks={marks} returnTo={returnTo} />
      </div>
      <div className="md:col-start-1 md:row-start-3">
        <TheUsual usual={model.usual} lookup={lookup} />
      </div>
      <p className="text-ink-2 mt-6 md:col-start-1 md:row-start-4">
        <Link href="/today" className={link}>
          Today ›
        </Link>
      </p>
    </div>
  );
}
