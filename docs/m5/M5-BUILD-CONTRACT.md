# M5 — Intelligent Today: Build Contract

Status: **Approved**, 2026-10-08 (Package 0, PR #53, merged by the owner).

- **Approved:** ADR 0008 §20, §23, §24, §25 and §26. §22 is approved as provisional.
- **Revised as the owner directed:** §21. There is no transport inference, so Getting everyone there is not built in M5.
- **Progress:** Packages 0 and 1 merged (PRs #53, #54). Package 2 (the Today and insights engines, ADR 0008 §31) is in review. Packages 3–5 have not started.

Implementers and reviewers: per package (§2).

At the end of M5, an adult opening Today sees what matters for the household today, not just a list. Today shows:

- **a factual headline** that says what is on;
- **each person's day** in a line or two, with routine kept quiet and the people recorded on each item;
- **what's to do**;
- **up to three things worth knowing** that HOME has noticed in the household's own records;
- **in the evening**, tonight and tomorrow morning first.

All of it is computed by deterministic code from data the household has already recorded. Every statement can be traced to records and a named rule, and Today works without Kev. **Nothing here is AI, nothing is guessed, and a missing record is never treated as meaning something.**

Authoritative references:

- `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md` and `docs/BRAND.md`;
- `docs/concepts/TODAY.md` and `docs/concepts/README.md`;
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
  - None of these blocks M5 *development*. M5 is built and tested on synthetic data in local, CI and Preview.
- **The Production real-data gate stays closed.** M5's one write, Dismiss (ADR 0008 §23), passes through `auditedWrite` and is refused in Production while `HOME_REAL_DATA` is not exactly `open`.
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
- **M5 builds on M3's factual Today and M4's synced events.** The agenda loader and engine stay the single source of placed items (ADR 0008 §7).

---

## 1. Scope

### 1.1 What the roadmap commits M5 to (ROADMAP M5)

| Commitment | M5 decision |
|---|---|
| Today per the M0 concept | **Built**, within the exclusions below and with factual wording (§5) |
| Day headline | **Built**, factual and deterministic (§5.3) |
| Getting there (drop-offs and pickups) | **Not built in M5.** No existing record reliably says that transport is needed or who is providing it (ADR 0008 §21). Needs a separate owner decision on a structured transport record (§12). |
| Per-person day | **Built** (§5.1) |
| Tasks | **Built**: extends M3's To do (§5.5) |
| Weather line | **Deferred to M7** with its adapter (ADR 0008 §20, approved) |
| To sort count | **Kept** (M3) |
| Insights engine skeleton with template text | **Built** (§5.4) |
| `busy_day`, `preparation`, `data_health` | **Built** (§5.4); `busy_day` thresholds are provisional (§22) |
| `coordination_gap` | **Not built in M5**, for the same reason as getting there (ADR 0008 §21) |
| Person profile screens | **Already delivered** (M3; regular week in M4 Package 7). Today links to them. |

Also settled for M5:

- **Contextual evening mode**, in factual wording (ADR 0008 §17).
- **"+ N more" counting only genuine insights** (ADR 0002).
- **Carry-forwards:**
  - overnight events (§24, approved);
  - ordering of a series in another time zone (m-6b);
  - batched annotation reads.

### 1.2 Build

| Area | What |
|---|---|
| **Agenda groundwork** | Event items carry their `kind`. Annotations are read in one batch, as the actor. Items are ordered by local time within a day (m-6b). Overnight items are carried onto the next day, on Today and Forward. The engine is extended, not duplicated. |
| **Today engine** | `src/domain/engines/today.ts` produces person lines, routine compression, *Also today*, day parts, the evening state, and the headline's rule, facts and template. |
| **Insights engine** | `src/domain/engines/insights/`: the candidate type, deterministic keys, the `busy_day`, `preparation` and `data_health` detectors, ranking, and marking of anything already shown. |
| **Today loader** | `src/app/(home)/today/load.ts` reads through the domain services as the actor, calls the engines, and filters out the adult's own dismissals. |
| **Today screen** | Headline, Worth knowing, Everyone's day, *Also today*, To do, To sort, "Which one is you?", the Forward link, evening mode, the quiet, first-run and stale states, and the tablet two-column layout with person cards. |
| **Traceability** | Every headline, line and insight carries the record ids it came from (`facts`) and its rule id (`rule`). The headline and insights show their facts in place, without JavaScript. |
| **Dismiss** | One form action through the existing `insights/service.respond` (§23). |
| **Fixtures** | The six M0 scenarios rebuilt as synthetic domain data for engine tests and seeded e2e. |
| **Tests** | Engine unit tests (rules, boundaries, DST, traceability, the privacy invariant, the absence rule), loader integration tests as `home_app`, Today e2e, and the privacy and device sweeps extended to Today. |

### 1.3 Do not build

- **No transport.** M5 has no runs, no "Getting everyone there", no **Who?** chip and no `coordination_gap` detector. No wording may imply that someone is taking, collecting or driving anyone, or that a lift is needed (ADR 0008 §21). Event responsibility is shown only as what was recorded.
- **No inference of need, transport, intent, priority, preference, availability, stress or urgency.** This applies to inference from age, title, kind, location, counts or the absence of a record (ADR 0008 §5, §6).
- **Nothing from later milestones:**
  - **M6:** conflicts, "Not useful", sheets and Forward changes.
  - **M7:** weather, free windows and availability.
  - **M8:** Kev, the Kev bar and Kev phrasing.
  - **M9:** "Sort it" and proposals.
  - **M10:** the time-of-day orb.
- **No stored insights, push notifications or background jobs.**
- **No new schema.** Any schema change, including a transport record, needs a separate owner decision.
- **No context records on Today** and no sensitive reads.
- **No hour grid, badges, counters, red, streaks, progress bars, greeting or "+" button.**
- **No new runtime dependency.**

---

## 2. Implementation packages

Packages are acceptance boundaries. Each ends with CI green, a focused independent review at its stated intensity, and the owner merging it. Package *n* starts only after *n−1* has merged.

### 2.1 Packages

| # | Package | Objective | Scope | Depends on | Main risks | Builder | Review |
|---|---|---|---|---|---|---|---|
| **0** | **Contract and ADR** | Agree M5's product, architecture, packages and acceptance | This document, ADR 0008, ROADMAP and status lines | — | Mis-scoping; decisions left implicit | Opus | Owner approval |
| **1** | **Agenda groundwork** | Give the agenda what Today needs, without a second engine | (1) `kind` on event items. (2) One batched annotation read in the events service (`listEventPeopleFor(actor, eventIds)`), visible exactly as its events. (3) Ordering by local time (m-6b). (4) Overnight carry-over on Today and Forward (§24). (5) Forward, *Coming up* and the regular week otherwise unchanged. | 0 approved | The batched read leaking people on events the reader can't see; regressions on Forward; DST and overnight edges | **Opus** | **High** (new domain read path; shared engine semantics) |
| **2** | **Today and insights engines** | Deterministic, traceable meaning, fully tested, with no UI | `engines/today.ts` and `engines/insights/` per §5, with rule ids, facts, templates, keys, ranking and on-object marking. The six scenarios as pure inputs. The privacy invariant, the absence rule and the forbidden-phrases test (§8). | 1 | Wording that over-claims (layer 3 creeping in); thresholds implying stress or availability; non-determinism; DST | **Opus** | **High** (this is where meaning is defined) |
| **3** | **The Today screen** | Today per the concept, without Worth knowing yet | Loader and page: headline with its facts, Everyone's day (phone list, tablet cards), *Also today*, To do (≤3 + "N more to do ›"), To sort, "Which one is you?", Forward link, evening mode, the quiet, first-run and stale states. Seeded scenarios. e2e, a11y, no-JS and devices. Screenshots for the owner. | 2 | Regression to M3/M4 Today (an item lost); layout drifting into a dashboard; a11y; no-JS | **Fable** | **Medium** (presentation over reviewed engines; privacy sweep extended) |
| **4** | **Worth knowing, explanations and Dismiss** | Insights on Today, explained and dismissible | Worth knowing (≤3, "+ N more"), facts in place (`<details>`), Dismiss (§23) through the existing service with its audit, and an insight-specific two-adult privacy sweep. | 3 | Insight facts naming something the reader can't see; one adult's dismissal affecting the other; unstable keys bringing dismissed insights back | **Opus** | **High** (a new user-facing write entry and per-actor derived content) |
| **5** | **Acceptance** | Prove M5 against §10 | `docs/m5/M5-ACCEPTANCE.md`: criteria evidence, cross-package review, scenario screenshots, performance measurement, carry-forwards, status docs. | 4 | Evidence that is asserted rather than tested | **Opus** | **High** (comprehensive milestone acceptance) |

If Package 3 proves too large for one review, it may split into **3a** (the screen without evening mode) and **3b** (evening mode and the tablet cards), decided at its start. That is the only split allowed without an ADR change.

### 2.2 Per-package acceptance

- **Package 1:**
  - Agenda engine and loader tests pass, plus new ones for `kind`, batching, local-time ordering and overnight carry-over.
  - An integration test proves the batched read returns nothing for an event the actor cannot see.
  - A query-count test proves the loader's queries do not grow with the number of events.
  - Forward and *Coming up* e2e pass, with only the approved overnight change.
- **Package 2:**
  - Every rule in §5 has unit tests at its boundaries.
  - Every output carries a known rule id and non-empty facts, except the stated absence rules, whose facts cite the range and the calendars consulted.
  - The six scenarios produce the expected output.
  - The privacy invariant, the absence rule and the forbidden-phrases test hold.
  - A mutation proof shows that removing a rule fails its tests.
  - The engines import nothing from `db`, `app`, `kev` or the clock.
- **Package 3:**
  - The no-regression test (§8.4) passes.
  - Scenario e2e passes at four viewports, with JavaScript on and off.
  - The accessibility baseline holds.
  - The two-adult sweep covers Today.
  - The owner approves the headline wording and layout from screenshots.
- **Package 4:**
  - Insight facts and counts never include an item the reader can't see.
  - Dismissal is per user, audited, and refused while the gate is closed.
  - Dismissed insights stay gone across reloads.
  - The insight sweep passes for both adults.
- **Package 5:** every criterion in §10 is met, with evidence that cites tests.

### 2.3 Verification by package

| Package | While working | Before the PR | Why |
|---|---|---|---|
| 1 | `pnpm verify:focused` | **Full `pnpm verify`** | Shared engine and a new domain read; Forward is affected |
| 2 | `pnpm verify:focused` | `pnpm verify:focused` + CI | Pure engines; no UI, database or boundary |
| 3 | `pnpm verify:focused` | **Full `pnpm verify`** | Scenario seeding touches `tests/fixtures` (high-risk to `verify:focused`), plus the privacy and device sweeps |
| 4 | `pnpm verify:focused` | **Full `pnpm verify`** | A user-facing write entry and per-actor content |
| 5 | — | **Full `pnpm verify`** + CI | Milestone evidence |

Settled reviews are not repeated: auth, CSP, the calendar boundary and the M4 sync model. A package re-opens one only if it touches that boundary.

---

## 3. Architecture

### 3.1 Source data (all existing; read as the actor)

| Source | Service | Used for |
|---|---|---|
| Events (manual and synced, occurrences, overrides) | `events` via the agenda loader | Person lines, *Also today*, counts, evening |
| Event people (`attending`, `responsible`) and calendar default people | `events`, `calendar` via the loader (`who.ts`) | Who is shown on each item, *as recorded*: no further meaning (ADR 0008 §14) |
| People (`role`, `in_household`, `date_of_birth`, `user_id`) | `people` | Household lines, adults for `busy_day.late`, birthdays, "Which one is you?" |
| Regular week | `profile` engine over the loader's events | Routine compression and the "only the usual" headline |
| Tasks (open, `due_date`, `scheduled_starts_at`, project) | `tasks` | To do, *Before then*, project preparation |
| Projects (`status`, `target_date`) | `projects` | Preparation |
| Captures (status) | `captures` | To sort line |
| Calendars (freshness, last status) | `calendar` | `data_health`, the "as far as HOME knows" qualifier, refresh on use |
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
engines/today.ts ──► TodayModel { headline, personLines, alsoToday, todo, evening }
engines/insights/ ─► InsightCandidate[] (ranked, on-object marked)
        │   every output: { rule, facts[], template }
        ▼
Today loader (filters own dismissals, caps lists) ──► presentational components (no rules)
```

- **Engines** are pure. They take their input data plus `now` (an instant) and `timeZone`. They do no I/O, call no `Date.now()`, and use stable sorts with explicit tie-breaks. They live under `src/domain/engines/`.
- **The loader** fetches through services in parallel, calls the engines, removes the actor's dismissed keys and applies display caps. It holds no rules.
- **Presentation** maps the model to existing UI primitives, using tokens only (BRAND.md).

### 3.3 Model shapes (indicative; fixed in Package 2)

```ts
type Fact = { kind: 'event' | 'task' | 'person' | 'project' | 'calendar' | 'range';
              id: string; label: string; when?: string };

type Traced = { rule: RuleId; facts: Fact[]; template: string };

type PersonLine = { personId: string; items: { eventId: string; occurrenceDate: IsoDate;
                    text: string; routine: boolean; people: PersonRef[] }[]; more: number };

type InsightCandidate = Traced & {
  key: string;                // `${kind}:${subjectIds.join('.')}:${date}`, matches insightKey
  kind: 'busy_day' | 'preparation' | 'data_health';
  when: IsoDate; subjects: string[]; priority: number; onObject: boolean;
};
```

`RuleId` is a closed union, one value per rule in §5 (for example `headline.counted`, `busy_day.count`, `preparation.birthday`). A test asserts that every value is documented here.

### 3.4 Privacy

- **Visibility is resolved by the services before anything is interpreted** (CLAUDE.md rule 1). Engines cannot see what the reader cannot see, so headlines, counts, thresholds and facts cannot reveal it. There are no "busy" or "something private" placeholders.
- **The invariant test (§8.2)** is the proof: adding records only the other adult can see leaves the reader's `TodayModel` and insight candidates identical.
- **Insight keys** use ids and dates only, and dismissals are private by `user_id`.
- **Sensitive context** is never read.

### 3.5 Stale, incomplete and absent information

**Absence rule (ADR 0008 §6).** A missing record means only that HOME has no record. Today states absence as absence ("Nothing on today", "Nothing due") and never as reassurance, need, arrangement or availability.

| Situation | Today's behaviour |
|---|---|
| A visible calendar older than 15 minutes | Renders at once; refresh on use as in M4 |
| A visible calendar whose last successful refresh is >24h old, or whose last refresh failed | `data_health` insight. Every statement of count or absence on Today is qualified "as far as HOME knows". |
| No calendars and no events at all | First-run headline with a link to Settings › Calendars |
| An item with no people | *Also today*, never dropped |
| A child's event with nobody recorded as responsible | Shown on the child's line with the people recorded. **No Who?**, and no statement about transport or need. |
| A person with no visible items | No line for them |
| An unlinked adult | "Which one is you?" (M3) |
| A template whose facts are missing | Not shown; nothing is invented to fill it |

### 3.6 Determinism and traceability

- **Same input, same output:** both engines are tested with a frozen `now`, randomised input order and repeated runs.
- **Every output is traceable:** it carries `rule` and `facts`, and the headline and insights show their facts in place, without JavaScript.

### 3.7 Performance

- **One batched annotation read.** The calendar list is read once and shared, so the loader's query count is constant in the number of events. A test proves it.
- **No LLM and no network on render.**
- **Render time is measured, not gated:** in Package 5, on the seeded scenarios and a synthetic 300-event household.

### 3.8 Schema

None (ADR 0008 §12). A transport record, or any other schema need, requires a separate owner decision, an ADR amendment and a migration-first package.

---

## 4. The Today experience

### 4.1 Order (phone)

1. **Date, then the headline**: one factual sentence, sometimes two, in serif.
2. **Worth knowing**: up to 3 genuine insights, then "+ N more". The section is absent when there is nothing.
3. **Everyone's day**: one line per household person (dot, name, at most two lines, then "+ N"), routine as a word. Each item shows the people recorded on it.
4. ***Also today***: items with no people.
5. **To do**: up to 3, then "N more to do ›".
6. **To sort**: only when something waits.
7. **"Which one is you?" ›** (unlinked adult) and **"The next 30 days ›"**.

Empty sections are not shown, and spacing and colours are the same on every day. In M5 every insight is ○ *good to know*. No M5 rule establishes a need, so the Sun accent's ● *needs you* is unused.

### 4.2 Synthetic examples (fixture family; Wednesday 14 October 2026)

**A normal weekday, 7:03am**

```
Wednesday 14 October

Four things on today, besides the usual.

WORTH KNOWING
○ Nana Jo's birthday is Tuesday.

EVERYONE'S DAY
● Sam    Client site · 7:00pm Board meeting
● Alex   Work till 2:30 · 6:15pm Pilates
● Milo   School · 3:30 Swimming  ● Alex
● Isla   School · 3:00 Pickup

TO DO
○ Pay swimming term fees · Due today

2 things to sort ›
```

- *Rules shown:*
  - `headline.counted` counts non-routine events.
  - School and work are routine (`routine.regular_week`).
  - `preparation.birthday` fires for a birthday within seven days.
- *What it shows and does not say:*
  - Alex is shown on Swimming because Alex is *recorded* on it.
  - Isla's 3:00 item shows no one because no one is recorded. Nothing says that a lift is needed, that someone is missing, or that Alex is free.

**Over the provisional threshold (Monday 19 October)**

```
Monday 19 October

Seven things on today, besides the usual.
Sam and Alex both have something on after 6.
```

The headline states the counts and records that crossed the provisional thresholds (`busy_day.count`, `busy_day.late`). It never says "busy", "full" or "out".

**A quiet day (Saturday 17 October)**

```
Saturday 17 October

Nothing on today.

The next 30 days ›
```

**Only routine**

```
Thursday 15 October

Just the usual today.
```

**Evening (Wednesday, 8:40pm)**

```
Wednesday 14 October

Nothing else on today.

TOMORROW MORNING
8:30  School · Milo, Isla
Before then
○ Sign Milo's camp form · Due tomorrow

Earlier today ›          (collapsed: today's items)
```

**Incomplete data**

```
Thursday 15 October

Two things on today, as far as HOME knows.

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

- **Left:** headline, Worth knowing, To do, To sort.
- **Right:** Everyone's day as one calm card per person, with morning, afternoon and evening as words. There are never hourly lanes.

Desktop keeps the same layout. The Kev panel is M8.

### 4.4 Interactions in M5

| Gesture | Result |
|---|---|
| Tap an item or person | Its existing full page. On an event page an adult can record who is going and who is responsible, as now (M4 Packages 6 and 8b). |
| Tap the headline or an insight | Expands in place to its facts (no JavaScript) |
| **Dismiss** | Gone for this adult, for this insight key |
| Tick a to-do | Unchanged from M3 (task page) |

---

## 5. Rules (deterministic; every one named, traceable and tested)

### 5.1 Everyone's day (`person_line.*`)

- **Who gets a line:** household people the reader can see, in the order People lists them, but only if they have at least one visible item today.
- **Routine (`routine.regular_week`):** an item is routine when its event is in the person's regular week and its kind is `school` or `work`.
  - Routine `school` reads "School".
  - Routine `work` reads "Work till {end}", or "Work" when the end is after 17:00.
  - All-day routine reads its title.
- **Other items** read "{time} {title}", with the people recorded on the item (attending and responsible, as the agenda resolves them). There is no added label.
- **Order and length:** time order, at most two lines, then "+ N".

### 5.2 *Also today* (`also_today`)

Agenda items for today with no visible household person:

- birthdays of people outside the household;
- project targets;
- events with no people.

They are shown in the agenda's own row style, so no item is lost.

### 5.3 Headline (closed set; first match wins; each a rule id)

| Rule | Condition | Template (indicative; final copy approved in Package 3) |
|---|---|---|
| `headline.first_run` | No calendars and no events at all | "HOME is quiet because it doesn't know your calendars yet." |
| `headline.evening` | Evening state (§5.6) | "Nothing else on today." |
| `headline.listed` | One or two non-routine events today, all timed and starting today (added in Package 2, ADR 0008 §31) | "Swimming at 15:30." / "Swimming at 15:30, then Pilates at 18:15." |
| `headline.counted` | Any other non-routine events today (three or more, or any all-day or carried-over one) | "{N} things on today{, besides the usual}." |
| `headline.usual` | Only routine events today | "Just the usual today." |
| `headline.nothing` | No events today | "Nothing on today." |
| `headline.late` (second sentence) | `busy_day.late` holds today | "Sam and Alex both have something on after 6." |
| `headline.qualified` (qualifier) | `data_health` fires for a visible calendar | Appends ", as far as HOME knows" to the first sentence |

- **Numbers** are words up to ten.
- **Forbidden words:** "easy", "busy", "full", "calm", "covered", "free", "needs you", "nothing needs sorting".
- **Facts:** each headline carries the events counted, or the range and calendars consulted for `headline.nothing`.

### 5.4 Detectors (reader's visible data only)

| Rule | Fires when | Template | Facts |
|---|---|---|---|
| `busy_day.count` | **Tomorrow** has at least **6** non-routine event occurrences (provisional, §22) | "Tomorrow has seven things on." | The events counted |
| `busy_day.late` | **Tomorrow** at least two household adults each have a visible timed event ending after **18:00** (provisional, §22) | "Sam and Alex both have something on after 6 tomorrow." | Those events |
| `preparation.birthday` | A visible person's birthday is within the next 7 days | "Nana Jo's birthday is Tuesday." | The person |
| `preparation.project_target` | An active project's target date is within 7 days and it has open tasks | "The back fence is due Saturday; two tasks are open." | The project and the tasks |
| `data_health.stale` | A visible calendar's last successful refresh is >24h old | "Alex's calendar hasn't updated since yesterday." | The calendar and its last success time |
| `data_health.failed` | A visible calendar's last refresh failed | "Alex's calendar didn't update last time it was checked." | The calendar and its last attempt |

- **Today's `busy_day`** is carried by the headline, so it is marked `onObject` and excluded from the list and its count.
- **Ranking:** `data_health`, then `preparation`, then `busy_day`; then by date; then by key.
- **Display:** Worth knowing shows the top 3 not dismissed and not `onObject`. "+ N more" counts only those.
- **Keys:** `{kind}:{ids}:{date}`. Changed facts produce a new key.
- **Provisional thresholds:** §22's thresholds are code constants, evaluated during the M10 family trial and changed only by an ADR amendment.

### 5.5 To do (`todo`)

- **Which tasks:** open tasks due today, scheduled today (`scheduled_starts_at` on today in the home zone), or due earlier. Overdue ones are labelled in words, as in M3.
- **Order:** due and scheduled today first, then carried over by date.
- **Length:** at most 3, then "N more to do ›".

### 5.6 Evening state (`evening`)

The evening state applies when, at `now`, no timed item today still has its start or end to come. Today then leads with "Nothing else on today.", then **Tomorrow morning** (tomorrow's items starting before 12:00, then *Before then*: tasks due tomorrow), and **Earlier today** collapsed (`<details>`). Otherwise the day view stays, and past items fold into *Earlier today* once more than one has passed.

---

## 6. Environments and data

- **Local and CI:** the seeded fixture family and the six scenarios as synthetic domain data (`tests/fixtures/`), seeded into `home_test` only.
- **Preview:** the throwaway synthetic account only.
- **Production:** M5 deploys like any merged code. `HOME_REAL_DATA` stays closed, with no real data and no new settings.

---

## 7. Schema

None (ADR 0008 §12).

---

## 8. Testing requirements

### 8.1 Unit (engines)

- **Every rule in §5 at its boundaries:**
  - thresholds ±1;
  - 11:59 and 12:00;
  - 18:00 exactly;
  - midnight;
  - the DST changeover days (Pacific/Auckland);
  - all-day, multi-day and overnight items.
- **The six M0 scenarios** as pure inputs. The "conflict" scenario asserts that no conflict, need or transport wording appears.
- **Determinism:** shuffled input, repeated runs, frozen `now`.
- **Traceability:**
  - every output carries a known `RuleId`;
  - every `RuleId` is documented in §5;
  - every non-absence output has non-empty facts referring to input records.
- **The absence rule:** for scenarios with missing people, missing responsible people or no events, no output asserts a need, an arrangement, availability or reassurance.
- **Forbidden phrases:** no template or rendered string contains any of these:
  - "needs", "needs you", "nobody's down", "who?";
  - "lift", "pick up", "drop off", "taking", "driving";
  - "free", "available", "out";
  - "easy", "busy", "full", "calm";
  - "covered", "sorted", "nothing needs";
  - "should", "probably", "nothing prepared".

  Words that are part of the household's own titles, shown as recorded, are exempt (for example an event titled "Pickup").
- **Import boundaries:** the engines import no `db`, `app`, `kev` or clock.

### 8.2 The privacy invariant (unit and integration)

For each adult, add records only the other adult can see (private, sensitive, archived). The reader's `TodayModel` and insight candidates must be deeply equal before and after. This runs both in unit tests over engine inputs and in integration tests through the real services as `home_app`, with the M3 canary marks.

### 8.3 Integration (as `home_app`)

- The batched annotation read refuses events the actor can't see.
- The loader's query count is constant in the number of events.
- Dismissal is the actor's own and audited, and is gated in Production mode.

### 8.4 End to end (Playwright, seeded scenarios)

- **The no-regression check:** every agenda item for today, every due task and the To sort line appear on Today.
- **The scenarios** at four viewports, with JavaScript on and off.
- **Facts in place:** the headline and insights expand to their facts without JavaScript.
- **Evening mode** with a frozen request time. The test-only time source is refused outside local and CI.
- **The two-adult privacy sweep** extended to Today and insight facts.
- **Accessibility baseline:** axe, headings, landmarks, focus, 44px targets, no information by colour alone, and `<details>` keyboard operable.

### 8.5 Kept

Every M1–M4 test.

---

## 9. Documentation

- **Package 0:** this contract, ADR 0008, the ROADMAP M5 row, and the status lines in `CLAUDE.md` and `README.md`.
- **Each package:**
  - ADR 0008 amended where a decision changes;
  - this contract's status line updated;
  - `docs/concepts/TODAY.md` annotated where M5 differs from the concept: no weather, Kev bar, "Sort it", sheets, Getting everyone there or **Who?**; factual headline and evening wording.
- **Package 5:** `docs/m5/M5-ACCEPTANCE.md`.

---

## 10. Acceptance criteria

| # | Criterion | Measured by |
|---|---|---|
| 1 | **Correctness.** Person lines, *Also today*, To do, evening state, headline and detectors follow §5 exactly on the six scenarios and every boundary in §8.1. | Unit tests per rule; scenario snapshots |
| 2 | **No regression.** Every item M3/M4 Today showed still appears; Forward, *Coming up* and the regular week are unchanged except for the approved overnight carry-over. | §8.4 no-regression e2e; Forward and profile suites |
| 3 | **Privacy.** No item, count, threshold, fact or headline reflects anything the reader cannot see; dismissals are per user. | §8.2 invariant; extended two-adult sweep |
| 4 | **Determinism.** Engines are pure; the same input and `now` give identical output regardless of input order. | Determinism tests; import-boundary test |
| 5 | **Traceability and explainability.** Every headline, line and insight carries its rule id and the records it came from; the headline and insights show their facts in place without JavaScript. | Traceability unit tests; no-JS e2e |
| 6 | **No inference, no absence-as-meaning.** No statement of transport, need, availability, stress, urgency, reassurance or arrangement; no layer-3 or layer-4 content (ADR 0008 §5, §6, §21). | Forbidden-phrases test; absence-rule tests; review checklist |
| 7 | **Healthy quiet.** A quiet day is one line; no insight without a firing rule; at most 3 insights; "+ N more" counts only genuine ones. | Scenario and detector tests |
| 8 | **Household usefulness.** On the weekday scenarios at phone width the headline, Worth knowing and Everyone's day start above the fold; the owner confirms from screenshots that the day can be understood in about five seconds (concepts README design tests 1–3, 7). | Screenshot evidence; owner review in Packages 3 and 5 |
| 9 | **Accessibility.** Axe baseline clean at four viewports; keyboard reachable; 44px targets; no colour-only meaning. | Device and a11y e2e |
| 10 | **Performance.** The loader's query count is independent of event count; no LLM or network on render; render time measured and recorded. | Query-count test; Package 5 measurement |
| 11 | **Scope.** No transport, conflicts, weather, free windows, availability, Kev, proposals, sheets, stored insights, notifications, background jobs, new schema or new runtime dependency. | Review checklist; `package.json` diff; no migration |
| 12 | **Production gate and operations.** `HOME_REAL_DATA` stays closed; no real data or calendar used; Dismiss refused while closed; M1, M3 and M4 operational items remain open, not marked complete. | Gate tests; DEPLOY.md §E status unchanged; acceptance doc |
| 13 | **Handover.** Each package had a focused independent review at its stated intensity; every Blocker and Important finding was fixed before merge. | Package reviews; M5-ACCEPTANCE |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Wording over-claims (need, transport, availability, character of the day) | Layer table and absence rule (ADR 0008 §5, §6); closed rule set; forbidden-phrases and absence-rule tests; high review on Package 2 |
| Counts read as stress | Templates state counts and records only; thresholds provisional and evaluated in the M10 trial |
| Recorded responsibility read as transport | Shown only as recorded, with no added label; no transport wording (§21) |
| The roadmap's getting-there promise is unmet | Recorded as a limitation (ADR 0008 §21); a structured transport record is an open owner decision (§12) |
| Counts or headlines leak private items | Services filter first; invariant test at unit and integration level; insight sweep |
| Agenda change regresses Forward | Package 1 engine-only, full verify, high review; Forward suites must pass |
| Today turns into a dashboard | Concept order, caps, absent empty sections, owner screenshot approval |
| Clock-dependent tests flake | `now` injected everywhere; guarded test-only time source |

---

## 12. Decisions

### 12.1 Settled (ADR 0008)

| § | Decision | Status |
|---|---|---|
| 20 | Weather line deferred to M7 | Approved |
| 21 | No transport inference; Getting everyone there, **Who?** and `coordination_gap` not built in M5 | Revised as directed by the owner |
| 22 | `busy_day` thresholds: ≥6 non-routine events; two adults with something after 18:00 | Approved as provisional; evaluated in the M10 trial |
| 23 | Plain Dismiss in M5; "Not useful" in M6 | Approved |
| 24 | Overnight events on both days, Today and Forward | Approved |
| 25 | Full pages, no sheets, in M5 | Approved |
| 26 | Seven-day lookahead | Approved |

### 12.2 Open (owner decision required; not blocking M5)

| Decision | Why it matters | Recommended |
|---|---|---|
| **A structured transport record.** For example, a per-event "getting there" record saying someone needs taking or collecting, and who is doing it, distinct from event responsibility. | It is the only reliable basis for the roadmap's getting-there view, the **Who?** chip and `coordination_gap`. M6's "unassigned responsibilities" in the conflict engine has the same dependency. It needs a schema change (migration-first). | Decide before M6 is planned. M5 proceeds without it. |
| **FAMILY-DATA-MODEL wording for `responsible`.** | Resolved: changed in Package 1 to "the person responsible for the event; not, by itself, a record of transport". | — |
