import { Disclosure } from '@/app/_insights/disclosure';
import { Label } from '@/ui/page';
import {
  asOfTime,
  DRY_MAX_MM,
  DRY_MAX_PROBABILITY,
  RAIN_LIKELY_MM,
  RAIN_LIKELY_PROBABILITY,
  WINDY_GUST_KMH,
} from '@/domain/engines/weather';
import { PLANNING_FROM, PLANNING_TO } from '@/domain/engines/planning';
import { CreditLink } from './credit';

// Forward Week's credit line (M7 contract §4.2, ADR 0011 §20): beside the
// Coming up label, once, "Forecast as of 06:55 · Open-Meteo", with its own
// Why. Day phrases have no Why of their own; this one says what they
// describe and what the words mean, with their thresholds. Shown only when
// at least one day has words.

/** The Coming up label with, when there are day phrases, the credit line beside it. */
export function ComingUpLabel({
  id,
  fetchedAt,
  now,
  timeZone,
}: {
  id: string;
  fetchedAt: Date | null;
  now: Date;
  timeZone: string;
}) {
  if (!fetchedAt) return <Label id={id}>Coming up</Label>;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Label id={id}>Coming up</Label>
        <p
          data-testid="forecast-credit"
          className="text-muted flex flex-wrap items-baseline gap-x-1.5 text-[13px]"
        >
          <span>Forecast as of {asOfTime(fetchedAt, now, timeZone)}</span>
          <span aria-hidden="true">·</span>
          <CreditLink />
        </p>
      </div>
      <div className="flex justify-end">
        <Disclosure label="Why" className="text-[15px]">
          <div className="mt-1 mb-2 text-[15px]" data-testid="forecast-why">
            <p className="text-ink-2">
              Each day’s words describe that day’s planning hours, {PLANNING_FROM}–{PLANNING_TO}{' '}
              (what is left of them, today), in the forecast as of{' '}
              {asOfTime(fetchedAt, now, timeZone)}. A day the forecast doesn’t fully cover has no
              words.
            </p>
            <ul className="mt-1">
              <li className="py-0.5">
                Looks dry: every hour at or below a {DRY_MAX_PROBABILITY}% chance of rain, and under{' '}
                {DRY_MAX_MM} mm.
              </li>
              <li className="py-0.5">Showers possible: anything between those two.</li>
              <li className="py-0.5">
                Rain likely: any hour at {RAIN_LIKELY_PROBABILITY}% or more, or {RAIN_LIKELY_MM} mm
                or more.
              </li>
              <li className="py-0.5">Windy: gusts of {WINDY_GUST_KMH} km/h or more in any hour.</li>
            </ul>
            <p className="mt-1">
              <CreditLink />
            </p>
          </div>
        </Disclosure>
      </div>
    </>
  );
}

/** A day's words, muted, at the end of its row. */
export function DayPhrase({ text }: { text: string }) {
  return (
    <span data-testid="day-phrase" className="text-ink-2 shrink-0 text-[15px]">
      {text}
    </span>
  );
}
