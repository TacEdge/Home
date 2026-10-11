# ADR 0009 — M6 Forward Coordination: scope, architecture and decisions

Status: **Accepted**, 2026-10-09. The owner approved the product decisions on PR #59 (§20–§29, as refined there) and accepted this ADR and the contract (`docs/m6/M6-BUILD-CONTRACT.md`) by merging Package 0.

- **Implementation:** Package 1 (Forward groundwork and engine, §32) has merged (PR #60), and so has Package 2 (the conflict engine, §33, PR #65). Package 3 (conflict insights, Not useful and Today, §34) has merged (PR #66). Package 4 (the Forward screen and Coming up marks, §35) is in review.
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

8. **There is still one agenda engine.** The M3–M5 loader (`readAgendaInputs`, `loadAgenda`) and engine (`src/domain/engines/agenda.ts`) stay the only place that places, expands and orders items. Forward reads 90 days through them, in one read, and the engine is told the range the agenda covered (§32: it refuses an agenda that does not cover the whole horizon).

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

      *Refined in Package 4 (§35, approved):* that order is Week's, where the conflict marks sit on the rows. Month and Season rows are chronological (by day, then the agenda's order, then the key): conflicts are listed in Worth knowing there and do not move an entry ahead of earlier commitments.
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
      - An occurrence in one is notable (even a usual one), marked `conflicted`, and first in its row on Week (Month and Season rows are chronological since Package 4, §35).
      - The headline's second sentence counts the conflicts touching the range ("There is one overlap.").
      - Package 1 passes none; the behaviour is unit-tested with synthetic conflicts.
    - **Other groundwork.**
      - The insights engine takes an optional last day (`through`, default today + 7), so Today is unchanged.
      - The Forward page reads the test time source (`requestNow`), and `loadAgenda` takes the screen's today.
      - The audit-log scan in `proposals.test.ts` has an explicit 30-second timeout (M5-ACCEPTANCE §9).
      - Two more test-reliability fixes, from this package's first full verify (both passed when rerun alone, and neither touches the code under test):
        - `calendar-sync.test.ts` ordered audit rows by `at` alone. Rows written in one transaction share that instant, and audit ids are random, so their order was the database's choice. It now breaks the tie by `event`.
        - The Activity test in `people-privacy.test.ts`, which reads the whole shared audit log four times, took over vitest's 5-second default once. Its timeout is explicit, as for `proposals.test.ts`.
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
    - **After the Package 1 review (PR #60).**
      - **Coverage invariant.** The agenda leaves empty days out, so an empty stretch and a stretch that was never loaded looked the same, and an eight-day agenda gave a Month of "Nothing recorded". The engine's input now carries `coverage`: the home-date range the agenda was computed over.
        - **When it refuses:** `forward()` throws `IncompleteAgendaError` unless the coverage starts on or before today and ends on or after the horizon's last day. Both ends are checked.
        - **What it never does:** fetch, expand or fill in anything; it stays pure.
        - **Tests:**
          - complete Week, Month and Season coverage composes;
          - wider coverage composes and changes nothing;
          - eight days are refused for Month and Season;
          - coverage starting after today is refused;
          - coverage ending one day short is refused;
          - an empty agenda over full coverage composes as "Nothing recorded".
      - **Finished overnight items.** A carry-over from last night that has already ended, judged by its own recorded end and `now`, no longer takes a visible slot.
        - **How:** `selection()` fills the cap with entries that still count first, then shows the chosen ones in row order. The rest are held, in row order, with `more` exactly their number.
        - **What stays:** the full model keeps the item, and the load-count rule is unchanged.
        - **Test:** a finished gig with two appointments on the same day shows the appointments and holds the gig; while the gig is still running, it is shown.
      - **Retention test.** It now uses the engine's own identities (`entryKey`) and includes a real project target on a day where the cap applies. The target survives grouping on every horizon, is on the surface (targets sort before timed events), and "+ N" is exact. No product change was needed.
      - **Privacy.** The non-interference test adds a private weekly event of Sam's naming Milo, a household person both adults see. Alex's Week, Month and Season models are equal both deeply and byte for byte (headlines, counts, the usual and every fact). Milo's usual gains the event for Sam only.
      - **Mutations,** each failing its tests, with the code restored after:
        - the coverage check removed (4 tests);
        - the old "first by row order" selection (1);
        - project targets dropped in grouping (4);
        - Alex's read replaced by Sam's (the invariant).
    - **Carry-forwards, recorded and not changed now:**
      - **Future-starting routines** are notable until they become active: the usual is the regular week as of today, so a weekly series beginning in three weeks counts as notable in Season.
      - **The listed headline for a multi-day item carried in from before today** says "today" ("Camp today."). Its wording is for the Package 4 presentation review. (Decided in §36: "Camp, until Friday.")
      - **A scheduled task whose window spans midnight** is placed on its start day only.
      - **Unit loads can add up to more than the headline count**, because an event spanning two units counts in each unit and once in the headline.
      - **Category order within a row** (scheduled tasks before timed events, whatever their times) is to be judged from the Package 4 screenshots.
      - **The bounded regular-week recurrence work is accepted:** the usual re-expands each weekly series over 7–14 days for each household person on it.
    - **Unchanged.**
      - No schema, migration or new dependency.
      - No Forward screen: the page stays the plain 30-day list, apart from the scheduled-task rows and the test clock.
      - No conflict detection, Kev, transport or weather.

33. **Package 2: the conflict engine** (`src/domain/engines/conflicts.ts`, `conflicts()`).

    - **What it is.** One pure function, run once per request over the page's window (Today's 8 days, Forward's 90). It states §10 and §11 and nothing else.
      - **Inputs:** the shared agenda's days, the events the agenda was given (for recurrence and kind), the people the reader can see (with `inHousehold`, for routine), `now`, the home zone, the window and the agenda's `coverage`.
      - **Coverage:** like Forward (§32), it throws `ConflictWindowError` unless the agenda covers the whole window. It never fetches or fills anything in.
      - **No I/O and no clock:** it imports only the agenda engine's types, `occurrenceKey` and `routineEvents` from day-facts, and the date library.
    - **Overlap.** Each timed occurrence is taken once, by `occurrenceKey`, however many home days it is placed on, so an overnight or multi-day occurrence is never doubled.
      - **Sweep:** occurrences are grouped by visible person, sorted by start, end and identity, and swept. Each one is compared only with those still running when it starts.
      - **The one overlap test:** an occurrence that ended at or before another's start is dropped from the running set. So ends that touch never overlap, and every pair compared overlaps from the later start to the earlier end. Zero-length occurrences take part in nothing.
      - **Current:** a pair is kept while its overlap has not ended at `now`.
    - **Rule, per person.** `conflict.responsible` when that person's role is `responsible` on both (any of their entries saying so counts), otherwise `conflict.overlap`. One conflict per person per pair, never both rules.
    - **Exclusions, as §10 sets them:**
      - all-day events (never in the sweep), so no away or travel reading;
      - an occurrence of Today's routine (`routineEvents`: a weekly or fortnightly `school` or `work` series with a household person on it);
      - a pair where both are `work`;
      - a pair of occurrences of the same event.
    - **Identity (§13).** Standing when both occurrences are unchanged occurrences of recurring series, that is, both events carry a recurrence rule. A changed occurrence (manual) or an override (synced) is its own row with no rule, so any pair containing one is occurrence-level.
      - **Key:** built exactly as §13 gives it: sorted event ids, then `w{HHMM}-{HHMM}` (the overlap's home wall clock) or `{YYYYMMDDTHHMMZ}-{YYYYMMDDTHHMMZ}` (its instants, to the minute).
      - **Standing conflicts:** every repeat in the window with the same key is one conflict, with all its overlaps in `instances` and the next one in `when`, `occurrences` and `overlap`.
    - **Order:** rule, then the (next) overlap's start, then the key. Instances are ordered by overlap start, then occurrence identity.
    - **Explanation.** Each conflict carries both occurrences as recorded (event, occurrence, title, start, end and zone, whether it repeats, and the person's role on it), the person, the overlap, the rule, structural `facts` (the person and both event occurrences) and one sentence from §5.6's templates:
      - "Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00."
      - "Alex is recorded as responsible for both Art club and Dentist, which overlap tomorrow, 15:30–16:00."
      - "Milo’s Swimming and Tutoring overlap regularly, 15:45–16:15; next today." (Reworded in §36: "…; the next is today.")

      A standing `conflict.responsible` combines the two. No sentence says why, where, who should change or that anyone is unavailable. Package 3 places these in insights; Package 4 presents them.
    - **Interpretations the contract needed** (for the domain review):
      - **"The same event"** is the same event row. A changed occurrence is a different row from its series, so a change that overlaps another occurrence of its own series is stated.
        - **Why that is right:** it is a genuine recorded overlap, not a series overlapping its own repeats (what §10 excludes). For example, the 21 October lesson moved onto 28 October's slot is a make-up lesson landing on the regular one.
        - **The key** names the change's row and the series, so it is unambiguous.
        - **The wording** is ambiguous for now: "Milo has Swimming and Swimming at the same time on Wednesday 28 October, 15:45–16:15." Telling two same-titled occurrences apart (by date, or "the moved Swimming") is deferred to the Package 3 and 4 presentation.
        - **No schema or shared-read change** is needed or made.
      - **Routine** is Today's definition, by event. A changed occurrence of a routine series is not itself routine, so it can conflict, as it is notable on Forward.
      - **A standing window is the home wall clock.** For a series kept in another zone, the home-clock window moves when that zone changes its clocks, so the pair has two standing conflicts, one per window. This is §5.7.1's "two windows, two conflicts". A home-zone series keeps its key across Pacific/Auckland's changes (tested over April 2027).
      - **`when`** is the home date the overlap starts, even for an overlap that began before the window and is still running at `now`.
      - **Minutes.** Occurrence windows are UTC to the minute, as §13 sets. Two overlaps of the same two events differing only in seconds would share a key; HOME records minutes.
        - **Under a minute:** an overlap shorter than a minute (possible only with seconds in synced times) is still an overlap. Its key and wording show the same minute twice (`…2200Z-2200Z`, "11:00–11:00"). That is a presentation limitation, left as it is.
      - **The DST-change night.** A standing pair whose overlap spans the night Pacific/Auckland's clocks change has, for that one week, a different home-clock window. It is a second standing key for that week alone (for example `w0130-0230` beside `w0130-0330`). This is factual and rare (an overlap at about 2am on that Sunday), and is left as it is.
      - **Many concurrent occurrences.** The number of conflicts is what it is: 400 occurrences that all overlap for one person give 79,800 pairs, about 630 ms. The sweep is bounded by that output, not by the window. Real household data comes nowhere near this. Presenting a long list in bounded form (caps and "+ N more") is Package 3's job.
    - **Evidence.**
      - **Unit tests** (`tests/unit/conflicts/conflicts-engine.test.ts`, 57):
        - the engine boundaries in contract §2.2: touching ends, one minute, identical times, overnight, multi-day, DST (home and foreign zones), routine and work-pair exclusions, the same series, all-day, visibility, changed occurrences. "Default people" is resolved by the shared read before the engine, so its evidence is the integration test below, not a unit test;
        - the engine-level cases of §5.7.4 by number: T1–T4, T7, T9–T13, T15, T16, T19 and T20;
        - **T19** shuffles events, people and the agenda's days and items with a seeded Fisher–Yates over eight fixed seeds, and asserts that every seed gives a different order (so not the input, and not only its reverse) and that the complete output is identical, deeply and byte for byte;
        - **engine-level forms of T5, T6, T8 and T14:** the inputs the reads give before, during and after the change. T6 is the change put away (the change row gone, the series' own occurrence back), then restored as a fresh row with the same id and times. The T4 key returns. These show identity follows the inputs. That the database operations produce those inputs is Package 3's service-level acceptance (marked P3), and these tests do not claim it;
        - T17 is Package 3: it is about responses, which the engine never sees;
        - material and non-material changes;
        - multiple people;
        - order;
        - traceability;
        - forbidden phrases;
        - purity.
      - **Through the real services** (`tests/integration/conflicts-engine.test.ts`):
        - **The fixture:** both adults see the same household keys.
        - **T4:** a change made with `changeEventOccurrence` is its own occurrence-level conflict, keyed by the change's row and showing its series' people.
        - **T7:** a skip made with `skipEventOccurrence` keeps the standing key and moves its next date.
        - **T18, the non-interference invariant:** Sam adds a private event overlapping a household event Sam is on, a private one-off and a private weekly series naming Milo, and a private person on two overlapping private events. Alex's conflicts are equal deeply and byte for byte, and contain no private title; Sam's gain them.
      - **Calendar default people** (`tests/integration/conflicts-default-people.test.ts`, through `connectCalendar`, `refreshCalendar` with a synthetic feed, and `setEventPerson`):
        - **Household calendar:** a synced event with no people of its own, on a household calendar whose usual person is Milo, overlaps a household event Milo is on. Both adults get the conflict, with the same key, person, occurrences, facts and sentence. The engine has no default-people logic; the shared read resolves them.
        - **Private calendar:** the same on Sam's private calendar is Sam's conflict only. Alex's list has nothing of it, not even the title.
        - **Replacement:** a person recorded on the synced event replaces the calendar's usual people. The read gives only Isla, and Milo's conflict ends for both adults.
      - **Performance** (dev container; `conflicts-performance.test.ts`):

        | Data, 90 days | Occurrences | Conflicts (overlaps) | Agenda | Engine (warm) |
        |---|---|---|---|---|
        | The fixture household | 182 | 0 | 57 ms | 1–2 ms |
        | 300 events (60 weekly, 240 one-offs) | 1,012 | 339 (1,195) | about 210 ms | about 22 ms |
        | 1,200 events, very dense | 4,046 | 6,334 (27,966) | about 750 ms | about 120–180 ms |

        - **Where the time went:** the shared date helpers build a formatter on every call, so the engine formats each instant once per run, with one formatter. That took the 300-event run from 164 ms to about 22 ms.
        - **Recurring pairs:** a recurring pair is one conflict however many weeks the window holds.
      - **Mutations,** each failing its tests, with the code restored after (counts are the tests failed):

        | Mutation | Tests failed |
        |---|---|
        | Touching ends treated as overlapping | 2 |
        | Responsible precedence removed | 7 |
        | The standing key given the date, so it changes every week | 14 |
        | A changed occurrence taken into the standing pattern | 2 |
        | An overnight occurrence counted once per day | 2 |
        | The visibility filter on people removed | 1 |
        | The person removed from the key | 23 |
        | The work-pair exclusion removed | 1 |
        | The routine exclusion removed | 1 |
        | The same-event exclusion removed | 1 |
        | The overlap-start tie-break removed | 1 |
        | `visibleTo` letting every private row through, in the integration test | 1 (the non-interference test) |
        | The calendar's usual people not applied in the shared read (`readAgendaInputs`) | 2 (default-people tests) |
        | The T19 shuffle doing nothing | T19's order-diversity check (1 order, not 8) |
        | The T19 shuffle only reversing | T19's order-diversity check |

        **Adjusted after the first mutation run:** three mutations first survived. Touching ends had two redundant guards, so the redundant one was removed. The overnight mutation had changed only one of its two lines. The order test's key order happened to equal its time order, so it was given cases that disagree.
    - **After the Package 2 review (PR #65).** Tests and documentation only; the engine is unchanged:
      - the calendar default-people integration test;
      - a seeded T19;
      - a real change-and-restore sequence for T6, labelled engine-level;
      - the corrected coverage claim;
      - the decisions above on a change overlapping its own series, the DST-change night, overlaps under a minute and very many conflicts.
    - **Unchanged.** No schema, no migration, no dependency, no screen, no insight or response, no Kev. The shared agenda and its read are untouched. Forward still receives no conflicts (Package 3 connects them).

34. **Package 3: conflict insights, Not useful and Today.**

    - **Conflicts are an insight family, not a second detector.** The insights engine (`engines/insights/`) takes the conflict engine's output (`conflicts`) and turns each one whose (next) overlap is in its window into a `conflict` insight: the same key, rule, sentence and facts, with the observation kept for its marks and its Why.
      - **Ranking (§18):** family (`data_health`, `conflict`, `preparation`, `busy_day`), then the conflicts' own order (§13), then date, then key. Total.
      - **Today's window** is unchanged: today and the next seven days.
    - **Today (contract §4.5).**
      - **Today's conflicts are said on their items.** `conflictPlacements` lists every place Today shows an occurrence in its day state: each person's line (its folded entries too) and Also today.
        - **On the items:** a conflict of today that has a place is on-object, not listed. It is marked on each of its two occurrences: on its person's line where that person has one, else on Also today.
        - **The mark:** a small Sun dot and "overlaps Art club 15:00", the other commitment as recorded. Why holds the facts, Dismiss and Not useful.
        - **Two per entry:** an entry shows two marks, then "+ N more overlaps" in place.
      - **Nothing is lost.** A conflict of today with no place on the screen (the evening, first run) is listed in Worth knowing instead.
      - **Tomorrow onwards** is listed in Worth knowing, with the Sun mark.
      - **Unchanged:** the headline and everything else on Today. M5's Today suites pass. One end-to-end test now names the Dismiss form explicitly, because each row has a second form (Not useful).
    - **Responses (contract §5.9).**
      - **One service:** `respondToInsight(actor, key, response, surface, now, timeZone)`, in the contract's order:
        1. the gate, then the actor, before any read;
        2. the key, the response and the surface, by schema;
        3. the reader's insights and conflicts, re-derived from one 90-day agenda read;
        4. a current conflict of the reader's is accepted from any surface, and anything else only if it is current, not said on its item, and listed on the named surface (Today: M5's families; Forward: `data_health`; a person's page: none); otherwise `not_eligible`;
        5. the same response again writes nothing;
        6. `respond`: an upsert, audited with the response kind only.

        Changing Dismiss to Not useful (or back) is one more audited upsert.
      - **Dismiss** is now `respondToInsight(…, 'dismissed', 'today', …)`.
      - **Not useful** hides exactly as Dismiss does, and records the judgement (`insight_response.response = 'not_useful'`). It changes no rule, threshold, ranking, family or other insight. Kev does not read it.
      - **Where they are:** Not useful sits inside every insight's Why, after the facts. Dismiss stays on the surface; on a Today mark, both sit inside its Why.
    - **Explanations (§14).** A conflict's Why gives:
      - the rule in one sentence, naming the person: recorded on both, or recorded as responsible for both;
      - the overlap ("from 15:30 to 16:00");
      - for a standing conflict, that both repeat and when the next one is;
      - the two commitments, each with its own recorded date and times and the person's role, linked to the event.

      **Two same-titled commitments:** a moved occurrence on another occurrence of its own series (§33) is told apart by its start, in the sentence ("Swimming (from 15:30) and Swimming (from 15:45)") and in Why. This is a text change in the engine; no key changed.
    - **Forward and Coming up data (for Package 4).** `domain/insights/conflicts.ts`:
      - `readConflicts`: one agenda read over 90 days, one engine run and one query for the reader's responses. It gives every current conflict, the unanswered ones, and the reader's responses.
      - `forwardConflicts`: the Forward engine's input, each key with its (next) pair's occurrence keys.
      - `personConflicts`: one person's conflicts, for Coming up.
      - **No new identity:** Today, Forward and Coming up take the same keys from the same engine, and a response hides a key on all of them.
      - **No Forward dependency:** `forwardConflicts` writes its output shape out rather than importing the Forward engine, so the medium-tier engine keeps no high-tier importer (ADR 0010 §8).
      - **The Forward page is unchanged** (Package 4).
    - **Shared UI.** `ItemRow` and `AgendaItemRow` take an optional `after` slot, under the row and outside its link, used for Also today's marks. Existing callers are unchanged.
    - **Evidence.**
      - **Unit tests** (`tests/unit/conflicts/conflict-insights.test.ts`, 12, plus the M5 suites):
        - the conflict family's fields and ranking;
        - Today's window;
        - a response hides it;
        - on-object when placed, and marked on both occurrences without a duplicate;
        - Also today for someone outside the household;
        - listed when there is no place;
        - same-title wording;
        - 435 conflicts bounded to three shown, with an exact remainder and none lost;
        - the Forward engine marks and counts the same keys, and drops a responded one.

        The Today test helper now composes exactly as the page does, with conflicts and placements.
      - **Through the real services** (`tests/integration/conflict-insights.test.ts`, 15):
        - **Both adults:** both get the same keys.
        - **Refusals:** crafted, malformed and private keys are refused, and nothing is written.
        - **T17:** Alex's dismissal is Alex's alone, and is hidden from Alex's Today list and Forward data.
        - **Not useful:** it hides, records `not_useful`, is audited as `{"response":"not_useful"}` with no key or title, is visible in Sam's Activity only, and is idempotent.
        - **Changing the kind:** Not useful to Dismiss is one audited upsert.
        - **Lifecycle:**
          - T3: nothing expires;
          - T4: a change is a new, eligible key despite the standing dismissal;
          - T5: returned to the series;
          - T6: put away, then restored, and its response applies again;
          - T7 and T8: skip and put back;
          - T14: archive and restore.
        - **Privacy:** Sam's private event changes nothing in Alex's conflicts or insights, byte for byte.
        - **The gate:** both responses are refused before any query.
        - **Cost:** the 90-day read is 7 queries, the same after 20 more events.
      - **End to end** (`tests/e2e/today-conflicts.spec.ts`):
        - **Without JavaScript:** marks on Milo's entries; Why's sentence, links and buttons; Not useful hides that pair for Sam while the fixture's other pairs stay; Alex still sees it.
        - **With JavaScript:** tomorrow's conflict in Worth knowing; Not useful inside Why; Dismiss; the accessibility baseline with marks and an open Why.
      - **Performance:**
        - **Today:** the page adds no query. Conflicts and insights over its eight days take about 6 ms for a 300-event household (the agenda read, about 37 ms, as before).
        - **A response:** it reads 90 days, which is about 200 ms of agenda for 300 events.
      - **Mutations,** each failing its tests, with the code restored after:

        | Mutation | Tests failed |
        |---|---|
        | Responses read for every user (cross-adult leak) | 3 |
        | Responses matched by person, so an old dismissal hides a changed conflict | 4 |
        | Eligibility skipped, so an unauthorised key is accepted | 2 |
        | The gate check removed | 1 |
        | A conflict of today both marked and listed | 3 |
    - **Caveats, recorded:**
      - **Today marks only today's conflicts.** A standing conflict is marked at its next pair only, as §13 says it is said.
      - **Two marks per entry**, then "+ N more overlaps". Worth knowing shows three, then "+ N more" with the exact remainder.
      - **A response costs a 90-day read**, about 200 ms at 300 events. It is not on any page's render path.
      - **Coming up and Forward show no conflicts yet.** Their data is ready; Package 4 presents it.
    - **Unchanged.** No schema, migration, dependency, transport, weather, Kev or external write. No adaptive ranking, and no Forward UI.

35. **Package 4: the Forward screen and Coming up marks.**

    - **One page, one read.** `/forward?h=week|month|season` (Week by default, and for anything else) reads the agenda once for 90 days whatever the horizon, runs the conflict engine over it, takes the reader's responses in one query, and hands the rest to the Forward engine. Measured through the real services: 6 queries for the read and 1 for the responses, 7 in all, and still 7 after 20 more events, 3 tasks, a project and a second calendar. No `hasStaleCalendar` call: the read already carries the calendars.
    - **The hierarchy (§15), the same on every horizon:** "Forward" and the switch (three links, `aria-current`, no JavaScript); the headline sentence with its qualifier and the overlaps sentence, and "What this is based on ›"; Worth knowing (two, then "+ N more"); Coming up; The usual ›; Today ›. At 768px and wider Coming up takes the second column of the 960px width, as Today's lines do.
    - **Coming up (§15, §22).** One row per unit (`li[data-unit]`): its label, the load band as ink dots with the words for a screen reader ("Three things recorded"), the shown entries, then "+ N" holding the rest in place, or "Nothing recorded besides the usual" / "Nothing recorded" in words. A row is the agenda's row: Week keeps the time and the detail; Month puts the weekday in the time column ("Thu", "Fri–Sat"); Season the date ("15 Oct", "10–12 Nov"); both keep a timed event's recorded time under the title. Every entry links to its page.
    - **Where insights are listed (§18).** The insights engine takes `listed` (the families a surface lists) and `shown` (how many before "+ N more"): a family not listed is on-object, never listed or counted, but still in `all`, so its key is in the one responses query. Week lists only `data_health`; Month and Season also list `conflict`. Today passes nothing and is unchanged.
    - **Marks.** Week says every conflict on its row entries, both of them, one key behind both, with Why, Dismiss and Not useful (`conflictMarks` over `forwardPlacements`). A mark on a shared row names the person: "overlaps Art club 15:00 · Milo", because a Forward row, like Today's Also today row, is not a person's line. On a person's own line the text is unchanged. Month and Season have no marks; their conflicts are listed, and their rows are chronological (below).
    - **A person's Coming up (§28).** `personInsights` takes that person's conflicts over the page's 30 days, with the reader's responses (one query), and the page marks them on their items, with the same keys and the same Why. Nothing is listed on a person's page. The page reads the test time source now, like Today and Forward.
    - **Responses from any surface (§17, §19).** The insight pieces (disclosure, facts, explanation, responses, conflict marks, Worth knowing) moved from Today to `src/app/_insights/` and take a `surface` and a return path, as hidden fields; the one action passes the surface to `respondToInsight`, which checks it, and lands back only on a known path (`/today`, `/forward`, `/forward?h=…`, `/people/{id}`), else on Today. No new write path.
    - **Bounded pages (the Package 3 caveat).** Worth knowing's "+ N more" renders its first twelve in full (Why and both forms) and any beyond as the sentence and its mark; the count stays exact, and the item each is about is on the page. Conflict marks keep two per entry then "+ N more overlaps", as in Package 3.
    - **Today.** Its footer reads "What’s coming up ›". Nothing else on Today changes; its suites pass with that one string.
    - **The usual ›** lays out each household person's regular week with the profile page's own weekday lists (`RegularWeekDays`, extracted from `_profile/regular-week.tsx`).
    - **Evidence.**
      - **Unit** (`tests/unit/forward/forward-insights.test.ts`, 23, and one more in `conflict-insights.test.ts`): what each horizon lists and shows; marks on both entries behind one key, none on Month or Season; a response gone from the count, the row, the listing and the marks on every horizon; a moved occurrence of a usual series is notable with its own key despite the standing dismissal; a three-way overlap is three keys and six marks without a duplicate; 30 things on one day show 2 (Week) or 3 (Month) with an exact "+ N" and nothing lost; empty horizons draw every unit; the forbidden-phrase list over every rendered string; the Also today mark names the person and a person-line mark does not.
      - **Through the real services** (`tests/integration/forward-screen.test.ts`, 9, two adults): the query count above; Sam's private overlapping event, task and project leave Alex's Forward on every horizon, insights, marks and conflicts byte-identical, and change Sam's; Alex's responses leave Sam's byte-identical; a dismissal from Forward is gone from every horizon, from Today's insights and from Milo's page, for that adult only; Not useful from a person's page the same, with exactly one audit row carrying `{"response":"not_useful"}` and nothing else; `preparation` and `busy_day` keys refused on Forward and on a person's page; crafted, malformed and private keys and an unknown surface refused with nothing written; a person's page marks that person's items only.
      - **End to end** (`tests/e2e/forward.spec.ts`, 11, on a fixed Wednesday in May 2027 through the test time source, every record the spec's own): Week without JavaScript (the counted headline, the overlaps sentence, both marks on tomorrow's pair naming Milo, Why with its sentence and links, Not useful as a form post that takes the pair's marks and lowers the count for Sam only); Month (the week units, the responsible conflict listed first, rows folding under "+ N", Dismiss there gone from Week's marks and from Today); Season (the months, a one-off sixty days out, The usual listing Milo's Swimming); Milo's page (the mark with Why, Not useful there gone from Forward too); privacy (Alex never sees Sam's private title or its overlap on any horizon or on Sam's page); the four viewports (axe, no horizontal scroll, 44px targets, screenshots in `test-results/screenshots/forward-{horizon}-{viewport}.png`); keyboard (Tab to the horizon links and a fold, Enter opens it); and nothing lost from the old 30-day list on Month. The older specs that read the 30-day list (`events`, `occurrence-changes`, `home-tasks`, `today`, `today-screen`) now read Week or Month by `li[data-unit]`, with folds opened, and keep their intent. The M3 device and privacy sweeps pass on the new Forward; the sweep caught the Week link at 42px wide, fixed with `min-w-11`.
      - **Performance.** Engine cost over a synthetic 300-event household with 375 overlaps (pathological): the 90-day agenda about 80 ms, the conflict engine about 12 ms, and insights, the Forward model and the marks under 10 ms per horizon. Render cost is in the browser specs' timings; the page adds no query to the read.
    - **After the product review (approved corrections, owner):**
      - **A clipped Season month is labelled by its days.** A month the 90 days end inside reads "1–11 Jan" (or "1 Jan"), never by its name, so an empty one does not read as a whole month HOME has looked at. The first month runs from today, as every horizon does, and keeps its name. Unit-tested on a one-day, a whole-month and a first-month case.
      - **Conflict marks are bounded in the fold.** An entry's "+ N more overlaps" renders its first `FOLDED_FULL` (12) marks in full (Why, Dismiss, Not useful) and any beyond as the sentence and mark alone, with a line saying that responding to the ones above brings the rest forward. The count is exact and every overlap is said; `FOLDED_FULL` is one constant for Worth knowing and the marks (`src/app/_insights/folds.ts`). Tested on a day of twenty things at once for one person (190 conflicts, 19 marks on the entry: two in full, "+ 17 more overlaps", twelve more in full, five as sentences, 28 forms).
      - **Month and Season rows keep a timed event's time.** The recorded times sit under the title ("15:00–16:00"; "from 15:00" and "until 09:00" for a longer one; a scheduled task "Scheduled 10:00–10:30"). An all-day event has none. The changed-time checks on Forward are back in the browser specs (17:00, 06:30 and the moved 17:00, on Month).
      - **Month and Season rows are chronological** (§15 refined; contract §5.3): by day, then the agenda's order, then the key. A conflict is listed in Worth knowing and explained there; it does not pull its entries ahead of earlier commitments, so a month reads as a timeline and a trip or a target holds its place. Week keeps the conflicted entries first, where their marks are. The usual is unchanged. Unit-tested on a synthetic month with a recurring conflict, a family trip, a project milestone and ordinary commitments: every row in date order, the trip and the milestone reachable on the surface or under "+ N", the conflicted pair at its own time.
    - **Caveats, recorded:**
      - **Month and Season rows carry no mark.** The conflict is listed above with its Why; the owner may prefer a mark there too, from the screenshots.
      - **Season's items beyond the first three per month** sit under "+ N"; a month with many one-offs reads as a count. That is the contract's cap.
      - **For Package 5's review (accepted as minor, not changed here):** the "Camp today." wording for a multi-day item carried in; scheduled tasks ahead of earlier timed events on Week; the "+ N" fold label having no context of its own for a screen reader; a recurring conflict marked at its next pair only on Coming up (§13); Worth knowing's fold past twelve showing sentences only.
      - **The usual is per person, not per unit.** A usual occurrence is reachable through its series in The usual ›, not as a row on its day; the old 30-day list showed it on its day.
      - **Bounded folds.** Beyond twelve folded insights or marks a reader responds to the first ones to reach the rest.
    - **Unchanged.** No schema, migration, dependency, transport, weather, Kev, external write, adaptive ranking or new insight rule. The conflict engine and its keys are untouched.

36. **Acceptance corrections (owner-approved, after Package 5's assessment).**

    - **Two wording decisions.**
      - **A multi-day event carried in from before today** is named in Week's listed headline by when it ends: "Camp, until Friday." ("…, until tomorrow", "…, ending today"; seven days or more on, its date: "…, until Wednesday 21 October"). An event that starts today is unchanged ("Camp today."). Contract §5.5.
      - **A standing conflict's sentence** ends "…; the next is today." ("…; the next is tomorrow.", "…; the next is on Wednesday 21 October."), on every surface that shows it. Conflict identity and keys are unchanged. Contract §5.6.
    - **Evidence added for the gaps the assessment named (R-1 to R-7, R-11).** Tests only; no product behaviour changed beyond the two sentences above.
      - **R-1, a stale response is refused** (`tests/integration/conflict-insights.test.ts`): once the Thursday overlap has ended, and the old key after Dentist moves through `updateEvent` (T13), both responses are `not_eligible` with no row and no audit entry; the new key is accepted.
      - **R-2, Forward's first-run, quiet and stale scenes** (`tests/e2e/forward.spec.ts`): first run (the "HOME doesn’t know your calendars yet." headline, "Connect a calendar ›", every Week unit "Nothing recorded", no conflict); quiet ("Just the usual in the next seven days.", each unit's exact words, no qualifier); stale, without JavaScript ("As far as HOME knows.", one calendar-health row naming the calendar and the day it last updated, and none of failed, error, broken, stale or urgent).
      - **R-3, Not useful on a non-conflict insight** (`tests/integration/worth-knowing.test.ts`, "Not useful on a birthday"; browser half in `forward.spec.ts`): hidden for Sam only, Alex's insights deep-equal, exactly one audit row with `{"response":"not_useful"}`, a repeat writes nothing, Forward and a person's page refuse the key.
      - **R-4, Worth knowing's fold at twenty** (`tests/unit/insights/worth-knowing.test.tsx`): Today shows 3 and "+ 17 more", Forward 2 and "+ 18 more"; 15 (or 14) in full with Why and both forms, the rest as sentences; every sentence present.
      - **R-5, rendered privacy non-interference** (`forward.spec.ts`): Alex's Today, Week, Month, Season and Milo's page, every fold opened, read byte-identical before and after Sam adds a private overlapping event, a private scheduled task and a private project with a target date; Sam's own Forward changes, so the check is not vacuous.
      - **R-6, without JavaScript and across layouts** (`forward.spec.ts`): at phone and desktop with JavaScript off, each horizon link navigates and moves `aria-current`, a "+ N" fold opens, Why opens (a mark on Week, Worth knowing on Month and Season), and Dismiss posts back to the same horizon with the item gone; on a phone, Month's switch, headline and first Worth knowing row sit in the first screen; at tablet and desktop widths Coming up sits in the right column, and below the header on a phone.
      - **R-7, a conflict's Why at render** (`tests/unit/insights/conflict-explanation.test.tsx`): both commitments with links, the person, each role, the recorded dates and times, the repeating sentence on a standing conflict and not on an occurrence, and the responsible wording; no place, travel or "should".
      - **R-11, engine edges** (`tests/unit/forward/forward-engine.test.ts`, `tests/unit/conflicts/conflicts-engine.test.ts`, `tests/unit/conflicts/conflict-insights.test.ts`, and T9 in the integration suite): Forward across the April DST end with a weekly 09:00 series; a fortnightly series usual on its on-weeks only; a seeded Fisher–Yates shuffle over events, tasks, projects, the agenda's people and each day's items, deep- and byte-equal on every horizon; the full forbidden-phrase list; one standing key across the September DST start; an overlap on the DST-start night; §33's second standing key on the DST-end week; Today's window edge (+7 listed, +8 not); T9's moved series gives a new key, and the old dismissal is kept and matches nothing.
    - **Mutations.** Each was killed by the new tests and then restored: Worth knowing rendered in full; the eligibility check in `respondToInsight` bypassed; Forward's listed set given `preparation`; the Why's role forced to "attending"; the repeating line suppressed; `listedPart` disabled; the weekday cut-off moved from 7 to 8; and the old "; next …" sentence.
    - **Caveat, recorded.** Forward takes two orders as given: the agenda's days, in date order as `agenda()` documents, and People's order for The usual. The shuffle test keeps those two orders and shuffles everything else.

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
