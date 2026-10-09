# M6 — Forward Coordination: Build Contract

Status: **Proposed**, 2026-10-09 (Package 0, for the owner's approval).

- Nothing here is approved until the owner merges Package 0.
- The owner decisions in §12.2 are recommendations, not approvals.
- Package 1 does not start until the owner says so.

The architecture decisions are recorded in ADR 0009 (`docs/decisions/0009-m6-forward-coordination.md`).

## The product shift

M5 answered **"What matters today?"**. M6 answers **"What's coming up, and what needs a look?"**.

At the end of M6, an adult opening Forward sees the shape of the next 7, 30 or 90 days. They see it without reading a calendar, and without being told how to feel about it:

- **a factual headline** that says what is recorded for the horizon;
- **one row per day, week or month**, showing only what is different from the usual;
- **the usual**, folded away but one tap from view;
- **recorded overlaps**, shown quietly on the items they affect, or listed where those items are not drawn;
- **Dismiss and Not useful** on every observation.

Today gains the same conflicts: on the item for today, and in Worth knowing for the next seven days.

All of it is computed by deterministic code from records the household has already made. Every statement can be traced to records and a named rule. Forward and Today work without Kev. **Nothing here is AI, nothing is guessed, and a missing record is never treated as meaning something** (ADR 0008 §5, §6).

Forward must stay calm. It is anticipation, not an alarm board:

- no red, no counts as warnings and no "needs you" without a recorded fact behind it;
- a quiet stretch is shown as quiet, never as an opportunity HOME has invented.

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
| Forward per the M0 concept (week / month / season) | **Built**, with factual wording and within the exclusions below (§4, §5) |
| Delete `/prototype` (tag `m0.6-prototype` keeps it) | **Built** in Package 1. The tag is on `origin` at `3d58390`. |
| Conflict engine | **Built**: `conflict.overlap`, `conflict.responsible` and `conflict.away` (§5.6). Transport conflicts are not built (§6). |
| `conflict` insights on Today and Forward | **Built** (§5.7) |
| Dismiss / not useful | Dismiss is **kept** from M5 and extended to conflicts. **Not useful is built** (§5.8). |

**Moved into M6 by earlier decisions:**

| Item | Source | M6 decision |
|---|---|---|
| Conflicts | ADR 0008 §3 | As above |
| "Not useful" | ADR 0008 §23 | As above |
| Forward changes | ADR 0008 §3 | As above |
| Sheets | ADR 0008 §25 | **Proposed: defer again**, to M10 design polish (ADR 0009 §23) |
| "Double-booked" and "unassigned" responsibilities in the conflict engine | ADR 0008 §21, SYSTEM-ARCHITECTURE §2.2 | Double responsibility as recorded is **built** (`conflict.responsible`). Unassigned is **not built**: no record says one is needed (§6). |

**From V0.1-SCOPE, not yet delivered:**

| Item | M6 decision |
|---|---|
| Forward: "scheduled tasks" | **Proposed** for Package 1 (ADR 0009 §26) |
| Forward: "conflicts highlighted quietly" | **Built** |
| Forward: "Week Ahead button" | **Not built.** The Week Ahead is Kev's, in M10. |
| "Done" item 2: "Look 30 days ahead and see anything that needs coordinating" | **Built for recorded overlaps.** Coordination that depends on transport is not built (§6). |

**Dependencies on M3–M5, all merged:**

- the agenda loader and engine;
- overnight placement;
- batched annotations;
- calendar default people;
- changed occurrences;
- the regular week;
- the insights engine;
- `dismissInsight`;
- the test time source;
- the refresh-on-use calendars.

**Explicitly excluded:** §1.3.

**Proposed additions, not in the roadmap row:**

- scheduled tasks on Forward (§1.1 above);
- `conflict.away`;
- conflict marks on a person's Coming up.

Each is listed in §12.2 for approval.

### 1.2 Build

| Area | What |
|---|---|
| **Groundwork** | Delete `/prototype` and its exclusions (ESLint, tsconfig, Prettier, `.vercelignore`), and update the runbook lines that name it. One 90-day agenda read for Forward through the existing loader, with a constant query count. The insights engine takes a window instead of a fixed 7 days; Today's output is unchanged. Scheduled tasks as agenda items, if approved. The test time source is read by Forward too. |
| **Forward engine** | `src/domain/engines/forward.ts`: horizons and units; usual or notable; row items and their order; load bands, if approved; The usual; the headline's rule, facts and template. |
| **Conflict engine** | `src/domain/engines/conflicts.ts`: the three rules, identity, deduplication, the standing-overlap rule, order and explanation basis. |
| **Coordination insights** | The `conflict` family in the insights engine. Per-surface listing and on-object marking (§5.7). |
| **Feedback** | Not useful through the existing `respond`. The dismiss service is generalised so that conflicts can be dismissed wherever they are shown (ADR 0009 §19). |
| **Today** | Today's conflicts marked on the affected item, with Why and Dismiss. Conflicts in the next seven days in Worth knowing. Not useful in Why. |
| **Forward screen** | Horizon switch (three links, no JavaScript). Headline with its facts. Worth knowing: two shown, then "+ N more". The shape rows with load marks and conflict marks. The usual. The quiet, first-run and stale states. Tablet and desktop layout. |
| **Coming up** | A person's Coming up shows the same conflict marks on that person's items, if approved. |
| **Tests** | Engine unit tests: rules, boundaries, DST, determinism, traceability, the privacy invariant, the absence rule and forbidden phrases. Two-adult integration tests as `home_app`. Forward e2e at four viewports, with and without JavaScript. Privacy, accessibility and device sweeps extended to Forward. |

### 1.3 Do not build

- **No transport.** M6 has no getting there, no **Who?**, no `coordination_gap`, and no unassigned or double-booked transport. No wording may imply that anyone is taking, collecting or driving anyone, or that a lift is needed (ADR 0008 §21, ADR 0009 §20).
- **No inference** of travel time, transport, availability outside recorded commitments, childcare arrangements, whether someone can attend, or whether anyone is willing to help. Nothing is inferred from age, title, kind (beyond the written rules in §5), location, counts or the absence of a record.
- **No observation built on absence:** no "nothing planned", "worth deciding early", "nobody's down" or "both weekends are clear".
- **No character wording:** no "busy", "easy", "quiet week" as judgement, "packed", "steady", "full" or "free".
- **Nothing from later milestones:**
  - **M7:** weather, free windows, `alignment` and availability.
  - **M8:** Kev phrasing, the Kev bar and long-press "Ask Kev".
  - **M9:** "Sort it", proposals and "look at what could move".
  - **M10:** the Week Ahead, and "Read the week ahead ›".
- **No sheets or swipe**, unless the owner chooses otherwise (ADR 0009 §23).
- **No adaptive ranking, learning or rule suppression** from feedback (ADR 0009 §17).
- **No stored insights, push notifications or background jobs.**
- **No new schema, migration or runtime dependency.**
- **No hour grid, month grid, badges, counters, red, streaks, progress bars, category colours, year view or "+" button.**
- **No per-person filter on Forward.**

---

## 2. Implementation packages

Packages are acceptance boundaries. Each ends with:

- CI green;
- a focused independent review at its stated intensity;
- the owner merging it.

Package *n* starts only after *n−1* has merged. Review intensity follows risk; not every package gets an exhaustive review.

### 2.1 Packages

| # | Package | Objective | Scope | Depends on | Main risks | Builder | Review |
|---|---|---|---|---|---|---|---|
| **0** | **Contract and ADR** | Agree M6's product, rules, architecture, packages and acceptance | This contract, ADR 0009, status lines | M5 merged | Mis-scoping; unapproved decisions read as approved | Opus | Owner approval |
| **1** | **Forward groundwork and engine** | Give Forward its horizons and shape from the shared agenda, as a pure tested engine, with no screen yet | (1) Delete `/prototype` and its exclusions. (2) A 90-day read through the loader, with a constant query count. (3) Insights window parameterised, with Today unchanged. (4) Scheduled tasks as agenda items, if approved. (5) `engines/forward.ts` per §5.1–§5.5. (6) Forward reads the test time source. (7) An explicit timeout on the audit-log scan test (M5-ACCEPTANCE §9). | 0 approved | Today regressing through the shared agenda or insights window; usual and notable misclassifying a changed occurrence; headline wording drifting into character | **Opus** | **Medium.** The engine is pure; agenda changes are additive; Today's suites must pass unchanged. |
| **2** | **Conflict engine** | Deterministic, explainable, private conflicts | `engines/conflicts.ts` per §5.6: the rules, exclusions, identity (pair, standing, away), order and explanation basis. Unit tests at every boundary. The privacy invariant through the real services. Forbidden phrases. A mutation proof. | 1 | Overlap boundaries; noise from recurring pairs or work calendars; one adult's private event creating, changing or counting a conflict for the other; layer-3 wording | **Opus** | **High.** This defines what HOME states as a conflict. |
| **3** | **Coordination insights, feedback and Today** | Conflicts as insights; Not useful; Today integration | The `conflict` family; per-surface listing and on-object marking (§5.7); the generalised dismiss and Not useful service (§5.8); Today's marks, Why, Dismiss and Not useful; two-adult integration tests; Today e2e updated | 2 | A new write variant; eligibility across surfaces; a dismissal leaking across adults; Today regressing | **Opus** | **High.** New user-facing write variant and per-actor content. |
| **4** | **The Forward screen** | Forward per the concept, over reviewed engines | The page, horizon links, headline and facts, Worth knowing (two, then "+ N more"), the rows with load and conflict marks, The usual, states, tablet and desktop, Coming up marks if approved, no-JS, accessibility, devices, the two-adult sweep. Screenshots for the owner. FORWARD.md annotated. | 3 | Forward turning into a dashboard or a calendar; accessibility of marks; the old 30-day list regressing (an item lost) | **Fable** | **Medium.** Presentation over reviewed engines, with privacy and device sweeps extended. |
| **5** | **Acceptance** | Prove M6 against §10 | `docs/m6/M6-ACCEPTANCE.md`: criteria evidence, cross-package checks, scenario screenshots, performance measurement, carry-forwards, DEPLOY.md §E items 18–19, status docs | 4 | Evidence asserted rather than tested | **Opus** | **High, focused** on the acceptance evidence. Settled reviews are not repeated. |

If Package 4 proves too large for one review, it may split into **4a** (Week, and the switch) and **4b** (Month, Season and The usual), decided at its start. That is the only split allowed without an ADR change.

If the owner chooses transport Option B (§6), a migration-first package **1T** is inserted before Package 2, and this contract is amended first.

### 2.2 Per-package acceptance

- **Package 1:**
  - `/prototype` is gone, along with every exclusion and the CLAUDE.md rule-14 deletion clause. The tag `m0.6-prototype` resolves on `origin`.
  - Forward's agenda query count is constant in the number of events. A test proves it.
  - Today's unit, integration and e2e suites pass unchanged. A scheduled task appears once on Today.
  - Every rule in §5.1–§5.5 has boundary tests:
    - units across a month end, a year end and both DST changes;
    - a changed occurrence is notable;
    - a fortnightly series is usual;
    - caps and their "+ N".
  - The engine imports no `db`, `app`, `kev` or clock.
- **Package 2:**
  - Every conflict rule has boundary tests:
    - touching ends;
    - a one-minute overlap;
    - overnight;
    - all-day `travel` on its first and last days;
    - DST;
    - routine and work-pair exclusions;
    - default people;
    - changed occurrences;
    - the standing-overlap rule.
  - Keys are stable across input order and fit `insightKey`.
  - The non-interference invariant holds at unit level and through the real services.
  - Forbidden phrases hold.
  - A mutation proof shows that removing each exclusion or tie-break fails a test.
- **Package 3:**
  - Conflicts appear on Today's items and in Worth knowing as §5.7 says.
  - Not useful and Dismiss are per user, audited, refused while the gate is closed, and idempotent.
  - Feedback changes nothing for the other adult.
  - A crafted, foreign or stale key is refused.
  - Today's no-regression test passes.
- **Package 4:**
  - Scenario e2e at four viewports, with JavaScript on and off.
  - Every agenda item in the 30-day window is reachable from Forward (Month), so nothing is lost from the old list.
  - The accessibility baseline holds.
  - The two-adult sweep covers Forward.
  - The owner approves the headline wording and layout from screenshots.
- **Package 5:** every criterion in §10 is met, with evidence that cites tests.

### 2.3 Verification by package

| Package | While working | Before the PR | Why |
|---|---|---|---|
| 0 | — | Lint, format, typecheck, the private-terms check, CI | Documentation only |
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
| Event people (`attending`, `responsible`), calendar default people, series people for changes | `events` and `calendar`, through `who.ts` | Who is on each occurrence, *as recorded*; the shared person in a conflict; `responsible` for `conflict.responsible` only |
| People (`role`, `in_household`, `date_of_birth`) | `people` | Household people for The usual and routine; birthdays |
| Regular week | `profile.regularWeek` over the loader's events | The usual, and the notable test |
| Tasks (open; due; scheduled) | `tasks` | Due and, if approved, scheduled items |
| Projects (`status`, `target_date`) | `projects` | Target dates on rows |
| Calendars (freshness) | `calendar` | `data_health`, the qualifier, refresh on use |
| Insight responses (own) | `insights.respondedKeys` | Hiding dismissed and not-useful insights |

Forward and conflicts read no context, notes, captures, Kev data or audit records.

### 3.2 Layers

```
domain services (as the actor: visibility, archive, sensitivity applied here)
        │
        ▼
readAgendaInputs + agenda engine (the one placement; 90 days for Forward, 8 for Today)
        │  AgendaDay[] · events · people · tasks · projects · calendars
        ├──────────────► engines/conflicts.ts ─► Conflict[] (rule, key, facts, overlap, people)
        ▼                         │
engines/forward.ts ◄──────────────┤
  (horizon, units, usual/notable, │
   rows, load, headline)          ▼
        │                engines/insights/ (+ conflict family; window; per-surface onObject)
        ▼                         │
Forward page / Today page ◄───────┘  + the reader's own responses (one query)
        │
        ▼
presentational components (no rules)
```

- **Engines are pure.** They take records, the agenda's output, `now` and `timeZone`. They do no I/O, never call `Date.now()`, and use stable sorts with explicit tie-breaks.
- **The conflict engine runs once per request** over the page's window. Today, Forward and Coming up get the same conflicts for the same days from the same function.
- **The page** reads through the shared loader, runs the engines, reads the reader's responses among the keys found (one query), runs them again with those responses, and renders. It holds no rules.

### 3.3 Model shapes (indicative; fixed in Packages 1–3)

```ts
type Conflict = {
  key: string;                       // ADR 0009 §13; fits insightKey
  rule: 'conflict.responsible' | 'conflict.overlap' | 'conflict.away';
  when: IsoDate;                     // home date of the overlap's start (away: the day)
  occurrences: [EventFact, EventFact];
  people: string[];                  // shared visible people, People order
  responsible: string[];             // conflict.responsible only
  overlap: { from: Date; to: Date } | { day: IsoDate };
  standing?: { times: number };      // a standing overlap: how often in the window
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
  - a conflict, its count or its explanation;
  - a load band;
  - a headline count;
  - the order of a list;
  - "+ N more";
  - The usual;
  - Forward's presentation.

  A conflict between a household event and Sam's private event exists for Sam and does not exist for Alex, indistinguishably from no conflict at all. There are no "something private" placeholders.
- **The non-interference invariant** (§8.2) is the proof. It is extended from Today to Forward and conflicts. Adding records only the other adult can see leaves the reader's `ForwardModel`, conflicts, insights and rendered pages identical, for every horizon.
- **Responses are private by `user_id`**, read and written by their owner only. A dismissal or Not useful never changes what the other adult sees. Activity shows `insight_response.respond` to its owner only, with the response kind and never the key.
- **Authority.** The only writes are the reader's own responses, through `respond`, audited and gated. The service re-derives the reader's own insights before writing and refuses any key that is not one of them (§5.8). Kev gains nothing. No source record is touched.
- **Keys** are built from ids, dates and instants only. An event id in a key is one the reader can already see.

### 3.5 Stale, incomplete and absent information

| Situation | Behaviour |
|---|---|
| A visible calendar is stale or failing | `data_health` insight. Every count or absence on Forward is qualified "As far as HOME knows." Refresh on use, as in M4. |
| No calendars and no events at all | The first-run headline and "Connect a calendar ›" |
| A unit with nothing recorded | Drawn, with no mark and "Nothing recorded". Never "free" or "clear". |
| A child's occurrence with nobody recorded | Shown as recorded. No conflict, no mark, no wording about need. |
| An occurrence whose only people the reader can't see | It is the reader's occurrence with nobody on it, so it takes part in no conflict |
| Two overlapping occurrences with no shared recorded person | No conflict |

### 3.6 Determinism and traceability

- **Same input and `now`, same output.** Tested with shuffled inputs, repeated runs and a frozen `now`, for every horizon and both surfaces.
- **Every output carries its `rule` and `facts`.** Headline, rows, marks and insights show their facts in place without JavaScript.

### 3.7 Performance

- **One read.** Forward makes one agenda read plus one query for responses. The query count is constant in events, tasks, projects and calendars, and a test proves it.
- **No LLM and no network on render.** Refresh on use is unchanged.
- **Measured in Package 5:** engines and render over the 90-day Season on the seeded scenarios and on a synthetic 300-event household. Expected well under a second on the dev container, as M5's Today was.
- **Overlap detection** is per home day over at most that day's occurrences (pairwise). The standing rule collapses recurring pairs, so its cost does not grow with the horizon's repeats.

### 3.8 Schema

None (ADR 0009 §4). `insight_response.response` already allows `not_useful`.

---

## 4. The Forward experience

### 4.1 Order (phone)

1. **Horizon switch:** **Week** · Month · Season. Three links with `aria-current`, Week by default.
2. **Headline:** one factual sentence, sometimes two, in the display face. Then "As far as HOME knows." on its own line when qualified, and "What this is based on ›".
3. **Worth knowing:** two at most, then "+ N more". Absent when empty.
4. **The shape:** one row per unit, each with its label, load mark (if approved) and notable items, then "+ N". Conflicts are marked on their items (● with "Why ›").
5. **The usual ›**, collapsed.
6. **"Today ›"**, back to Today.

Empty sections are absent. Spacing and colour are the same on every horizon.

### 4.2 Synthetic examples (fixture family; Wednesday 14 October 2026, 7:03)

Indicative layout and copy. Final copy is approved from screenshots in Package 4.

**Week**

```
[Week]  Month   Season

Seven things in the next seven days, besides the usual.
There are two overlaps.
What this is based on ›

Today     ●    Parent interviews 16:00 · Sam, Alex
Tomorrow  ●●   ● Art club 15:00 · Milo       Why ›
               ● Dentist 15:30 · Milo        Why ›
               + 1
Fri 16    ●    Wellington trip · Sam (Fri–Sat)
Sat 17    ●    Wellington trip · day 2 of 2
               ● Football 9:00 · Milo, Sam   Why ›
Sun 18         Nothing recorded besides the usual
Mon 19         Nothing recorded besides the usual
Tue 20    ●    Nana Jo's birthday

The usual ›
```

- *Rules shown:*
  - `forward.headline.counted` counts the notable occurrences in the seven days, each once (the trip is one), and says the rest is the usual.
  - The second sentence is `forward.headline.conflicts`.
  - Tomorrow's marks are one `conflict.overlap`: Milo is recorded on both occurrences, and they overlap from 15:30 to 16:00. "Why ›" says so.
  - Saturday's mark is `conflict.away`: Sam is recorded on the all-day `travel` event and on Football. Football is in Milo's regular week, so it would be in The usual; it is drawn because it is in a current conflict (§5.2).
- *What it does not say:*
  - "in two places";
  - that Milo can't go, or that anyone needs to take him;
  - who should go to Football instead;
  - that Sunday or Monday is free;
  - that the week is busy.

**Month**

```
Week  [Month]  Season

Nineteen things in the next 30 days, besides the usual.
There are three overlaps.

WORTH KNOWING
● Milo has Art club and Dentist at the same time tomorrow.        Why ›
● Sam is on Wellington trip and on Football on Saturday.          Why ›
+ 1 more

This week        ●●●  Art club Thu · Dentist Thu · + 5
19–25 Oct        ●    Nana Jo's birthday Tue · Back fence target Sat
26 Oct–1 Nov     ●    Labour Day Mon
2–8 Nov          ●    School cross-country Fri
9–12 Nov         ●    Sam's board meeting Mon

The usual ›
```

**Season**

```
Week   Month  [Season]

Thirty-one things over the next 90 days, besides the usual.

▁▃▂▁▂▂▁▂▃▅▆▇▅            (one mark per week; text equivalent available)

OCTOBER     Nana Jo's birthday · Back fence target · + 3
NOVEMBER    Sydney trip (10–12) · School cross-country · + 6
DECEMBER    School ends (16th) · Christmas Day · + 5

The usual ›
```

There is no "worth deciding early" and no "nothing planned for the break". A season row shows only what is recorded.

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
- **Right:** the shape rows.
- **Season on desktop** may show its three months side by side.
- Wider means more context per row, never smaller cells. There is no hour grid and no month grid.

### 4.4 Interactions in M6

| Gesture | Result |
|---|---|
| Tap Week, Month or Season | Its link (`/forward?h=…`), with no JavaScript |
| Tap an item | Its existing full page, as now |
| Tap "+ N" on a row | The row's other notable items, in place (`<details>`) |
| Tap "Why ›" on a conflict or insight | Its rule and records, in place, with Dismiss and Not useful (§5.8) |
| Dismiss | Gone for this adult, for this key, on every surface |
| Not useful | The same as Dismiss, and recorded as feedback |
| The usual › | Each household person's regular week, in place |

Swipe, sheets, long-press and Kev are not built (ADR 0009 §3, §23).

### 4.5 Today in M6

- **Today's conflicts sit on the affected entry:** on the person line, or on the Also today row. They are marked ● and say, for example, "overlaps Art club 15:00". "Why ›" holds the facts, Dismiss and Not useful.
- **The headline is unchanged.** Conflicts do not become headline wording on Today.
- **Worth knowing** adds conflicts from tomorrow to seven days ahead, ranked after `data_health` (§5.7). Not useful sits inside every insight's Why.
- **Everything else on Today is unchanged.** M5's tests keep passing.

### 4.6 Coming up (if approved, ADR 0009 §28)

A person's Coming up shows the same conflict marks on that person's items, with the same keys and the same Why. That is the individual view. Forward stays household-wide.

---

## 5. Rules (deterministic; every one named, traceable and tested)

### 5.1 Horizons and units (`forward.horizon`)

| Horizon | Range (home zone) | Unit | Unit label |
|---|---|---|---|
| `week` | today … today + 6 | day | "Wed 14", with "Today" and "Tomorrow" |
| `month` | today … today + 29 | week, Monday to Sunday; the first runs from today to Sunday | "This week", then "19–25 Oct" |
| `season` | today … today + 89 | calendar month, clipped to the range | "October" |

Every unit in range is drawn. A unit's items are the agenda's items on its days. An occurrence carried over several days is counted once per unit (`occurrenceKey`).

### 5.2 Usual or notable (`forward.usual`, `forward.notable`)

- **Usual:** an unchanged occurrence of a series that is in at least one household person's regular week (`profile.regularWeek`: a plain weekly or fortnightly series with that person on it).
- **Notable:** everything else, which includes:
  - any occurrence in a current, unresponded conflict for the reader, even a usual one, so a conflict is always drawn on its item;
  - one-offs;
  - changed occurrences, which are always notable, because a change from the usual is news;
  - multi-day and all-day events not in the regular week;
  - birthdays;
  - project targets;
  - tasks due;
  - scheduled tasks, if approved.
- **A skipped occurrence** is simply absent. Showing "Swimming isn't on this week" is not built (§12.3).

### 5.3 Rows (`forward.row`)

- **Caps:**

  | Horizon | Shown per unit |
  |---|---|
  | Week | 2 per day |
  | Month | 3 per week |
  | Season | 3 per month |

  The rest are counted ("+ N") and held in place.
- **Order within a unit:**
  1. items with a current conflict for the reader;
  2. birthdays;
  3. multi-day and all-day events;
  4. project targets;
  5. tasks due;
  6. scheduled tasks;
  7. timed items by start;

  then the agenda's order. This is by kind and time, never by importance.
- **Each item** reads as on the agenda (time, title, recorded people) in short form. Week names the time. Month and Season name the weekday or date.

### 5.4 Load bands (`forward.load`; if approved, provisional)

- **What is counted:** notable items in the unit. The usual is not counted.
- **Bands:**

  | Unit | Band 0 | Band 1 | Band 2 | Band 3 |
  |---|---|---|---|---|
  | Day | 0 | 1–2 | 3–4 | 5 or more |
  | Week or month | 0 | 1–4 | 5–9 | 10 or more |

- **Season texture:** one mark per week, from the week bands.
- **How they are drawn:** in ink tones, never the Sun accent, with a text equivalent ("Three things recorded").
- **Status:** code constants, evaluated in the M10 trial, changed only by an ADR amendment.

### 5.5 Headline (closed set; first match wins)

| Rule | Condition | Template (indicative) |
|---|---|---|
| `forward.headline.first_run` | No calendars and no events at all | "HOME doesn't know your calendars yet." |
| `forward.headline.nothing` | Nothing notable and nothing usual in range | "Nothing recorded in the next seven days." |
| `forward.headline.usual` | Only usual items in range | "Just the usual in the next seven days." |
| `forward.headline.listed` | One or two notable items (Week only) | "Parent interviews on Wednesday, then Nana Jo's birthday on Monday." |
| `forward.headline.counted` | Otherwise | "{N} things in the next {seven days \| 30 days \| 90 days}, besides the usual." |
| `forward.headline.conflicts` (second sentence) | Conflicts current for the reader in range, with no response from the reader | "There are two overlaps." / "There is one overlap." |
| `forward.headline.qualified` (qualifier) | `data_health` fires for a visible calendar | "As far as HOME knows." on its own line |

- **Numbers** are words up to ten.
- **Forbidden:** the M5 list (M5 contract §8.1), plus "packed", "steady", "clear", "quiet" (as a judgement), "away" (as HOME's word), "in two places", "clash" (as a claim of impossibility), "double-booked", "can't" and "worth deciding".
- **Facts:** the counted items, or the range and the calendars consulted.

### 5.6 Conflicts (`conflict.*`; ADR 0009 §9–§14)

| Rule | Fires when | Template (indicative) | Facts |
|---|---|---|---|
| `conflict.responsible` | Two overlapping timed occurrences (each starts before the other ends) share a visible person recorded as `responsible` on both | "Alex is recorded as responsible for Swimming and Parent interviews, which overlap on Wednesday from 16:00." | Both occurrences; the people |
| `conflict.overlap` | Two overlapping timed occurrences share a visible person, and `conflict.responsible` does not apply | "Milo has Dentist and Art club at the same time on Thursday." | Both occurrences; the people |
| `conflict.away` | A visible person is on an all-day `travel` event and on another occurrence on a day it covers *(if approved)* | "Sam is on Sydney trip and on Football on Saturday." | Both occurrences; the person |

- **Excluded from all three:**
  - Today's routine occurrences (`routine.regular_week`);
  - pairs where both occurrences are kind `work`;
  - for `away`, a second occurrence of kind `travel`.
- **Shared people** are the people the agenda shows for each occurrence (§3.1). A person the reader cannot see is never on an occurrence for that reader.
- **Standing overlaps:** when both occurrences are unchanged occurrences of plain weekly or fortnightly series, the conflict is keyed on the series pair. It is said at its next occurrence, with the number of times it falls in the window ("…every Wednesday; four times in the next 30 days").
- **Keys:** as ADR 0009 §13.
- **Order:** `responsible`, `overlap`, `away`; then the overlap start; then the key.
- **`when`:** the home date of the overlap start, or of the day for `away`.
- **DST:** overlap is decided on instants. `when` and the wording use the home zone.
- **Never stated:** class C (ADR 0009 §9); the reason for a conflict; locations; who should change; whether either is optional.

### 5.7 Insights on each surface (`insights`)

| Surface | Window | Listed families | On the item, not listed |
|---|---|---|---|
| Today | today … today + 7 | `data_health`, `conflict` (tomorrow onwards), `preparation`, `busy_day` (tomorrow) | Today's conflicts; M5's on-object rules |
| Forward, Week | today … today + 6 | `data_health` | Every conflict, on its row item |
| Forward, Month | today … today + 29 | `data_health`, `conflict` | — |
| Forward, Season | today … today + 89 | `data_health`, `conflict` | — |

- **Ranking:**
  - by family: `data_health`, then `conflict`, then `preparation`, then `busy_day`;
  - then within the family (§5.6);
  - then by date;
  - then by key.

  This is a total order.
- **Shown:** Today shows 3 and Forward shows 2. "+ N more" counts only listed insights that are not dismissed and not marked not useful.
- **Marks:** ● (Sun) for `conflict.*` if approved (ADR 0009 §27); ○ for everything else.
- **Responses:** any response (`dismissed` or `not_useful`) hides that key for that reader everywhere: lists, item marks, counts and the headline's conflicts sentence.

### 5.8 Dismiss and Not useful (`insight_response`)

- **One service:** `respondToInsight(actor, key, response, surface, now, timeZone)`, generalising `dismissInsight`. It runs these steps in order:
  1. Gate, then actor (before any read).
  2. Key schema.
  3. Re-derive the reader's own insights over 90 days.
  4. Accept the key if it is a current conflict, or current and listable on the named surface; otherwise refuse with `not_eligible`.
  5. If the same response already exists, return without writing anything.
  6. Otherwise `respond(actor, key, response)`: an upsert, audited.
- **Not useful** sits inside Why, after the facts, as a quieter secondary button. Dismiss stays on the surface. Both are no-JS forms.
- **Neither changes any rule, threshold or ranking.** `not_useful` rows are reviewed deliberately, by each adult from their own export, in the M10 retrospective. Kev does not read them.
- **Midnight:** a key that changed overnight is refused, as in M5 (M5-ACCEPTANCE §9). Reloading shows the current list.

---

## 6. Transport responsibility: the owner decision (ADR 0009 §20)

`event_person.role = 'responsible'` records responsibility for an event, not transport (ADR 0008 §21). Nothing records that someone needs getting there or home, travels independently, has nobody assigned yet, or doesn't need transport. Without such a record, "unassigned pickup" is absence, and absence proves nothing.

**Records a transport model would need:**

| Record | Meaning |
|---|---|
| Getting someone there | Who takes the person to it |
| Getting someone home | Who collects them |
| Independent travel | Makes their own way |
| Not yet assigned | Needs someone; nobody recorded |
| Not applicable | No transport involved |

**The options compared:**

| | **A. No transport model in M6** | **B. Minimal structured model in M6** | **C. Defer to a later milestone** |
|---|---|---|---|
| **What it means** | Coordination is restricted to existing explicit facts, and the getting-there promise is withdrawn from V0.1 | A per-event (and per-series) `getting_there` field (`needed` \| `own_way` \| `not_applicable`, null = unknown) and two `event_person` roles (`takes`, `collects`) | M6 behaves as A. The transport record stays planned and is decided at M9 planning, with real-use evidence. |
| **Product value** | Recorded overlaps only. The concept's most recognisable gap ("nobody's down for pickup") is never possible. | The highest: unassigned and double-assigned getting there become facts, and Who? becomes possible. But only if someone records them, for every relevant event or series. | As A in M6. The full value arrives once Kev can record it from conversation ("I'll grab Isla at 3"), with no form to fill in. |
| **Data model** | None | One additive column and two enum values (text + `CHECK`, additive). Series-level defaults with per-occurrence changes, mirroring ADR 0007 §46. Export version bump. | None now. B's design is kept as the starting point. |
| **Privacy** | No change | Transport inherits its event's visibility, as `event_person` does, so no new boundary. A private event's transport stays private. | No change now |
| **UX complexity** | None | A new choice on every child's event; series versus occurrence editing; a Who? chip; an unknown state that must never read as a need. Risk of data-entry work, against principle 7. | None now |
| **Migration** | None | **Required.** Migration-first, in its own package (1T), merged and run in Production before code needs it. | None now |
| **Implementation and review** | Lowest | About two extra packages at high review: migration, then service, UI, the getting-there engine and a `coordination_gap` detector. Instant-only collision rules, because travel time can't be inferred. | Lowest now |
| **Future Kev** | Kev can talk about overlaps only. Transport lives in notes and context, unstructured. | Kev (M9) proposes `event_person.set` with `takes` or `collects`, a clean structured target. | Same as B, once built. M9 is designed with the record in view. |

**Recommendation: C.** Reasons:

- M6 is already high risk.
- There is no real-use evidence yet that the household would keep transport records current; the gate is closed and M1 and M3–M5 acceptance are open.
- Principle 7 warns against features that are mostly data entry, and B is mostly that until Kev can propose the records.
- The model can be added later without restructuring, because enums are text + `CHECK` and annotations are separate rows.

C differs from A in one way: the commitment is kept and re-decided at a named point, not withdrawn. **This is the owner's decision; nothing in M6 assumes it.**

---

## 7. Environments and data

- **Local and CI:** the seeded fixture family. Forward scenarios are seeded in `home_test` only, using the M5 scenario harness (held records, a fixed date): an ordinary week, a month with overlaps, a season, quiet, first run, stale, and a standing overlap.
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
  - multi-day `travel`, on its first and last days;
  - units across a month end, a year end and both Pacific/Auckland DST changes;
  - caps ±1;
  - load bands ±1;
  - a changed occurrence of a usual series;
  - fortnightly cadence;
  - default people;
  - series people on a change.
- **Determinism:** shuffled input, repeated runs, frozen `now`, every horizon.
- **Traceability:**
  - every output has a known rule;
  - every rule is documented in §5;
  - every non-absence output has facts that resolve to input records.
- **The absence rule:** in scenarios with missing people or responsibility, or nothing recorded, no output asserts need, arrangement, availability or reassurance.
- **Forbidden phrases:** §5.5's list over every template and rendered string. Household titles shown as recorded are exempt.
- **Import boundaries:** no `db`, `app`, `kev`, `ui`, `integrations` or clock.

### 8.2 The privacy invariant (unit and integration)

For each adult, add records only the other adult can see:

- a private event overlapping a household event;
- a private `travel` event;
- private people on household events;
- private tasks and projects;
- a private stale calendar;
- the other adult's responses.

The reader's conflicts, insights, `ForwardModel` for every horizon, Today model, and rendered Forward and Today pages must be identical before and after. The same records must change the other adult's own. This runs through the real services as `home_app`.

### 8.3 Integration (as `home_app`)

- **Dismiss and Not useful are:**
  - per user;
  - audited, with the response kind only;
  - idempotent, with no second audit row;
  - refused while the gate is closed, before any query;
  - refused for crafted, foreign, stale and unlistable keys.
- **A response on one surface hides the key on the others** for that adult only.
- **Forward's query count** is constant.

### 8.4 End to end (Playwright, seeded scenarios)

- The Forward scenarios at four viewports, with JavaScript on and off: the horizon links, "+ N", Why, The usual, Dismiss and Not useful.
- **No regression:** every item the old 30-day Forward showed is reachable from Month.
- **Today:** conflict marks, Worth knowing conflicts and Not useful. M5's Today specs keep passing.
- **The two-adult privacy sweep** extended to Forward.
- **Accessibility baseline:**
  - axe;
  - headings and landmarks;
  - focus;
  - 44px targets;
  - no information by colour alone (marks have text);
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
| 2 | **Determinism.** Engines are pure. The same input and `now` give identical output regardless of input order. Ranking is a total order. | Determinism tests; import-boundary test |
| 3 | **Explainability.** Every headline, mark and insight carries its rule and records, and shows them in place without JavaScript. A conflict's Why names both occurrences, their times, their people and the overlap. | Traceability tests; no-JS e2e |
| 4 | **Privacy.** No conflict, count, band, list, ranking, explanation or presentation for one adult reflects anything only the other adult can see. Responses are per user. | §8.2 invariant (unit and integration); two-adult sweep |
| 5 | **No unsupported inference.** No transport, need, availability, attendance, willingness, childcare, travel time, location, character or reassurance. No class C output. No statement built on absence. | Forbidden phrases; absence-rule tests; review checklist |
| 6 | **Cross-screen consistency.** The same conflict has the same key, wording and facts on Today, Forward and Coming up. A response on one hides it on all, for that adult. Forward's items for a day equal the agenda's items for that day. | Shared-engine tests; e2e across surfaces |
| 7 | **Healthy quiet.** A unit with nothing recorded says so without judgement. No insight appears without a firing rule. Forward lists at most two, and Today at most three. "+ N more" counts only genuine, unresponded insights. | Scenario and insight tests |
| 8 | **Accessibility.** The axe baseline is clean at four viewports. Everything is keyboard reachable. Targets are 44px. Marks have text equivalents. Nothing relies on colour alone. | Device and accessibility e2e |
| 9 | **Performance.** Forward's query count is independent of record counts. No LLM or network on render. Render and engine time over 90 days are measured and recorded. | Query-count test; Package 5 measurement |
| 10 | **Reliability.** Forward and Today work with Kev absent and with no calendars. A failing or stale calendar is said, not hidden. No flaky time-dependence: `now` is injected. | Scenario e2e; the test time source |
| 11 | **Scope.** No transport, weather, Kev, proposals, sheets (unless approved), stored insights, notifications, background jobs, adaptive ranking, new schema or new runtime dependency. `/prototype` is deleted. | Review checklist; `package.json` diff; no migration |
| 12 | **Production gate.** `HOME_REAL_DATA` stays closed. No real data or calendar is used. Responses are refused while it is closed. The M1 and M3–M5 operational items remain open and are not marked complete. | Gate tests; DEPLOY.md §E unchanged except the new rows; acceptance doc |
| 13 | **Family usefulness (synthetic).** On the scenarios at phone width, the switch, headline and Worth knowing are above the fold. The owner confirms from screenshots that the shape of a week and a month can be read in a few seconds, and that nothing reads as an alarm (concepts README design tests 2, 4, 7). | Screenshot evidence; owner review in Packages 4 and 5 |
| 14 | **Handover.** Each package had its stated review. Every Blocker and Important finding was fixed before merge. Carry-forwards are recorded. | Package reviews; M6-ACCEPTANCE |

### 10.2 Operational acceptance (real family use, after the gate opens)

These are proposed as DEPLOY.md §E items, added in Package 5:

- **18. Forward on a real week:**
  - each adult opens Week and Month;
  - the rows match what is recorded;
  - nothing private to the other adult appears;
  - a real overlap, if any, is marked with correct facts;
  - Dismiss and Not useful work and stay one adult's.
- **19. The anticipation check:** the owner confirms, on their own phone, that the coming week and month can be understood at a glance without alarm, noting anything that reads wrong. Usefulness itself, including whether conflicts are worth their marks, is evaluated in the M10 trial, together with the `not_useful` review.

M6 is fully accepted only when both technical and operational acceptance are recorded.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Conflicts read as alarms | Factual templates; a quiet mark; caps; Dismiss and Not useful; a high-intensity review of Package 2 |
| Noise from recurring pairs, work calendars or default people | The standing-overlap key; the work-pair and routine exclusions; measured on scenarios; noise reported through Not useful in the trial |
| Three-way clusters producing three pairs | Caps and row placement. Merging is recorded for the M10 trial if needed. |
| Private records shaping the other adult's view | Services filter first; the invariant at unit and integration level; the two-adult sweep |
| Character wording creeping into headlines | A closed template set; the forbidden list; owner screenshot approval |
| "The usual" meaning differs between Today and Forward | Recorded (ADR 0009 §21) and explained in each headline's Why |
| The roadmap's getting-there promise stays unmet | The transport decision (§6) kept explicit, with a named point to revisit |
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

### 12.2 Proposed (owner approval required; none approved)

| ADR 0009 § | Decision | Recommended |
|---|---|---|
| 20 | Transport model | **C. Defer**; M6 uses explicit facts only; re-decide at M9 planning |
| 21 | The usual on Forward = the regular week (all kinds) | Yes |
| 22 | Load marks and the Season texture, with provisional bands | Build |
| 23 | Sheets and swipe | Defer to M10 polish |
| 24 | `conflict.away` | Build |
| 25 | "Both adults away" | Not in M6 |
| 26 | Scheduled tasks on Forward | Yes, Package 1 |
| 27 | "Worth knowing" on Forward; ● for conflicts only | Yes |
| 28 | Conflict marks on a person's Coming up | Yes |
| 29 | Package plan (§2) | As proposed |
| 9–14, 17–19 | Conflict rules, identity, Not useful semantics, cross-surface dismissal | As written |

### 12.3 Considered and not proposed

| Item | Why not |
|---|---|
| "A task is due before an upcoming event" | No record links a task to an event. Linking them by person or title would be inference. |
| "Unassigned responsibility" without a transport record | Absence (ADR 0008 §6) |
| Showing skipped occurrences ("Swimming isn't on this week") | A new agenda item kind. The series page already shows skips. Revisit in the M10 trial. |
| Merging overlap clusters | Pairwise is simpler to explain. Revisit with evidence. |
| Adaptive ranking from Not useful | ROADMAP "Not yet"; ADR 0009 §17 |
