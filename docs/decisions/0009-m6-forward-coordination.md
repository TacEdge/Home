# ADR 0009 — M6 Forward Coordination: scope, architecture and decisions

Status: **Accepted**, 2026-10-09. The owner approved the product decisions on PR #59 (§20–§29, as refined there) and accepted this ADR and the contract (`docs/m6/M6-BUILD-CONTRACT.md`) by merging Package 0.

- **Implementation:** Package 1 (Forward groundwork and engine, §32) is in review.
- **Refinements on PR #59:**
  - `conflict.away` removed (§12, §24);
  - conflict identity and lifecycle defined precisely (§13);
  - transport approved as deferred (§20);
  - Forward's hierarchy set (§15).

## Context

M5 is technically accepted on synthetic data (`docs/m5/M5-ACCEPTANCE.md`, ADR 0008 §34), and PR #58 has merged. The milestones before it are still waiting on owner steps in DEPLOY.md §E:

| Milestone | Waits on |
|---|---|
| M5 operational acceptance (real family use) | Items 16–17 |
| M4 operational acceptance | Items 12–15 |
| M3 owner acceptance (the restore rehearsal) | Items 7–8 |
| M1 acceptance | Items 1–6 |

The Production real-data gate is closed (ADR 0006 §2).

Forward is still M3's plain 30-day list (ADR 0006 §4), with synced events (M4) and overnight carry-over (ADR 0008 §24). It has no horizons, no headline, no conflicts and no insights.

The ROADMAP M6 row commits M6 to: *"Forward per the M0 concept (week / month / season); delete `/prototype` (tag `m0.6-prototype` keeps it); conflict engine and `conflict` insights on Today and Forward; dismiss / not useful."*

ADR 0008 moved these into M6 or left them for it:

- conflicts (§3);
- "Not useful" (§23; plain Dismiss was built in M5);
- Forward changes (§3);
- sheets (§25).

ADR 0008 §21 also records that M6's conflict engine, as SYSTEM-ARCHITECTURE §2.2 describes it, expects "double-booked responsibilities" and "unassigned responsibilities". Both depend on a structured transport record that does not exist.

Earlier decisions already settle much of the shape:

- **The Forward concept:** `docs/concepts/FORWARD.md`, with the refinements in `docs/concepts/README.md`.
- **Clashes belong on the affected item** (ADR 0002 §2).
- **"+ N more" counts only genuine insights** (ADR 0002 §3).
- **Forward on phones shows two list items, then "+ N more"** (M0.6 refinement 5).
- **Insights are derived on read; only responses persist** (CLAUDE.md rule 15).
- **The four layers and the absence rule** (ADR 0008 §5, §6): only known facts and deterministic interpretation are shown, and a missing record proves nothing.
- **Kev belongs to M8–M10.** Kev phrasing, "Read the week ahead", "Sort it" and proposals are not M6.

## Decisions

### Scope

1. **M6 is Forward Coordination, computed without Kev.** It moves Forward from "what's on" towards "what's coming up, and what needs a look". It applies written, deterministic rules to records the household has already made. Nothing in M6 calls an LLM. Forward and Today are complete without Kev.

2. **M6 builds:**
   - **Forward, with Week as the primary experience.** Month and Season are progressively higher-level summaries with the same structure. Horizons are switched without JavaScript.
   - **A factual horizon headline**, deterministic, from a closed set of templates.
   - **Coming up:** one row per unit (days, weeks or months), each with a factual load indicator and its notable items. Routine is folded into **The usual**.
   - **A conflict engine** with two rules: `conflict.overlap` and `conflict.responsible` (§9–§14).
   - **Conflict insights** on Today, Forward and a person's Coming up: on the affected item where it is drawn, and in Worth knowing where it is not.
   - **"Not useful"** beside Dismiss (§17).
   - **Deletion of `/prototype`**; the tag `m0.6-prototype` keeps it.

3. **M6 does not build** the following:

   | Item | Why, or where it goes |
   |---|---|
   | Transport: getting there, **Who?**, `coordination_gap`, unassigned or double-booked transport | §20: deferred; re-decided at M9 planning |
   | `conflict.away`, or any conflict built on all-day `travel` events | §12, §24: an all-day travel event alone does not establish that someone is unavailable |
   | "Both adults away" | §25 |
   | "Worth deciding early" and other season observations built on absence ("nothing planned for the break yet") | The absence rule (ADR 0008 §6) |
   | Load described as character ("busy midweek, easy weekend", "stressful", "overwhelming") | ADR 0008 §5; load is a factual indicator (§22) |
   | Free time inferred from empty calendar space | ADR 0008 §6 |
   | Weather, free windows, `alignment`, availability | M7 |
   | Kev phrasing, "Read the week ahead", long-press "Ask Kev about this", the Kev bar | M8–M10 |
   | "Sort it", proposals, "look at what could move" | M9 |
   | Sheets and swipe gestures | M10 (§23) |
   | A separate texture graphic for Season | §22: one structure on every horizon |
   | Holidays and school terms as data | Not in the data model; nothing infers them |
   | A month grid, an hour grid, counts like "14 events", a year view | The concept's deliberate absences |
   | Push notifications, background jobs, stored insights, adaptive ranking | ROADMAP "Not yet" |

4. **No new schema.** M6 needs no table, column, enum value or migration. `insight_response.response` already accepts `not_useful` (migration `0006`). Any schema change needs a separate owner decision and its own migration-first package.

### What Forward may say

5. **The four layers hold unchanged** (ADR 0008 §5). Forward uses only known facts and deterministic interpretation.

   The concept's example headlines are character, not counts, so M6 does not use them: "Busy midweek, easy weekend.", "Steady till December, then it all happens at once.". Its observations built on absence are also out: "nobody's down for pickup", "nothing planned for the break yet", "worth planning soon?". M6's wording states counts, dates, names and recorded overlaps.

6. **Traceability.** Every headline, row, load indicator, mark and insight carries:
   - its `rule`, from a closed, documented list;
   - its `facts`: record ids, dates and instants only, never text.

   Each shows its facts in place without JavaScript. A statement with no traceable rule is not shown.

7. **Absence proves nothing** (ADR 0008 §6).
   - A day with nothing recorded is "nothing recorded", never "free" or "clear".
   - Empty calendar space is never presented as free time.
   - A child's event with no adult recorded is shown as recorded and never flagged.
   - A missing record is never a need, an assignment, an availability, an arrangement or a reassurance.

### Architecture

8. **There is still one agenda engine.** The M3–M5 loader (`readAgendaInputs`, `loadAgenda`) and engine (`src/domain/engines/agenda.ts`) stay the only place that places, expands and orders items. Forward reads 90 days through them, in one read.

   Two pure engines are added under `src/domain/engines/`:
   - **`forward.ts`**: horizons, units, notable or usual, load bands, the headline and caps;
   - **`conflicts.ts`**: the two conflict rules, their identity and their order.

   The insights engine gains the `conflict` family and a window parameter. Today's other detectors are unchanged.

   All three engines are pure functions of the reader's records, the agenda's output, the home zone and an injected `now`. They never read the database or the clock, and never import `db`, `app`, `kev`, `ui` or `integrations`.

### Conflicts

9. **Three classes, and only two are stated.**

   | Class | What it is | In M6 |
   |---|---|---|
   | **A. A proven overlap of records** | The same visible person is recorded on two visible timed occurrences whose times overlap | **Stated**, as recorded: `conflict.overlap` |
   | **B. A recorded responsibility conflict** | The same visible person is recorded as `responsible` on both of two overlapping timed occurrences | **Stated**: `conflict.responsible` |
   | **C. A possible concern that needs more information** | For example: a child's event with no adult recorded; an event that may need a lift; both adults with travel recorded; someone on an all-day travel event with something else that day | **Never stated.** No rule produces it in M6. |

10. **`conflict.overlap`.**
    - **When two occurrences overlap:** both are timed, and each starts before the other ends (`a.start < b.end && b.start < a.end`). Back-to-back occurrences, where one ends exactly when the other starts, do not overlap. All-day events take part in no conflict.
    - **Who it is about:** one person. That person is visible and on both occurrences. "On" means the people the agenda shows: the event's own annotations, else its calendar's usual people, or a changed occurrence's series people (ADR 0007 §14, §46).
    - **Excluded:**
      - an occurrence that is Today's routine (`routine.regular_week`: a weekly or fortnightly `school` or `work` series with a household person on it). One-offs usually sit inside school and work hours on purpose.
      - a pair where both occurrences are of kind `work`. A work calendar's own double-bookings are not household coordination.
      - a pair of occurrences of the same event. A series never conflicts with itself.

    One occurrence carried over several days is still one occurrence (`occurrenceKey`).

11. **`conflict.responsible`.** The same test as §10, for a person recorded as `responsible` on both occurrences. For that person it replaces `conflict.overlap`; it is never added alongside it.
    - It says only that the person is recorded as responsible for both. It never says "can't", "double-booked", "needs cover" or anything about getting there.
    - `responsible` keeps the meaning ADR 0008 §21 gave it, and is never read as transport (§20).

12. **`conflict.away`: not in M6** (owner decision, §24). An all-day `travel` event alone does not establish that someone is unavailable. M6 states conflicts only from timed overlaps, which are explicit and defensible scheduling facts.

13. **Identity and lifecycle** (contract §5.7 has the examples and the acceptance tests).

    **One conflict per person per pair.** A conflict is about one person and two commitments. When two people are on both occurrences, each has their own conflict, with its own key and its own responses. The rule for each person is decided by that person's own roles.

    **There are two kinds of identity:**

    | Kind | When | Key |
    |---|---|---|
    | **Standing** (case A) | Both occurrences are *unchanged* occurrences of recurring series: a series' own expansion, not a changed occurrence and not a one-off | `{rule}:{person}:{seriesA}.{seriesB}:w{HHMM}-{HHMM}`. The window is the overlap's start and end on the home-zone wall clock. |
    | **Occurrence** (case B) | Either occurrence is a one-off or a changed occurrence (its own event row) | `{rule}:{person}:{eventA}.{eventB}:{startUTC}-{endUTC}`. The window is the overlap's start and end as UTC instants, to the minute (`YYYYMMDDTHHMMZ`). For an unchanged series occurrence the event id is the series id. |

    - **Key format.** Event ids are sorted. Keys are built from ids and times only, never from the date of viewing and never from text. Every key fits `insightKey`, the longest being 161 characters.
    - **Material change.** A change is material exactly when it changes an identity input: the rule, the person, either commitment, or the overlap window. A material change produces a new key, and the new conflict is eligible again for both adults. Anything else is not material and keeps the key, including:
      - titles, notes, places;
      - other people on either occurrence;
      - an end or start that moves without moving the overlap;
      - skipping a different occurrence;
      - extending a series' rule while the overlap window stays the same;
      - a calendar refresh that keeps the same rows.
    - **Lifecycle.** A response (Dismiss or Not useful) belongs to one adult and one key. It suppresses that conflict wherever and whenever the key is current, with no expiry.
      - **When a material change happens,** the old response matches nothing and stays in place, harmless.
      - **When the inputs return to an earlier state,** that earlier response applies again. Examples: a change put back to the series, an archived event restored, a skip put back. The situation is one the adult has already answered.
      - **A standing conflict** is said once, at its next occurrence. A response to it holds for every occurrence of the pattern.
      - **A changed occurrence** is its own row, so it has its own key. It is never covered by a response to the standing pattern.

    **Order:**
    1. `conflict.responsible`, then `conflict.overlap`;
    2. then the earliest overlap start;
    3. then the key.

    This is a total order.

    **Clusters.** Three occurrences that all overlap produce one conflict per pair per person. Pairs are not merged in M6, and caps keep the list short. This is a recorded risk.

14. **Explanation.** Each conflict's "Why ›" gives, in Today's row style:
    - the rule in one plain sentence;
    - the two occurrences, with their times and recorded people;
    - the overlap ("from 15:45 to 16:15");
    - for a standing conflict, that both repeat and when the next one is;
    - for `conflict.responsible`, that the person is recorded as responsible on both.

    It never gives locations, travel or reasons.

### Forward

15. **Hierarchy, horizons, units and notable items.** *Approved* (owner, PR #59).

    - **Week is the primary Forward experience** and the default. Month and Season are progressively higher-level summaries of the same thing, not separate dashboards.
    - **Every horizon has the same four parts, in this order:**
      1. the factual headline;
      2. Worth knowing;
      3. Coming up (the upcoming commitments, one row per unit);
      4. The usual.
    - **Units by horizon:**

      | Horizon | Days | Unit |
      |---|---|---|
      | Week | 7, from today | days |
      | Month | 30, from today | weeks: the first from today to Sunday, then Monday to Sunday |
      | Season | 90, from today | months |

      Every unit is drawn, including empty ones ("Nothing recorded besides the usual").

    - **The usual.** An occurrence is usual when it is an unchanged occurrence of a series in a household person's regular week (the profile engine's `regularWeek`). That is the test the profile page already uses.
    - **Notable** is everything else:
      - any occurrence in a current conflict for the reader that the reader has not responded to, even a usual one, so a conflict is always drawn on its item;
      - one-offs;
      - changed occurrences;
      - all-day and multi-day events;
      - birthdays;
      - project target dates;
      - tasks due;
      - scheduled tasks (§26).

      Forward's usual is broader than Today's routine, which is school and work only (§21).
    - **Rows** show notable items only:
      - Week: up to two per day;
      - Month: three per week;
      - Season: three per month;

      then "+ N". Within a row, the order is:
      1. items with a conflict;
      2. birthdays;
      3. all-day and multi-day events;
      4. project targets;
      5. tasks due;
      6. scheduled tasks;
      7. timed items by start;

      then by agenda order. This order is written and tested; it ranks by kind and time, not by importance.
    - **The usual ›** is a disclosure listing each household person's regular week, from the existing profile engine.

16. **Headline.** A closed set of factual templates per horizon, each a named rule:
    - first run;
    - nothing recorded;
    - only the usual;
    - listed (one or two notable items, named);
    - counted;
    - a second sentence when conflicts fall in the window;
    - the "As far as HOME knows." qualifier when a visible calendar is stale or failing.

    It reports counts, names and dates, never character, and never free time. Final copy is approved by the owner from screenshots in Package 4.

### Insights, Dismiss and Not useful

17. **Dismiss and Not useful.** *Approved* (owner, PR #59).
    - **Dismiss** hides that insight, by key, for that adult. It is unchanged from M5.
    - **Not useful** does the same, and records the adult's explicit judgement that the observation did not help. It is stored as the existing `insight_response` row with `response = 'not_useful'`, through the existing `respond`, audited and gated.
    - **Neither changes any rule, threshold, ranking or other insight.** There is no adaptive ranking, no learning and no suppression of a whole rule.
    - **What `not_useful` is for:** the household and its developers review it deliberately, in the M10 trial retrospective, from each adult's own export. Any change to a detector that follows is an ADR amendment. Kev does not read it in M6, and any later use by Kev needs its own decision.
    - **Where Not useful is offered:** inside the insight's "Why ›" disclosure, as a secondary action (TODAY.md §4).

18. **Where insights appear.**

    | Surface | Families | On the item (not listed) |
    |---|---|---|
    | **Today**, window today + 7 | `data_health`, `conflict`, `preparation`, `busy_day` | Today's conflicts, on the person line or Also today row; plus M5's on-object rules |
    | **Forward, Week** | `data_health` | Every conflict, on its row item |
    | **Forward, Month and Season** | `data_health`, `conflict` | None. Conflicts are listed, because there are no day rows to put them on. |
    | **Coming up** (a person) | — | That person's conflicts, on their items |

    - **Why only these on Forward.** `preparation` and `busy_day` stay Today's. On Forward, birthdays and targets are on the rows, and the load is the row's indicator.
    - **Ranking:**
      - by family: `data_health`, then `conflict`, then `preparation`, then `busy_day`;
      - then within the family (§13);
      - then by date;
      - then by key.
    - **How many are shown:** Today shows three. Forward shows two, then "+ N more" (M0.6 refinement 5). "+ N more" counts only listed insights with no response from the reader.

19. **Responses reach everywhere the reader sees that key.** A conflict dismissed on Today is gone from Forward and from Coming up, and the other way round. A conflict with a response is neither listed nor marked on its item for that adult. The items themselves are untouched.

    The response service re-derives the reader's own insights over the longest window (90 days) and accepts:
    - a conflict key that is current;
    - any other key that is current and listable on the surface named in the request.

    Everything else is refused as `not_eligible`, as in M5.

### Owner decisions

20. **Transport: Approved — defer the structured transport-responsibility model** (Option C; contract §6).
    - **The rule for M6:** existing `event_person` responsibility is never interpreted as transport responsibility.
    - **M6 never infers:**
      - who is taking a child somewhere;
      - whether transport is required;
      - whether transport has been arranged;
      - whether a parent is available to provide transport.
    - **No transport output:** no transport wording, no **Who?** and no `coordination_gap`.
    - **When it is revisited:** structured transport is re-decided at M9 planning, using real-family evidence where available.

21. **The usual on Forward is the regular week: Approved.** It covers all kinds, built on the existing regular-week model. Today keeps its narrower routine compression.

    "Besides the usual" therefore means school and work on Today, and the regular week on Forward. The difference is written into both headlines' Why.

22. **Load indicators: Approved, as factual indicators.**
    - **What is counted:** the notable items per unit. The usual is not counted.
    - **Bands:**

      | Unit | Band 0 | Band 1 | Band 2 | Band 3 |
      |---|---|---|---|---|
      | Day | 0 | 1–2 | 3–4 | 5 or more |
      | Week or month | 0 | 1–4 | 5–9 | 10 or more |

    - **How they are drawn:** in ink tones, never the Sun accent. Each has a factual text equivalent ("Three things recorded").
    - **Wording:** never "busy", "easy", "stressful", "overwhelming", "quiet" or "free".
    - **Status:** code constants, provisional, evaluated in the M10 trial (as ADR 0008 §22).
    - **Refinement:** the concept's separate Season texture strip is not built. Each month row carries the same indicator as every other row, so the three horizons share one structure.

23. **Sheets: Approved — deferred to M10 design polish.**
    - Items keep linking to their full pages.
    - A Month week or a Season month expands in place (`<details>`).
    - The horizon switch is three links.
    - Swipe is not built.

24. **`conflict.away`: Excluded** (owner, PR #59). See §12. No availability or transport-related conflict is introduced.

25. **"Both adults away": Excluded.** It is class C (§9).

26. **Scheduled tasks on Forward: Approved, in Package 1.**
    - V0.1-SCOPE lists "scheduled tasks" on Forward, and M3–M5 never delivered it. The agenda gains a `task_scheduled` item (open tasks with `scheduled_starts_at`).
    - Today already shows these under To do, so Today's no-regression test must place them there and not twice.

27. **Section name and marks: Approved.**
    - The section is "Worth knowing" on Forward, as on Today. The concept's "Needs sorting" claims a need that no rule establishes.
    - Conflict marks are restrained: a small ● in the Sun accent, beside factual wording, with "Why ›". It is the only use of the accent in M6.
    - Everything else is ○.

28. **Conflict visibility on Coming up: Approved.** A person's Coming up shows that person's conflict marks, from the same engine and with the same keys. Forward has no per-person filter in M6.

29. **The package plan: Approved.** Six packages, numbered 0–5 (§30; contract §2).

### Process

30. **Packages:**
    - **0:** this ADR and the contract.
    - **1:** Forward groundwork and engine.
    - **2:** the conflict engine.
    - **3:** coordination insights, Not useful and Today.
    - **4:** the Forward screen, and Coming up marks.
    - **5:** acceptance.

    Builder, review intensity and verification are set per package in contract §2. Review is risk-based: high for the conflict engine, for the feedback write path and for acceptance; medium elsewhere. Package 1 cannot start until the owner merges Package 0 and says to start.

31. **Production.** M6 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed. M6 adds no migration and no Production setting. Its operational acceptance on real records waits on the gate, through two new DEPLOY.md §E items added in Package 5.

### Implementation

32. **Package 1: Forward groundwork and engine.**

    - **One agenda, 90 days.** Forward composes every horizon from one read (`readAgendaInputs`, as the signed-in adult) and one 90-day run of the shared agenda engine. No second engine and no recurrence of its own. Recurrence identity, overnight placement, override suppression, changed occurrences and calendar default people all come through unchanged. The read costs a constant number of queries: measured through the real services at 9 for the test's composition (the 7-query agenda read plus a 2-query calendar read the page will not need, because the agenda read already carries the calendars), before and after 30 more events and tasks.
    - **Scheduled tasks (§26).** The agenda engine places an open task with a recorded scheduled window as a `task_scheduled` item on the home day its window starts. It sits among timed items by start, with an event before a task at the same start. Done and dropped tasks are never placed. Today still says a task once, under To do: its engine leaves `task_scheduled` out of Also today, person lines and Earlier today, as it already did `task_due`. The current 30-day Forward list shows the row ("Scheduled until 11:00") until Package 4 replaces the page. A person's Coming up is unchanged (it lists events and birthdays only).
    - **The Forward engine** (`src/domain/engines/forward.ts`, `forward()`), one composition for every horizon:
      - **Inputs:** the agenda's days, the events with their people, the reader's people, calendars, `now`, the home zone, the horizon, and conflicts (empty until Package 2).
      - **Units (§15):** days for Week, Monday-to-Sunday weeks for Month (the first runs from today to Sunday, so a Sunday gives a one-day "This week"), and calendar months for Season (with the year in the label once it changes). Every unit is drawn.
      - **Entries:** each occurrence (`{eventId}:{occurrenceDate}`), birthday, project target, task due or scheduled task appears once per unit, at its first day there. It is either notable or usual; nothing is dropped. A test checks, for every horizon, that the entries equal the agenda's items for each unit.
      - **The usual:** an event whose series is in a household person's regular week (`profile.regularWeek`), unless it is in a current conflict. A changed occurrence, a monthly or not-yet-begun series, and a series only a non-household person is on are notable. Nothing is read from a title.
      - **Rows:** ordered by kind and time (conflict, birthday, all-day or multi-day, project target, task due, scheduled task, timed), then day, agenda order and key: a total order. Shown up to the cap (2, 3, 3), with the rest kept in `rest` and `more` exactly `rest.length`.
      - **Load (§22):** the counted notable entries per unit, banded 1/3/5 for a day and 1/5/10 for a week or month, with the facts counted and a text equivalent: "Three things recorded", "Nothing recorded besides the usual" or "Nothing recorded".
    - **Counting rule.** As Today's (ADR 0008 §31): everything that begins in the range counts; a carry-over from before today counts only while it is still running at `now`. An overnight item from last night that has ended stays in its unit's entries (`counts: false`), so in that one case a row can show an item its load does not count.
    - **Headline (§16).** First run (no live calendar and no events), nothing, usual, listed, counted, then the overlaps sentence and the qualifier.
      - **Listed** is Week only, and only when the one or two notable items are events or birthdays, named as recorded with "today", "tomorrow" or "on {weekday}". Anything else is counted, which avoids wording rules for targets and tasks that the contract never set.
      - **Wording.** Every horizon reads "in the next …". The contract's Season example said "over the next 90 days"; the template said "in the next", and the template wins.
      - **Qualifier.** "As far as HOME knows." is its own sentence after the headline, as on Today.
      - **Facts.** The headline carries the items counted, or the range and calendars consulted.
      - **Determinism.** The engine imports only the agenda, day-facts, profile and today engines and the date library, and reads no clock.
    - **For Package 2.** The engine takes `conflicts: { key, occurrences }[]`, where `occurrences` are occurrence keys. The caller passes only the reader's current conflicts that the reader has not responded to.
      - An occurrence in one is notable (even a usual one), marked `conflicted`, and first in its row.
      - The headline's second sentence counts the conflicts touching the range ("There is one overlap.").
      - Package 1 passes none; the behaviour is unit-tested with synthetic conflicts.
    - **Other groundwork.**
      - The insights engine takes an optional last day (`through`, default today + 7), so Today is unchanged.
      - The Forward page reads the test time source (`requestNow`), and `loadAgenda` takes the screen's today.
      - The audit-log scan in `proposals.test.ts` has an explicit 30-second timeout (M5-ACCEPTANCE §9).
    - **Prototype retired.**
      - **Before deleting:** the tag `m0.6-prototype` was confirmed on `origin` at `3d58390`, and no route, source file or test referred to `/prototype`; only the build, lint, format and deploy exclusions named it.
      - **What was removed:** the directory and those exclusions. CLAUDE.md rule 14 now records the retirement; README, LOCAL-DEV and DEPLOY say how the tag restores a local copy for reference.
      - **What it kept:** the design references live on in `docs/concepts/`, including its six fixture states (README) and the scenario family.
      - **Test:** `prototype-retired.test.ts` fails if the directory or any exclusion returns.
    - **Evidence.**
      - **Engine unit tests** (`tests/unit/forward/`):
        - units and labels across month, year and week ends;
        - the NZ DST start and end;
        - UTC, London and New York (on their own clock-change days);
        - overnight and all-day items;
        - changed and skipped occurrences;
        - scheduled tasks;
        - caps and exact "+ N";
        - load bands at every boundary;
        - every headline rule;
        - forbidden words over every horizon;
        - shuffled-input determinism;
        - traceability, and every rule id present in the contract;
        - purity.
      - **Non-interference through the real services:** Sam adds a private person with a birthday, a private weekly series, private one-offs across the season, a private scheduled task, task and project target, and a stale private calendar. Alex's model for Week, Month and Season is identical before and after, and Sam's changes. Putting a private person on a household event is refused by the domain (`references_private`), so that path cannot reach the other adult.
      - **Performance:** 300 events over 90 days (60 weekly series, 240 one-offs) take about 220 ms for the agenda and 55 ms for all three horizons on the dev container.
      - **Targeted mutations**, each failing its tests:
        - a recurring series of any kind counted as usual;
        - the household filter removed;
        - weeks ending on Monday;
        - one held row dropped;
        - "+ N" off by one;
        - a read handing Sam's records to Alex, simulated in the invariant test, because a temporary edit to the visibility predicate was not permitted in this environment.
    - **Unchanged.**
      - No schema, migration or new dependency.
      - No Forward screen: the page stays the plain 30-day list, apart from the scheduled-task rows and the test clock.
      - No conflict detection, Kev, transport or weather.

## Consequences

- **ROADMAP.** The M6 row records Package 0, the approved decisions and this ADR. The M5 row shows Package 5 merged.
- **SYSTEM-ARCHITECTURE §2.2 and §2.6, and KEV-AGENT-MODEL's `get_conflicts`.** These keep the long-term design: double or missing responsibilities, "both adults away", and `coordination_gap`. M6 narrows them as §9, §12 and §20 record. Their prerequisite remains a structured transport record, re-decided at M9 planning.
- **FAMILY-DATA-MODEL.** Unchanged; there is no schema change.
- **Concepts.** In Package 4, `docs/concepts/FORWARD.md` is annotated where M6 differs:
  - factual headlines;
  - "Worth knowing";
  - one structure with no texture strip;
  - no Week Ahead, Kev, weather, sheets, swipe, "worth deciding early", away or transport gaps.
- **CLAUDE.md rule 14.** It is fulfilled in Package 1, when `/prototype` and its build, lint, format and deploy exclusions are removed.
