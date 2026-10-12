import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { conflictsOver } from '@/domain/insights/conflicts';
import { openingsOver } from '@/domain/insights/openings';
import { addDays } from '@/lib/dates';
import { timed } from '../today/household';
import { calendarAt, F0, ID, NZ, PEOPLE, WED_0703, WELLINGTON } from './fixture';

// What openings cost (contract §3.8, §8.6 X3; ADR 0011 §38): over Forward's
// 90-day agenda for a synthetic 300-event household with 100 waiting tasks,
// the openings composition over Forward Week (the household's gaps, daylight,
// the forecast, matching), and the pure part of `respondToInsight`'s
// eligibility read (one 90-day placement, conflicts over all of it, openings
// over the week). Timings are logged for the ADR; the bounds are loose so a
// slow CI runner does not fail them.

const FROM = '2026-10-14';
const TO = addDays(FROM, 89);
const people = [ID.sam, ID.alex, ID.milo, ID.isla];

/** The gap engine's synthetic household: weekly series and one-offs, two people each. */
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

/** 100 waiting tasks, a third of them matchable. */
const TASKS = Array.from({ length: 100 }, (_, k) => ({
  id: `t-${String(k).padStart(3, '0')}`,
  title: `Task ${k}`,
  status: 'open',
  dueDate: k % 4 ? null : addDays(FROM, k % 30),
  estimateMinutes: 30 + (k % 8) * 30,
  needs: k % 3 === 0 ? ['dry_weather', 'daylight'] : k % 3 === 1 ? ['daylight'] : [],
  projectId: null,
  assigneePersonId: null,
  scheduledStartsAt: null,
  scheduledEndsAt: null,
}));

const timeIt = (f: () => unknown) => {
  const t0 = performance.now();
  f();
  const cold = performance.now() - t0;
  const warm: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    f();
    warm.push(performance.now() - a);
  }
  warm.sort((a, b) => a - b);
  return { coldMs: cold, warmMs: warm[2]! };
};

describe('openings performance (contract §3.8, X3)', () => {
  it('a 300-event household with 100 waiting tasks: openings over Forward Week, and the 90-day eligibility read', () => {
    const events = household(60, 240);
    // The authorised read's shapes, as `readAgendaInputs` gives them (only the fields read).
    const inputs = {
      events,
      people: PEOPLE.map((p) => ({ ...p })),
      records: { tasks: TASKS, projects: [], calendars: [{ ...calendarAt(WED_0703) }] },
    } as unknown as Parameters<typeof openingsOver>[0] & Parameters<typeof conflictsOver>[0];
    const weather = { forecast: F0, point: WELLINGTON };
    const week = { from: FROM, to: addDays(FROM, 6) };
    const range = { from: FROM, to: TO };
    const placed = agenda({ ...range, timeZone: NZ, events });

    let found = 0;
    const forward = timeIt(() => {
      found = openingsOver(inputs, placed, WED_0703, NZ, week, range, weather).length;
    });
    const eligibility = timeIt(() => {
      const days = agenda({ ...range, timeZone: NZ, events });
      conflictsOver(inputs, days, WED_0703, NZ, range);
      openingsOver(inputs, days, WED_0703, NZ, week, range, weather);
    });
    // M6's part of the same read, without openings, for the difference.
    const m6 = timeIt(() => {
      const days = agenda({ ...range, timeZone: NZ, events });
      conflictsOver(inputs, days, WED_0703, NZ, range);
    });
    console.info(
      `openings 300 events, 100 tasks: Forward Week ${found} openings, ${forward.coldMs.toFixed(1)} ms cold, ${forward.warmMs.toFixed(1)} ms warm; ` +
        `respondToInsight's 90-day read (placement, conflicts, openings) ${eligibility.coldMs.toFixed(1)} ms cold, ${eligibility.warmMs.toFixed(1)} ms warm, ` +
        `of which M6's placement and conflicts ${m6.warmMs.toFixed(1)} ms warm`,
    );
    // Loose bounds: an order of magnitude above what the dev container measures.
    expect(forward.warmMs).toBeLessThan(100);
    expect(eligibility.warmMs).toBeLessThan(2_000);
  });
});
