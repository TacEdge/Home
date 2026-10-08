# M5 — Intelligent Today: Build Contract

Status: **Proposed**, 2026-10-08. This contract is Package 0: it changes no code. M5 implementation has **not started**. Package 1 begins only after the owner approves this contract and ADR 0008, including decisions §20–§26.

Implementers and reviewers: per package (§2).

At the end of M5, an adult opening Today sees what matters for the household today, not only what is happening:

- **a headline** that says what kind of day it is;
- **who needs to be taken where**, and by whom, with a plain **Who?** where nobody is down;
- **each person's day** in a line or two, routine kept quiet;
- **what's to do**;
- **up to three things worth knowing** that HOME has noticed in the household's own records.

In the evening, Today leads with tonight and tomorrow morning.

All of it is computed by deterministic code from data the household has already recorded, explains itself, and works without Kev. **Nothing here is AI, nothing is guessed, and nothing is invented.**

Authoritative references:

- `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md` (§8 especially) and `docs/BRAND.md`;
- `docs/concepts/TODAY.md` and `docs/concepts/README.md` (refinements and ADR 0002 decisions);
- `docs/SYSTEM-ARCHITECTURE.md` §2.2 and §2.6, and `docs/FAMILY-DATA-MODEL.md`;
- `docs/decisions/0001–0008`;
- the M3 and M4 contracts, whose rules continue;
- `docs/runbooks/`.

Where this contract narrows or defers part of those documents, ADR 0008 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1–M4

- **Status of earlier milestones:**
  - **M4** is technically accepted on synthetic data. Its operational acceptance waits on DEPLOY.md §E items 12–15.
  - **M3's** owner acceptance waits on the restore rehearsal (§E items 7–8).
  - **M1** is deployed but not accepted (§E items 1–6).
  - None of these blocks M5 *development*. M5 is built and tested on synthetic data in local, CI and Preview, as M3 and M4 were.
- **The Production real-data gate stays closed.** M5 adds no new kind of write. Its one write, dismissing an insight (if ADR 0008 §23 is approved), passes through `auditedWrite` and is refused in Production while `HOME_REAL_DATA` is not exactly `open`.
- **M1–M4 guarantees stay in force, unchanged:**
  - auth and the allowlist;
  - the runtime role;
  - CSP and headers;
  - visibility and sensitivity in the domain query layer;
  - Kev refusal;
  - the gate;
  - structural audit;
  - export completeness;
  - migration-first;
  - synthetic data only;
  - read-only calendars;
  - refresh on use.
- M5 builds on M3's factual Today and M4's synced events. The agenda loader and engine stay the single source of placed items (ADR 0008 §6).

---

## 1. Scope

### 1.1 What the roadmap commits M5 to (ROADMAP M5)

| Commitment | M5 decision |
|---|---|
| Today per the M0 concept | **Built**: §4, within the exclusions below |
| Day headline | **Built**, deterministic (§5.4) |
| Getting there (drop-offs and pickups) | **Built** as *runs* (§5.1) |
| Per-person day | **Built** (§5.2) |
| Tasks | **Built**: extends M3's To do (§5.6) |
| Weather line | **Proposed: deferred to M7** with its adapter (ADR 0008 §20) |
| To sort count | **Kept** (M3) |
| Insights engine skeleton with template text | **Built** (§5.5) |
| `coordination_gap`, `busy_day`, `preparation`, `data_health` | **Built** (§5.5) |
| Person profile screens | **Already delivered** (M3, plus the regular week in M4 Package 7). Today links to them. |

Also settled for M5 by earlier documents:

- **Contextual evening mode** (concepts README refinement 3, M0.6 refinement 4).
- **On-object gaps and "+ N more" counting only genuine insights** (ADR 0002).
- **Carry-forwards from M3 and M4:**
  - overnight events (proposed decision ADR 0008 §24);
  - ordering of a series in another time zone (M4 m-6b);
  - the loader's annotation reads.

### 1.2 Build

| Area | What |
|---|---|
| **Agenda groundwork** | Items carry their event `kind`. Annotations are read in one batch per request, as the actor. Within a day, items are ordered by local time (m-6b). Overnight carry-over is added if approved. The agenda engine is extended, not duplicated. |
| **Today engine** | `src/domain/engines/today.ts` derives runs and gaps, person lines with routine compression, *Also today*, day parts (morning, afternoon, evening), evening state and the headline's facts and template. |
| **Insights engine** | `src/domain/engines/insights/` provides the candidate type, deterministic keys, the four detectors, ranking, and marking of candidates already shown on an object. |
| **Today loader** | `src/app/(home)/today/load.ts` reads through the domain services as the actor, calls the engines and filters out the adult's own dismissals. |
| **Today screen** | Headline, Worth knowing, Getting everyone there, Everyone's day, *Also today*, To do, To sort, "Which one is you?", the Forward link. Plus evening mode, the quiet, first-run and stale states, and the tablet two-column layout with person cards. |
| **Explanations** | Every gap, insight and headline shows the facts it came from, in place and without JavaScript. |
| **Dismiss** | Only if ADR 0008 §23 is approved: one form action through the existing `insights/service.respond`. |
| **Fixtures** | The six M0 scenarios rebuilt as synthetic domain data for engine tests and seeded e2e (M1 contract: "M5 onwards"). |
| **Tests** | Engine unit tests (scenarios, DST, thresholds, the privacy invariant), loader integration tests as `home_app`, Today e2e, and the two-adult privacy and device sweeps extended to the new Today. |

### 1.3 Do not build

- **Nothing from later milestones:**
  - **M6:** conflicts (the `conflict` engine and detector, overlaps, double bookings), "Not useful", Forward changes, deleting `/prototype`.
  - **M7:** weather and forecasts, free windows, availability ("free from 2:30"), leave-by or travel times, `free_window`, `weather_effect` and `alignment`.
  - **M8:** the Kev bar on Today, Kev phrasing or ordering of insights, "Tell me about today" and `get_insights`.
  - **M9:** "Sort it", proposals from Today and Kev capture.
  - **M10:** the time-of-day orb and PWA polish.
- **No inference:** nothing guessed about need, intent, priority, preference, availability, emotion, health or relationships, whether shown as fact or as a suggestion (ADR 0008 §5, CLAUDE.md rule 11).
- **No stored insights, no push notifications, no background jobs, no new schema** (unless ADR 0008 §21 B is chosen, as its own migration-first package).
- **No context records on Today.** Context is shown where its subject is (profile, event) and is read by Kev in M8. Sensitive context is never read by Today.
- **No sheets** (ADR 0008 §25), no hour grid, no badges, counters, red, streaks or progress, no greeting, and no "+" add button.
- **No new runtime dependency.**

---

## 2. Implementation packages

Packages are acceptance boundaries. Each one ends with CI green, a focused independent review at the stated intensity, and the owner merging it. Package *n* starts only after *n−1* has merged.

### 2.1 Packages

| # | Package | Objective | Scope | Depends on | Main risks | Builder | Review |
|---|---|---|---|---|---|---|---|
| **0** | **Contract and ADR** | Agree M5's product, architecture, packages and acceptance | This document, ADR 0008, ROADMAP and status | — | Mis-scoping; decisions left implicit | Opus | Owner approval |
| **1** | **Agenda groundwork** | Give the agenda what Today needs, without a second engine | (1) `kind` on event items. (2) One batched annotation read in the events service (`listEventPeopleFor(actor, eventIds)`), visible exactly as its events. (3) Ordering by local time (m-6b). (4) Overnight carry-over if §24 is approved, on Today and Forward. (5) Forward, *Coming up* and the regular week unchanged otherwise. | 0 approved | A new batched domain read leaking an annotation of an event the reader can't see; agenda regressions on Forward; DST and overnight edges | **Opus** | **High** (new domain read path; shared engine semantics) |
| **2** | **Today and insights engines** | Deterministic meaning, fully tested, with no UI | `engines/today.ts` and `engines/insights/` per §5, template text, keys, ranking, on-object marking. The six scenarios as pure inputs. The privacy invariant test (§8.2). | 1 | Rules that over-claim (layer 3 creeping in); thresholds that manufacture busyness; non-determinism (clock, sort stability); DST | **Opus** | **High** (this is where meaning is defined) |
| **3** | **The Today screen** | Today per the concept, with no Worth knowing yet | Loader and page: headline, Getting everyone there (grouped by day part), Everyone's day (phone list, tablet cards), *Also today*, To do (≤3 + "N more to do ›"), To sort, "Which one is you?", Forward link, evening mode, quiet, first-run and stale states. **Who?** links to the existing people page. Seeded scenarios. e2e, a11y, no-JS and devices. Screenshots for the owner. | 2 | Regression to M3/M4 Today (an item lost); layout drifting into a dashboard; a11y of grouped lists; no-JS | **Fable** | **Medium** (presentation over reviewed engines; privacy sweep extended) |
| **4** | **Worth knowing and explanations** | Insights on Today, explained, and dismissible if approved | Worth knowing (≤3, + N more), facts in place (`<details>`), headline facts, Dismiss (§23) through the existing service with its audit, and an insight-specific two-adult privacy sweep. | 3 | Insight facts naming something the reader can't see; dismissal by one adult affecting the other; key instability making dismissed insights return | **Opus** | **High** (a new user-facing write entry and per-actor derived content) |
| **5** | **Acceptance** | Prove M5 against §10 | `docs/m5/M5-ACCEPTANCE.md`: criteria evidence, cross-package review, scenario screenshots, performance measurement, carry-forwards, status docs. | 4 | Evidence that is asserted rather than tested | **Opus** | **High** (milestone acceptance, comprehensive) |

The work is deliberately not split further: each package is one coherent reviewable concern. If Package 3's screen proves too large for one review, it may split into **3a** (the screen without evening mode) and **3b** (evening mode and the tablet cards), decided at the start of that package. That is the only split the contract allows without an ADR change.

### 2.2 Per-package acceptance

- **Package 1:**
  - The agenda engine and loader tests pass, plus new ones for `kind`, batching, local-time ordering and overnight carry-over (if approved).
  - An integration test proves the batched read returns nothing for an event the actor cannot see.
  - A query-count test proves the loader's queries do not grow with the number of events.
  - Forward and *Coming up* e2e pass unchanged.
- **Package 2:**
  - Every rule in §5 has unit tests, including boundaries (thresholds ±1, midnight, DST changeover days, all-day and multi-day items).
  - The six scenarios produce the expected engine output.
  - The privacy invariant (§8.2) holds.
  - A mutation proof shows that removing a rule fails its tests.
  - Engines import nothing from `db`, `app`, `kev` or the clock.
- **Package 3:**
  - The no-regression test (§8.4) passes.
  - Scenario e2e passes at four viewports, with JavaScript on and off.
  - Accessibility baseline: axe, headings, landmarks, 44px targets, visible focus, and no meaning carried by colour alone.
  - The two-adult sweep covers Today.
  - The owner approves the headline and layout from screenshots.
- **Package 4:**
  - Insight facts and counts never include an item the reader can't see.
  - A dismissal affects only its user, is audited, and is refused while the gate is closed in Production mode.
  - Dismissed insights stay gone across reloads and are recomputed on a new key.
  - The insight sweep passes for both adults.
- **Package 5:** every criterion in §10 is met, with evidence that cites tests.

### 2.3 Verification by package

| Package | While working | Before the PR | Why |
|---|---|---|---|
| 1 | `pnpm verify:focused` | **Full `pnpm verify`** | Shared engine and a new domain read; Forward is affected |
| 2 | `pnpm verify:focused` (pure engines; unit tests) | `pnpm verify:focused` + CI | No UI, database or boundary; CI runs everything |
| 3 | `pnpm verify:focused` | **Full `pnpm verify`** | Scenario seeding touches `tests/fixtures` (high-risk to `verify:focused`), and the privacy and device sweeps |
| 4 | `pnpm verify:focused` | **Full `pnpm verify`** | A user-facing write entry and per-actor content |
| 5 | — | **Full `pnpm verify`** + CI | Milestone evidence |

Settled reviews are not repeated: auth, CSP, the calendar security boundary and the M4 sync model. A package re-opens one only if it touches that boundary (`verify:focused` refuses those paths).

---

## 3. Architecture

### 3.1 Source data (all existing; read as the actor)

| Source | Service | Used for |
|---|---|---|
| Events (manual and synced, occurrences, overrides) | `events` via the agenda loader | Runs, person lines, *Also today*, busy, evening, tomorrow's gaps |
| Event people (`attending`, `responsible`) and calendar default people | `events`, `calendar` via the loader (`who.ts`) | Who is going and who is responsible; gaps |
| People (`role`, `in_household`, `date_of_birth`, `user_id`) | `people` | Household lines, children for runs, birthdays, "Which one is you?" |
| Regular week | `profile` engine over the loader's events | Routine compression |
| Tasks (open, `due_date`, `scheduled_starts_at`, project) | `tasks` | To do, *Before then*, project preparation |
| Projects (`status`, `target_date`) | `projects` | Preparation |
| Captures (status) | `captures` | To sort line |
| Calendars (freshness, last status) | `calendar` | `data_health`, the headline qualifier, refresh on use |
| Insight responses (own) | `insights.respondedKeys` | Hiding dismissed insights |

Today reads no context, notes, Kev data or audit records.

### 3.2 Layers

```
domain services (as the actor: visibility, archive, sensitivity applied here)
        │
        ▼
agenda loader + agenda engine (the one placement of items; Package 1 extends it)
        │  AgendaDay[] (today + 7) · people · tasks · projects · calendars · own responses
        ▼
engines/today.ts ──► TodayModel { headline, runs, personLines, alsoToday, todo, evening }
engines/insights/ ─► InsightCandidate[] (ranked, on-object marked)
        │
        ▼
Today loader (filters own dismissals, caps lists) ──► presentational components (no rules)
```

- **Engines** are pure: the input data plus `now` (an instant) and `timeZone`. No I/O, no `Date.now()`, and stable sorts with explicit tie-breaks. They live under `src/domain/engines/`, which may import `lib`. Their output carries ids, facts and template text. They hold no React and no copy beyond templates.
- **The loader** fetches through services in parallel, calls the engines, removes the actor's dismissed keys and applies display caps (3 insights, 3 to-dos, 2 lines per person). It holds no rules.
- **Presentation** maps the model to existing UI primitives (`Page`, `Label`, `List`, `ItemRow`, person dots). It adds no logic beyond layout, using tokens only (BRAND.md).

### 3.3 Model shapes (indicative; fixed in Package 2)

```ts
type Fact = { kind: 'event' | 'task' | 'person' | 'project' | 'calendar';
              id: string; label: string; when?: string; people?: string[] };

type Run = { eventId: string; occurrenceDate: IsoDate; startsAt: Date;
             title: string; children: PersonRef[]; responsible: PersonRef[];
             ownWay: boolean; gap: boolean; part: 'morning' | 'afternoon' | 'evening' };

type InsightCandidate = {
  key: string;                // `${kind}:${subjectIds.join('.')}:${date}`, matches insightKey
  kind: 'coordination_gap' | 'busy_day' | 'preparation' | 'data_health';
  when: IsoDate; subjects: string[]; facts: Fact[];
  priority: number; template: string; onObject: boolean; mark: 'needs_you' | 'good_to_know';
};
```

### 3.4 Privacy

- **Visibility is resolved by the services before anything is interpreted** (CLAUDE.md rule 1). Engines cannot see what the reader cannot see, so headlines, counts, thresholds, gaps and facts cannot reveal it. There are no placeholders such as "busy" or "something private" for invisible items.
- **The invariant test (§8.2)** is the proof: adding records the reader cannot see leaves the reader's whole `TodayModel` and every insight candidate identical.
- **Insight keys** are built from ids and dates only (the existing `insightKey` schema refuses anything else). Dismissals are private by `user_id`.
- **Sensitive context** is never read by Today.

### 3.5 Stale and incomplete information

| Situation | Today's behaviour |
|---|---|
| A visible calendar older than 15 minutes | Renders at once; refresh on use as in M4 |
| A visible calendar whose last successful refresh is >24h old, or whose last refresh failed | `data_health` insight ("Alex's calendar hasn't updated since yesterday."); headline qualified "as far as HOME knows" |
| No calendars and no events at all | First-run headline with a link to Settings › Calendars |
| A run with no responsible person | **Who?** on the run (the gap is a fact: nobody is recorded) |
| An item with no people | *Also today*, never dropped |
| A person with no visible items | No line for them |
| An unlinked adult | "Which one is you?" (M3) |
| A template whose facts are missing | Not shown; nothing is invented to fill it |

### 3.6 Determinism and explainability

- **Same input, same output:** both engines are tested with frozen `now`, randomised input order and repeated runs.
- **Every gap, insight and headline carries its facts.** Today shows them in place with `<details>`, without JavaScript.

### 3.7 Performance

- **Reads stay bounded.** One batched annotation read replaces the per-event reads (Package 1). The calendar list is read once and shared between `data_health` and refresh on use. The loader's query count is constant in the number of events, and a test proves it.
- **Today never waits on anything but the database:** no LLM and no network fetch on render. Calendar refresh stays after render (M4).
- **Measured, not gated:** Package 5 records Today's server render time on the seeded scenarios and a synthetic 300-event household, as an observation (one container, qualified as M4's timings were).

### 3.8 Schema

None. ADR 0008 §11. A package that finds a schema need stops and proposes an ADR amendment and a migration-first package.

---

## 4. The Today experience

### 4.1 Order (phone)

1. **Date, then the headline** (one or two sentences, serif). This answers "what kind of day is it?".
2. **Worth knowing**: up to 3 genuine insights, then "+ N more". The section is absent when there is nothing. This answers "has HOME noticed anything?".
3. **Getting everyone there**: runs grouped Morning / Afternoon / Evening, each with who is taking them or **Who?**. This answers "who needs to be where, and who's taking them?". It is the one section allowed to be long.
4. **Everyone's day**: one line per household person (dot, name, at most two lines, then "+ N"), routine as a word. This answers "who's where?".
5. ***Also today***: items with no people (birthdays of people outside the household, project targets, unassigned events).
6. **To do**: up to 3 (due today, scheduled today, then carried over in words), then "N more to do ›".
7. **To sort**: "2 things to sort ›", only when something waits.
8. **"Which one is you?" ›** (unlinked adult) and **"The next 30 days ›"**.

Empty sections are not shown. The same spacing and colours are used on quiet and busy days: busy is expressed in words, never in alarm. The Sun accent is reserved for **Who?** and `●` *needs you* marks. Nothing is red.

### 4.2 Synthetic examples (fixture family; Wednesday 14 October 2026)

**A normal weekday, 7:03am**

```
Wednesday 14 October

Easy morning. Isla's 3:00 pickup needs someone.

WORTH KNOWING
○ Nana Jo's birthday is Tuesday.

GETTING EVERYONE THERE
Morning
8:30  School · Milo, Isla        ● Alex
Afternoon
3:00  Isla — pickup              Who? ›
3:30  Swimming · Milo            ● Alex

EVERYONE'S DAY
● Sam    Client site · 7:00pm Board meeting
● Alex   Work till 2:30 · 6:15pm Pilates
● Milo   School · Swimming 3:30
● Isla   School

TO DO
○ Pay swimming term fees · Due today

2 things to sort ›
```

- *Rules shown:* School is routine (a weekly series of kind `school` in their regular week), so it is one word. Isla's pickup is a run with no responsible person, so it has a **Who?** that links to the event's people page. The birthday is `preparation` (within seven days).
- *What it does not say:* "Alex is free from 2:30", because availability belongs to M7.

**A full day (Monday 19 October)**

```
Monday 19 October

Full one. Two runs need someone.

GETTING EVERYONE THERE
Morning
8:30  School · Milo, Isla        ● Sam
Afternoon
3:00  Isla — pickup              ● Alex
3:30  Dentist · Milo             Who? ›
3:30  Football training · Milo   Who? ›
…
```

The same calm layout is used. No clash label appears: two runs at 3:30 are a conflict, and conflicts are M6. Each run simply shows its own **Who?**.

**A quiet day (Saturday 17 October)**

```
Saturday 17 October

Nothing on today. Nothing needs sorting.

The next 30 days ›
```

**Evening (Wednesday, 8:40pm)**

```
Wednesday 14 October

Tonight — nothing else needs you.

TOMORROW MORNING
8:30  School · Milo, Isla        ● Alex
Before then
○ Sign Milo's camp form · Due tomorrow

Earlier today ›          (collapsed: today's items)
```

**Incomplete data**

```
Thursday 15 October

Thursday looks easy, as far as HOME knows.

WORTH KNOWING
○ Alex's calendar hasn't updated since yesterday.
```

**First run**

```
Wednesday 14 October

HOME is quiet because it doesn't know your calendars yet.
Connect a calendar ›
```

### 4.3 Tablet and desktop

At 768px and wider there are two columns:

- **Left:** headline, Worth knowing, Getting everyone there, To do, To sort.
- **Right:** Everyone's day as one calm card per person, with morning, afternoon and evening as words. There are never hourly lanes.

Desktop keeps the same two columns. The Kev panel is M8.

### 4.4 Interactions in M5

| Gesture | Result |
|---|---|
| Tap an item, run or person | Its existing full page (event, task, profile) |
| **Who? ›** | The event's people page (M4 Package 6), where an adult chooses who is responsible. A repeating manual event offers "for this one" (M4 Package 8b). |
| Tap an insight or the headline | Expands in place to its facts (no JavaScript) |
| **Dismiss** (if §23) | Gone for this adult, for this insight key |
| Tick a to-do | Unchanged from M3 (task page) |
| Pull to refresh | Not in M5. Refresh on use is kept. |

---

## 5. Rules (deterministic interpretation; every one tested)

### 5.1 Runs and gaps

- **A run** is a timed occurrence on the reader's agenda that:
  - is attended by at least one household person with `role = 'child'`; and
  - has a kind that is not `birthday`, `deadline` or `work`.

  Runs are listed at their start time, grouped by day part:
  - **Morning:** before 12:00;
  - **Afternoon:** 12:00–17:00;
  - **Evening:** from 17:00, in the home zone.
- **Responsible people** are the item's `responsible` people as the loader resolves them, including calendar defaults and series people for changed occurrences.
- **A gap** is a run with no responsible person. It is shown on the run as **Who?** and is never repeated in Worth knowing.
- **"Own way"** applies only under §21 A: a run whose only responsible people are its attending children reads "· own way" and is not a gap.
- **Tomorrow's gaps** are `coordination_gap` insights (§5.5).

### 5.2 Everyone's day

- **Who gets a line:** household people the reader can see, in the order People lists them. A person appears only if they have at least one visible item today.
- **Routine:** an item is routine if its event is in the person's regular week and its kind is `school` or `work`.
  - Routine `school` reads "School".
  - Routine `work` reads "Work till {end}", or "Work" when the end is after 17:00.
  - All-day routine reads its title.
- **Order and length:** non-routine items show "{time} {title}". A person's items are in time order, at most two lines, then "+ N".

### 5.3 *Also today*

Agenda items for today with no visible household person:

- birthdays of people outside the household;
- project targets;
- events with no people.

They are shown in the agenda's own row style, so no item the agenda returns is lost.

### 5.4 Headline (closed template set; first match wins)

| Condition | Template (indicative; final copy approved in Package 3) |
|---|---|
| No calendars and no events at all | "HOME is quiet because it doesn't know your calendars yet." |
| Evening state (§5.7) | "Tonight — nothing else needs you." |
| Full day (§22) with gaps | "Full one. {Two runs need someone / Isla's 3:00 pickup needs someone}." |
| Full day, no gaps | "Full one, but everyone's covered." |
| Gaps, not full | "{Easy morning / A steady day}. {gap phrase}." |
| Items, no gaps | "{Weekday} looks easy." / "A steady day." |
| Nothing on, nothing due | "Nothing on today. Nothing needs sorting." |
| Any of the above while `data_health` fires | The sentence plus ", as far as HOME knows" |

- **Numbers** are words up to ten.
- **The day's character:**
  - "Easy morning" means no runs before 12:00 that have a gap;
  - "A steady day" means between the easy and full thresholds.
- **Fixed in Package 2:** the full grammar and its boundaries are fixed and unit-tested there. No template is ever chosen by an LLM.

### 5.5 Detectors

| Kind | Fires when (reader's visible data only) | Template | Mark |
|---|---|---|---|
| `coordination_gap` | A run **tomorrow** has no responsible person (today's gaps are on their runs: `onObject`) | "Nobody's down for Milo's football tomorrow at 4." | ● |
| `busy_day` | Tomorrow crosses the full-day threshold (today's is carried by the headline: `onObject`) | "Tomorrow's a full one." | ○ |
| `preparation` | A visible person's birthday falls within the next 7 days, or an active project's target date falls within 7 days and it has open tasks | "Nana Jo's birthday is Tuesday." / "The back fence is due Saturday; two tasks are open." | ○ |
| `data_health` | A visible calendar's last successful refresh is >24h old, or its last refresh failed | "Alex's calendar hasn't updated since yesterday." | ○ |

- **Ranking** is by kind priority (`coordination_gap` > `data_health` > `busy_day` > `preparation`), then by date, then by key. It is deterministic.
- **Display:** Worth knowing shows the top 3 not marked `onObject` and not dismissed. "+ N more" counts only those.
- **Keys:** `{kind}:{ids}:{date}`. For example `coordination_gap:{eventId}.{occurrenceDate}:2026-10-15`. A changed fact (for example a new event id) is a new key, so a dismissed insight returns only when its facts change.

### 5.6 To do

- **Which tasks:** open tasks due today, scheduled today (`scheduled_starts_at` on today in the home zone), or due earlier. Overdue ones are labelled in words, as in M3.
- **Order:** due today and scheduled today first, then carried over by date.
- **Length:** at most 3, then "N more to do ›" linking to Home.

### 5.7 Evening state

The evening state applies when, at `now`:

- no timed item today still has its start or end to come; and
- no gap today is unresolved.

Today then leads with "Tonight — nothing else needs you.", then **Tomorrow morning** (tomorrow's items starting before 12:00, then *Before then*: tasks due tomorrow), and **Earlier today** collapsed (`<details>`). Otherwise the day view stays, and past items fold into *Earlier today* once more than one has passed.

---

## 6. Environments and data

- **Local and CI:** the seeded fixture family plus the six scenarios as synthetic domain data (`tests/fixtures/`). They are seeded only into `home_test`, as in M3.
- **Preview:** the throwaway synthetic account only. No real calendar.
- **Production:** M5 is deployed like any merged code. `HOME_REAL_DATA` stays closed, with no real data and no new environment variables or settings.

---

## 7. Schema

None (ADR 0008 §11).

---

## 8. Testing requirements

### 8.1 Unit (engines)

- Every rule in §5, with its boundaries:
  - thresholds ±1;
  - 11:59 and 12:00, 16:59 and 17:00;
  - midnight;
  - the DST changeover days (late September and early April, Pacific/Auckland);
  - all-day and multi-day items;
  - overnight items (if §24).
- **The six M0 scenarios:**
  - normal weekday;
  - chaotic weekday;
  - quiet weekend;
  - the "conflict" scenario (asserting no conflict wording, only gaps);
  - evening;
  - big week ahead.
- **Determinism:** shuffled input order, repeated runs, frozen `now`.
- **Import boundaries:** the engines import no `db`, `app`, `kev` or clock (ESLint layer test).

### 8.2 The privacy invariant (unit and integration)

For each adult, add events, annotations, tasks, people and calendars that only the *other* adult can see (private, sensitive, archived). The reader's `TodayModel` and insight candidates must be deeply equal before and after.

This runs:

- in unit tests over engine inputs; and
- in integration tests through the real services as `home_app` (the canary marks from M3 must never appear in either adult's Today model).

### 8.3 Integration (as `home_app`)

- The batched annotation read refuses events the actor can't see.
- The loader's query count is constant in the number of events.
- A dismissal is the actor's own and audited, and is gated in Production mode.

### 8.4 End to end (Playwright, seeded scenarios)

- **The no-regression check:** every agenda item for today, every due task and the To sort line appear on Today.
- **The scenarios** at four viewports, with JavaScript on and off.
- **Who?** reaches the people page and sets a responsible person, after which the gap is gone.
- **Evening mode** with a frozen request time. A test-only time source is used, refused outside local and CI as `HOME_TEST_CALENDAR_FEEDS` is.
- **The two-adult privacy sweep** extended to Today, Worth knowing and insight facts.
- **Accessibility baseline:** axe, headings, landmarks, focus, 44px targets, no information by colour alone (●/○ always accompanied by words), and `<details>` keyboard operable.

### 8.5 Kept

Every M1–M4 test stays, including the Forward, *Coming up*, sync, gate, export and Activity suites.

---

## 9. Documentation

- **Package 0:** this contract, ADR 0008, the ROADMAP M5 row, and the status lines in `CLAUDE.md` and `README.md`.
- **Each package:**
  - ADR 0008 amended where it changes a decision;
  - this contract's status line updated;
  - `docs/concepts/TODAY.md` annotated where M5 deliberately differs from the concept (weather, Kev bar, Sort it, sheets).
- **Package 5:** `docs/m5/M5-ACCEPTANCE.md`.

---

## 10. Acceptance criteria

| # | Criterion | Measured by |
|---|---|---|
| 1 | **Correctness.** Runs, gaps, person lines, *Also today*, To do, evening state and headline follow §5 exactly on the six scenarios and every boundary in §8.1. | Unit tests per rule; scenario snapshots |
| 2 | **No regression.** Every item M3/M4 Today showed still appears; Forward, *Coming up* and the regular week are unchanged except for approved overnight carry-over. | §8.4 no-regression e2e; Forward and profile suites green |
| 3 | **Privacy.** No item, count, threshold, fact or headline on Today reflects anything the reader cannot see; dismissals are per user. | §8.2 invariant (unit and integration); extended two-adult sweep |
| 4 | **Determinism.** Engines are pure; the same input and `now` give identical output regardless of input order. | Determinism tests; import-boundary lint test |
| 5 | **Explainability.** Every gap, insight and headline exposes its facts in place without JavaScript; every insight has template text; no layer-3 or layer-4 statement appears (ADR 0008 §5). | e2e (no-JS facts); copy review against a forbidden-phrases list ("free", "probably", "should", "needs a lift", "nothing prepared") |
| 6 | **Healthy quiet.** A quiet day says so in one line; no insight is shown without a firing rule; at most 3 insights; "+ N more" counts only genuine ones; nothing on-object is repeated. | Scenario tests (quiet weekend); detector tests |
| 7 | **Household usefulness.** On the normal and chaotic weekday scenarios at phone width, the headline, Worth knowing and Getting everyone there sit above the fold; the owner confirms from screenshots that the five-second test (concepts README design test 1–3, 7) is met. | Screenshot evidence; owner review in Package 3 and 5 |
| 8 | **Accessibility.** Axe baseline clean at four viewports; keyboard reachable; 44px targets; no colour-only meaning. | Device and a11y e2e |
| 9 | **Performance.** The loader's query count is independent of event count; no LLM or network on render; render time measured and recorded. | Integration query-count test; Package 5 measurement |
| 10 | **Scope.** No conflict detection, weather, free windows, availability, Kev, proposals, sheets, stored insights, notifications, background jobs, new schema (unless §21 B) or new runtime dependency. | Review checklist; `package.json` diff; no migration |
| 11 | **Production gate and operations.** `HOME_REAL_DATA` stays closed; no real data or calendar used; the dismissal (if built) is refused while closed; M1, M3 and M4 operational items remain listed as open, not marked complete. | Gate tests; DEPLOY.md §E unchanged in status; acceptance doc |
| 12 | **Handover.** Each package had a focused independent review at its stated intensity, and every Blocker and Important finding was fixed before merge. | Package reviews; M5-ACCEPTANCE |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Interpretation over-claims (a gap read as a need; "free" implied) | Layer table (ADR 0008 §5); templates state the rule's finding only; forbidden-phrases check; high review on Package 2 |
| Busyness manufactured by thresholds | Conservative defaults (§22), constants with boundary tests, tuned only in the M10 trial |
| A child's every event shows **Who?** until marked | Expected and honest; one change on a series quiets it; §21 decides how "own way" is said |
| Counts or headlines leak private items | Services filter first; invariant test at unit and integration level; insight sweep |
| Agenda change regresses Forward | Package 1 is engine-only with full verify and high review; Forward suites must pass unchanged |
| Today turns into a dashboard | Concept order, caps (3 / 3 / 2 lines), absent empty sections, owner screenshot approval |
| Clock-dependent tests flake | `now` injected everywhere; the e2e time source is test-only and guarded |
| Weather left out disappoints the concept | ADR 0008 §20 records it with M7; the headline never pretends to know the weather |

---

## 12. Decisions requested (ADR 0008 §20–§26)

| § | Decision | Recommended |
|---|---|---|
| 20 | Weather line | Defer to M7 with the Open-Meteo adapter |
| 21 | A run that needs nobody | A: mark the child responsible ("own way"); no schema |
| 22 | Full-day thresholds | ≥3 runs, or ≥6 timed events, or both adults committed past 18:00 |
| 23 | Dismiss | Plain Dismiss in M5; "Not useful" stays in M6 |
| 24 | Overnight events | Carried onto the next day ("until 1:00"), Today and Forward alike |
| 25 | Sheets | Not in M5; full pages as now |
| 26 | Lookahead | Seven days |
