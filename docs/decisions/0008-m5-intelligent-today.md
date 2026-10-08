# ADR 0008 — M5 Intelligent Today: scope, architecture and decisions

Status: **Proposed**, 2026-10-08, and revised the same day after the owner's first review.

- **Approved by the owner:** §20, §23, §24, §25 and §26.
- **Approved as provisional:** §22.
- **Revised as the owner directed:** §21.
- **Awaiting the owner:** overall approval of this ADR and the contract, `docs/m5/M5-BUILD-CONTRACT.md` (Package 0). No M5 code is written until both are approved.

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

## Consequences

- **ROADMAP.** The M5 row records the approved boundary changes (§20, §23, §25) and the narrowing in §21.
- **V0.1-SCOPE.** Its Today line ("who's doing drop-off/pickup") is not met in M5, for the reason in §21.
- **Data-model wording.** FAMILY-DATA-MODEL's example for `responsible` ("e.g. doing drop-off/pickup") conflicts with §21. A wording change is proposed for the owner's decision (contract §12) and is not made here.
- **SYSTEM-ARCHITECTURE.** §2.6's `coordination_gap` row stays as the long-term design. Its prerequisite is a structured transport record.
- **Other rules.** CLAUDE.md and the rest of SYSTEM-ARCHITECTURE are unchanged. M5 follows their existing rules.
- **Prototype.** `/prototype` stays as reference until M6 deletes it.
