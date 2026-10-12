import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { gaps } from '@/domain/engines/gaps';
import { addDays } from '@/lib/dates';
import { timed } from '../today/household';
import { ALL_SCOPES, healthy, ID, NZ, VISIBLE } from './fixture';

// What the gap engine costs (contract §3.8, §8.6 X3; ADR 0011 §38): over
// Forward's 90-day agenda for a synthetic 300-event household, gaps over seven
// days (Forward Week) and over all 90, for the household and every household
// person; and a dense day of 50 overlapping events. The engine sorts each
// day's intervals for a scope once and sweeps them, so its work follows the
// occurrences, not their square. Timings are logged for the ADR; the bounds
// are loose so a slow CI runner does not fail them.

const FROM = '2026-10-14';
const TO = addDays(FROM, 89);
const NOW = new Date('2026-10-14T07:03:00+13:00');
const people = [ID.sam, ID.alex, ID.milo, ID.isla];

/** The conflict engine's synthetic household: weekly series and one-offs, two people each. */
function household(series: number, oneOffs: number): AgendaEventInput[] {
  const out: AgendaEventInput[] = [];
  for (let k = 0; k < series; k++) {
    const day = addDays(FROM, k % 7);
    const hour = 6 + ((k * 5) % 14);
    out.push(
      timed(
        `s-${k}`,
        `Series ${k}`,
        `${day}T${String(hour).padStart(2, '0')}:00:00+13:00`,
        `${day}T${String(hour + 1).padStart(2, '0')}:15:00+13:00`,
        {
          rrule: 'FREQ=WEEKLY',
          people: [
            { personId: people[k % 4]!, role: 'attending' },
            { personId: people[(k + 1) % 4]!, role: k % 3 ? 'attending' : 'responsible' },
          ],
        },
      ),
    );
  }
  for (let k = 0; k < oneOffs; k++) {
    const day = addDays(FROM, (k * 7) % 90);
    const hour = 7 + ((k * 3) % 13);
    out.push(
      timed(
        `o-${k}`,
        `One-off ${k}`,
        `${day}T${String(hour).padStart(2, '0')}:30:00+13:00`,
        `${day}T${String(hour + 1).padStart(2, '0')}:30:00+13:00`,
        { people: k % 5 ? [{ personId: people[k % 4]!, role: 'attending' }] : [] },
      ),
    );
  }
  return out;
}

function measure(events: AgendaEventInput[], days: number) {
  const placed = agenda({ from: FROM, to: TO, timeZone: NZ, events });
  const input = {
    now: NOW,
    timeZone: NZ,
    range: { from: FROM, to: addDays(FROM, days - 1) },
    agendaRange: { from: FROM, to: TO },
    days: placed,
    people: VISIBLE,
    tasks: [],
    calendars: [healthy(NOW)],
    scopes: ALL_SCOPES,
  };
  const t0 = performance.now();
  const cold = gaps(input);
  const t1 = performance.now();
  // Warm: the median of five runs, what a page pays after the first request.
  const warm: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    gaps(input);
    warm.push(performance.now() - a);
  }
  warm.sort((a, b) => a - b);
  return { coldMs: t1 - t0, warmMs: warm[2]!, gaps: cold.gaps.length };
}

describe('gap engine performance (contract §3.8, X3)', () => {
  it('a 300-event household over Forward’s 90-day agenda: gaps over 7 and 90 days, five scopes', () => {
    const events = household(60, 240);
    const week = measure(events, 7);
    const season = measure(events, 90);
    console.info(
      `gaps 300 events: 7 days ${week.gaps} gaps, ${week.coldMs.toFixed(1)} ms cold, ${week.warmMs.toFixed(1)} ms warm; ` +
        `90 days ${season.gaps} gaps, ${season.coldMs.toFixed(1)} ms cold, ${season.warmMs.toFixed(1)} ms warm`,
    );
    expect(week.gaps).toBeGreaterThan(0);
    // Loose bounds: an order of magnitude above what the dev container measures.
    expect(week.warmMs).toBeLessThan(100);
    expect(season.warmMs).toBeLessThan(1_000);
  });

  it('a dense day: 50 overlapping events on one Sunday', () => {
    const sunday = '2026-10-18';
    const events = Array.from({ length: 50 }, (_, k) =>
      timed(
        `d-${k}`,
        `Dense ${k}`,
        `${sunday}T${String(8 + (k % 10)).padStart(2, '0')}:${String((k * 7) % 60).padStart(2, '0')}:00+13:00`,
        `${sunday}T${String(9 + (k % 10)).padStart(2, '0')}:${String((k * 11) % 60).padStart(2, '0')}:00+13:00`,
        { people: [{ personId: people[k % 4]!, role: 'attending' }] },
      ),
    );
    const r = measure(events, 7);
    console.info(
      `gaps dense day (50 overlapping events): ${r.gaps} gaps over 7 days, ${r.coldMs.toFixed(1)} ms cold, ${r.warmMs.toFixed(1)} ms warm`,
    );
    expect(r.warmMs).toBeLessThan(100);
  });
});
