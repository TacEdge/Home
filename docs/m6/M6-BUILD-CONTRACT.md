# M6 — Forward Coordination: Build Contract

Status: **Approved**, 2026-10-09 (Package 0, PR #59, merged by the owner; product decisions in §12.2).

- **Progress:** Package 1 (Forward groundwork and engine, ADR 0009 §32) has merged (PR #60), and so has Package 2 (the conflict engine, §33, PR #65). Package 3 (conflict insights, Not useful and Today, §34) has merged (PR #66). Package 4 (the Forward screen and Coming up marks, §35) has merged (PR #67). Package 5 (acceptance, `M6-ACCEPTANCE.md`) is in review; M6 closes only when the owner accepts it.

The architecture decisions are recorded in ADR 0009 (`docs/decisions/0009-m6-forward-coordination.md`).

## The product shift

M5 answered **"What matters today?"**. M6 answers **"What's coming up, and what needs a look?"**.

At the end of M6, an adult opening Forward sees the coming week first, and can step back to the month or the season. They see it without reading a calendar, and without being told how to feel about it:

- **a factual headline** that says what is recorded;
- **Worth knowing**: the few things HOME has noticed;
- **Coming up**: one row per day, week or month, with a factual load indicator and only what is different from the usual;
- **The usual**: folded away, but one tap from view;
- **recorded overlaps**, marked quietly on the items they affect, or listed where those items are not drawn;
- **Dismiss and Not useful** on every observation.

Today and a person's Coming up gain the same conflicts.

All of it is computed by deterministic code from records the household has already made. Every statement can be traced to records and a named rule. Forward and Today work without Kev. **Nothing here is AI, nothing is guessed, and a missing record is never treated as meaning something** (ADR 0008 §5, §6).

Forward must stay calm. It is anticipation, not an alarm board:

- no red;
- no counts as warnings;
- no subjective labels ("busy", "easy", "stressful", "overwhelming");
- no free time inferred from empty space;
- no "needs you" without a recorded fact behind it.

Authoritative references:

- `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md` and `docs/BRAND.md`;
- `docs/concepts/FORWARD.md`, `docs/concepts/TODAY.md` and `docs/concepts/README.md`;
- `docs/SYSTEM-ARCHITECTURE.md` §2.2 and §2.6, and `docs/FAMILY-DATA-MODEL.md`;
- `docs/decisions/0001–0009`;
- the M3–M5 contracts, whose rules continue;
- `docs/runbooks/`.

Where this contract narrows or defers part of those documents, ADR 0009 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1–M5

- **Status of earlier milestones:**
  - **M5** is technically accepted on synthetic data. Its operational acceptance waits on DEPLOY.md §E items 16–17.
  - **M4's** operational acceptance waits on items 12–15.
  - **M3's** owner acceptance waits on the restore rehearsal (items 7–8).
  - **M1** is deployed but not accepted (items 1–6).
  - None of these blocks M6 *development*. M6 is built and tested on synthetic data in local, CI and Preview.
- **The Production real-data gate stays closed.** M6's only writes are Dismiss and Not useful, both through `insight_response.respond` and `auditedWrite`. Both are refused in Production while `HOME_REAL_DATA` is not exactly `open`.
- **M1–M5 guarantees stay in force, unchanged:**
  - auth and the allowlist;
  - the runtime role;
  - CSP and headers;
  - visibility and sensitivity in the domain query layer;
  - the gate;
  - structural audit;
  - export completeness;
  - migration-first;
  - synthetic data only;
  - read-only calendars;
  - refresh on use;
  - the four layers and the absence rule;
  - Today's rules and its non-interference invariant.
- **M6 builds on the shared agenda.** `readAgendaInputs`, `loadAgenda` and the agenda engine stay the one place items are placed (ADR 0009 §8).

---

## 1. Scope

### 1.1 What the roadmap commits M6 to

**Committed** (ROADMAP M6 row):

| Commitment | M6 decision |
|---|---|
| Forward per the M0 concept (week / month / season) | **Built**: Week first, Month and Season as summaries, with factual wording, within §1.3 (§4, §5) |
| Delete `/prototype` (tag `m0.6-prototype` keeps it) | **Built** in Package 1. The tag is on `origin` at `3d58390`. |
| Conflict engine | **Built**: `conflict.overlap` and `conflict.responsible` (§5.6, §5.7). No availability or transport conflicts (§6). |
| `conflict` insights on Today and Forward | **Built** (§5.8), and on a person's Coming up |
| Dismiss / not useful | Dismiss is **kept** from M5 and extended to conflicts. **Not useful is built** (§5.9). |

**Moved into M6 by earlier decisions:**

| Item | Source | M6 decision |
|---|---|---|
| Conflicts | ADR 0008 §3 | As above |
| "Not useful" | ADR 0008 §23 | As above |
| Forward changes | ADR 0008 §3 | As above |
| Sheets | ADR 0008 §25 | **Deferred to M10** (approved, ADR 0009 §23) |
| "Double-booked" and "unassigned" responsibilities in the conflict engine | ADR 0008 §21, SYSTEM-ARCHITECTURE §2.2 | Double responsibility as recorded is **built** (`conflict.responsible`). Unassigned is **not built**: no record says one is needed. Transport is deferred (§6). |

**From V0.1-SCOPE, not yet delivered:**

| Item | M6 decision |
|---|---|
| Forward: "scheduled tasks" | **Built** in Package 1 (approved, ADR 0009 §26) |
| Forward: "conflicts highlighted quietly" | **Built** |
| Forward: "Week Ahead button" | **Not built.** The Week Ahead is Kev's, in M10. |
| "Done" item 2: "Look 30 days ahead and see anything that needs coordinating" | **Built for recorded overlaps.** Coordination that depends on transport is deferred (§6). |

**Dependencies on M3–M5, all merged:**

- the agenda loader and engine;
- overnight placement;
- batched annotations;
- calendar default people;
- changed occurrences, skip and put back, return to series, and restore;
- the regular week;
- the insights engine;
- `dismissInsight`;
- the test time source;
- the refresh-on-use calendars.

**Explicitly excluded:** §1.3.

**Approved additions, not in the roadmap row:**

- scheduled tasks on Forward;
- conflict marks on a person's Coming up.

### 1.2 Build

| Area | What |
|---|---|
| **Groundwork** | Delete `/prototype` and its exclusions (ESLint, tsconfig, Prettier, `.vercelignore`), and update the runbook lines that name it. One 90-day agenda read for Forward through the existing loader, with a constant query count. The insights engine takes a window instead of a fixed 7 days; Today's output is unchanged. Scheduled tasks as agenda items. Forward reads the test time source too. |
| **Forward engine** | `src/domain/engines/forward.ts`: horizons and units; usual or notable; row items and their order; load bands; The usual; the headline's rule, facts and template. |
| **Conflict engine** | `src/domain/engines/conflicts.ts`: the two rules, exclusions, per-person identity (standing and occurrence), order and explanation basis (§5.6, §5.7). |
| **Coordination insights** | The `conflict` family in the insights engine. Per-surface listing and on-object marking (§5.8). |
| **Feedback** | Not useful through the existing `respond`. The response service is generalised so that conflicts can be dismissed wherever they are shown (ADR 0009 §19). |
| **Today** | Today's conflicts marked on the affected item, with Why, Dismiss and Not useful. Conflicts up to seven days ahead in Worth knowing. Not useful in every Why. |
| **Forward screen** | Horizon switch (three links, no JavaScript; Week by default). Headline with its facts. Worth knowing: two shown, then "+ N more". Coming up rows with load indicators and conflict marks. The usual. The quiet, first-run and stale states. Tablet and desktop layout. |
| **Coming up** (a person) | That person's conflict marks on their items. |
| **Tests** | Engine unit tests: rules, boundaries, DST, determinism, traceability, the identity and lifecycle tests (§5.7), the privacy invariant, the absence rule and forbidden phrases. Two-adult integration tests as `home_app`. Forward e2e at four viewports, with and without JavaScript. Privacy, accessibility and device sweeps extended to Forward. |

### 1.3 Do not build

- **No transport** (ADR 0009 §20). Existing `event_person` responsibility is never interpreted as transport responsibility. M6 never infers:
  - who is taking a child somewhere;
  - whether transport is required;
  - whether transport has been arranged;
  - whether a parent is available to provide transport.

  There is no getting there, no **Who?** and no `coordination_gap`. No wording may imply that anyone is taking, collecting or driving anyone, or that a lift is needed.
- **No availability conflicts.** There is no `conflict.away`, nothing built on all-day `travel` events and no "both adults away" (ADR 0009 §12, §24, §25).
- **No inference** of travel time, availability outside recorded commitments, childcare arrangements, whether someone can attend, or whether anyone is willing to help. Nothing is inferred from age, title, kind (beyond the written rules in §5), location, counts or the absence of a record.
- **No free time from empty space:** no "free", "clear", "nothing on so…" or "both weekends are clear".
- **No observation built on absence:** no "nothing planned", "worth deciding early" or "nobody's down".
- **No subjective load labels:** no "busy", "easy", "stressful", "overwhelming", "packed", "steady", "full" or "quiet week" as judgement.
- **Nothing from later milestones:**
  - **M7:** weather, free windows, `alignment` and availability.
  - **M8:** Kev phrasing, the Kev bar and long-press "Ask Kev".
  - **M9:** "Sort it", proposals and "look at what could move".
  - **M10:** the Week Ahead, "Read the week ahead ›", sheets and swipe.
- **No adaptive ranking, learning or rule suppression** from feedback (ADR 0009 §17).
- **No stored insights, push notifications or background jobs.**
- **No new schema, migration or runtime dependency.**
- **No hour grid, month grid, Season texture graphic, badges, counters, red, streaks, progress bars, category colours, year view or "+" button.**
- **No per-person filter on Forward.**

---

## 2. Implementation packages

Six packages, numbered 0–5 (approved, ADR 0009 §29). Packages are acceptance boundaries. Each ends with:

- CI green;
- a focused independent review at its stated intensity;
- the owner merging it.

Package *n* starts only after *n−1* has merged and the owner says to start. Review intensity follows risk; not every package gets an exhaustive review.

### 2.1 Packages

| # | Package | Objective | Scope | Depends on | Main risks | Builder | Review |
|---|---|---|---|---|---|---|---|
| **0** | **Contract and ADR** | Agree M6's product, rules, architecture, packages and acceptance | This contract, ADR 0009, status lines | M5 merged | Mis-scoping; decisions left implicit | Opus | Owner approval |
| **1** | **Forward groundwork and engine** | Give Forward its horizons and rows from the shared agenda, as a pure tested engine, with no screen yet | (1) Delete `/prototype` and its exclusions. (2) A 90-day read through the loader, with a constant query count. (3) Insights window parameterised, with Today unchanged. (4) Scheduled tasks as agenda items, placed once on Today. (5) `engines/forward.ts` per §5.1–§5.5. (6) Forward reads the test time source. (7) An explicit timeout on the audit-log scan test (M5-ACCEPTANCE §9). | 0 merged | Today regressing through the shared agenda or insights window; usual and notable misclassifying a changed occurrence; headline wording drifting into character | **Opus** | **Medium.** The engine is pure; agenda changes are additive; Today's suites must pass unchanged. |
| **2** | **Conflict engine** | Deterministic, explainable, private conflicts with stable identity | `engines/conflicts.ts` per §5.6–§5.7: the two rules, exclusions, per-person standing and occurrence identity, material-change rules, order and explanation basis. Every identity and lifecycle test in §5.7.4, unit-level. The privacy invariant through the real services. Forbidden phrases. A mutation proof. | 1 | Overlap boundaries; keys that change when nothing material did, or don't when something did; noise from recurring pairs or work calendars; one adult's private event creating, changing or counting a conflict for the other; layer-3 wording | **Opus** | **High.** This defines what HOME states as a conflict and how long a response lasts. |
| **3** | **Coordination insights, feedback and Today** | Conflicts as insights; Not useful; Today integration | The `conflict` family; per-surface listing and on-object marking (§5.8); the generalised response service (§5.9); Today's marks, Why, Dismiss and Not useful; the lifecycle tests in §5.7.4 through the real services (archive and restore, skip and put back, change and return); two-adult integration tests; Today e2e updated | 2 | A new write variant; eligibility across surfaces; a response leaking across adults; Today regressing | **Opus** | **High.** New user-facing write variant and per-actor content. |
| **4** | **The Forward screen** | Forward per the approved hierarchy, over reviewed engines | The page, horizon links, headline and facts, Worth knowing (two, then "+ N more"), Coming up rows with load indicators and conflict marks, The usual, states, tablet and desktop, Coming up marks on a person's page, no-JS, accessibility, devices, the two-adult sweep. Screenshots for the owner. FORWARD.md annotated. | 3 | Forward turning into a dashboard or a calendar; three horizons drifting into three designs; accessibility of marks; the old 30-day list regressing (an item lost) | **Fable** | **Medium.** Presentation over reviewed engines, with privacy and device sweeps extended. |
| **5** | **Acceptance** | Prove M6 against §10 | `docs/m6/M6-ACCEPTANCE.md`: criteria evidence, cross-package checks, scenario screenshots, performance measurement, carry-forwards, DEPLOY.md §E items 18–19, status docs | 4 | Evidence asserted rather than tested | **Opus** | **High, focused** on the acceptance evidence. Settled reviews are not repeated. |

If Package 4 proves too large for one review, it may split into **4a** (Week, and the switch) and **4b** (Month, Season, The usual and Coming up marks), decided at its start. That is the only split allowed without an ADR change.

### 2.2 Per-package acceptance

- **Package 1:**
  - `/prototype` is gone, along with every exclusion and the CLAUDE.md rule-14 deletion clause. The tag `m0.6-prototype` resolves on `origin`.
  - Forward's agenda query count is constant in the number of events. A test proves it.
  - Today's unit, integration and e2e suites pass unchanged. A scheduled task appears once on Today.
  - Every rule in §5.1–§5.5 has boundary tests:
    - units across a month end, a year end and both DST changes;
    - a changed occurrence is notable;
    - a fortnightly series is usual;
    - caps and their "+ N";
    - load bands ±1.
  - The engine imports no `db`, `app`, `kev` or clock.
- **Package 2:**
  - Every conflict rule has boundary tests:
    - touching ends;
    - a one-minute overlap;
    - identical times;
    - overnight;
    - DST;
    - routine and work-pair exclusions;
    - the same series;
    - all-day events excluded;
    - default people;
    - changed occurrences.
  - Every engine-level test in §5.7.4 passes.
  - Keys are stable across input order and fit `insightKey`.
  - The non-interference invariant holds at unit level and through the real services.
  - Forbidden phrases hold.
  - A mutation proof shows that removing an identity input, an exclusion or a tie-break each fails a test.
- **Package 3:**
  - Conflicts appear on Today's items and in Worth knowing as §5.8 says.
  - Not useful and Dismiss are per user, audited, refused while the gate is closed, and idempotent.
  - Feedback changes nothing for the other adult.
  - A crafted, foreign or stale key is refused.
  - The service-level lifecycle tests in §5.7.4 pass through the real services.
  - Today's no-regression test passes.
- **Package 4:**
  - Scenario e2e at four viewports, with JavaScript on and off.
  - Every agenda item in the 30-day window is reachable from Forward (Month), so nothing is lost from the old list.
  - The accessibility baseline holds.
  - The two-adult sweep covers Forward and Coming up.
  - The owner approves the headline wording and layout from screenshots.
- **Package 5:** every criterion in §10 is met, with evidence that cites tests.

### 2.3 Verification by package

| Package | While working | Before the PR | Why |
|---|---|---|---|
| 0 | — | Prettier, lint, typecheck, unit tests, CI | Documentation only |
| 1 | `pnpm verify:focused` | **Full `pnpm verify`** | Config changes from the prototype deletion, which are high-risk paths for `verify:focused`; the shared agenda |
| 2 | `pnpm verify:focused` | `pnpm verify:focused` + CI | Pure engine; its integration invariant runs in CI |
| 3 | `pnpm verify:focused` | **Full `pnpm verify`** | A user-facing write variant; Today e2e |
| 4 | `pnpm verify:focused` | **Full `pnpm verify`** | Seeded e2e scenarios, devices and the privacy sweep |
| 5 | — | **Full `pnpm verify`** + CI | Milestone evidence |

Settled reviews are not repeated: auth, CSP, the calendar boundary, the M4 sync model and M5's Dismiss path. A package re-opens one only if it changes that boundary.

---

## 3. Architecture

### 3.1 Source data (all existing; read as the actor)

| Source | Service | Used for |
|---|---|---|
| Events: manual and synced, occurrences, changes, overnight | `events`, through `readAgendaInputs` | Rows, notable or usual, conflicts, load |
| Event people (`attending`, `responsible`), calendar default people, series people for changes | `events` and `calendar`, through `who.ts` | Who is on each occurrence, *as recorded*; the person in a conflict; `responsible` for `conflict.responsible` only, never transport |
| People (`role`, `in_household`, `date_of_birth`) | `people` | Household people for The usual and routine; birthdays |
| Regular week | `profile.regularWeek` over the loader's events | The usual, and the notable test |
| Tasks (open; due; scheduled) | `tasks` | Due and scheduled items |
| Projects (`status`, `target_date`) | `projects` | Target dates on rows |
| Calendars (freshness) | `calendar` | `data_health`, the qualifier, refresh on use |
| Insight responses (own) | `insights.respondedKeys` | Hiding insights with a response |

Forward and conflicts read no context, notes, captures, Kev data or audit records.

### 3.2 Layers

```
domain services (as the actor: visibility, archive, sensitivity applied here)
        │
        ▼
readAgendaInputs + agenda engine (the one placement; 90 days for Forward, 8 for Today)
        │  AgendaDay[] · events · people · tasks · projects · calendars
        ├──────────────► engines/conflicts.ts ─► Conflict[] (rule, key, person, facts, overlap)
        ▼                         │
engines/forward.ts ◄──────────────┤
  (horizon, units, usual/notable, │
   rows, load, headline)          ▼
        │                engines/insights/ (+ conflict family; window; per-surface onObject)
        ▼                         │
Forward / Today / Coming up ◄─────┘  + the reader's own responses (one query)
        │
        ▼
presentational components (no rules)
```

- **Engines are pure.** They take records, the agenda's output, `now` and `timeZone`. They do no I/O, never call `Date.now()`, and use stable sorts with explicit tie-breaks.
- **The conflict engine runs once per request** over the page's window. Today, Forward and Coming up get the same conflicts, with the same keys, from the same function.
- **The page** reads through the shared loader, runs the engines, reads the reader's responses among the keys found (one query), runs them again with those responses, and renders. It holds no rules.

### 3.3 Model shapes (indicative; fixed in Packages 1–3)

```ts
type Conflict = {
  key: string;                       // §5.7.1; fits insightKey
  rule: 'conflict.responsible' | 'conflict.overlap';
  identity: 'standing' | 'occurrence';
  person: string;                    // the one visible person it is about
  when: IsoDate;                     // home date of the (next) overlap start
  occurrences: [EventFact, EventFact];
  overlap: { from: Date; to: Date }; // the (next) overlap
  facts: Fact[];
};

type Horizon = 'week' | 'month' | 'season';
type ForwardUnit = { label: …; from: IsoDate; to: IsoDate; band: 0 | 1 | 2 | 3;
                     notable: NotableItem[]; more: number; conflicts: string[] /* keys */ };
type ForwardModel = { horizon: Horizon; headline: Traced; units: ForwardUnit[];
                      usual: RegularWeekEntry[] /* by person */ };
```

`ForwardRule` and `ConflictRule` are closed unions. A test asserts that every value is documented in §5.

### 3.4 Privacy and authority

- **Visibility is resolved by the services before anything is interpreted** (CLAUDE.md rule 1). The engines see only what the reader can see. One adult's private records therefore cannot appear in, change or be counted by any of the following, for the other adult:
  - a conflict, its key, its count or its explanation;
  - a load band;
  - a headline count;
  - the order of a list;
  - "+ N more";
  - The usual;
  - Forward's or Coming up's presentation.

  A conflict between a household event and Sam's private event exists for Sam and does not exist for Alex, indistinguishably from no conflict at all. There are no "something private" placeholders.
- **The non-interference invariant** (§8.2) is the proof. It is extended from Today to Forward, Coming up and conflicts. Adding records only the other adult can see leaves the reader's `ForwardModel`, conflicts, insights and rendered pages identical, for every horizon.
- **Responses are private by `user_id`**, read and written by their owner only. A dismissal or Not useful never changes what the other adult sees. Activity shows `insight_response.respond` to its owner only, with the response kind and never the key.
- **Authority.** The only writes are the reader's own responses, through `respond`, audited and gated. The service re-derives the reader's own insights before writing and refuses any key that is not one of them (§5.9). Kev gains nothing. No source record is touched.
- **Keys** are built from ids and times only. Every id in a reader's key is one the reader can already see.

### 3.5 Stale, incomplete and absent information

| Situation | Behaviour |
|---|---|
| A visible calendar is stale or failing | `data_health` insight. Every count or absence on Forward is qualified "As far as HOME knows." Refresh on use, as in M4. |
| No calendars and no events at all | The first-run headline and "Connect a calendar ›" |
| A unit with nothing recorded | Drawn, with no indicator and "Nothing recorded besides the usual". Never "free" or "clear". |
| A child's occurrence with nobody recorded | Shown as recorded. No conflict, no mark, no wording about need or transport. |
| An occurrence whose only people the reader can't see | It is the reader's occurrence with nobody on it, so it takes part in no conflict |
| Two overlapping occurrences with no shared recorded person | No conflict |
| An all-day event (including `travel`) beside other commitments | No conflict; both are shown as recorded |

### 3.6 Determinism and traceability

- **Same input and `now`, same output.** Tested with shuffled inputs, repeated runs and a frozen `now`, for every horizon and every surface.
- **Every output carries its `rule` and `facts`.** Headline, rows, indicators, marks and insights show their facts in place without JavaScript.

### 3.7 Performance

- **One read.** Forward makes one agenda read plus one query for responses. The query count is constant in events, tasks, projects and calendars, and a test proves it.
- **No LLM and no network on render.** Refresh on use is unchanged.
- **Measured in Package 5:** engines and render over the 90-day Season on the seeded scenarios and on a synthetic 300-event household. Expected well under a second on the dev container, as M5's Today was.
- **Overlap detection** is per home day over that day's timed occurrences (pairwise). Standing identity collapses a recurring pair into one conflict, so its number does not grow with the horizon's repeats.

### 3.8 Schema

None (ADR 0009 §4). `insight_response.response` already allows `not_useful`.

---

## 4. The Forward experience

### 4.1 One hierarchy on every horizon (phone)

**Week is the primary experience.** Month and Season are higher-level summaries of the same structure, not separate dashboards. On every horizon:

1. **Horizon switch:** **Week** · Month · Season. Three links with `aria-current`, Week by default.
2. **Headline:** one factual sentence, sometimes two, in the display face. Then "As far as HOME knows." on its own line when qualified, and "What this is based on ›".
3. **Worth knowing:** two at most, then "+ N more". Absent when empty.
4. **Coming up:** one row per unit, each with its label, factual load indicator and notable items, then "+ N". Conflicts are marked on their items (a small ●, with "Why ›").
5. **The usual ›**, collapsed.
6. **"Today ›"**, back to Today.

Empty sections are absent. Spacing, type and colour are the same on every horizon; only the unit changes.

### 4.2 Synthetic examples (fixture family; Wednesday 14 October 2026, 7:03)

These are indicative layout and copy; final copy is approved from screenshots in Package 4. In the fixture:

- **Tomorrow:** Milo has a one-off Art club (15:00–16:00) and a one-off Dentist (15:30–16:30).
- **From 21 October:** Milo has weekly Tutoring on Wednesdays, 15:45–16:30, beside his usual Wednesday Swimming (15:30–16:15).

**Week (primary)**

```
[Week]  Month   Season

Six things in the next seven days, besides the usual.
There is one overlap.
What this is based on ›

COMING UP
Today     ●    Parent interviews 16:00 · Sam, Alex
Tomorrow  ●●   ● Art club 15:00 · Milo       Why ›
               ● Dentist 15:30 · Milo        Why ›
               + 1
Fri 16    ●    Wellington trip · Sam (Fri–Sat)
Sat 17    ●    Wellington trip · day 2 of 2
Sun 18         Nothing recorded besides the usual
Mon 19         Nothing recorded besides the usual
Tue 20    ●    Nana Jo's birthday

The usual ›
```

- *Rules shown:*
  - `forward.headline.counted` counts the notable occurrences in the seven days, each once (the trip is one), and says the rest is the usual.
  - The second sentence is `forward.headline.conflicts`.
  - Tomorrow's two marks are one `conflict.overlap` for Milo: an occurrence identity, because both are one-offs. The overlap is 15:30–16:00, and "Why ›" says so.
  - The load indicators are `forward.load` bands: Tomorrow has three notable items, so it is band 2.
- *What it does not say:*
  - "in two places";
  - that Milo can't go, or that anyone needs to take him;
  - that Sam is unavailable at the weekend;
  - that Sunday or Monday is free;
  - that the week is busy.

**Month (summary)**

```
Week  [Month]  Season

Nineteen things in the next 30 days, besides the usual.
There are two overlaps.

WORTH KNOWING
● Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00.   Why ›
● Milo's Swimming and Tutoring overlap regularly, 15:45–16:15;
  next on Wednesday 21 October.                                           Why ›

COMING UP
This week        ●●   Art club Thu · Dentist Thu · Wellington trip Fri–Sat · + 2
19–25 Oct        ●    Swimming Wed · Tutoring Wed · Nana Jo's birthday Tue · + 1
26 Oct–1 Nov     ●    Swimming Wed · Tutoring Wed · Labour Day Mon
2–8 Nov          ●    Swimming Wed · Tutoring Wed · School cross-country Fri
9–12 Nov         ●    Swimming Wed · Tutoring Wed · Sam's board meeting Mon

The usual ›
```

- The second insight is a **standing** `conflict.overlap` for Milo. Swimming and Tutoring are both unchanged occurrences of recurring series. It is said once, and a response to it holds every week (§5.7).
- Swimming is in Milo's regular week, so it would be usual. It is drawn, and counted, in the weeks where it is in a current conflict (§5.2). On Month the row is chronological (§5.3): the conflicted items sit at their times, and the conflict is listed in Worth knowing.

**Season (summary)**

```
Week   Month  [Season]

Thirty-one things over the next 90 days, besides the usual.
There are two overlaps.

WORTH KNOWING
● Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00.   Why ›
● Milo's Swimming and Tutoring overlap regularly, 15:45–16:15;
  next on Wednesday 21 October.                                           Why ›

COMING UP
October     ●●●  Nana Jo's birthday · Back fence target · + 9
November    ●●   Sydney trip (10–12) · School cross-country · + 6
December    ●    School ends (16th) · Christmas Day · + 2

The usual ›
```

Season has no texture graphic and no "worth deciding early". A row shows only what is recorded.

**Nothing recorded**

```
Nothing recorded in the next seven days besides the usual.

The usual ›
```

**Stale calendar**

```
Five things in the next 30 days, besides the usual.
As far as HOME knows.

WORTH KNOWING
○ Alex's work calendar hasn't updated since Monday.   Why ›
```

**First run**

```
HOME doesn't know your calendars yet.
Connect a calendar ›
```

### 4.3 Tablet and desktop

- At 768px and wider, Forward uses the 960px width, as Today does.
- **Left:** switch, headline, Worth knowing and The usual.
- **Right:** Coming up.
- Wider means more context per row, never smaller cells. There is no hour grid, no month grid and no side-by-side month dashboard.

### 4.4 Interactions in M6

| Gesture | Result |
|---|---|
| Tap Week, Month or Season | Its link (`/forward?h=…`), with no JavaScript |
| Tap an item | Its existing full page, as now |
| Tap "+ N" on a row | The row's other notable items, in place (`<details>`) |
| Tap "Why ›" on a conflict or insight | Its rule and records, in place, with Dismiss and Not useful (§5.9) |
| Dismiss | Gone for this adult, for this key, on every surface |
| Not useful | The same as Dismiss, and recorded as explicit feedback |
| The usual › | Each household person's regular week, in place |

Swipe, sheets, long-press and Kev are not built (ADR 0009 §3, §23).

### 4.5 Today in M6

- **Today's conflicts sit on the affected entry:** on the person line, or on the Also today row. They are a small ● and say, for example, "overlaps Art club 15:00". "Why ›" holds the facts, Dismiss and Not useful.
- **The headline is unchanged.** Conflicts do not become headline wording on Today.
- **Worth knowing** adds conflicts from tomorrow to seven days ahead, ranked after `data_health` (§5.8). Not useful sits inside every insight's Why.
- **Everything else on Today is unchanged.** M5's tests keep passing.

### 4.6 A person's Coming up

A person's Coming up shows that person's conflict marks on their items, with the same keys and the same Why. That is the individual view. Forward stays household-wide.

---

## 5. Rules (deterministic; every one named, traceable and tested)

### 5.1 Horizons and units (`forward.horizon`)

| Horizon | Range (home zone) | Unit | Unit label |
|---|---|---|---|
| `week` (default) | today … today + 6 | day | "Wed 14", with "Today" and "Tomorrow" |
| `month` | today … today + 29 | week, Monday to Sunday; the first runs from today to Sunday | "This week", then "19–25 Oct" |
| `season` | today … today + 89 | calendar month, clipped to the range | "October"; a month the range ends inside is labelled by its days, "1–11 Jan" (ADR 0009 §35) |

Every unit in range is drawn. A unit's items are the agenda's items on its days. An occurrence carried over several days is counted once per unit (`occurrenceKey`).

**Coverage invariant (ADR 0009 §32).** The engine is given the range of home dates the agenda was computed over (`coverage`). It composes only when that range starts on or before today and ends on or after the horizon's last day. Otherwise it refuses (`IncompleteAgendaError`). It never fetches, expands or fills in days. An absent day inside the coverage was loaded and is empty; a day outside it is never described at all.

### 5.2 Usual or notable (`forward.usual`, `forward.notable`)

- **Usual:** an unchanged occurrence of a series that is in at least one household person's regular week (`profile.regularWeek`: a plain weekly or fortnightly series with that person on it).
- **Notable:** everything else, which includes:
  - any occurrence in a current conflict for the reader that the reader has not responded to, even a usual one, so a conflict is always drawn on its item;
  - one-offs;
  - changed occurrences, which are always notable, because a change from the usual is news;
  - multi-day and all-day events not in the regular week;
  - birthdays;
  - project targets;
  - tasks due;
  - scheduled tasks.
- **A skipped occurrence** is simply absent. Showing "Swimming isn't on this week" is not built (§12.3).

### 5.3 Rows (`forward.row`)

- **Caps:**

  | Horizon | Shown per unit |
  |---|---|
  | Week | 2 per day |
  | Month | 3 per week |
  | Season | 3 per month |

  The rest are counted ("+ N") and held in place.
- **Which are shown:** entries that still count fill the cap first, so a carry-over from last night that has already ended never takes a visible slot from something still to come (ADR 0009 §32). The shown entries keep row order, and the held ones stay in the model.
- **Order within a unit, on Week:**
  1. items with a current conflict for the reader;
  2. birthdays;
  3. multi-day and all-day events;
  4. project targets;
  5. tasks due;
  6. scheduled tasks;
  7. timed items by start;

  then the agenda's order. This is by kind and time, never by importance.
- **Order within a unit, on Month and Season** (approved refinement, Package 4; ADR 0009 §35): chronological, by day, then the agenda's order within the day, then the key. A conflict is listed in Worth knowing there and explained in its Why; it does not move its entries ahead of earlier commitments, so the row reads as a timeline and a trip or a target keeps its place. The usual stays the usual (§5.2): a row is not filled with every series occurrence to keep it in order.
- **Each item** reads as on the agenda (time, title, recorded people) in short form. Week names the time in its column. Month and Season name the weekday or date in the column and keep a timed event's recorded time under it ("15:00–16:00"); an all-day event has no time.

### 5.4 Load indicators (`forward.load`; factual, provisional bands)

- **What is counted:** notable items in the unit. The usual is not counted.
- **Bands:**

  | Unit | Band 0 | Band 1 | Band 2 | Band 3 |
  |---|---|---|---|---|
  | Day | 0 | 1–2 | 3–4 | 5 or more |
  | Week or month | 0 | 1–4 | 5–9 | 10 or more |

- **How they are drawn:** in ink tones, never the Sun accent. Each has a factual text equivalent ("Three things recorded"). There is no separate texture graphic on any horizon.
- **Wording:** never subjective ("busy", "easy", "stressful", "overwhelming", "quiet", "free").
- **Status:** code constants, evaluated in the M10 trial, changed only by an ADR amendment.

### 5.5 Headline (closed set; first match wins)

| Rule | Condition | Template (indicative) |
|---|---|---|
| `forward.headline.first_run` | No calendars and no events at all | "HOME doesn't know your calendars yet." |
| `forward.headline.nothing` | Nothing notable and nothing usual in range | "Nothing recorded in the next seven days." |
| `forward.headline.usual` | Only usual items in range | "Just the usual in the next seven days." |
| `forward.headline.listed` | One or two notable items (Week only) | "Parent interviews on Wednesday, then Nana Jo's birthday on Tuesday." An event carried in from before today is named by when it ends: "Camp, until Friday." (ADR 0009 §36) |
| `forward.headline.counted` | Otherwise | "{N} things in the next {seven days \| 30 days \| 90 days}, besides the usual." |
| `forward.headline.conflicts` (second sentence) | Conflicts in range that are current for the reader, with no response from the reader | "There are two overlaps." / "There is one overlap." |
| `forward.headline.qualified` (qualifier) | `data_health` fires for a visible calendar | "As far as HOME knows." on its own line |

- **Numbers** are words up to ten.
- **Forbidden:** the M5 list (M5 contract §8.1), plus:
  - "packed", "steady", "clear", "quiet" (as a judgement), "stressful", "overwhelming";
  - "away", "unavailable", "in two places", "double-booked", "can't";
  - "clash" (as a claim of impossibility);
  - "worth deciding".
- **Facts:** the counted items, or the range and the calendars consulted.

### 5.6 Conflict rules (`conflict.*`; ADR 0009 §9–§12)

| Rule | Fires when | Template (indicative) | Facts |
|---|---|---|---|
| `conflict.responsible` | A visible person is recorded as `responsible` on both of two overlapping timed occurrences | "Alex is recorded as responsible for both Swimming and the working bee, which overlap on Wednesday 4 November, 16:00–16:15." | Both occurrences; the person |
| `conflict.overlap` | A visible person is on both of two overlapping timed occurrences, and is not responsible on both | "Milo has Art club and Dentist at the same time tomorrow, 15:30–16:00." | Both occurrences; the person |

- **Overlap:** each occurrence starts before the other ends. Ends that touch do not overlap. Overlap is decided on instants; `when` and the wording use the home zone.
- **On an occurrence** means the people the agenda shows for it: the event's own annotations, else its calendar's usual people, or a changed occurrence's series people (§3.1). A person the reader cannot see is never on an occurrence for that reader.
- **One conflict per person per pair** (ADR 0009 §13). When Milo and Alex are both on both occurrences, each has their own conflict. The rule for each is decided by that person's own roles.
- **Excluded:**
  - all-day events, including `travel`;
  - Today's routine occurrences (`routine.regular_week`);
  - pairs where both occurrences are kind `work`;
  - two occurrences of the same event.
- **Standing template:** "Milo's Swimming and Tutoring overlap regularly, 15:45–16:15; the next is on Wednesday 21 October." The wording is the same on every surface (owner's wording, ADR 0009 §36).
- **Order:**
  1. `responsible`, then `overlap`;
  2. then the (next) overlap start;
  3. then the key.
- **Never stated:**
  - class C (ADR 0009 §9);
  - availability;
  - transport;
  - the reason for a conflict;
  - locations;
  - who should change;
  - whether either commitment is optional.

### 5.7 Conflict identity and lifecycle (ADR 0009 §13)

#### 5.7.1 Identity

| | **Standing (case A)** | **Occurrence (case B)** |
|---|---|---|
| **Applies when** | Both occurrences are unchanged occurrences of recurring series, produced by a series' own expansion | Either occurrence is a one-off event or a changed occurrence (its own event row, `recurrence_parent_id` set) |
| **Commitments in the key** | The two series ids | The two event ids. For an unchanged series occurrence paired with a one-off or a change, the series id. |
| **Window in the key** | The overlap's start and end on the home-zone wall clock: `w1545-1615` | The overlap's start and end as UTC instants, to the minute: `20261014T0230Z-20261014T0300Z` |
| **Key** | `{rule}:{person}:{seriesA}.{seriesB}:w{HHMM}-{HHMM}` | `{rule}:{person}:{eventA}.{eventB}:{startUTC}-{endUTC}` |
| **Said** | Once, at its next occurrence in the window | At its occurrence |

- **Key format.** Ids are sorted, separated by `.`. The longest key is 161 characters (an occurrence key for `conflict.responsible`), within `insightKey`'s 200.
- **Nothing else is in a key:** no viewing date, no occurrence date, no title or other text.
- **Two windows, two conflicts.** When a standing pair overlaps with different windows on different days (for example, Monday 15:30–16:00 and Wednesday 15:45–16:00), each window is its own standing conflict.

#### 5.7.2 What counts as a material change

A change is **material** exactly when it changes an identity input:

1. the rule;
2. the person;
3. either commitment;
4. the overlap window.

A material change makes a new key. The new conflict is eligible again, for both adults, whatever either did to the old one. Anything else is **not material** and keeps the key, with every response on it.

| Change | Material? | Why |
|---|---|---|
| Either occurrence's time changes so that the overlap's start or end moves | **Yes** | The window changes |
| An occurrence's end moves but the overlap is the same (Dentist now 15:30–17:00 against Art club 15:00–16:00: still 15:30–16:00) | No | Same window |
| One occurrence of a standing pair is changed, by any field (time, title, people) | **Yes, for that occurrence** | It becomes its own row: case B, with a new commitment id. The standing conflict for the other weeks is unaffected. |
| A whole-series edit moves the series' time | **Yes** | The standing window changes. Occurrence keys involving that series' unchanged occurrences change too. |
| A whole-series edit adds weekdays, with the same overlap window | No | Same commitments, same window; the next date may change |
| The person changes from `attending` to `responsible` on both, or the reverse | **Yes** | The rule changes |
| A different person becomes responsible on both (Alex out, Sam in) | **Yes, for each** | Alex's conflict ends. Sam's is new. |
| Another person is added to or removed from either occurrence | No, for the existing person | That person's own conflict may begin or end |
| A calendar's usual people now apply, or own annotations replace them | Only if a person's being on both changes | The person is the identity input |
| Title, notes, place, kind (except into or out of `work` and routine, which can end a conflict) | No | Not identity |
| A calendar refresh keeps the same rows | No | Same ids, same times |

#### 5.7.3 Lifecycle

- **A response belongs to one adult and one key.** Dismiss and Not useful are both responses. A response suppresses that conflict wherever and whenever the key is current: lists, item marks, counts and the headline's overlap sentence, on every surface. It never expires.
- **A material change** produces a new key, which has no response yet. The old response stays and matches nothing.
- **A return to an earlier state brings the earlier response back.** The situation is one the adult already answered:

  | Event | Effect on the conflict | Effect on a response |
  |---|---|---|
  | **Skip** an occurrence of a standing pair | No conflict that week. The standing conflict continues at its next unskipped occurrence. | Unaffected |
  | **Put back** that skip | The occurrence is back under the standing key | The standing response, if any, applies |
  | **Skip** one side of an occurrence-level pair | The conflict disappears | Kept, matching nothing |
  | **Put back** that skip | The same key, current again | The earlier response applies again |
  | **Move** (change) one occurrence of a standing pair | A new occurrence-level conflict, if it still overlaps | Eligible: not covered by the standing response |
  | **Move** that change again | A new key only if the overlap window moves | Kept if the window is the same |
  | **Return** the change to the series | Its row is archived; the week is under the standing key again | The standing response applies |
  | **Restore** a put-away change | The same row and times, so the same key | Its earlier response applies again |
  | **Archive** either event, or a synced event leaves its feed | The conflict disappears | Kept, matching nothing |
  | **Restore** that event, or the synced event comes back | The same rows and times, so the same keys | Earlier responses apply again |

- **No date-based re-raising.** A conflict never comes back merely because a day, week or month has passed. M5's date-keyed `data_health.stale` pattern is not used for conflicts.

#### 5.7.4 Acceptance tests (synthetic; engine-level in Package 2 unless marked P3)

Fixture: Milo, Alex and Sam.

- Swimming is weekly on Wednesdays, 15:30–16:15; Milo is attending and Alex responsible.
- Tutoring is weekly on Wednesdays, 15:45–16:30; Milo is attending.
- Art club (one-off, 15:00–16:00) and Dentist (one-off, 15:30–16:30) are on Thursday; Milo is attending both.

| # | Given | Expect |
|---|---|---|
| T1 | Swimming and Tutoring, both unchanged, over 90 days | One standing `conflict.overlap` for Milo, key `…:{swim}.{tutor}:w1545-1615`, said once at the next Wednesday |
| T2 | T1, and Alex is made responsible on Tutoring too | Milo's key is unchanged. A new standing `conflict.responsible` for Alex. |
| T3 | Milo dismisses T1's conflict; four weeks pass (`now` advanced) | Still suppressed for Milo's reader. No new key. |
| T4 | The Wednesday 28 October Swimming is changed to 16:00–16:45 | An occurrence-level conflict for that Wednesday (key with the change's id and 28 Oct's UTC window), eligible despite T3. The standing conflict continues for the other weeks, still dismissed. |
| T5 | T4's change is returned to the series (P3) | The occurrence-level conflict is gone. That week is under the standing key, still dismissed. |
| T6 | T4's change is put away, then restored (P3) | The same key as T4. A response given in T4 applies again. |
| T7 | The Wednesday 21 October Tutoring is skipped | No conflict on 21 October. The standing conflict's next date is 28 October. Same key. |
| T8 | T7's skip is put back (P3) | 21 October is back under the standing key. The response is unchanged. |
| T9 | Tutoring's series moves to 16:00–16:45 | A new standing key (`w1600-1615`), eligible. The old response matches nothing. |
| T10 | Tutoring's series adds Mondays, with no Swimming on Mondays | Same key as T1. No new conflict. |
| T11 | Art club and Dentist on Thursday | One occurrence-level `conflict.overlap` for Milo, window 15:30–16:00 in UTC |
| T12 | Dentist's end moves to 17:00 | Same key as T11 |
| T13 | Dentist moves to 15:45–16:45 | A new key (window 15:45–16:00), eligible |
| T14 | Dentist is archived, then restored (P3) | The conflict disappears, then returns with T11's key and any response on it |
| T15 | Dentist moves to start at 16:00 | No conflict: ends touch |
| T16 | Sam is on an all-day `travel` event and on Football that day | No conflict |
| T17 | Alex dismisses T11; Sam reads | Sam's conflicts and responses are unchanged (P3, two adults) |
| T18 | A private event of Sam's overlaps a household event Sam is on; Alex reads | Alex's conflicts, keys, counts and pages are identical with and without it |
| T19 | Shuffled inputs, repeated runs | Identical conflicts, keys and order |
| T20 | Any key produced in T1–T19 | Matches `insightKey`; at most 200 characters; contains no text from a record |

### 5.8 Insights on each surface (`insights`)

| Surface | Window | Listed families | On the item, not listed |
|---|---|---|---|
| Today | today … today + 7 | `data_health`, `conflict` (tomorrow onwards), `preparation`, `busy_day` (tomorrow) | Today's conflicts; M5's on-object rules |
| Forward, Week | today … today + 6 | `data_health` | Every conflict, on its row item |
| Forward, Month | today … today + 29 | `data_health`, `conflict` | — |
| Forward, Season | today … today + 89 | `data_health`, `conflict` | — |
| Coming up (a person) | as its page today | — | That person's conflicts |

- **Ranking:**
  - by family: `data_health`, then `conflict`, then `preparation`, then `busy_day`;
  - then within the family (§5.6);
  - then by date;
  - then by key.

  This is a total order.
- **Shown:** Today shows 3 and Forward shows 2. "+ N more" counts only listed insights with no response from the reader.
- **Marks:** a small ● (Sun) for `conflict.*`, restrained, beside factual wording. ○ for everything else.
- **Current:** a conflict is current while its (next) overlap has not ended at `now`.

### 5.9 Dismiss and Not useful (`insight_response`)

- **One service:** `respondToInsight(actor, key, response, surface, now, timeZone)`, generalising `dismissInsight`. It runs these steps in order:
  1. Gate, then actor (before any read).
  2. Key schema.
  3. Re-derive the reader's own insights over 90 days.
  4. Accept the key if it is a current conflict, or current and listable on the named surface; otherwise refuse with `not_eligible`.
  5. If the same response already exists, return without writing anything.
  6. Otherwise `respond(actor, key, response)`: an upsert, audited.
- **Not useful** sits inside Why, after the facts, as a quieter secondary button. Dismiss stays on the surface. Both are no-JS forms.
- **Neither changes any rule, threshold or ranking.** `not_useful` is explicit feedback, reviewed deliberately by each adult from their own export in the M10 retrospective. Kev does not read it.
- **Midnight:** for non-conflict insights whose key carries a date (M5's), a key that changed overnight is refused, as in M5 (M5-ACCEPTANCE §9). Conflict keys carry no viewing date.

---

## 6. Transport responsibility (ADR 0009 §20): Approved, deferred

**Decision (owner, PR #59):** the structured transport-responsibility model is deferred. Its rules:

- **Responsibility is not transport.** Existing `event_person` responsibility is never interpreted as transport responsibility.
- **M6 never infers:**
  - who is taking a child somewhere;
  - whether transport is required;
  - whether transport has been arranged;
  - whether a parent is available to provide transport.
- **When it is revisited:** structured transport is re-decided at M9 planning, using real-family evidence where available.

**Why a record would be needed.** `event_person.role = 'responsible'` records responsibility for an event, not transport (ADR 0008 §21). Nothing records any of these:

| Record | Meaning |
|---|---|
| Getting someone there | Who takes the person to it |
| Getting someone home | Who collects them |
| Independent travel | Makes their own way |
| Not yet assigned | Needs someone; nobody recorded |
| Not applicable | No transport involved |

Without such a record, "unassigned pickup" is absence, and absence proves nothing.

**The options that were compared:**

| | **A. No transport model in M6** | **B. Minimal structured model in M6** | **C. Defer to a later milestone (approved)** |
|---|---|---|---|
| **What it means** | Coordination is restricted to existing explicit facts, and the getting-there promise is withdrawn from V0.1 | A per-event (and per-series) `getting_there` field (`needed` \| `own_way` \| `not_applicable`, null = unknown) and two `event_person` roles (`takes`, `collects`) | M6 behaves as A. The transport record stays planned and is re-decided at M9 planning, with real-use evidence. |
| **Product value** | Recorded overlaps only | The highest, but only if someone records it for every relevant event or series | As A in M6. The full value arrives once Kev can record it from conversation. |
| **Data model** | None | One additive column and two enum values; series defaults with per-occurrence changes; export version bump | None now. B's design is kept as the starting point. |
| **Privacy** | No change | Inherits its event's visibility; no new boundary | No change now |
| **UX complexity** | None | A new choice on every child's event; an unknown state that must never read as a need; a data-entry burden | None now |
| **Migration** | None | Required, migration-first, in its own package | None now |
| **Implementation and review** | Lowest | About two extra high-review packages | Lowest now |
| **Future Kev** | Overlaps only | A clean structured target for M9 proposals | Same as B, once built; M9 is designed with it in view |

---

## 7. Environments and data

- **Local and CI:** the seeded fixture family. Forward scenarios are seeded in `home_test` only, using the M5 scenario harness (held records, a fixed date): an ordinary week, a month with a one-off and a standing overlap, a season, quiet, first run and stale. The §5.7.4 fixture is a pure engine input, with its service-level cases seeded.
- **Preview:** the throwaway synthetic account only.
- **Production:** M6 deploys like any merged code. `HOME_REAL_DATA` stays closed: no real data and no new settings.

---

## 8. Testing requirements

### 8.1 Unit (engines)

- **Every rule in §5 at its boundaries:**
  - overlap by one minute;
  - touching ends;
  - identical times;
  - overnight;
  - all-day excluded;
  - units across a month end, a year end and both Pacific/Auckland DST changes;
  - a standing window across a DST change for a series in the home zone, which keeps its key;
  - caps ±1;
  - load bands ±1;
  - a changed occurrence of a usual series;
  - fortnightly cadence;
  - default people;
  - series people on a change.
- **Identity and lifecycle:** every engine-level case in §5.7.4.
- **Determinism:** shuffled input, repeated runs, frozen `now`, every horizon.
- **Traceability:**
  - every output has a known rule;
  - every rule is documented in §5;
  - every non-absence output has facts that resolve to input records.
- **The absence rule:** in scenarios with missing people or responsibility, all-day travel, or nothing recorded, no output asserts need, arrangement, availability, transport, free time or reassurance.
- **Forbidden phrases:** §5.5's list over every template and rendered string. Household titles shown as recorded are exempt.
- **Import boundaries:** no `db`, `app`, `kev`, `ui`, `integrations` or clock.

### 8.2 The privacy invariant (unit and integration)

For each adult, add records only the other adult can see:

- a private event overlapping a household event;
- private people on household events;
- private tasks and projects;
- a private stale calendar;
- the other adult's responses.

The reader's conflicts, keys, insights, `ForwardModel` for every horizon, Today model, Coming up, and rendered Forward and Today pages must be identical before and after. The same records must change the other adult's own. This runs through the real services as `home_app`.

### 8.3 Integration (as `home_app`)

- **Dismiss and Not useful are:**
  - per user;
  - audited, with the response kind only;
  - idempotent, with no second audit row;
  - refused while the gate is closed, before any query;
  - refused for crafted, foreign, stale and unlistable keys.
- **A response on one surface hides the key on the others** for that adult only.
- **The §5.7.4 cases marked P3** pass through the real event services: change, return, restore, skip, put back, archive and restore.
- **Forward's query count** is constant.

### 8.4 End to end (Playwright, seeded scenarios)

- The Forward scenarios at four viewports, with JavaScript on and off: the horizon links, "+ N", Why, The usual, Dismiss and Not useful.
- **No regression:** every item the old 30-day Forward showed is reachable from Month.
- **Today:** conflict marks, Worth knowing conflicts and Not useful. M5's Today specs keep passing.
- **Coming up:** a person's conflict marks.
- **The two-adult privacy sweep** extended to Forward and Coming up.
- **Accessibility baseline:**
  - axe;
  - headings and landmarks;
  - focus;
  - 44px targets;
  - no information by colour alone (marks and indicators have text);
  - `<details>` keyboard-operable.

### 8.5 Kept

Every M1–M5 test.

---

## 9. Documentation

- **Package 0:** this contract and ADR 0009; the ROADMAP M6 and M5 rows; the status lines in `CLAUDE.md` and `README.md`; the M5 contract and ADR 0008 status lines (Package 5 merged).
- **Each package:**
  - ADR 0009 amended with an "Implementation" section and any changed decision;
  - this contract's status line updated.
- **Package 1:** CLAUDE.md rule 14 rewritten to record the deletion; `docs/runbooks/LOCAL-DEV.md` and `DEPLOY.md` lines on `/prototype` updated.
- **Package 4:** `docs/concepts/FORWARD.md` annotated where M6 differs.
- **Package 5:** `docs/m6/M6-ACCEPTANCE.md`; DEPLOY.md §E items 18–19.

---

## 10. Acceptance criteria

### 10.1 Technical acceptance (synthetic data)

| # | Criterion | Measured by |
|---|---|---|
| 1 | **Correctness.** Units, notable and usual, rows, caps, load bands, headline, conflicts and per-surface insights follow §5 exactly on every scenario and every boundary in §8.1. | Unit tests per rule; scenario snapshots |
| 2 | **Determinism and identity.** Engines are pure. The same input and `now` give identical output regardless of input order. Ranking is a total order. Keys change exactly on the material changes in §5.7.2, and never with the passage of time. | Determinism tests; §5.7.4; import-boundary test |
| 3 | **Explainability.** Every headline, indicator, mark and insight carries its rule and records, and shows them in place without JavaScript. A conflict's Why names both occurrences, their times, the person and the overlap. | Traceability tests; no-JS e2e |
| 4 | **Privacy.** No conflict, key, count, band, list, ranking, explanation or presentation for one adult reflects anything only the other adult can see. Responses are per user. | §8.2 invariant (unit and integration); two-adult sweep |
| 5 | **No unsupported inference.** No transport, need, availability, attendance, willingness, childcare, travel time, location, free time, character or reassurance. No class C output. No conflict from all-day events. No statement built on absence. | Forbidden phrases; absence-rule tests; T16; review checklist |
| 6 | **Cross-screen consistency.** The same conflict has the same key, wording and facts on Today, Forward and Coming up. A response on one hides it on all, for that adult. Forward's items for a day equal the agenda's items for that day. | Shared-engine tests; e2e across surfaces |
| 7 | **Healthy quiet.** A unit with nothing recorded says so without judgement. No insight appears without a firing rule. Forward lists at most two, and Today at most three. "+ N more" counts only genuine insights with no response. A recurring overlap is said once, not every week. | Scenario and insight tests; T1, T3 |
| 8 | **Accessibility.** The axe baseline is clean at four viewports. Everything is keyboard reachable. Targets are 44px. Marks and indicators have text equivalents. Nothing relies on colour alone. | Device and accessibility e2e |
| 9 | **Performance.** Forward's query count is independent of record counts. No LLM or network on render. Render and engine time over 90 days are measured and recorded. | Query-count test; Package 5 measurement |
| 10 | **Reliability.** Forward and Today work with Kev absent and with no calendars. A failing or stale calendar is said, not hidden. No flaky time-dependence: `now` is injected. | Scenario e2e; the test time source |
| 11 | **Scope.** No transport, availability conflicts, weather, Kev, proposals, sheets, stored insights, notifications, background jobs, adaptive ranking, new schema or new runtime dependency. `/prototype` is deleted. | Review checklist; `package.json` diff; no migration |
| 12 | **Production gate.** `HOME_REAL_DATA` stays closed. No real data or calendar is used. Responses are refused while it is closed. The M1 and M3–M5 operational items remain open and are not marked complete. | Gate tests; DEPLOY.md §E unchanged except the new rows; acceptance doc |
| 13 | **Family usefulness (synthetic).** On the scenarios at phone width, the switch, headline and Worth knowing are above the fold. The owner confirms from screenshots that the coming week can be read in a few seconds, that Month and Season read as summaries of the same thing, and that nothing reads as an alarm (concepts README design tests 2, 4, 7). | Screenshot evidence; owner review in Packages 4 and 5 |
| 14 | **Handover.** Each package had its stated review. Every Blocker and Important finding was fixed before merge. Carry-forwards are recorded. | Package reviews; M6-ACCEPTANCE |

### 10.2 Operational acceptance (real family use, after the gate opens)

These are DEPLOY.md §E items, added in Package 5:

- **18. Forward on a real week:**
  - each adult opens Week and Month;
  - the rows match what is recorded;
  - nothing private to the other adult appears;
  - a real overlap, if any, is marked with correct facts;
  - Dismiss and Not useful work and stay one adult's.
- **19. The anticipation check:** the owner confirms, on their own phone, that the coming week and month can be understood at a glance without alarm, noting anything that reads wrong. Usefulness itself is evaluated in the M10 trial, together with the `not_useful` review and the evidence for transport at M9 planning. That includes whether conflicts are worth their marks.

M6 is fully accepted only when both technical and operational acceptance are recorded.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Conflicts read as alarms | Factual templates; a restrained mark; caps; Dismiss and Not useful; a high-intensity review of Package 2 |
| A dismissed situation coming back when nothing material changed, or staying hidden when something did | Identity inputs and material changes written down (§5.7); tests T1–T20; a mutation proof on each identity input |
| Noise from recurring pairs, work calendars or default people | Standing identity; the work-pair and routine exclusions; noise reported through Not useful in the trial |
| Two people on the same pair making two conflicts | Per-person identity is deliberate (each person's situation is their own). Caps and ranking keep the list short; evaluated in the trial. |
| Three-way clusters producing three pairs | Caps and row placement. Merging is recorded for the M10 trial if needed. |
| A series in another zone shifting its home-zone window at a DST change | That is a real change in overlap timing at home, so a new key. It is rare, and is recorded and tested. |
| Private records shaping the other adult's view | Services filter first; the invariant at unit and integration level; the two-adult sweep |
| Character wording, or free time, creeping into headlines | A closed template set; the forbidden list; owner screenshot approval |
| Three horizons drifting into three dashboards | One hierarchy and one row structure (§4.1); no Season graphic; owner screenshot review |
| "The usual" meaning differs between Today and Forward | Recorded (ADR 0009 §21) and explained in each headline's Why |
| The roadmap's getting-there promise stays unmet | Transport deferred with a named point to revisit (§6) |
| Today regressing through the shared agenda and insights | Today's suites unchanged in Packages 1 and 3; full verify |
| Feedback mistaken for learning | No code path reads `not_useful` except export and the eligibility check |

---

## 12. Decisions

### 12.1 Settled (inherited)

| Source | Decision |
|---|---|
| ADR 0002 §2–§3 | Clashes on the affected item; "+ N more" counts only genuine insights |
| ADR 0008 §5, §6 | Four layers; absence proves nothing |
| ADR 0008 §21 | Responsibility is not transport |
| ADR 0008 §23 | Dismiss built in M5; Not useful in M6 |
| CLAUDE.md rule 15 | Insights derived on read; only responses stored |
| ROADMAP M6 | Forward (week/month/season); `/prototype` deleted; conflict engine and insights; dismiss / not useful |

### 12.2 Approved by the owner (PR #59, 2026-10-09)

| ADR 0009 § | Decision | Status |
|---|---|---|
| 20 | Transport: the structured model deferred; responsibility never read as transport; re-decided at M9 planning with real-family evidence | **Approved** |
| 12, 24 | `conflict.away`: excluded; conflicts only from timed overlaps | **Approved** |
| 13 | Conflict identity: standing for unchanged recurring pairs, occurrence for one-offs and changes; material change; lifecycle (§5.7) | **Approved** (with Package 0) |
| 15 | Week primary; Month and Season as summaries; headline, Worth knowing, Coming up, The usual | **Approved** |
| 21 | The usual on Forward = the existing regular week | **Approved** |
| 22 | Factual load indicators with provisional bands; no subjective labels; no Season graphic | **Approved** (the graphic's removal is a refinement under "one structure") |
| 23 | Sheets deferred to M10 | **Approved** |
| 25 | "Both adults away" excluded | **Approved** |
| 26 | Scheduled tasks on Forward | **Approved** |
| 27 | "Worth knowing" on Forward; restrained conflict marks | **Approved** |
| 28 | Conflict visibility on Coming up | **Approved** |
| 17 | Not useful as explicit feedback, with no adaptive ranking | **Approved** |
| 29 | Six packages, numbered 0–5 | **Approved** |

### 12.3 Considered and not proposed

| Item | Why not |
|---|---|
| "A task is due before an upcoming event" | No record links a task to an event. Linking them by person or title would be inference. |
| "Unassigned responsibility" without a transport record | Absence (ADR 0008 §6) |
| Showing skipped occurrences ("Swimming isn't on this week") | A new agenda item kind. The series page already shows skips. Revisit in the M10 trial. |
| Merging overlap clusters, or merging per-person conflicts on the same pair | Pairwise, per person, is simpler to explain and to give identity. Revisit with evidence. |
| Adaptive ranking from Not useful | ROADMAP "Not yet"; ADR 0009 §17 |
| Conflicts from all-day `travel` events (`conflict.away`) and "both adults away" | Owner decision: an all-day event does not establish unavailability |
