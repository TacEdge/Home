import { Disclosure } from '@/app/_insights/disclosure';
import {
  asOfTime,
  bandWords,
  type PartSummary,
  type WeatherSentence,
  type WeatherWords,
} from '@/domain/engines/weather';
import { capitalise } from '@/domain/engines/day-facts';
import { clockOf } from '@/lib/dates';
import { CreditLink } from './credit';

// Today's weather (M7 contract §4.1, §4.4, §4.5, §5.2): one sentence in the
// header, in body type and ink (never the display face, never the Sun), the
// small credit link after it, and a quiet "Why" with the evidence: the
// forecast's time, each part's band in words with its highest chance of rain,
// its rain and its strongest gust, the low and high, and the credit. Or, for a
// forecast over twelve hours old, the stale line in its place (no credit: no
// forecast words are shown). The model is the engine's; this only sets it out.
// Everything comes from the cached forecast; the browser asks nobody.

/** "Looks dry: chance of rain up to 10%, no rain, gusts up to 30 km/h." for one part. */
export function partLine(p: PartSummary, timeZone: string): string {
  const rain = p.totalMm === 0 ? 'no rain' : `${p.totalMm} mm of rain`;
  const gust = p.maxGustKmh === null ? '' : `, gusts up to ${p.maxGustKmh} km/h`;
  return `${capitalise(p.part)}, ${clockOf(p.from, timeZone)}–${clockOf(p.to, timeZone)}: ${bandWords(p.band).toLowerCase()}. Chance of rain up to ${p.maxProbability}%, ${rain}${gust}.`;
}

export function WeatherToday({
  sentence,
  stale,
  fetchedAt,
  now,
  timeZone,
}: {
  sentence: WeatherSentence | null;
  stale: WeatherWords | null;
  fetchedAt: Date | null;
  now: Date;
  timeZone: string;
}) {
  if (sentence && fetchedAt) {
    return (
      <div data-testid="weather" className="mt-3">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span data-testid="weather-sentence" className="text-[17px] break-words">
            {sentence.text}
          </span>
          <CreditLink />
        </p>
        <Disclosure label="Why">
          <div className="mt-1 mb-2 text-[15px]" data-testid="weather-why">
            <p className="text-ink-2">
              {sentence.rule === 'weather.tomorrow' ? 'Tomorrow, from' : 'From'} the forecast as of{' '}
              {asOfTime(fetchedAt, now, timeZone)}.
            </p>
            <ul className="mt-1">
              {sentence.parts.map((p) => (
                <li key={p.part} className="py-0.5">
                  {partLine(p, timeZone)}
                </li>
              ))}
            </ul>
            {sentence.lowC !== null && sentence.highC !== null ? (
              <p className="mt-1">
                Between {sentence.lowC}° and {sentence.highC}°.
              </p>
            ) : null}
            <p className="mt-1">
              <CreditLink />
            </p>
          </div>
        </Disclosure>
      </div>
    );
  }
  if (stale) {
    return (
      <p data-testid="weather-stale" className="text-ink-2 mt-3 text-[17px]">
        {stale.text}
      </p>
    );
  }
  return null;
}
