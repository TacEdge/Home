import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEventInput } from '@/domain/engines/agenda';
import { conflicts, type ConflictPerson } from '@/domain/engines/conflicts';
import { insights } from '@/domain/engines/insights';
import { addDays } from '@/lib/dates';
import { ID, NZ, PEOPLE, ROUTINE, timed, WEDNESDAY } from '../today/household';

// What the conflict engine costs over a 90-day window (contract §3.7): the
// fixture household, then synthetic households of 300 and 1,200 events. The
// engine compares an occurrence only with those still running when it
// starts (a sweep per person), so its work follows the occurrences and the
// overlaps, not the square of the occurrences. Timings are logged for the
// ADR; the bounds are loose so a slow CI runner does not fail them.

const VISIBLE: ConflictPerson[] = PEOPLE.map((p) => ({
  id: p.id,
  name: p.name,
  inHousehold: p.inHousehold,
}));
const FROM = '2026-10-14';
const TO = addDays(FROM, 89);
const NOW = new Date('2026-10-14T07:03:00+13:00');
const people = [ID.sam, ID.alex, ID.milo, ID.isla];

/** `series` weekly series and `oneOffs` one-offs over 90 days, two people each, some overlapping. */
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
        {
          people: [
            { personId: people[k % 4]!, role: 'attending' },
            { personId: people[(k + 2) % 4]!, role: 'responsible' },
          ],
        },
      ),
    );
  }
  return out;
}

function measure(events: AgendaEventInput[]) {
  const t0 = performance.now();
  const days = agenda({ from: FROM, to: TO, timeZone: NZ, events });
  const t1 = performance.now();
  const found = conflicts({
    now: NOW,
    timeZone: NZ,
    window: { from: FROM, to: TO },
    days,
    coverage: { from: FROM, to: TO },
    events,
    people: VISIBLE,
  });
  const t2 = performance.now();
  // A second run, warm: what a page pays after the first request.
  conflicts({
    now: NOW,
    timeZone: NZ,
    window: { from: FROM, to: TO },
    days,
    coverage: { from: FROM, to: TO },
    events,
    people: VISIBLE,
  });
  const t3 = performance.now();
  const occurrences = new Set(
    days.flatMap((d) =>
      d.items.flatMap((i) => (i.kind === 'event' ? [`${i.eventId}:${i.occurrenceDate}`] : [])),
    ),
  ).size;
  const instances = found.reduce((n, c) => n + c.instances.length, 0);
  return {
    agendaMs: t1 - t0,
    engineMs: t2 - t1,
    warmMs: t3 - t2,
    occurrences,
    conflicts: found.length,
    instances,
  };
}

describe('conflict engine performance over 90 days (contract §3.7)', () => {
  it('the fixture household, 300 and 1,200 events', () => {
    const rows = {
      fixture: measure([...ROUTINE, ...WEDNESDAY]),
      '300 events': measure(household(60, 240)),
      '1,200 events': measure(household(240, 960)),
    };
    for (const [name, r] of Object.entries(rows))
      console.info(
        `conflicts ${name}: ${r.occurrences} occurrences, ${r.conflicts} conflicts (${r.instances} overlaps); ` +
          `agenda ${r.agendaMs.toFixed(0)} ms, engine ${r.engineMs.toFixed(1)} ms (warm ${r.warmMs.toFixed(1)} ms)`,
      );
    expect(rows['300 events'].conflicts).toBeGreaterThan(0);
    // Loose bounds: an order of magnitude above what the dev container measures.
    expect(rows['300 events'].warmMs).toBeLessThan(1_000);
    expect(rows['1,200 events'].warmMs).toBeLessThan(5_000);
  });

  it('standing identity keeps a recurring pair to one conflict however long the window', () => {
    const r = measure(household(60, 0));
    expect(r.instances).toBeGreaterThan(r.conflicts * 10); // ~13 Wednesdays each, one key
  });

  it('Today’s composition (M6 Package 3): conflicts and insights over eight days of a 300-event household', () => {
    const events = household(60, 240);
    const to = addDays(FROM, 7);
    const t0 = performance.now();
    const days = agenda({ from: FROM, to, timeZone: NZ, events });
    const t1 = performance.now();
    const found = conflicts({
      now: NOW,
      timeZone: NZ,
      window: { from: FROM, to },
      days,
      coverage: { from: FROM, to },
      events,
      people: VISIBLE,
    });
    const r = insights({
      now: NOW,
      timeZone: NZ,
      days,
      events,
      people: PEOPLE,
      tasks: [],
      projects: [],
      calendars: [],
      conflicts: found,
    });
    const t2 = performance.now();
    console.info(
      `Today (8 days, 300 events): ${found.length} conflicts, ${r.all.length} insights; ` +
        `agenda ${(t1 - t0).toFixed(0)} ms, conflicts and insights ${(t2 - t1).toFixed(1)} ms`,
    );
    expect(r.shown.length).toBeLessThanOrEqual(3);
    expect(t2 - t1).toBeLessThan(1_000);
  });
});
