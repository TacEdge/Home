import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { creditOpeningKey } from '@/app/_insights/weather/credit-key';
import { CreditLink } from '@/app/_insights/weather/credit';
import { ComingUpLabel, DayPhrase } from '@/app/_insights/weather/forecast-credit-line';
import { WeatherToday } from '@/app/_insights/weather/weather-today';
import { OpeningExplanation } from '@/app/_insights/opening-explanation';
import type { FactLookup } from '@/app/_insights/facts';
import {
  dayPhrase,
  staleSentence,
  todaySentence,
  tomorrowSentence,
} from '@/domain/engines/weather';
import type { Person } from '@/domain/people/service';
import {
  at,
  compose,
  F0,
  FENCE,
  forecastOf,
  GARAGE,
  ID,
  NZ,
  PEOPLE,
  STALE_CALENDAR,
  task,
  WED_0703,
} from '../openings/fixture';

// The weather and opening pieces on their own (M7 Package 4; contract §4.1,
// §4.2, §4.4, §4.5, §4.7, §5.2): every shape the sentence can take, the older
// prefix and the stale line, day phrases, the credit link and the credit line
// with its Why, and an opening's Why from its facts in each shape (plain,
// task with others, qualified, without weather, with sunrise and sunset).
// Synthetic only.

const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

describe('the credit link (W19, §4.7)', () => {
  const html = renderToStaticMarkup(<CreditLink />);
  it('is a real link to Open-Meteo, same tab, no referrer, named for where it goes, 44px tall', () => {
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="https://open-meteo.com/"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('aria-label="Forecast data: Open-Meteo"');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('onClick');
    expect(words(html)).toBe('Open-Meteo');
  });
});

describe('Today’s weather block (§4.1, §4.4, §5.2)', () => {
  const render = (props: Partial<Parameters<typeof WeatherToday>[0]>) =>
    renderToStaticMarkup(
      <WeatherToday
        sentence={null}
        stale={null}
        fetchedAt={null}
        now={WED_0703}
        timeZone={NZ}
        {...props}
      />,
    );

  it('the sentence in body type with the credit after it and a Why of the parts, the low and high, and the credit; never the display face or the Sun', () => {
    const forecast = forecastOf(at('2026-10-14', '06:55'), (s) =>
      s >= at('2026-10-14', '12:00') ? { precipitationProbability: 40, precipitationMm: 0.1 } : {},
    );
    const sentence = todaySentence(forecast, WED_0703, NZ)!;
    const html = render({ sentence, fetchedAt: forecast.fetchedAt });
    expect(words(html)).toContain('Looks dry until midday, then showers possible.');
    expect(html).not.toMatch(/font-display|bg-accent|text-accent|sky/);
    expect(html.indexOf('data-testid="weather-sentence"')).toBeLessThan(
      html.indexOf('data-testid="credit-link"'),
    );
    expect(html).toContain('<details');
    const why = words(html.slice(html.indexOf('data-testid="weather-why"')));
    expect(why).toContain('From the forecast as of 06:55.');
    expect(why).toContain('Morning, 07:00–12:00: looks dry.');
    expect(why).toContain('Afternoon, 12:00–18:00: showers possible. Chance of rain up to 40%');
    expect(why).toContain('Evening, 18:00–21:00: showers possible.');
    expect(why).toContain('Between 14° and 14°.');
    expect((html.match(/data-testid="credit-link"/g) ?? []).length).toBe(2);
  });

  it('an older forecast carries “As of …” from the engine; the Why dates it', () => {
    const forecast = forecastOf(at('2026-10-13', '21:00'), () => ({}));
    const sentence = todaySentence(forecast, WED_0703, NZ)!;
    const html = render({ sentence, fetchedAt: forecast.fetchedAt });
    expect(words(html)).toContain('As of yesterday 21:00, looks dry today.');
    expect(words(html)).toContain('From the forecast as of yesterday 21:00.');
  });

  it('the evening state: the sentence is about tomorrow', () => {
    const forecast = forecastOf(at('2026-10-14', '19:20'), (s) =>
      s >= at('2026-10-15', '00:00') && s < at('2026-10-16', '00:00')
        ? { precipitationProbability: 80, precipitationMm: 2 }
        : {},
    );
    const now = at('2026-10-14', '19:30');
    const sentence = tomorrowSentence(forecast, now, NZ)!;
    const html = render({ sentence, fetchedAt: forecast.fetchedAt, now });
    expect(words(html)).toContain('Rain likely tomorrow.');
    expect(words(html)).toContain(
      'From the forecast as of 19:20.'.replace('From', 'Tomorrow, from'),
    );
  });

  it('windy is said, and a part with no gust data omits gusts rather than inventing them', () => {
    const forecast = forecastOf(at('2026-10-14', '06:55'), () => ({ gustKmh: 60 }));
    const sentence = todaySentence(forecast, WED_0703, NZ)!;
    expect(sentence.text).toBe('Looks dry today. Windy at times.');
    const html = render({ sentence, fetchedAt: forecast.fetchedAt });
    expect(words(html)).toContain('gusts up to 60 km/h');
  });

  it('the stale line stands alone: no sentence, no credit, no word “error”', () => {
    const fetchedAt = at('2026-10-13', '17:00');
    const stale = staleSentence(fetchedAt, WED_0703, NZ)!;
    const html = render({ stale, fetchedAt });
    expect(words(html)).toBe("The forecast hasn't updated since yesterday.");
    expect(html).not.toContain('credit-link');
    expect(html).not.toMatch(/error/i);
  });

  it('nothing at all when there is neither (no location, no key, no forecast yet)', () => {
    expect(render({})).toBe('');
  });
});

describe('Forward Week’s day phrases and credit line (§4.2, §5.2)', () => {
  it('a phrase is at most four words, with “, windy” when it applies, and the engine’s own text', () => {
    const forecast = forecastOf(at('2026-10-14', '06:55'), (s) =>
      s >= at('2026-10-15', '00:00') && s < at('2026-10-16', '00:00')
        ? { precipitationProbability: 80, precipitationMm: 2, gustKmh: 60 }
        : {},
    );
    expect(dayPhrase(forecast, '2026-10-14', WED_0703, NZ)!.text).toBe('Looks dry');
    const rain = dayPhrase(forecast, '2026-10-15', WED_0703, NZ)!.text;
    expect(rain).toBe('Rain likely, windy');
    expect(rain.split(/\s+/).length).toBeLessThanOrEqual(4);
    // Beyond today + 6: no words.
    expect(dayPhrase(forecast, '2026-10-21', WED_0703, NZ)).toBeNull();
    expect(words(renderToStaticMarkup(<DayPhrase text={rain} />))).toBe(rain);
  });

  it('the credit line reads “Forecast as of 06:55 · Open-Meteo”, once, with a Why holding the span and the thresholds', () => {
    const html = renderToStaticMarkup(
      <ComingUpLabel id="forward-coming" fetchedAt={F0.fetchedAt} now={WED_0703} timeZone={NZ} />,
    );
    expect(words(html)).toContain('Coming up');
    expect(words(html)).toContain('Forecast as of 06:55 · Open-Meteo');
    expect(html).toContain('id="forward-coming"');
    expect((html.match(/data-testid="forecast-credit"/g) ?? []).length).toBe(1);
    const why = words(html.slice(html.indexOf('data-testid="forecast-why"')));
    expect(why).toContain('planning hours, 08:00–20:00');
    expect(why).toContain('at or below a 20% chance of rain, and under 0.2 mm');
    expect(why).toContain('60% or more, or 1 mm or more');
    expect(why).toContain('gusts of 50 km/h or more');
  });

  it('with no forecast it is only the label', () => {
    const html = renderToStaticMarkup(
      <ComingUpLabel id="forward-coming" fetchedAt={null} now={WED_0703} timeZone={NZ} />,
    );
    expect(words(html)).toBe('Coming up');
    expect(html).not.toContain('credit-link');
  });
});

describe('an opening’s Why, from its facts (§4.5)', () => {
  const people = new Map(PEOPLE.map((p) => [p.id, { ...p, colour: null } as unknown as Person]));
  const lookupFor = (
    c: ReturnType<typeof compose>,
    extra: Partial<FactLookup> = {},
  ): FactLookup => ({
    days: c.days,
    people,
    calendars: new Map(),
    tasks: new Map(
      [FENCE, GARAGE].map((t) => [t.id, { ...t, estimateMinutes: t.estimateMinutes } as never]),
    ),
    projects: new Map(),
    timeZone: NZ,
    ...extra,
  });
  const why = (c: ReturnType<typeof compose>, key: string, extra?: Partial<FactLookup>) => {
    const o = c.openings.find((x) => x.key.includes(key))!;
    return words(
      renderToStaticMarkup(<OpeningExplanation opening={o} lookup={lookupFor(c, extra)} />),
    );
  };

  it('a task opening: the rule, the commitment before, the household, the forecast and its credit, the task, the fixed limit', () => {
    const c = compose();
    const w = why(c, '2026-10-17:1000-1930:task');
    expect(w).toContain(
      'Nothing is recorded for anyone in the household from the end of Football (10:00) to the end of daylight (19:30; sunset 19:4',
    );
    expect(w).toContain('Before');
    expect(w).toContain('Football');
    expect(w).toContain('Household:');
    expect(w).toContain(
      'Forecast fetched Wednesday 14 October, 06:55 (Open-Meteo), for Saturday, 08:00–20:00: looks dry.',
    );
    expect(w).toContain('The task, as recorded');
    expect(w).toContain('About three hours; dry weather and daylight');
    expect(w.endsWith("It isn't a check of anyone's plans.")).toBe(true);
  });

  it('a plain opening bounded by the planning hours and sunset has no task and no “Before”', () => {
    const c = compose();
    const w = why(c, '2026-10-18:0800-1930');
    expect(w).toContain(
      'from the start of planning hours (08:00) to the end of daylight (19:30; sunset',
    );
    expect(w).not.toContain('The task, as recorded');
    expect(w).not.toContain('Before');
  });

  it('daylight at the start: “the start of daylight (…; sunrise …)”', () => {
    // Planning hours begin at 08:00, daylight later than that in winter.
    const winter = at('2027-06-19', '07:03', '+12:00');
    const c = compose({
      now: winter,
      forecast: null,
      point: { lat: -46.4, lon: 169.5 },
      window: { from: '2027-06-19', to: '2027-06-20' },
      events: [],
      tasks: [],
    });
    const o = c.openings[0]!;
    expect(o.edges.from).toBe('daylight');
    const w = why(c, '2027-06-19');
    expect(w).toContain('from the start of daylight (08:');
    expect(w).toMatch(/; sunrise 0[78]:\d\d\)/);
  });

  it('without weather there is no forecast line and no credit link', () => {
    const c = compose({ forecast: null });
    const html = renderToStaticMarkup(
      <OpeningExplanation opening={c.openings[0]!} lookup={lookupFor(c)} />,
    );
    expect(html).not.toContain('credit-link');
    expect(words(html)).not.toContain('Forecast fetched');
  });

  it('several matching tasks: the first is named, the others are listed', () => {
    const deck = task('t-deck', 'Stain the deck', {
      estimateMinutes: 120,
      needs: ['dry_weather'],
      dueDate: '2026-10-30',
    });
    const c = compose({ tasks: [FENCE, deck] });
    const o = c.openings.find((x) => x.key.includes(':task:'))!;
    expect(o.task!.id).toBe('t-deck');
    const lookup = lookupFor(c, {
      tasks: new Map([FENCE, deck].map((t) => [t.id, t as never])),
    });
    const w = words(renderToStaticMarkup(<OpeningExplanation opening={o} lookup={lookup} />));
    expect(w).toContain('Other tasks recorded the same way');
    expect(w).toContain('Paint the back fence');
  });

  it('the credit link follows an opening only when the page has no forecast words of its own', () => {
    const c = compose();
    const shown = c.openings.map((o) => ({ key: o.key, opening: o })) as never[];
    expect(creditOpeningKey({ shown, rest: [] })).toBe(c.openings[0]!.key);
    const none = compose({ forecast: null }).openings.map((o) => ({
      key: o.key,
      opening: o,
    })) as never[];
    expect(creditOpeningKey({ shown: none, rest: [] })).toBeUndefined();
  });

  it('a stale calendar is named in the Why', () => {
    const c = compose({ calendars: [STALE_CALENDAR] });
    const o = c.openings[0]!;
    expect(o.qualified).toBe(true);
    expect(o.text).toContain(', as far as HOME knows');
    void ID;
  });
});

describe('the screens’ boundaries, held in the source (X1, X12, W19)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const read = (p: string) => readFileSync(p, 'utf8');

  it('the credit link is rendered by exactly the weather pieces and the Worth knowing row, nowhere else', () => {
    const users = walk('src/app')
      .filter((f) => /\.tsx$/.test(f) && f !== join('src/app/_insights/weather/credit.tsx'))
      .filter((f) => /<CreditLink|from '.*weather\/credit'/.test(read(f)))
      .sort();
    expect(users).toEqual(
      [
        join('src/app/_insights/opening-explanation.tsx'),
        join('src/app/_insights/weather/forecast-credit-line.tsx'),
        join('src/app/_insights/weather/weather-today.tsx'),
        join('src/app/_insights/worth-knowing.tsx'),
      ].sort(),
    );
  });

  it('neither composition reaches a provider, and Forward reads the forecast on Week alone', () => {
    for (const f of ['src/app/(home)/today/compose.ts', 'src/app/(home)/forward/compose.ts'])
      expect(read(f)).not.toMatch(/integrations\/|fetchForecast|refreshForecast|safe-fetch/);
    expect(read('src/app/(home)/forward/compose.ts')).toMatch(
      /horizon === 'week' \? await readForecast/,
    );
  });

  it('a person’s page and Month and Season mount no weather piece', () => {
    const person = read('src/app/(home)/people/[id]/page.tsx');
    expect(person).not.toMatch(/weather|Weather|forecast|Forecast|CreditLink/);
  });

  it('the Content-Security-Policy gains nothing for the credit (a link needs no connect-src or img-src)', () => {
    const csp = walk('src').filter((f) => /csp/i.test(f));
    for (const f of csp) expect(read(f)).not.toMatch(/open-meteo/);
  });
});
