# ADR 0008 — M5 Intelligent Today: scope, architecture and decisions

Status: **Proposed**, 2026-10-08. Awaiting the owner's product and architecture approval, and decisions §20–§26. Contract: `docs/m5/M5-BUILD-CONTRACT.md` (Package 0). No M5 code is written until both are approved.

## Context

M4 is technically accepted on synthetic data (`docs/m4/M4-ACCEPTANCE.md`, ADR 0007 §48), and PR #52 has merged. Its operational acceptance on real calendars waits on DEPLOY.md §E items 12–15. M3's owner acceptance waits on the restore rehearsal (§E items 7–8), and M1's on §E items 1–6. The Production real-data gate is closed (ADR 0006 §2).

Today is still the factual screen from M3 (ADR 0006 §59), with synced events added in M4. It shows the date, the day's agenda rows, open tasks that are due, the To sort line, the "Which one is you?" prompt, and a link to Forward. It has no meaning, insights or weather.

The repository already commits M5 to a specific outcome. The ROADMAP M5 row reads: *"Today per the M0 concept: day headline, getting-there (drop-offs/pickups), per-person day, tasks, weather line, To sort count; insights engine skeleton with `coordination_gap`, `busy_day`, `preparation`, `data_health` detectors and template text; person profile screens."*

Earlier decisions already settle the shape:

- **The Today concept:** `docs/concepts/TODAY.md`, with the refinements recorded in `docs/concepts/README.md`.
- **The deterministic headline:** README refinement 4.
- **Contextual evening mode:** refinement 3 and M0.6 refinement 4.
- **On-object problems are never repeated as insights,** and "+ N more" counts only genuine insights (ADR 0002 §2–§3, PRODUCT-PRINCIPLES §8).
- **Insights are derived on read,** carry their facts and template text, and only dismissals persist (CLAUDE.md rule 15, SYSTEM-ARCHITECTURE §2.6, ADR 0001 D19).
- **Kev phrasing and prioritising** belong to M8, and proposals and "Sort it" to M9 (ROADMAP).

Four items were carried forward to M5:

1. **Overnight events** (ADR 0006 §59, M3-ACCEPTANCE): a timed event that starts yesterday and runs into today is not shown on today.
2. **Ordering of a series in another time zone** (M4-ACCEPTANCE m-6b).
3. **The agenda loader** reads each event's annotations with a separate query (M4-ACCEPTANCE, ADR 0007 §44).
4. **Sheets** layered over the existing detail URLs (ADR 0006 §10).

Four parts of the ROADMAP M5 row overlap other milestones or are already done:

- **The weather line** needs the Open-Meteo adapter, which the roadmap schedules for M7.
- **Person profile screens** were delivered in M3, with the regular week added in M4 Package 7.
- **Dismiss / not useful** is listed under M6.
- **The concept's "Sort it" and Kev bar** are M8 and M9.

This ADR settles each of these explicitly rather than leaving them to drift.

## Decisions

### Scope

1. **M5 is Intelligent Today, computed without Kev.** Today moves from "what is happening today?" towards "what matters for our household today?", using deterministic rules over household data that is already recorded. Nothing in M5 calls an LLM. Today stays complete and useful when Kev does not exist, which in M5 is always.

2. **What M5 builds:**
   - a deterministic day **headline**;
   - **Getting everyone there**: a child's runs, with who is responsible and an on-object **Who?** when nobody is;
   - **Everyone's day**: one or two lines per household person, with routine compressed;
   - an **Also today** line for items that belong to nobody;
   - **To do** (due, scheduled today, carried over);
   - the **To sort** line;
   - **Worth knowing**: up to three insights from the `coordination_gap`, `busy_day`, `preparation` and `data_health` detectors, each with its facts and template text, and "+ N more";
   - contextual **evening mode** (Earlier today, Tonight, Tomorrow morning);
   - the healthy-quiet, first-run and stale-data states;
   - the tablet two-column layout with person cards.

3. **What M5 does not build, and where each goes:**
   - **M6:** conflicts and the `conflict` engine and detector; Forward intelligence; deleting `/prototype`; "Not useful".
   - **M7:** weather, the Open-Meteo adapter, free windows, `free_window`, `weather_effect`, `alignment`, and leave-by times.
   - **M8:** Kev, the Kev bar, Kev phrasing and ordering, "Tell me about today", and `get_insights`.
   - **M9:** "Sort it", proposals from Today, and capture through Kev.
   - **M10:** PWA polish and the time-of-day orb.
   - **No release:** push notifications, background jobs, and stored insights (ROADMAP "Not yet").

4. **Profile screens are already delivered.** The ROADMAP's "person profile screens" exist (M3, and the regular week from M4 Package 7). In M5, a person line on Today links to the existing profile. No new profile work is planned.

### The four layers of meaning

5. **Every statement on Today belongs to exactly one layer, and M5 uses only the first two.**

   | Layer | What it is | Examples | In M5? |
   |---|---|---|---|
   | **1. Known fact** | Recorded by a person or synced from a calendar, shown as it is | "3:30 Swimming · Milo · Alex", "Nana Jo's birthday is Tuesday", "Pay swimming term fees · due today" | **Yes** |
   | **2. Deterministic interpretation** | A written rule applied by code to known facts, carrying those facts | "Nobody's down for Isla's pickup" (a run with no responsible person), "School" (a regular weekly series), "Full one" (a threshold crossed), "Alex's calendar hasn't updated since yesterday" | **Yes**, with every rule written in the contract |
   | **3. Uncertain or inferred meaning** | A guess about intent, availability, need or priority | "Isla probably needs a lift", "Alex is free from 2:30", "nothing's been organised for the birthday", "this matters more than that" | **No.** Never shown as fact, and some never at all (CLAUDE.md rule 11). Availability is M7's windows engine. |
   | **4. AI-generated reasoning** | Kev's wording, ordering or explanation | "Kev noticed…", reworded insights, "Tell me about today" | **No.** M8, and always labelled as Kev's. |

   The words on Today say what the rule found and nothing more. For example, "Nobody's down for it" is correct, while "Isla needs picking up" claims a need HOME does not know.

### Architecture

6. **Today has no second agenda engine.** The M3/M4 agenda loader and engine (`src/app/_agenda/load.ts`, `src/domain/engines/agenda.ts`) stay the only place that places, expands and orders items. M5 extends them where it needs to:
   - each event item carries its `kind`;
   - overnight carry-over, if decided (§24);
   - ordering by local time within a day (m-6b);
   - annotations read in a single batch.

   It does not create a parallel engine.

7. **Two new pure engines read the agenda's output:**
   - `src/domain/engines/today.ts`: runs, gaps, person lines, routine compression, day parts, evening state, and the headline's facts and template.
   - `src/domain/engines/insights/`: the candidate type, keys, the four detectors and deterministic ranking.

   Both are pure functions of their input and an injected `now`. They never read the database or the clock, and never import `db`, `app` or `kev`. Like the existing engines, they sit under `src/domain/engines/`.

8. **The loader assembles data and the screen presents it.** A Today loader in `src/app/(home)/today/` reads everything as the signed-in adult through the existing domain services:
   - the agenda for today plus the next seven days;
   - open tasks;
   - captures;
   - the adult's visible calendars and their freshness;
   - the adult's own insight responses.

   It then calls the two engines and hands their output to presentational components. Screens contain no rules, and the engines contain no presentation beyond template sentences.

9. **Privacy is enforced by what reaches the engines.** The engines only ever receive what the domain services returned for this actor. An event, annotation, task, person or calendar the reader cannot see therefore cannot appear in, or be counted towards:
   - a run or gap;
   - a person line;
   - the headline;
   - a busy threshold;
   - an insight's facts or its "+ N more".

   This is tested as an invariant: adding records the reader cannot see leaves the reader's Today output identical. Insights are computed per actor, and an insight key is built from ids and dates only. Dismissals are private to their user (`insight_response`, M2). Sensitive context is not read by Today at all.

10. **Every interpretation explains itself.**
    - Each gap and each insight carries `facts`, the source items (ids, titles, times, people) it was derived from, together with its template sentence. Today renders the sentence immediately.
    - Tapping an insight shows its facts in place, using no JavaScript (`<details>`).
    - The headline exposes the facts it was built from in the same way.

    Insight `facts` are built only from the reader's visible items.

11. **No new schema.** M5 needs no table, column or migration:
    - runs come from the existing `event_person` roles and person `role`;
    - routine comes from the `profile` engine's regular week;
    - freshness comes from the calendar service;
    - dismissals use `insight_response` (M2), whose service already exists.

    If a decision below is taken the other way (§21, option B), that change is a migration-first package of its own.

12. **No new write authority.**
    - **Who?** and every other action links to an existing page and its existing domain service. Choosing who is responsible stays on the event's people page from M4 Package 6, including "for this one" on a repeating manual series from M4 Package 8b.
    - The only write Today adds is dismissing an insight (if §23 is approved). It goes through the existing `insights/service.respond`, as the adult, audited, and gated like every other domain write.
    - Kev gains nothing.

### Behaviour

13. **Runs.** A run is a timed (not all-day) event occurrence on the reader's agenda that:
    - is attended by a person whose `role` is `child` and who is in the household; and
    - has a kind other than `birthday`, `deadline` or `work`.

    The run shows its responsible people, or an on-object **Who?** when it has none. That is the `coordination_gap` for today, shown on the run and never repeated in Worth knowing (ADR 0002 §3). How a run that needs nobody stays quiet is decision §21.

14. **Routine compression.** An item on a person's day is *routine* when its event belongs to that person's regular week (the `profile` engine, M4 Package 7) and its kind is `school` or `work`. Routine is compressed to a word or a short phrase ("School", "Work till 2:30"). Everything else keeps its time. Each person gets at most two lines, then "+ N".

15. **Headline.** A small, closed set of deterministic templates chosen by rules over the day's facts:
    - quiet;
    - easy with runs;
    - gaps to sort;
    - full day;
    - evening;
    - first run (no events and no calendars yet);
    - incomplete data.

    The headline is never replaced by LLM text, and never claims the day is quiet or easy while a calendar the reader can see is failing or out of date. In that case it says "as far as HOME knows". The exact sentences are fixed and tested in Package 2 and approved by the owner from screenshots in Package 3.

16. **Detectors in M5:**
    - `coordination_gap` for **tomorrow's** runs. Today's gaps are on their runs.
    - `busy_day` for today and tomorrow. Thresholds are set by §22.
    - `preparation`: a visible person's birthday within the next seven days, or an open project's target date within seven days with open tasks. It states the fact only, never "nothing prepared".
    - `data_health`: a calendar the reader can see whose last successful refresh is older than 24 hours, or whose last refresh failed.

    Ranking is deterministic, by kind priority and then time proximity. Insights already shown on an object are marked and excluded from the list and its count.

17. **Evening mode is contextual, not a clock rule.** "Nothing meaningful remains" means no timed item still to come today and no gap still open today. When that holds, Today leads with *Tonight — nothing else needs you*, then *Tomorrow morning*: tomorrow's items before midday, and tasks due tomorrow under *Before then*. Today's past items fold into *Earlier today*. If something still needs attention tonight, it stays first. "Now" is the request time in the home zone, injected and testable.

18. **Incomplete information is said plainly, never filled in.**
    - A calendar that is stale or failing is a `data_health` insight, and it qualifies the headline (§15).
    - Items with no people go under *Also today* and never vanish.
    - A household person with nothing visible today has no line.
    - An unlinked adult still sees "Which one is you?".
    - No count, time or person is ever made up to complete a template. A template whose facts are missing is not shown.

19. **No regression to existing Today behaviour.**
    - Every item Today shows now (events, synced events, birthdays, project targets, due and overdue tasks, To sort, "Which one is you?", the Forward link) still appears in M5's Today.
    - The refresh-on-use behaviour, quiet-day wording and no-JS operation are kept.
    - A test proves that every item the agenda returns for today is placed somewhere on the screen.

### Owner decisions (proposed defaults; approval required)

20. **Weather line: defer to M7** *(recommended)*. The ROADMAP lists a "weather line" in M5, but its only data source, the Open-Meteo adapter, is M7's. Building the adapter in M5 would pull an external integration (CSP, safe fetch, home coordinates in configuration) into a Today milestone.

    *Alternative:* add the adapter and a one-line forecast to M5 as its own high-review package.

    The ROADMAP M5 row is updated to match the decision.

21. **A run that needs nobody (option A recommended).**

    - **A: quiet the run by marking the child themselves responsible.** A child marked as responsible for their own event reads "Milo · own way", and no **Who?** appears. This uses the existing `event_person` role, needs no schema, and is set once on a series. **Who?** appears for every child's run until someone is marked, which is the honest default: HOME does not know.
    - **B: add a per-event "getting there" flag.** The values would be someone taking them, or makes their own way. That is a migration-first schema package, with more surface and clearer words.
    - **C: show no Who? in M5.** Responsible people would be listed where set, and gaps deferred.

22. **Busy-day thresholds** *(recommended defaults, constants in the engine, tuned during the M10 trial).* A day is "full" for the household when, among items the reader can see:

    - there are at least **3 runs**; or
    - there are at least **6 timed events** across household people; or
    - both adults have a timed commitment ending after **18:00**.

    Thresholds are code constants, so they are deterministic and tested. They are not settings.

23. **Dismiss in M5; "Not useful" stays in M6** *(recommended)*. The ROADMAP lists "dismiss / not useful" under M6. Worth knowing arrives in M5, and a calm Today needs a way to put an insight away; the concept's swipe is its touch form.

    The proposal is a plain **Dismiss** for M5 only:
    - a no-JS form button;
    - the existing `insight_response` service;
    - gone for that user, for that insight key;
    - audited;
    - refused in Production while the gate is closed, like every domain write.

    "Not useful" and its tuning use remain in M6. *Alternative:* no dismissal in M5. Worth knowing items then clear only when their facts change.

24. **Overnight events on both days** *(recommended)*. A timed event that runs past midnight appears on the next day too, as "until 1:00", on Today and Forward alike. This changes the agenda engine's day semantics for every screen, which is why it needs approval. The carry-over is display only, and the event's identity and occurrence are unchanged.

    *Alternative:* keep start-day placement and show nothing on the next day.

25. **Detail stays on full pages in M5** *(recommended)*. Tapping an item, person or insight action goes to the existing full page, as it does today. Sheets layered over the same URLs (ADR 0006 §10) wait for M6, when Forward is rebuilt and both places can adopt them together.

26. **Today's lookahead is seven days** *(recommended)*. Detectors read today plus the next seven days. That covers tomorrow's runs, birthdays and project targets "this week". Anything further ahead is Forward's (M6).

### Process

27. **Packages:**
    - **0:** this contract.
    - **1:** agenda groundwork.
    - **2:** the today and insights engines.
    - **3:** the Today screen.
    - **4:** Worth knowing, Dismiss and explanations.
    - **5:** acceptance.

    Builder, review intensity and verification are set per package in contract §2, using M4's risk-based review strategy. Package 1 cannot start until this ADR is accepted.

28. **Verification:**
    - `pnpm verify:focused` while working. It refuses high-risk paths: `src/trust`, `src/db`, `src/domain/common`, `src/integrations`, the proxy, the gate, the browser suite's sign-in and fixtures, and its own config.
    - The full `pnpm verify` before every PR and for every high-risk package.
    - CI on every PR.
    - A focused independent review per package, at the intensity in the contract.
    - A comprehensive acceptance in Package 5.

    Settled security reviews (auth, CSP, calendar boundary) are not repeated unless a package introduces a new boundary.

29. **Production.**
    - M5 is built and accepted on synthetic data. `HOME_REAL_DATA` stays closed, and no real household data or calendar is used anywhere.
    - M5 adds no migration (unless §21 B is chosen) and no Production setting.
    - M5's acceptance is technical acceptance on synthetic data. Its usefulness to the household is proven in the M10 trial, after the gate opens.

## Consequences

- **ROADMAP.** The M5 row records the contract as drafted and awaiting approval, and §20, §23 and §25 as proposed boundary changes. On approval, the row is updated to match.
- **Unchanged rules.** CLAUDE.md, SYSTEM-ARCHITECTURE §2.6 and FAMILY-DATA-MODEL are unchanged, because M5 follows their existing rules. If an implementation package finds one too narrow, it stops and proposes an ADR amendment.
- **Prototype.** `/prototype` stays as reference until M6 deletes it. M5 never imports it or copies from it.
