# ADR 0008 — M5 Intelligent Today: scope, architecture and decisions

Status: **Accepted**, 2026-10-08. The owner approved this ADR and the contract, `docs/m5/M5-BUILD-CONTRACT.md`, by merging Package 0 (PR #53) and starting Package 1.

- **Approved:** §20, §23, §24, §25 and §26.
- **Approved as provisional:** §22.
- **Revised as the owner directed:** §21.
- **Implementation:** Packages 1 and 2 merged (PRs #54, #55; §30, §31). Package 3 (the Today screen) is in review; its decisions are recorded in §32.

## Context

M4 is technically accepted on synthetic data (`docs/m4/M4-ACCEPTANCE.md`, ADR 0007 §48), and PR #52 has merged. Its operational acceptance on real calendars waits on DEPLOY.md §E items 12–15. M3's owner acceptance waits on the restore rehearsal (§E items 7–8), and M1's on §E items 1–6. The Production real-data gate is closed (ADR 0006 §2).

Today is still the factual screen from M3 (ADR 0006 §59), with synced events added in M4. It shows the date, the day's agenda rows, open tasks that are due, the To sort line, the "Which one is you?" prompt and a link to Forward. It has no meaning, insights or weather.

The ROADMAP M5 row commits M5 to: *"Today per the M0 concept: day headline, getting-there (drop-offs/pickups), per-person day, tasks, weather line, To sort count; insights engine skeleton with `coordination_gap`, `busy_day`, `preparation`, `data_health` detectors and template text; person profile screens."*

Earlier decisions already settle the shape:

- **The Today concept:** `docs/concepts/TODAY.md`, with the refinements in `docs/concepts/README.md`.
- **The headline is deterministic.**
- **Evening mode is contextual.**
- **On-object problems are never repeated as insights, and "+ N more" counts only genuine insights** (ADR 0002).
- **Insights are derived on read** and carry their facts and template text, and only dismissals persist (CLAUDE.md rule 15, SYSTEM-ARCHITECTURE §2.6).
- **Kev phrasing belongs to M8, and proposals to M9.**

Four items are carried forward to M5:

1. **Overnight events:** an event that starts yesterday and runs into today is not shown on today.
2. **Ordering of a series in another time zone:** M4 m-6b.
3. **Annotation reads:** the agenda loader reads each event's annotations with a separate query.
4. **Sheets:** layered over the existing detail URLs (ADR 0006 §10).

## Decisions

### Scope

1. **M5 is Intelligent Today, computed without Kev.** Today moves towards "what matters for our household today?" by applying written, deterministic rules to household data that is already recorded. Nothing in M5 calls an LLM, and Today is complete without Kev.

2. **M5 builds:**
   - a factual, deterministic **headline**;
   - **Everyone's day**: one or two lines per household person, routine compressed, showing who is recorded on each item exactly as the agenda records them;
   - **Also today**, for items with no people;
   - **To do**: due, scheduled today, and carried over;
   - **To sort**;
   - **Worth knowing**: up to three insights from the `busy_day`, `preparation` and `data_health` detectors, each with its facts and template text, plus "+ N more";
   - **Dismiss** (§23);
   - **contextual evening mode**;
   - **the quiet, first-run and stale-data states**;
   - **the tablet two-column layout** with person cards.

3. **M5 does not build** the following:

   | Item | Goes to |
   |---|---|
   | Getting everyone there (transport runs), the **Who?** chip and the `coordination_gap` detector | §21: not until transport has its own structured record, which needs a separate owner decision |
   | Conflicts | M6 |
   | "Not useful" | M6 |
   | Forward changes | M6 |
   | Sheets | M6 (§25) |
   | Weather, the Open-Meteo adapter, free windows and availability | M7 (§20) |
   | Kev, the Kev bar, Kev phrasing, "Tell me about today" and `get_insights` | M8 |
   | "Sort it" and proposals | M9 |
   | The time-of-day orb | M10 |
   | Push notifications, background jobs, stored insights | Not built (ROADMAP "Not yet") |

4. **Profile screens are already delivered.** Profiles exist from M3, with the regular week from M4 Package 7. Today links to them. There is no new profile work.

### What Today may say

5. **Every statement on Today belongs to exactly one of four layers, and M5 uses only the first two.**

   | Layer | What it is | In M5? |
   |---|---|---|
   | **1. Known fact** | Recorded by a person or synced from a calendar, and shown as recorded, for example "3:30 Swimming · Milo · Alex" or "Pay swimming term fees · due today" | **Yes** |
   | **2. Deterministic interpretation** | A rule written in the contract, applied by code to known facts, carrying those facts, for example "Six things on today" (a count), "School" (a weekly series of kind `school` in the person's regular week) or "Alex's calendar hasn't updated since yesterday" (a freshness rule) | **Yes** |
   | **3. Uncertain or inferred meaning** | A guess about need, intent, priority, preference, availability, stress or urgency, for example "Isla needs a lift", "Alex is free from 2:30", "a busy day", "nothing's been organised for the birthday" | **No.** Never shown, whether as fact or as a suggestion. Some of it is never shown at all (CLAUDE.md rule 11). |
   | **4. AI-generated reasoning** | Kev's wording, ordering or explanation | **No.** It belongs to M8 and is always labelled as Kev's. |

6. **Traceability.** Every headline, line and insight on Today can be traced to:
   - (a) the known records it was built from, which it carries as `facts`, by id; and
   - (b) the named, deterministic rule that produced it, which it carries as a `rule` id matching a rule in contract §5.

   A statement with no traceable rule is not shown. Rule ids are stable, tested and listed in the contract.

   **Absence proves nothing.** A missing record is evidence only that HOME has no record. It is never proof that something is unnecessary, has been arranged elsewhere, or that someone is available. Today may state absence only as absence ("Nothing on today", "Nothing due"), and only qualified when a calendar the reader can see is out of date or failing (§18). No rule turns a missing record into a need, an assignment, an availability or a reassurance. In particular there is no "nobody's down for it", no "everyone's covered" and no "nothing needs you".

### Architecture

7. **There is no second agenda engine.** The M3/M4 agenda loader and engine (`src/app/_agenda/load.ts`, `src/domain/engines/agenda.ts`) stay the only place that places, expands and orders items. M5 extends them:
   - items carry their `kind`;
   - overnight items are carried onto the next day (§24);
   - items are ordered by local time within a day (m-6b);
   - annotations are read in a single batch.

8. **Two new pure engines read the agenda's output.**
   - `src/domain/engines/today.ts` produces person lines, routine compression, Also today, day parts, the evening state, and the headline's rule, facts and template.
   - `src/domain/engines/insights/` holds the candidate type, keys, the three detectors and the ranking.

   Both are pure functions of their input and an injected `now`. They never read the database or the clock, and never import `db`, `app` or `kev`.

9. **The loader assembles data and the screen presents it.** A Today loader in `src/app/(home)/today/` reads everything as the signed-in adult through the existing domain services:
    - the agenda for today and the next seven days;
    - open tasks;
    - captures;
    - visible calendars and their freshness;
    - the adult's own insight responses.

    It then calls the engines. Screens hold no rules.

10. **Privacy is enforced by what reaches the engines.** The engines only ever receive what the domain services returned for this actor. An invisible event, annotation, task, person or calendar therefore cannot appear in, or be counted towards, a line, a count, the headline, a threshold, an insight's facts or "+ N more".

    This is tested as an invariant: adding records the reader cannot see leaves the reader's Today output identical. Insights are computed per actor, keys are built from ids and dates only, and dismissals are private to their user (`insight_response`, M2). Today reads no context.

11. **Every interpretation explains itself.** Each insight, and the headline, carries `facts` and a `rule`. Tapping one shows its facts in place, using no JavaScript (`<details>`). Facts are built only from the reader's visible items.

12. **No new schema.** M5 needs no table, column or migration. Any schema change, including the transport record discussed in §21, needs a separate owner decision and its own migration-first package.

13. **No new write authority.** Choosing who is going or responsible stays on the existing people page (M4 Packages 6 and 8b), reached by tapping an item. The only write Today adds is Dismiss (§23), through the existing `insights/service.respond`, as the adult, audited and gated. Kev gains nothing.

### Behaviour

14. **Everyone's day.** Household people the reader can see get a line, but only if they have at least one visible item today. Each item shows the people recorded on it, as the agenda shows them now (attending and responsible, from `event_person` and the calendar's default people).

    Today attaches no further meaning to `responsible`. It means what an adult recorded and is shown as that; it is not shown as "taking", "driving" or "picking up".

    An item is routine when its event is in the person's regular week (the `profile` engine) and its kind is `school` or `work`. Routine items are compressed to a word ("School", "Work till 2:30"). A line shows at most two items, then "+ N".

15. **Headline.** A closed set of factual templates, each a named rule:
    - first run;
    - evening;
    - only the usual;
    - counted things on;
    - over the provisional threshold (§22);
    - nothing on;
    - and, as a qualifier, data incomplete.

    It reports counts and records, never character: there is no "easy", "busy", "full", "calm" or "covered". It is never replaced by LLM text. Exact sentences are fixed and tested in Package 2 and approved by the owner from screenshots in Package 3.

16. **Detectors in M5:**

    | Detector | Fires when | States |
    |---|---|---|
    | `busy_day` | Tomorrow crosses a provisional threshold (§22) | Only the facts that crossed it ("Tomorrow has seven things on.") |
    | `preparation` | A visible person's birthday is within seven days, or an active project's target date is within seven days and the project has open tasks | Only those facts. Never "nothing prepared" (§6). |
    | `data_health` | A calendar the reader can see last refreshed successfully more than 24 hours ago, or its last refresh failed | The calendar's freshness |

    Ranking is deterministic (`data_health`, then `preparation`, then `busy_day`; then by date; then by key). Today's count lives in the headline, so `busy_day` for today is marked as already shown and excluded from the list and from its count. Every insight is a ○ *good to know*. M5 produces no ● *needs you* mark, because no M5 rule establishes a need.

17. **Evening mode** is contextual, not a clock rule. It applies when no timed item today still has its start or end to come. Today then leads with **Nothing else on today**, then **Tomorrow morning** (tomorrow's items before midday, then *Before then*: tasks due tomorrow). Today's items fold into *Earlier today*.

    The concept's "nothing else needs you" is replaced by this factual wording (§6). `now` is the request time in the home zone, injected and testable.

18. **Incomplete information is said plainly, never filled in.**
    - When a visible calendar is stale or failing:
      - a `data_health` insight appears;
      - every statement of absence or count is qualified with "as far as HOME knows".
    - Items with no people go under Also today.
    - An unlinked adult still sees "Which one is you?".
    - A template whose facts are missing is not shown.

19. **No regression.** Every item Today shows now still appears in M5's Today:
    - events and synced events;
    - birthdays;
    - project targets;
    - due and overdue tasks;
    - To sort;
    - "Which one is you?";
    - the Forward link.

    Refresh on use and no-JS operation are kept. A test proves that every item the agenda returns for today is placed somewhere on the screen.

### Owner decisions

20. **Weather line: approved.** Deferred to M7 with the Open-Meteo adapter. The ROADMAP M5 row records this.

21. **Transport and "Who?": revised; Getting everyone there is not built in M5.**

    - **Responsibility and transport are different concepts.** Event responsibility (`event_person.role = 'responsible'`) records that an adult is responsible for an event. It is not a record of who is taking someone there or collecting them, and M5 never presents it as one. This applies even though FAMILY-DATA-MODEL's example for the role reads "(e.g. doing drop-off/pickup)".
    - **No existing record reliably says transport is needed.** HOME's structured data has no field that records that an event needs someone to take or collect a person, or who is doing it. The available signals are:
      - a child's age;
      - an event's title, kind or location;
      - the absence of an assigned adult.

      The first two would be inference, and the third is absence (§6). None of them is a reliable basis.
    - **So in M5:**
      - there are no transport runs, no **Who?** chip and no `coordination_gap` detector;
      - no wording implies transport, a need, or an arrangement;
      - children's events appear on their person line like anyone's, showing the people recorded on them.
    - **Limitation recorded:** the ROADMAP's "getting-there (drop-offs/pickups)" and `coordination_gap` are not delivered in M5. They can be delivered only once transport has its own structured record. That needs a separate owner decision (a schema change, migration-first, in its own package) and is listed in contract §12 as an open decision. It also bears on M6, whose conflict engine expects "double-booked responsibilities" and "unassigned responsibilities".

22. **Provisional thresholds (`busy_day`): approved as provisional.**

    | Threshold | Fires when | Wording |
    |---|---|---|
    | `busy_day.count` | There are at least **6** event occurrences in a day on the reader's agenda, not counting routine items (§14) | "Tomorrow has seven things on." |
    | `busy_day.late` | At least **two household adults** each have a visible timed event ending after **18:00** | "Sam and Alex both have something on after 6 tomorrow." |

    Both are code constants, deterministic and boundary-tested. They are not settings. The wording states only the facts that crossed the threshold: it does not use "busy", "full", "stressful" or "out", and does not say or imply that anyone is unavailable.

    The thresholds are **provisional**. They will be evaluated during the M10 family trial, and any change is recorded by an ADR amendment. The earlier "≥3 runs" criterion is withdrawn with §21.

23. **Dismiss in M5; "Not useful" stays in M6: approved.** A plain Dismiss on Worth knowing:
    - is a no-JS form button;
    - uses the existing `insight_response` service;
    - removes the insight for that user and that key;
    - is audited;
    - is refused in Production while the gate is closed, like every domain write.

24. **Overnight events on both days: approved.** A timed event that runs past midnight appears on the next day as well ("until 1:00"), on Today and Forward alike. This is display only: the event's identity and occurrence are unchanged.

25. **Detail stays on full pages in M5: approved.** Sheets wait for M6.

26. **Seven-day lookahead: approved.** The detectors read today and the next seven days.

### Process

27. **Packages:**
    - **0:** this contract.
    - **1:** agenda groundwork.
    - **2:** the today and insights engines.
    - **3:** the Today screen.
    - **4:** Worth knowing, explanations and Dismiss.
    - **5:** acceptance.

    Builder, review intensity and verification are set per package in contract §2, using M4's risk-based strategy. Package 1 cannot start until the owner approves this ADR and the contract.

28. **Verification:**
    - `pnpm verify:focused` while working. It refuses high-risk paths.
    - The full `pnpm verify` before every PR on a high-risk package.
    - CI on every PR.
    - A focused independent review per package at its stated intensity.
    - A comprehensive acceptance in Package 5.

    Settled security reviews are not repeated unless a package introduces a new boundary.

29. **Production.** M5 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed. M5 adds no migration and no Production setting. Its acceptance is technical acceptance on synthetic data; usefulness to the household is proven in the M10 trial, after the gate opens.

### Implementation

30. **Package 1: agenda groundwork.**

    - **Overnight placement (§24).** The agenda engine places a timed occurrence on every home day from the day it starts to the day before it ends. An end exactly at midnight does not reach the next day. Each placement is the same occurrence: the same `eventId`, `occurrenceDate` and instants, with `day` of `days`, as all-day items already had. The engine expands far enough back (the event's length plus a day) to find an occurrence still running on the first day of a range. Recurring, skipped and overridden occurrences follow the same rule, because placement happens after expansion. All-day handling is unchanged. Today, Forward and Coming up get this from the shared engine; none of them filters or places anything itself.
    - **Ordering and zones (m-6b).** The agenda already placed timed items by home date and ordered them by their actual start instant. Package 1 keeps that and tests it across Pacific/Auckland, UTC, London and New York, including each zone's clock changes. The remaining gap was a series page's *Next few times*: it windowed regular occurrences by the series' own date, but changed ones by home date. Both now use `occurrencesAtHome`, so a series page shows exactly the times Today and Forward show for those days.

      The page keeps giving times in the event's own zone, as its form does, and now says which zone that is ("New York time", "UTC") when it is not home's. No new time-zone rules were added.
    - **Rows.** A carried-over row says where it runs to on its first day ("until Wednesday 01:00"), which day it is in between ("Day 2 of 3"), and where it began on its last day ("Ends · from Tuesday 23:00"). This is shared presentation (`timedRow`) that Package 3 may restyle.
    - **Event kind.** Event items carry the recorded `kind` as `eventKind`, or `null` when a caller gives none. The loader always gives it. No classification is added.
    - **Batched people (ADR 0008 §7).** `listEventPeopleFor(actor, eventIds)` in the events service reads every event's annotations in one query. It joins the event under the same readable-records predicate as `getEvent` (visible to the actor, archived only when asked for) and each person under `visibleTo`, in the same order as `listEventPeople`. Ids the actor cannot read contribute nothing, indistinguishably from events with no people. Privacy stays in the domain query; nothing is filtered in the loader or the UI.

      The composition the app loader did is now the domain's `readAgendaInputs(actor, deps)` (`src/domain/events/agenda-inputs.ts`), unchanged in meaning: own annotations replace calendar defaults, and a changed occurrence with no people of its own shows its series' people. Measured on synthetic data, the composition's queries were 4 + 2 per event before (8 events: 20; 38 events: 80) and are now a constant 7.
    - **Unchanged.** There is no schema change and no migration. The export service still reads annotations per event (`listEventPeople`); it is not on Today's path and is left for a later package.

31. **Package 2: the Today and insights engines.**

    - **Shape.** `src/domain/engines/today.ts` (`today()`), `src/domain/engines/insights/` (`insights()`) and their shared `day-facts.ts`. Both are pure functions of authorised records, the agenda engine's own output, the home zone and an injected `now`. They do no database access, never read the clock (a test scans their source for `Date.now`, `new Date()` and `Math.random`), import nothing from `app`, `kev`, `ui`, `integrations`, `trust` or the database client, and expand no recurrence of their own. Every statement is `{ rule, text, facts }`. Facts are structural (ids and dates only, never text), so nothing a person wrote travels with a fact. The engines are not yet wired to the screen; Package 3 does that.
    - **Routine (§14).** An item is routine when its event is a plain weekly or fortnightly series (`weeklyCadence`, the regular week's own test) of kind `school` or `work`, with a household person on it. This is the same test as the regular week, decided from the recorded rule and kind without expanding anything. A changed occurrence is its own row with no rule, so it is never routine and is said in full.
    - **Headline (§15).** The closed set is first run, evening, **listed**, counted, usual and nothing, plus the late-evening second sentence and the "as far as HOME knows" qualifier.

      `headline.listed` is new: one or two non-routine events today, all timed and starting today, are named with their times ("Swimming at 15:30, then Pilates at 18:15."). It applies the brief's factual-wording example within the contract's latitude for final copy, and is documented in contract §5.3. A carried-over or all-day item uses `headline.counted`.

      First run means no live calendar *and* no events at all. A household with a calendar but nothing on is a quiet day, and a household with events but no calendar is an ordinary day.
    - **Evening (§17), as corrected after the Package 2 review.** Evening applies only when something timed **began today** (`day === 1`) and every timed item on today, carry-overs included, is over. A day with nothing timed is never "evening" at any hour; a carry-over from last night (an overnight shift ending at 01:00) can never bring evening on by itself; an overnight event still running holds it off. While an all-day event is recorded for today, the evening headline is `headline.evening_all_day`, "Today’s timed events have finished.", which says nothing about the all-day event; otherwise it stays "Nothing else on today.".
    - **Carry-overs in counts (review fix).** A carried-over timed occurrence (`day > 1`) counts towards `headline.counted`/`listed`/`usual` and `busy_day.count` only while it is still running at `now` (`stillCounts`). One that has ended stays on the agenda and its person's line but is no longer counted as on today; everything that begins on the day counts. In the day view, past items fold into Earlier once more than one has passed. Tasks due tomorrow under *Before then* carry their own rule, `todo.due_tomorrow`.
    - **Everyone's day (§14).** A household person's own birthday is on their line ("Birthday"); one outside the household goes under Also today. A carried-over item reads "{title} until 01:00", or "{title}, all day" on a middle day. Tasks are not put on person lines: they are said once, under To do.
    - **To do.** Order is scheduled today (by time), then due today (by title), then carried over (oldest due date, then title, then id). Three are shown and the rest are counted. The full selection is returned, so nothing is silently dropped; tasks with no date or a later date are not Today's.
    - **Detectors (§16).**
      - `data_health`: at most one per calendar. `failed` (last refresh status other than ok or partial) wins over `stale` (last success more than 24 hours ago, strictly). Archived calendars and calendars never refreshed say nothing.
      - `preparation.birthday`: covers today through seven days ahead, and today's is marked as already on its item.
      - `preparation.project_target`: active projects with at least one recorded open task only.
      - `busy_day.count` and `busy_day.late`: computed for today (marked as already said by the headline) and tomorrow. "After 18:00" means ending strictly after 18:00, or running into the next day. Only household adults (`role = parent`) count.
      - Keys are `{rule}:{subject ids}:{date}` (`busy_day.count` includes the count), are valid `insightKey`s, and are stable across input order.
    - **Ranking (§16).** By kind (`data_health`, `preparation`, `busy_day`), then date, then key: a total order. Up to three are shown. "+ N more" counts only eligible insights: not already said on their item and not dismissed by this reader (the engine takes the reader's dismissed keys).
    - **Evidence.**
      - The non-interference invariant runs through the real services as `home_app`. Alex's whole Today model (at 07:03 and 22:00) and insight list are identical before and after Sam adds a private late evening, six private events tomorrow, a private person with a birthday, a private project with a task, a private task due today, a private stale calendar and a capture. The same records do change Sam's.
      - Mutation checks: removing calendar visibility, adding an "easy" headline, removing the ordering tie-breaks, and counting insights already said on their item each fail the tests.
      - Performance: 300 events over the week (agenda included) take about 90 ms per run on the development container.
    - **Unchanged.** No schema, no new dependency, no screen, no Dismiss write, no transport, no Kev.

32. **Package 3: the Today screen.**

    - **One read, one engine, one view.** `src/app/(home)/today/page.tsx` reads the agenda for today and tomorrow through the shared loader and the waiting captures, builds the engine's input from those records (`todayInput`, `src/app/_agenda/today-input.ts`, which only hands records over), runs `today()` and gives the model to `TodayView`. The view orders nothing, counts nothing and words nothing of its own: the headline, the second sentence, each person's lines, Also today, the to-dos and the evening state are the model's, rendered as given. A test scans the view for a clock, a database, `trust`, `kev` and `integrations` imports.
    - **No second read.** `readAgendaInputs` now also returns the whole records it read (`records`: tasks, projects, calendars). Package 1's page had read tasks, projects, people and calendars again beside the agenda, and read the calendars twice (once more for the refresh-on-use check); all of that is gone. Today's data load is the agenda read plus the captures, and its query count does not change with the number of events, tasks, projects or captures (an integration test measures it, and compares it with what the page did before: 8 queries, constant, where the page made 13).
    - **Shape.** The date is small and quiet (the `h1`); the headline is the large serif sentence beneath it, with its second sentence in a quieter tone. Then, in order: Everyone's day, Also today, To do, "N things to sort ›", "Which one is you? ›" for an unlinked adult, and "The next 30 days ›". Empty sections are absent and no empty container is drawn. No hour grid, badge, counter, colour for state or icon was added; people keep their dot and name. Spacing and type are the same on every day.
    - **The headline's facts (deviation from §4.4's gesture).** The contract says tapping the headline expands it to its facts. The screen instead puts one quiet, labelled line under it, "What this is based on ›", a native `<details>` that opens to the events counted (in the agenda's own row style, with their people), or, when nothing is recorded, to "HOME has nothing recorded for {date}" and the calendars looked at, each with when it was last updated. A labelled control is discoverable, keyboard-operable and 44px, where tapping a large sentence is none of those. It works without JavaScript. First run shows "Connect a calendar ›" in its place.
    - **Everyone's day.** The engine's people, in its order, with two lines on the surface and "+ N more" as a native disclosure holding the rest. A routine entry is one quiet word with nobody beside it; a one-off shows the other people recorded on it (never inferred from its title, and none where none is recorded). The person and each line link to their own pages. At 768px and wider Today is two columns: the headline, To do and To sort on the left, Everyone's day as one calm card per person on the right (hairline border, no shadow, no hour lanes). The shell lets a page grow from 720px to 960px when it holds a `data-wide` element; only Today does, on every day, so its left edge does not move from one day to the next. Morning, afternoon and evening words on the cards (concept §3) are not built: choosing the word is interpretation the engine does not do.
    - **Also today** is the engine's list in the agenda's row style, so nothing is lost and nothing repeats a person's line.
    - **To do.** The engine's three, with a recorded date in words ("Due today", "From Tuesday"), a scheduled time in the time column and the project; "Three more to do ›" goes to the full list. The count is words, never a warning. Tasks due tomorrow ("Before then") say "Due tomorrow".
    - **To sort.** The same line and link as before. No Kev action or proposal.
    - **Worth knowing is not drawn.** The contract keeps it for Package 4 (§2.1), and the insights engine is not wired to this screen. The slot is where §4.1 puts it, between the headline and Everyone's day, and is absent like any empty section, so there is no placeholder, no duplicate and no new write path. A calendar that is out of date is already said by the headline's "as far as HOME knows", named in its facts, and refreshed on use as in M4.
    - **Evening.** The state and its words are the engine's. The screen then shows, in order: **All day today** (the all-day events recorded for today, kept visible because the headline then says only that the *timed* events have finished); **Tomorrow morning**; **Before then** (or "Due tomorrow" when nothing is on tomorrow morning); To do; To sort; and **Earlier today** folded away. "Tonight" is the headline itself ("Nothing else on today."); no separate section is drawn for it, since nothing remains to put in one. Everyone's day is not shown in the evening, as in the concept.
    - **Which two lines (after the Package 3 review).** The engine chooses them (`lineSelection` in `today.ts`, with the injected `now` and each occurrence's own end; no clock, no recurrence). An entry is finished only when it is a timed occurrence that has ended; one under way, an all-day item and a birthday are not. The two are the earliest unfinished entries; if fewer than two remain, the most recently finished fill the rest (latest end, then later in agenda order). They keep agenda order, and every other entry is in `rest`, in agenda order, which is what "+ N more" counts and holds. So at 17:00 Alex's 18:15 Pilates is on the card and the finished morning is under "+ 1 more". Nothing is ranked by importance and nothing leaves the day model. The person's name sits level with their first line (it was centred against the whole card).
    - **Not built.** Past items are not faded, and the engine's `earlier` is not used in the day view; the selection above keeps them from hiding what is still to come, and they stay one tap away. Time-of-day words on the cards are deferred.
    - **Test time source (§8.4).** `HOME_TEST_TIME=allow` lets a request carry `x-home-test-now`, an ISO instant Today reads as now; `HOME_TEST_CLOCK=07:03` gives requests without it a steady clock on the real date, so the end-to-end specs that create records for "today" no longer depend on the hour they run (after the last event of the day, Today is the evening). Both are set only in the Playwright config; `parseEnv` refuses them in production and on any Vercel deployment, and only Today reads them.
    - **Evidence.**
      - A seeded-scenario spec (`today-screen.spec.ts`, on Thursday 11 February 2027 with the household's other records held aside): the ordinary weekday, a full day, quiet, first run, a stale calendar, evening with and without an all-day event, an overnight shift, a changed occurrence with a multi-day event, Also today, the other adult's private records (the same page, byte for byte, before and after), the unlinked adult's prompt and the keyboard path.
      - Four viewports (phone, tablet portrait and landscape, desktop) × four scenarios, with axe, no horizontal scroll, disclosures open, the capture bar clear of the last control and two columns only where there are two things to put in them. Screenshots are written by the spec (test-results/screenshots, never committed) and shown to the owner with the PR.
      - Without JavaScript: the facts, "+ N more" and links all work.
      - Unit tests render the view from the synthetic household and check order, the model's words, links, absence of need, arrangement or availability wording, and the view's imports.
    - **Recorded after the Package 3 review.** For Package 4: a failed calendar's facts say when it last updated but not that its last refresh failed (the `data_health.failed` insight is the place to say it), and the stale qualifier makes a long headline ("…, besides the usual, as far as HOME knows."). For M5 acceptance: a household person's birthday folds into Earlier today in the evening. For the shell backlog: at 320px the wordmark and the Today/Forward switch nearly touch.
    - **Carry-forwards for Package 4.** Worth knowing (≤3, "+ N more", facts in place, Dismiss) goes between the headline and Everyone's day and can reuse the facts disclosure (`FactsInPlace`, `Disclosure`). When `data_health` becomes an insight, the headline's qualifier stays (it qualifies counts and absences) and the insight must not say the same thing a third time. Past items in the day view and time-of-day words on the cards are open for the owner.
    - **Unchanged.** No schema, no migration, no new dependency, no Kev, no transport, no weather, no calendar write, no Dismiss.

## Consequences

- **ROADMAP.** The M5 row records the approved boundary changes (§20, §23, §25) and the narrowing in §21.
- **V0.1-SCOPE.** Its Today line ("who's doing drop-off/pickup") is not met in M5, for the reason in §21.
- **Data-model wording.** FAMILY-DATA-MODEL's example for `responsible` ("e.g. doing drop-off/pickup") conflicted with §21. Package 1 changed it, as the owner approved, to "the person responsible for the event; not, by itself, a record of transport".
- **SYSTEM-ARCHITECTURE.** §2.6's `coordination_gap` row stays as the long-term design. Its prerequisite is a structured transport record.
- **Other rules.** CLAUDE.md and the rest of SYSTEM-ARCHITECTURE are unchanged. M5 follows their existing rules.
- **Prototype.** `/prototype` stays as reference until M6 deletes it.
