# M7 — Weather and Free Windows: Build Contract

Status: **Proposed**, 2026-10-11 (Package 0, in review). The owner's decisions are open in §12.2; this contract is approved, as amended by them, when the owner merges Package 0.

- **Progress:** nothing is built. Package 1a (the forecast table, migration only) starts only after Package 0 merges and the owner says to start.

The architecture decisions are recorded in ADR 0011 (`docs/decisions/0011-m7-weather-and-free-windows.md`).

**Where the owner's twelve deliverables are:**

| # | Deliverable | Section |
|---|---|---|
| 1 | Product definition: what a parent can do | The product shift |
| 2 | Scope and non-goals | §1 |
| 3 | Architecture options and recommendation | §3.1 (and §3.2–§3.9) |
| 4 | Weather provider assessment | §6 |
| 5 | Free-window (gap) rules | §5.4, §5.5 |
| 6 | Opening rules | §5.6, §5.7 |
| 7 | Privacy and data boundaries | §3.5 |
| 8 | UX placement, including first-run, partial, error and no-JS states | §4 |
| 9 | Package plan, with risk, verification and acceptance per package | §2 |
| 10 | Contract test matrix | §8.6 |
| 11 | Open product decisions for the owner | §12.2 (D1–D19) |
| 12 | The ADR | ADR 0011 |

Performance is §3.8, the acceptance criteria §10, and the production gate §7.

## The product shift

M6 answered **"What's coming up, and what needs a look?"**. M7 answers **"What is the weather doing, and where is nothing recorded?"**

At the end of M7, an adult can:

- **read the forecast in words**, beside what is recorded:
  - on Today, one sentence: "Looks dry until midday, then showers possible.";
  - on Forward's Week, a short phrase on each day: "Looks dry", "Rain likely".
- **see where nothing is recorded** for the household on a weekend day, as exactly that: "Nothing is recorded for the household on Sunday, 08:00–19:30.", with the forecast for it when there is one.
- **see a waiting task matched to such a stretch**, when the family recorded the task with an estimate and a need for dry weather or daylight: "Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry."
- **open "Why ›"** on any of them and see the evidence: the commitments either side, who it covers, each calendar and when it last updated, daylight, the forecast hours and when the forecast was fetched, and the limit of what HOME can see.
- **Dismiss** or mark **Not useful**, as on every other insight.

All of it is computed by deterministic code from records the household has made, a fetched forecast and a computed sunrise. Today and Forward work without Kev, and without weather.

**M7 never says that anyone is free or available.** It says what is recorded and what the forecast says, with their times and their limits. It never says a time is good, best or suitable, never suggests what anyone should do, never creates or schedules a task, and never writes anywhere outside HOME.

Authoritative references:

- `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md` and `docs/BRAND.md`;
- `docs/concepts/TODAY.md`, `docs/concepts/FORWARD.md` and `docs/concepts/README.md`;
- `docs/SYSTEM-ARCHITECTURE.md` §2.2, §2.4 and §2.6, and `docs/FAMILY-DATA-MODEL.md`;
- `docs/decisions/0001–0011`;
- the M3–M6 contracts, whose rules continue;
- `docs/runbooks/`.

Where this contract narrows or defers part of those documents, ADR 0011 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1–M6

- **Status of earlier milestones:**
  - **M6** is technically accepted on synthetic data. Its operational acceptance waits on DEPLOY.md §E items 18–19.
  - **M5's** operational acceptance waits on items 16–17, and **M4's** on items 12–15.
  - **M3's** owner acceptance waits on the restore rehearsal (items 7–8).
  - **M1** is deployed but not accepted (items 1–6).
  - None of these blocks M7 *development*. M7 is built and tested on synthetic data in local, CI and Preview.
- **The Production real-data gate stays closed.** M7's writes are the forecast refresh (§5.1) and Dismiss and Not useful. All three are refused in Production while `HOME_REAL_DATA` is not exactly `open`.
- **M1–M6 guarantees stay in force, unchanged:**
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
  - the forbidden-phrase lists of M5 and M6, and their tests;
  - Today's and Forward's rules, and the non-interference invariant;
  - conflict identity and the response lifecycle.
- **M7 builds on the shared agenda.** `readAgendaInputs`, `loadAgenda` and the agenda engine stay the one place items are placed and expanded (ADR 0011 §9). No second read.

---

## 1. Scope

### 1.1 What the roadmap commits M7 to

**Committed** (ROADMAP M7 row):

| Commitment | M7 decision |
|---|---|
| Open-Meteo adapter | **Built** behind a HOME-defined `WeatherProvider`, with a fake provider for tests (§5.1; D1) |
| `windows` engine (people × calendar × daylight × weather × duration) | **Built** as the gap engine (people × calendar) and the opening composition (× daylight × weather × duration) (§5.4–§5.6) |
| `free_window` insight | **Built** as `open_window`, worded as "nothing is recorded", never "free" (§5.6) |
| `weather_effect` insight | **Folded into task openings** (D18): a dry-weather task's opening appears and disappears with the forecast. No outdoor-event rule. |
| `alignment` insight | **Deferred** (D17): unknowable to either adult without leaking the other's private time |

**Moved into M7 by earlier decisions:**

| Item | Source | M7 decision |
|---|---|---|
| Today's weather line | ADR 0008 §20 | **Built** (§4.1) |
| "Weather, free windows, `alignment`, availability" | ADR 0009 §3; M6 contract §1.3 | Weather and windows **built**; `alignment` deferred; **availability is never stated** (ADR 0011 §5–§7) |

**From V0.1-SCOPE, not yet delivered:**

| Item | M7 decision |
|---|---|
| Today: "a one-line weather note" | **Built** |
| "Deterministic engines: … free windows (daylight + weather)" | **Built** (§5.3–§5.6) |
| "Weather for home location" | **Built** (§5.1; D2) |
| Insights: "free windows, weather effects, … alignments" | Openings built; weather effects folded; alignments deferred |
| "Done" item 4: "Ask 'When could I realistically get that done?' and get a specific, correct window with a reason" | **The engines are built; the question is Kev's, in M8.** M7's openings are the deterministic ground M8 will cite. |
| Kev quality bar: "free-window recommendations always valid" | M8. M7's engines are the ones those recommendations must come from. |

**Dependencies, all merged:**

- the agenda loader and engine, overnight placement, batched annotations and calendar default people;
- changed and skipped occurrences;
- the insights engine with its window, `listed` and `shown`;
- `respondToInsight` and the response surfaces;
- the test time source;
- refresh on use and calendar health (`unhealthyCalendars`);
- task `estimate_minutes` and `needs` (migration `0004`), already editable.

**Explicitly excluded:** §1.3.

**Approved additions, not in the roadmap row:** none proposed.

### 1.2 Build

| Area | What |
|---|---|
| **Forecast table** | `weather_forecast` (§3.9), in a migration-only package (1a) |
| **Weather boundary** | `WeatherProvider` in the domain; the Open-Meteo adapter; a fake provider; the composition root `integrations/weather/entry.ts` and its ESLint exception; a second `safe-fetch` policy |
| **Forecast service** | Read the cache as an actor; refresh it (gated, single-flight, audited); keep the last good forecast on failure |
| **Refresh on use** | `POST /weather/refresh` and its client, after render, at most once an hour |
| **Configuration** | `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` in `env.ts`, rounded; a boot line; logger redaction |
| **Engines** | `daylight.ts`; `weather.ts` (bands, phrases, sentences); `gaps.ts` (gaps and coverage); the `open_window` family in `engines/insights/` |
| **Insights and responses** | `open_window` listed on Today and Forward Week, after every existing family; `respondToInsight` accepts it |
| **Today** | The weather sentence and its Why, the credit link, the stale line, at most one opening |
| **Forward Week** | A day phrase on each day, the credit line, up to two openings |
| **Tests** | Engine unit tests (bands, daylight, gaps, coverage, openings, identity, DST, determinism, forbidden phrases); adapter contract tests; `safe-fetch` policy tests; the privacy invariant through the real services; integration tests as `home_app`; e2e at four viewports with and without JavaScript |

### 1.3 Do not build

- **No availability.** M7 never says or implies that anyone is free, available, able, around or "out". No "nothing on", "everyone can", "both free", "a good time", "you could", "should", "best" or "room for".
- **No inferred availability:** nothing is inferred from empty space, from a title, kind, location or age, or from the absence of a record.
- **No travel:** no travel time, transport, buffers, distance or location reasoning.
- **No weather suitability:** weather never decides that a time is good or bad for anything. It is a sentence, or a filter the family recorded on a task.
- **No LLM recommendations,** no Kev tools, no Kev phrasing (M8).
- **No writes outside HOME:** no calendar writes, no booking, no messages.
- **No automatic tasks:** no task created, scheduled or changed; no proposals (M9).
- **No learning:** nothing is learned from responses, use or dismissals; no adaptive ranking; no implicit preferences (ADR 0009 §17).
- **No real data:** no real household data or home location in docs, tests, fixtures, seeds, screenshots or logs (CLAUDE.md rule 9).
- **No severe-weather warnings** (D7).
- **No `alignment`** and no "both adults" statements (D17).
- **No outdoor-event weather rule:** no record says an event is outdoors (D18).
- **No weather or openings on Month, Season or a person's Coming up** (D16). No weather icons, temperature tables, charts, hourly strips or a weather screen.
- **No settings:** no planning-hours or location screen, no `user.preferences`, no per-person filter.
- **No push notifications, background jobs or stored insights.**
- **No new runtime dependency.** One new table and nothing else in the schema.
- **Nothing from later milestones:**
  - **M8:** Kev, `find_free_windows`, `get_weather`, cached phrasing.
  - **M9:** capture triage, proposals, `propose_schedule_task`, "Sort it".
  - **M10:** the Week Ahead, sheets.

---

## 2. Implementation packages

Seven packages, numbered 0, 1a, 1b, 2, 3, 4 and 5 (D19). Packages are acceptance boundaries. Each ends with:

- CI green;
- a focused independent review at its stated intensity;
- the owner merging it.

Package *n* starts only after the one before has merged and the owner says to start. **Migration-first:** Package 1a's migration runs in Production (**Migrate production database**, owner-approved) and in Preview before Package 1b merges; 1b's description links the run.

### 2.1 Packages

| # | Package | Objective | Scope | Depends on | Main risks | CI tier (ADR 0010) | Builder | Review |
|---|---|---|---|---|---|---|---|---|
| **0** | **Contract and ADR** | Agree M7's product, rules, architecture, packages and acceptance | This contract, ADR 0011, status lines, dated annotations | M6 merged | Availability wording creeping in; decisions left implicit | Low (docs) | Opus | Owner approval |
| **1a** | **Forecast table** | Put the schema in Production first | `weather_forecast` migration and Drizzle definition; grants; export exclusion with its reason; migration, privilege and export-completeness tests; FAMILY-DATA-MODEL entry. No application code that needs it. | 0 | A non-additive change; a column that later holds the location; export drift | **Critical** | Opus | **High.** Schema, grants and the previous-schema check. |
| **1b** | **Weather** | A trustworthy, private, cached forecast with no screen | `WeatherProvider`; Open-Meteo adapter and its contract test; fake provider; `openMeteoPolicy` in `safe-fetch` with per-policy headers and `rate_limited`; forecast service (read, refresh, single-flight, gate, audit, retention); `POST /weather/refresh` and its client; `env.ts` location with rounding and the boot line; logger redaction; `weather.ts` bands and phrases; `daylight.ts`; the second ESLint exception | 1a merged **and migrated in Production and Preview** | The home location leaking (logs, URL, DB, client); the calendar fetch boundary weakened; fetch on render; DST errors from provider local times; hammering the provider | **Critical** (env, ESLint config) | Opus | **High.** Re-opens the `safe-fetch` boundary; a new outbound host; a new Production setting. |
| **2** | **Gap engine and coverage** | Deterministic, private, explainable "nothing recorded" | `engines/gaps.ts` per §5.4–§5.5: scopes, blocking, the no-household-person rules, today's clipping, keys, coverage; the privacy invariant through the real services; DST, zones, overnight, recurrence; forbidden phrases; a mutation proof | 1b | A gap that hides a recorded commitment; private timing reaching the other adult; keys that move every minute; all-day and unassigned events handled wrongly | High (an unmapped engine fails closed to high; insights will import it) | Opus | **High.** This defines what HOME states as "nothing recorded". |
| **3** | **Openings** | Openings as an insight family, with stable identity and responses | `open_window` per §5.6–§5.8: candidates, weekend rule, task matching, templates, keys, lifecycle, ranking, per-surface caps, `listed` sets, `respondToInsight`, Fact kinds and Why data; two-adult integration tests; no screen change | 2 | Wording drifting into suitability or availability; keys churning with the forecast; a response leaking across adults; openings displacing M5/M6 insights | High | Opus | **High.** A new insight family on an existing write path. |
| **4** | **The screens** | Weather and openings on Today and Forward Week, calm and complete | Today's sentence, Why, credit and stale line; Forward Week's day phrases and credit line; openings in Worth knowing; every state in §4.4; no-JS; four viewports; accessibility; screenshots for the owner; TODAY.md and FORWARD.md annotated; BRAND.md credit line | 3 | Today's first screen crowded; weather turning into a widget; the credit link missing where words appear; the accent misused | Medium or High, as the classifier decides (shared `_insights` and UI) | **Fable** | **Medium.** Presentation over reviewed engines; privacy and device sweeps extended. |
| **5** | **Acceptance** | Prove M7 against §10 | `docs/m7/M7-ACCEPTANCE.md` and its matrix; scenario screenshots; performance measurements; carry-forwards; DEPLOY.md §E items 20–22 and the environment rows; status docs | 4 | Evidence asserted rather than tested | **Critical** | Opus | **High, focused** on the evidence. Settled reviews are not repeated. |

If Package 1b proves too large for one review, it may split into **1b-i** (provider, adapter, `safe-fetch`, env, logger) and **1b-ii** (service, route, client, engines), decided at its start. That is the only split allowed without an ADR change.

### 2.2 Per-package acceptance

- **Package 1a:**
  - The migration is additive and creates only `weather_forecast`; the previous-schema check passes.
  - `home_app` can select, insert and update it (default privileges) and the integration privilege test proves it.
  - It has no location, coordinate or user column (a schema test asserts the column list).
  - Export completeness lists it as excluded, with its reason.
  - FAMILY-DATA-MODEL has the entry.
- **Package 1b:**
  - Matrix rows W1–W18 and P4–P8 pass.
  - The adapter's request is exactly §5.1's; the contract test fixes the normalisation of preceding-hour values.
  - No test, fixture or log contains anything but the synthetic point; a redaction test covers every new key.
  - The refresh is reachable only through the route; no page or service calls the provider while rendering.
  - The calendar `safe-fetch` suite passes unchanged.
  - Daylight is within one minute of the NOAA reference table for the synthetic point on every reference date.
- **Package 2:**
  - Matrix rows G1–G25 pass at unit level, and P1 holds for gaps and coverage through the real services.
  - Keys are stable across input order and fit `insightKey`.
  - A mutation proof: removing the unassigned rule, the all-day exception, the household filter, the clipping identity or a tie-break each fails a test.
- **Package 3:**
  - Matrix rows O1–O26 and P2–P3 pass; O23 through the real services.
  - Every template and rendered string passes the M5, M6 and M7 forbidden lists.
  - M5's and M6's insight suites pass unchanged except where an opening is now listed, and every such change is named in the PR.
- **Package 4:**
  - Matrix rows W19, X1, X4–X7, X9 and X12 pass, at four viewports, with JavaScript on and off.
  - On a phone, Today's headline, weather sentence and first Worth knowing row are on the first screen.
  - The credit link is present wherever forecast words are, and nowhere else.
  - The two-adult sweep covers Today and Forward Week with openings.
  - The owner approves the wording and layout from screenshots.
- **Package 5:** every criterion in §10 is met, with evidence that cites tests.

### 2.3 Verification by package

| Package | While working | Before the PR | Why |
|---|---|---|---|
| 0 | — | Prettier, lint, typecheck, unit tests, CI | Documentation only |
| 1a | `pnpm verify:focused` | **Full `pnpm verify`** + `pnpm check:previous-schema` | Schema and grants |
| 1b | `pnpm verify:focused` | **Full `pnpm verify`** | Env, ESLint config, `safe-fetch`, a new route |
| 2 | `pnpm verify:focused` | `pnpm verify:focused` + CI | A pure engine; its integration invariant runs in CI |
| 3 | `pnpm verify:focused` | **Full `pnpm verify`** | A new family on the response write path; Today and Forward data |
| 4 | `pnpm verify:focused` | **Full `pnpm verify`** | Seeded e2e scenarios, devices and the privacy sweep |
| 5 | — | **Full `pnpm verify`** + CI | Milestone evidence |

**CI tiers.** The new engines (`gaps.ts`, `daylight.ts`, `weather.ts`) match no rule in `scripts/ci-select.mts`, so they are high by failing closed, which is also what ADR 0010 §8 requires of engines the insights engine imports. No classifier change is proposed. `src/integrations/weather/` and `src/domain/weather/` are high; `env.ts`, `eslint.config.mjs`, the schema and migration, the acceptance document and DEPLOY.md are critical.

**Settled reviews are not repeated:** auth, CSP, the M4 sync model, M5's Dismiss path and M6's response service. Package 1b **re-opens the `safe-fetch` boundary** for its second policy, and Package 3 re-opens the response service's eligibility for one new family; nothing else.

---

## 3. Architecture

### 3.1 Options and recommendation

**Where the forecast lives, and when it is fetched:**

| | **A. A table, refreshed on use (recommended)** | B. No table: in-memory or framework fetch cache | C. Fetch while rendering |
|---|---|---|---|
| Rendering | Reads one row; never waits on the network | Each serverless instance starts empty, so a cold one fetches on render | Waits on the provider every time |
| Determinism | The same row for both adults and every instance | Depends on which instance answered | Depends on the provider at that moment |
| Failure | The last good forecast is kept, with its time | Lost with the instance | The page has no weather |
| Provider load | At most one request an hour, by attempt | Once per instance per expiry | Once per page view |
| Cost | One additive table (migration-first) | None | None |
| Fits M6 §3.7 ("no network on render") | **Yes** | No | No |

**How gaps are computed:**

| | **A. Per reader, from what the reader can see (recommended)** | B. Household-wide, as a system actor over both adults' records | C. Per reader, plus anonymous "something recorded" blocks from the other adult's private events |
|---|---|---|---|
| What a gap means | "Nothing is recorded that you can see" | "Nothing is recorded at all" | Nearer to "nothing at all" |
| Privacy | Non-interference holds | **Breaks it**: a gap's absence or shape reveals private timing | A new disclosure of private time, which needs its own owner decision |
| Wording it supports | "Nothing is recorded …", with the limit in Why | Would tempt "free" | Would tempt "both free" |
| In M7 | **Chosen** | Rejected | Not proposed (D17) |

**How openings are presented:**

| | **A. An insight family on existing surfaces (recommended)** | B. A "find a window" screen with inputs | C. Kev answers "When could I…?" |
|---|---|---|---|
| Fits | Insights, not interruption; Worth knowing; Dismiss and Not useful | A form-driven tool, close to a dashboard | Kev, M8 |
| In M7 | **Chosen** | Not proposed | M8, over these engines |

**Daylight:** computed locally (recommended; ADR 0011 §18), rather than taken from the provider, whose sunrise is astronomical anyway, computed at the grid cell's centre with a fixed offset that ignores DST.

**Recommendation:** A in each case, as ADR 0011 records.

### 3.2 Source data (all read as the actor)

| Source | Service | Used for |
|---|---|---|
| Events: manual and synced, occurrences, changes, overnight, all-day | `events`, through `readAgendaInputs` (already loaded by the page) | What blocks a gap |
| Event people (`attending`, `responsible`), calendar default people, series people for changes | `events` and `calendar`, through `who.ts` | Whose scope an occurrence blocks |
| People (`in_household`) | `people` | The household scope; "who it covers" |
| Tasks (open; `estimate_minutes`, `needs`, `scheduled_*`, `assignee_person_id`, `due_date`) | `tasks` (the full records are in `AgendaInputs.records.tasks`) | Scheduled tasks block; task openings |
| Projects (`status`) | `projects` | A task in a `paused` or `done` project is not matched |
| Calendars (freshness) | `calendar` | Coverage; the qualifier; the Why |
| The forecast | `weather.readForecast(actor)`: one query | Words, phrases, openings |
| The home location (rounded) | `env.ts`, through the weather service | Daylight; the refresh request |
| Insight responses (own) | `insights.respondedKeys` | Hiding openings with a response |

M7 reads no context, notes, captures, Kev data or audit records.

### 3.3 Layers

```
domain services (as the actor: visibility, archive, sensitivity applied here)
        │
        ▼
readAgendaInputs + agenda engine (one placement; 8 days for Today, 90 for Forward and responses)
        │  AgendaDay[] · events · people · tasks · projects · calendars
        │
        ├──────────────► engines/gaps.ts ─► Gap[] + Coverage (per scope, per day)
        │                        │
weather.readForecast(actor) ─────┼──► engines/weather.ts ─► bands, phrases, Today's sentence
        │  (one row; no network) │
rounded home point ─► engines/daylight.ts ─► sunrise, sunset per day
        │                        ▼
        └──────────► engines/insights/ (+ open_window: candidates, matching, wording, keys)
                                 │
Today / Forward Week ◄───────────┘  + the reader's own responses (one query)
        │
        ▼
presentational components (no rules)  ──after render──►  POST /weather/refresh (at most hourly)
```

- **Engines are pure.** They take records, the agenda's output, the forecast hours, daylight, `now` and `timeZone`. They do no I/O, never call `Date.now()`, and use stable sorts with explicit tie-breaks. They import no `db`, `app`, `kev`, `ui` or `integrations`.
- **The gap engine runs once per request** over the page's days. Today, Forward and `respondToInsight` get the same gaps, with the same keys, from the same function.
- **The page** reads through the shared loader, reads the forecast row, runs the engines, reads the reader's responses among the keys found (one query), and renders. It holds no rules. After rendering, the refresh client may ask for a refresh.

### 3.4 Model shapes (indicative; fixed in Packages 1b–3)

```ts
type ForecastHour = {
  start: Date;                          // UTC; the hour is [start, start + 1h)
  temperatureC: number | null;
  precipitationMm: number | null;       // during this hour
  precipitationProbability: number | null; // 0–100, for this hour
  windKmh: number | null;
  gustKmh: number | null;               // the hour's maximum
};
type Forecast = { provider: 'open_meteo'; fetchedAt: Date; hours: ForecastHour[] };
type ForecastAge = 'fresh' | 'older' | 'unusable';
type Band = 'dry' | 'showers' | 'rain';

type Daylight = { date: IsoDate; sunrise: Date; sunset: Date; from: Date; to: Date }; // from/to rounded inward

type Coverage = { rule: 'coverage.recorded' | 'coverage.partial' | 'coverage.unknown'; calendars: Fact[] };
type Gap = {
  key: string;                          // gap:{scope}:{date}:{HHMM}-{HHMM}
  rule: 'gap.household' | 'gap.person';
  scope: 'household' | string;          // a person id
  date: IsoDate;
  stretch: { from: Date; to: Date };    // identity: not clipped to now
  from: Date; to: Date;                 // shown: clipped to now on today
  before: Fact | null; after: Fact | null; // the commitments either side, or null at planning edges
  unblocking: Fact[];                   // events named in Why that did not block (§5.4)
  facts: Fact[];
};

type OpeningRule = 'open_window.plain' | 'open_window.task';
// An opening is an Insight with kind 'open_window', its gap, daylight, the forecast span it cites,
// and, for a task opening, the matched task and any others that also matched.
```

`Fact` gains `{ kind: 'forecast'; from: string; to: string; fetchedAt: string }` and `{ kind: 'daylight'; date: IsoDate }`. Rule ids are closed unions; a test asserts that every value is documented in §5.

### 3.5 Privacy and data boundaries

- **Visibility is resolved by the services before anything is interpreted** (CLAUDE.md rule 1). The gap engine and openings see only what the reader can see. One adult's private records therefore cannot appear in, change or be counted by any of the following, for the other adult:
  - a gap, its bounds, its key or its Why;
  - coverage or the qualifier;
  - an opening, its key, its sentence, its task or its order;
  - "+ N more";
  - Today's or Forward's presentation.

  Sam's private event on Saturday at 12:00 splits Sam's Saturday and leaves Alex's exactly as it was. There are no "something private" placeholders.
- **The non-interference invariant** (§8.2) is extended to gaps, coverage and openings. Adding records only the other adult can see leaves the reader's outputs and rendered pages byte-identical.
- **A stated limit, not a leak.** Because Alex cannot see Sam's private events, a stretch Alex sees as "nothing recorded" may hold one of Sam's. Every opening's Why ends: "This is only what HOME has recorded that you can see. It isn't a check of anyone's plans." Nothing in M7 claims availability, so the limit makes no statement false.
- **Never across adults.** No computation reads both adults' records for one adult's view, no system actor computes gaps, and gaps are cached nowhere, so nothing computed for one adult can be served to the other.
- **The forecast is household-level and non-personal.** One row, read by both adults through a service that requires an actor. It holds no coordinates, no person, no record and nothing either adult wrote.
- **The home location** is private configuration (V0.1-SCOPE D11):
  - read only by `env.ts`, rounded to two decimal places (and elevation to 10 m) there;
  - sent only to the provider, in the request, over HTTPS, server-side (the provider sees Vercel's address, never the household's);
  - never in the repository, database, export, audit, logs, client HTML or tests;
  - in Production, set only after the gate opens (§7).
- **Logs** carry events and ids only. The refresh logs only `weather_refresh_failed` and an error name. `lat`, `lon`, `latitude`, `longitude`, `elevation` and `coordinates` are redacted keys; no request URL is logged.
- **Audit.** A refresh writes one structural row, `weather.refresh` with `{ status, hours }`, visible only to the adult whose visit triggered it (D4). Responses are audited as now, with the kind only.
- **Responses are private by `user_id`**, as in M6. A dismissal changes nothing for the other adult.
- **Authority.** The only writes are the forecast refresh and the reader's own responses, both gated. Kev gains nothing. No source record, task or calendar is touched.
- **External content is data** (CLAUDE.md rule 7): forecast values are numbers parsed through a bounded schema; no provider text is stored or shown.

### 3.6 Stale, incomplete and absent information

| Situation | Behaviour |
|---|---|
| No home location configured | No weather anywhere, no credit, no refresh request, no error. Openings use planning hours only; no task needing daylight is matched. |
| Location set, no forecast fetched yet | No weather words; the refresh is asked for after render |
| Forecast under 3 hours old | Words shown; its time in the Why and on Forward's credit line |
| Forecast 3–12 hours old | Words shown with their time: "As of yesterday 21:00, …" |
| Forecast over 12 hours old | No weather words; no dry-weather task matched; Today says "The forecast hasn't updated since {when}." |
| The provider refuses or fails | The last good forecast stays; the attempt is recorded and audited; nothing on screen says "error" |
| A day beyond the forecast, or not fully covered by it | No words for that day |
| No live calendar (first run) | Coverage `unknown`: no gaps and no openings anywhere. Weather still shows if there is a forecast. |
| A visible calendar failed, stale or never refreshed | Coverage `partial`: openings carry ", as far as HOME knows", and Why names the calendars |
| A timed event with no household person | Blocks the household (D11); named in a person's Why |
| An all-day event with no household person | Does not block (D12); named in the day's Why |
| A task needing `two_people` or `shops_open` | Never matched; no wording about it |

### 3.7 Determinism and traceability

- **Same input and `now`, same output.** Tested with shuffled inputs, repeated runs and a frozen `now`, for both surfaces and every rule.
- **Every output carries its `rule` and `facts`.** The weather sentence, day phrases and openings show their facts in place without JavaScript.
- **Constants are named in code,** listed in §5, and changed only by an ADR amendment: planning hours, minimum lengths, bands, wind, freshness, refresh interval, horizon, day parts, daylight rounding and caps.

### 3.8 Performance

- **One more query.** Today and Forward each add the forecast row to their existing reads; `respondToInsight` adds the same. Every count stays constant in the number of events, tasks, projects and calendars, and a test proves it.
- **No LLM and no network on render.** The refresh runs after render, at most hourly, never blocking.
- **The gap engine** sorts each day's blocking intervals for a scope and sweeps them once: linear after the sort. Openings evaluate at most two weekend days. Daylight is a few arithmetic steps per day.
- **Measured in Package 5:** engine and render times on the seeded scenarios and on a synthetic 300-event household over Forward's 90-day read, with gaps over seven days. Expected to add well under 20 ms to the engines.
- **The refresh** is one GET with a 10-second limit and a 512 KiB cap; its cost is off the render path.

### 3.9 Schema

One new table, in Package 1a (ADR 0011 §14; D3):

| Column | Notes |
|---|---|
| `id` | uuid |
| `provider` | `open_meteo` (`CHECK`), unique: one row per provider |
| `fetched_at` | timestamptz, nullable: the last successful fetch |
| `hours` | `jsonb`, nullable: normalised `ForecastHour` rows of the last success; cleared when that success is over 24 hours old and an attempt fails |
| `first_hour`, `last_hour` | timestamptz, nullable: the span of `hours` |
| `last_attempt_at` | timestamptz, nullable |
| `last_attempt_status` | `ok` \| `unreachable` \| `rate_limited` \| `timeout` \| `too_large` \| `bad_response` (`CHECK`), nullable; any other `safe-fetch` refusal is recorded as `unreachable` |
| `created_at`, `updated_at` | timestamptz |

- **No location column, no user column, no visibility.** It is not a user-facing record; FAMILY-DATA-MODEL records why.
- **Excluded from export,** with its reason.
- **Grants:** read and write for `home_app` by default privileges. Not append-only.
- **Nothing else changes.** No column on an existing table; no enum value; `insight_response` is unchanged.

---

## 4. The experience

### 4.1 Today

The hierarchy of M5 and M6 is unchanged. M7 adds two things.

1. **The weather sentence**, in the header, after the headline and its late sentence, before "What this is based on ›". One sentence in body type and ink, never the display face and never the Sun accent, followed by a small muted "Open-Meteo" credit link (when there is no sentence but an opening cites the forecast, the link follows that opening). "Why ›" holds the forecast's time, the hours it summarises (in words: chance of rain, amount, gusts), the day's low and high temperature, and the credit.
2. **At most one opening** in Worth knowing, ranked after every other family, with a ○ mark, "Why ›", Dismiss and Not useful.

The headline, its rules and everything else on Today are unchanged. M5's and M6's Today suites keep passing.

### 4.2 Forward Week

1. **A day phrase** at the end of each day's row, in muted ink: "Looks dry", "Showers possible", "Rain likely", with ", windy" when it applies. At most four words. A row with nothing recorded reads "Nothing recorded besides the usual" and then its phrase.
2. **The credit line** once, beside the Coming up label: "Forecast as of 06:55 · Open-Meteo", with its own "Why ›": each day's words describe that day's planning hours (08:00–20:00, or what remains of today) in the forecast fetched at that time, and what "looks dry", "showers possible", "rain likely" and "windy" mean, with their thresholds.
3. **Openings** in Worth knowing, after `data_health`, at most two.

Month and Season are unchanged: no phrases, no openings, no credit. The horizon switch, headline, rows, load bands, marks and The usual are unchanged.

### 4.3 Synthetic examples (fixture family)

These are indicative layout and copy; final copy is approved from screenshots in Package 4. In the fixture (`tests/fixtures/`):

- **Saturday:** Football, 09:00–10:00, with Isla. **Sunday:** nothing. **Tuesday 20:** Nana Jo's birthday, an all-day event with no one on it.
- **Paint the back fence:** open, about three hours, needs dry weather and daylight, assigned to Sam, in the active project Back fence.
- **One household calendar,** last updated 06:58. **The location** is the synthetic public point.
- **The forecast,** fetched at 06:55, has today dry in the morning with showers possible after midday, Saturday dry, and Sunday with one showery hour.
- **Daylight** for Saturday and Sunday is 06:30–19:30 after rounding (sunrise about 06:29, sunset about 19:43).

**Today, Wednesday 14 October, 07:03**

```
Wednesday 14 October

‹M5's headline, unchanged›
Looks dry until midday, then showers possible.   Open-Meteo
What this is based on ›

‹Worth knowing, Everyone's day, Also today, To do: unchanged.
 No opening: today and tomorrow are weekdays.›
```

**Forward, Week, the same morning**

```
[Week]  Month   Season

‹M6's headline, unchanged›
What this is based on ›

WORTH KNOWING
○ Paint the back fence is recorded as about three hours, in dry
  weather and daylight. Nothing is recorded for the household on
  Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55
  looks dry.                                                   Why ›
○ Nothing is recorded for the household on Sunday, 08:00–19:30.
  The forecast for Sunday as of 06:55 has showers possible.    Why ›

COMING UP                          Forecast as of 06:55 · Open-Meteo
Today     Nothing recorded besides the usual       Showers possible
Tomorrow  Nothing recorded besides the usual       Rain likely
Fri 16    Nothing recorded besides the usual       Showers possible
Sat 17    Nothing recorded besides the usual       Looks dry
Sun 18    Nothing recorded besides the usual       Showers possible
Mon 19    Nothing recorded besides the usual       Looks dry
Tue 20 ●  Nana Jo's birthday                       Looks dry

The usual ›
```

- *Rules shown:* `open_window.task` on Saturday (the stretch after Football to the end of daylight; Saturday's day band is dry; the task's estimate fits); `open_window.plain` on Sunday (no task matches, because Sunday is not dry); `weather.day` on each row.
- *What it does not say:* that anyone is free on Saturday; that Saturday is a good day for the fence; that Sam should paint it; anything about Sunday's showers making it better or worse.

**Today, Saturday 17 October, 07:30** (the forecast fetched at 06:55)

```
Saturday 17 October

‹M5's headline›
Looks dry today.   Open-Meteo

WORTH KNOWING
○ Paint the back fence is recorded as about three hours, in dry
  weather and daylight. Nothing is recorded for the household today,
  10:00–19:30, and the forecast as of 06:55 looks dry then.    Why ›
```

**Why ›, on Saturday's opening**

```
Nothing is recorded for anyone in the household from the end of
Football (10:00) to the end of daylight (19:30; sunset 19:43).
Before: Football 09:00–10:00 · Isla
Household: Sam, Alex, Milo, Isla
Calendars: Family calendar, updated 06:58
Forecast as of 06:55 (Open-Meteo): no hour above a 10% chance of
rain, no rain, gusts up to 30 km/h.
Paint the back fence: about three hours; dry weather, daylight.
This is only what HOME has recorded that you can see. It isn't a
check of anyone's plans.
[Not useful]
```

**A stale calendar** (one calendar last updated yesterday at 06:58): the same openings read "…on Sunday, 08:00–19:30, as far as HOME knows.", and `data_health.stale` is listed first, as in M6.

**An older forecast** (fetched yesterday at 21:00): Today reads "As of yesterday 21:00, looks dry until midday, then showers possible."; Forward's credit line reads "Forecast as of yesterday 21:00 · Open-Meteo".

**An unusable forecast** (over 12 hours): Today reads "The forecast hasn't updated since yesterday." in place of the sentence; Forward has no phrases and no credit; Saturday's opening is plain, with no weather sentence.

**First run** (no calendar): no openings anywhere; the weather sentence and phrases still show if there is a forecast.

### 4.4 States

| State | Today | Forward Week |
|---|---|---|
| No location | No sentence, no credit | No phrases, no credit |
| Location set, no forecast yet | No sentence; the refresh is asked for after render | No phrases |
| Fresh forecast | Sentence; time in Why | Phrases; credit line with time |
| Older forecast (3–12 h) | Sentence with "As of {time}, …" | Phrases; credit line with time |
| Unusable forecast (over 12 h) | "The forecast hasn't updated since {when}." | No phrases, no credit |
| Provider failing | As the forecast's age says; never an error banner | The same |
| First run (no calendar) | Weather if there is a forecast; no opening | Weather if there is a forecast; no openings |
| Partial coverage | Opening with ", as far as HOME knows" | The same, after `data_health` |
| Evening state | The sentence is about tomorrow: "Tomorrow: looks dry until midday, then showers possible." | Unchanged |
| No JavaScript | The cached forecast with its time; every Why is `<details>`; Dismiss and Not useful are forms; no refresh | The same |

### 4.5 What a Why holds

| On | Holds |
|---|---|
| The weather sentence | The forecast's time; each part's band in words with its highest chance of rain, its rain in millimetres and its strongest gust; the day's low and high; the credit link |
| A day phrase | No Why of its own: the credit line's Why gives the forecast's time, the span each phrase describes and the bands' thresholds |
| An opening | The rule sentence; the commitment before and after, with times and people, or the planning-hours or daylight edge (with sunrise or sunset); the household people it is about (those the reader can see); any all-day event with no one on it, and any no-household-person event; each calendar and when it last updated; the forecast span in words, its time and the credit; for a task opening, the task as recorded and any other matching tasks; the fixed limit sentence; Not useful |

### 4.6 Tablet and desktop

At 768px and wider, Today and Forward keep M5's and M6's two columns. The weather sentence stays in the header (left); the day phrases stay at the end of each row (right). Wider means more room per row, never a weather panel.

### 4.7 Accessibility, no-JS and brand

- Phrases and the sentence are text, not icons. Nothing is conveyed by colour alone.
- The credit link is a real link, 44px tall as a target, with `rel="noreferrer"`, and an accessible name that says where it goes ("Forecast data: Open-Meteo").
- Weather is ink and muted ink. **Sky** may be used only as a small mark, never a fill (BRAND.md), and the Sun accent stays for "needs you", which no M7 output is.
- Everything works without JavaScript except the refresh, which is optional.

### 4.8 Interactions in M7

| Gesture | Result |
|---|---|
| Tap "Why ›" on the sentence or an opening | Its evidence, in place |
| Tap the credit link | Open-Meteo's site, in the same tab, with no referrer |
| Dismiss | Gone for this adult, for this key, on Today and Forward |
| Not useful | The same as Dismiss, recorded as explicit feedback |
| Tap a task in an opening's Why | The task's page |

No pull-to-refresh, no weather screen, no Kev.

---

## 5. Rules (deterministic; every one named, traceable and tested)

### 5.1 The forecast (`weather.*` service rules)

- **The request** (ADR 0011 §12): one GET to `https://api.open-meteo.com/v1/forecast` with `latitude` and `longitude` (two decimal places), `elevation` when configured (to 10 m), `hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m`, `forecast_days=8` and `timeformat=unixtime`. No `timezone`, no other parameter, no key. Headers: `accept: application/json`, `user-agent: HOME-weather/1`; nothing else.
- **Days:** without `timezone`, the provider's days are UTC days. Eight of them cover today to today + 6 in home time whenever the forecast is usable; a day the stored hours do not fully cover has no words.
- **Normalisation:** each hour is `[start, start + 1h)` in UTC. Precipitation, its probability and gusts come from the provider's row stamped at the hour's end; temperature and wind from the row at its start. Values are bounded (probability 0–100, millimetres and speeds non-negative, temperature −60 to 60). A malformed, non-monotonic, inconsistent or out-of-range response is `bad_response`: the stored forecast is unchanged, and only the attempt is recorded.
- **Refresh:**
  - asked for only after render, by the client, when a location is set and the last attempt is at least **60 minutes** old (**3 hours** after `rate_limited`); the service checks the same itself, and a refresh that is not due returns `{ changed: false }` with no request and no write;
  - gated (`assertFamilyWritesOpen`, then `assertCanWrite`) before any query;
  - single-flight (`pg_try_advisory_xact_lock` on `home:weather_forecast`); a second caller is `busy` and writes nothing;
  - on success: the hours replaced, `fetched_at` and the attempt columns set, one audit row;
  - on failure: only the attempt columns set, one audit row; the hours cleared if the last success is over **24 hours** old (`fetched_at` kept);
  - the route returns only `{ changed }`.
- **Freshness** (from `fetched_at`): **fresh** under 3 hours; **older** from 3 to 12 hours; **unusable** over 12 hours or with no hours.

### 5.2 Bands, phrases and sentences (`weather.today`, `weather.tomorrow`, `weather.day`, `weather.stale`)

**Bands over a span of forecast hours** (D5; code constants):

| Constant | Value |
|---|---|
| `DRY_MAX_PROBABILITY` | 20 (%) |
| `DRY_MAX_MM` | under 0.2 mm in every hour |
| `RAIN_LIKELY_PROBABILITY` | 60 (%) |
| `RAIN_LIKELY_MM` | 1.0 mm in any hour |
| `WINDY_GUST_KMH` | 50 |

- **Rain likely:** any hour at or above either rain-likely threshold.
- **Looks dry:** otherwise, every hour at or below 20% and under 0.2 mm.
- **Showers possible:** otherwise.
- **No band:** any hour in the span missing its probability or amount. No words are said for that span.
- **Windy:** any hour's gusts at or above 50 km/h.

**Horizon** (D6): fetched for 8 days; words for today to today + 6 only.

| Rule | Where | Span | Template |
|---|---|---|---|
| `weather.today` | Today, day state | The rest of today in parts: morning 06:00–12:00, afternoon 12:00–18:00, evening 18:00–21:00; a part's hours are those ending after `now`, and a part with none is dropped | One run of equal bands: "{Band} today." Two runs: "{Band} until {midday \| the evening}, then {band}." Three runs: "{Band} this morning, {band} this afternoon, {band} this evening." Windy adds "Windy at times." |
| `weather.tomorrow` | Today, evening state | Tomorrow's three parts | "{Band} tomorrow." / "Tomorrow: {band} until {midday \| the evening}, then {band}." / "Tomorrow: {band} in the morning, {band} in the afternoon, {band} in the evening." |
| `weather.day` | Forward Week, each day | That day's planning hours (the remaining ones, today) | "{Band}" and, when windy, ", windy" |
| `weather.stale` | Today, in place of the sentence | — | "The forecast hasn't updated since {when}." ({when}: a time today, "yesterday", a weekday, or a short date) |

- **Band words:** "Looks dry", "Showers possible", "Rain likely" (lower case inside a sentence).
- **Older forecast:** the sentence begins "As of {time}, ", with its first band in lower case: "As of yesterday 21:00, looks dry until midday, then showers possible."
- **No words** when any part or day has no band, when the forecast is unusable, or when a day is not fully covered.
- **Facts:** the `forecast` fact (the span and the fetch time).

### 5.3 Daylight (`daylight`)

- Sunrise and sunset from the NOAA solar-position equations (Meeus) with the standard 0.833° refraction, for the rounded home point and each home date, converted to `Pacific/Auckland` through the IANA zone.
- **Rounded inward** to the quarter hour where used: sunrise up (06:29 → 06:30; 07:46 → 08:00), sunset down (19:43 → 19:30).
- **Reference:** within one minute of a NOAA reference table for the synthetic point on 27 September 2026, 17 October 2026, 21 December 2026, 4 April 2027 and 21 June 2027, committed with the test.
- **No location, no daylight.**

### 5.4 Gaps (`gap.household`, `gap.person`)

- **Planning hours** (D9): `PLANNING_FROM = '08:00'`, `PLANNING_TO = '20:00'`, home time, every day.
- **A gap** is a maximal stretch inside planning hours on a home date where no commitment in the scope overlaps. Overlap is `[start, end)`: a commitment ending at 10:00 leaves 10:00 open.
- **Length:** the engine returns gaps of at least `GAP_FLOOR_MINUTES = 60` (D10).
- **A person's scope** blocks:
  - each timed occurrence the person is on, attending or responsible, as the agenda shows (own annotations, else the calendar's usual people, or a changed occurrence's series people);
  - each all-day event the person is on: the whole planning day, on every date it covers (exclusive end);
  - each scheduled task assigned to them, over its window.
- **The household's scope** blocks:
  - everything in each visible household person's scope;
  - each timed occurrence with no household person on it (nobody, only people outside the household, or only people the reader cannot see) (D11);
  - each scheduled task with no household assignee.
- **Never blocks:**
  - an all-day event with no household person on it (D12), which is named in that day's Why;
  - birthdays from people's records, project targets, tasks due, tasks with no window;
  - a zero-length occurrence;
  - a skipped occurrence (it is not in the agenda).
- **A person's gap** that overlaps a timed occurrence with no household person names it in its Why ("a household event with no one recorded on it: {title} {time}"). It does not shorten the gap.
- **Kind is never read.** Work and school block like anything else.
- **Recurrence, overnight and zones** come from the agenda's occurrences and instants, compared in UTC and named in home wall time. A multi-day timed occurrence blocks each home date it covers, from its start or the planning start to its end or the planning end.
- **On today:** the gap's `stretch` (its identity) is computed as if `now` were before the day began. Its shown `from` is `max(stretch.from, now)`, and a gap whose remaining length is under the floor, or whose end has passed, is not returned.
- **Key:** `gap:{household | personId}:{YYYY-MM-DD}:{HHMM}-{HHMM}`, from the stretch's home wall-clock bounds. Ids and times only.
- **Order:** date, then start, then key.
- **Facts:** the commitments either side (event or task facts), the `range`, the calendars consulted, and any named non-blocking events.

### 5.5 Coverage (`coverage.*`)

| Rule | When (for the reader, over their visible, unarchived calendars) | Effect |
|---|---|---|
| `coverage.unknown` | No live calendar | No gaps returned for any scope, on any day |
| `coverage.partial` | Any visible calendar's last refresh failed (status not `ok` or `partial`), its last success is over 24 hours old, or it has never succeeded | Gaps returned; every opening qualified; Why names the calendars |
| `coverage.recorded` | Otherwise | Gaps returned |

- The thresholds are M5's (`unhealthyCalendars`), plus "never succeeded", which M5 left silent because it said nothing either way, and which M7 cannot vouch for.
- **Coverage is for the reader,** not per day: calendar health has no date.
- **Agenda coverage:** like Forward and conflicts, the engine takes the range the agenda covered and refuses days outside it. It never fetches or fills in.

### 5.6 Openings (`open_window.plain`, `open_window.task`)

**Candidates** (D14):

- a household gap on a **Saturday or Sunday**, within the surface's window (§5.8), with coverage `recorded` or `partial`;
- intersected with daylight (when known) and planning hours;
- at least `OPENING_MIN_MINUTES = 120` long, measured on the shown span (clipped to `now` on today).

**Per day:** at most one opening, on the **longest** candidate (the earliest on a tie). If a task matches that day, it is a task opening on the longest candidate the task matches; otherwise a plain opening on the longest candidate.

**A task matches** (ADR 0011 §30) when it is:

- open, not scheduled, visible to the reader;
- with `estimate_minutes`, and `needs` that are non-empty and contain only `dry_weather` and `daylight`;
- not in a `paused` or `done` project;
- and the candidate is at least as long as the estimate, and:
  - `daylight`: daylight is known for that day;
  - `dry_weather`: the forecast is usable and its band is "looks dry" over the candidate's hours (today and tomorrow) or over the day's planning hours (days 2–6).

Several matching tasks: the opening names the first by due date (dated tasks first, earliest first), then title (`en-NZ`), then id; its Why lists the rest. The assignee is not read.

**Templates** (final copy approved in Package 4; tests follow the approved copy):

| Part | Template |
|---|---|
| Plain, first sentence | "Nothing is recorded for the household {today \| tomorrow \| on Saturday}, {HH:MM}–{HH:MM}." On today, once the stretch has begun: "Nothing is recorded for the household for the rest of today, until {HH:MM}." |
| Task, first sentence | "{Task title} is recorded as about {estimate}, in {dry weather and daylight \| dry weather \| daylight}." |
| Task, second sentence | The plain sentence with its weather clause joined by ", and " ("…, and the forecast as of …"), as one sentence |
| Qualifier | ", as far as HOME knows" before the first full stop of the "Nothing is recorded" sentence, when coverage is `partial` |
| Weather clause, today and tomorrow | "The forecast as of {time} {looks dry \| has showers possible \| has rain likely} then{, and windy}." |
| Weather clause, days 2–6 | "The forecast for {Weekday} as of {time} {looks dry \| has showers possible \| has rain likely}{, and windy}." |
| {time} | "06:55" when fetched today; "yesterday 21:00" otherwise (never older, §5.1) |
| {estimate} | Whole hours in words up to ten ("three hours"); otherwise minutes ("90 minutes") |

- **The weather clause** is added whenever the forecast is usable and the span has a band. On a plain opening it never changes whether the opening exists (ADR 0011 §31).
- **Facts:** the gap's facts, the `daylight` fact when it bounds the span, the `forecast` fact when cited, and the task fact.

### 5.7 Identity and lifecycle

- **Key:** `open_window:household:{YYYY-MM-DD}:{HHMM}-{HHMM}`, and for a task opening `open_window:household:{YYYY-MM-DD}:{HHMM}-{HHMM}:task:{taskId}`. The times are the candidate's bounds before clipping to `now`. The longest is 84 characters.
- **Nothing else is in a key:** no forecast value, fetch time, viewing date or text.

| Change | New key? | Why |
|---|---|---|
| The forecast is refreshed, with different numbers, and a plain opening's band changes | No | The sentence changes; the key and any response stay |
| The forecast turns wet on a day with a dry-weather task opening | The task opening is no longer derived; the day's plain opening (its own key) appears | A different observation |
| It turns dry again | The task opening returns with its old key and any response on it | A return to an earlier state |
| A commitment is added, moved, archived or restored so the candidate's bounds move | **Yes** | The stretch changed |
| A commitment changes title, notes, place or people, with the same times and blocking | No | Not identity |
| A calendar refresh keeps the same rows and times | No | Same bounds |
| Daylight's rounded edge moves (another date, or a changed location) | **Yes**, for that candidate | The stretch changed |
| The matched task is done, dropped, scheduled or edited out of matching | Its opening ends; the next matching task's (or the plain) opening has its own key | A different observation |
| The task's title or estimate changes and it still matches | No | The key holds the task id, not its fields |
| Midnight passes | No | Keys hold the opening's date, not the viewing date |

- **Current** while the opening's end is after `now` and its shown span is still at least two hours. A response on a key that is no longer current is refused as `not_eligible`, with no write.
- **A response belongs to one adult and one key,** suppresses it on Today and Forward, and never expires.

### 5.8 Insights on each surface, responses and forbidden phrases

| Surface | Window for openings | Listed families | Openings shown |
|---|---|---|---|
| Today | today and tomorrow | M6's, then `open_window` | At most one: the earliest without a response |
| Forward, Week | today … today + 6 | `data_health`, then `open_window` | At most two |
| Forward, Month and Season | — | Unchanged | None |
| Coming up (a person) | — | Unchanged | None |

- **Ranking** (D15): `data_health`, `conflict`, `preparation`, `busy_day`, then `open_window`; within `open_window`, by date, then start, then key. A total order.
- **Shown:** Today shows three and Forward two, as now. Openings past their family's cap are neither listed nor counted in "+ N more". Listed openings are counted as any other listed insight.
- **Marks:** ○.
- **Responses** (`respondToInsight`), in M6's order, with one addition at step 3:
  1. gate, then actor, before any read;
  2. key, response and surface, by schema;
  3. the reader's insights, conflicts **and openings**, re-derived from one 90-day agenda read **and one forecast read**;
  4. accept a current conflict from any surface; any other key only if current, not on its item, and listed on the named surface (Today: M5's families and `open_window`; Forward: `data_health` and `open_window`; a person's page: none); an opening is eligible if it is derivable on that surface, ignoring the cap; otherwise `not_eligible`;
  5. the same response again writes nothing;
  6. `respond`: an upsert, audited with the kind only.
- **Forbidden phrases.** The M5 list (M5 contract §8.1) and M6's (§5.5) stay in force and their tests are unchanged. M7 adds, over every template and rendered string of M7:
  - "free", "available", "nothing on", "everyone can", "both of you", "you could", "should", "a good time", "good day", "good for", "best", "ideal", "perfect", "nice", "great", "fine", "mild", "lovely", "chance to", "opportunity", "room for", "fits", "suitable", "recommend", "window";
  - "out of date" (`out` is already forbidden);
  - "probably" stays forbidden; "likely" is allowed only in the band phrase "rain likely".

  Task titles, event titles and names shown as recorded are exempt.

---

## 6. Weather provider assessment

Condensed from the research of 2026-10-11 (web research only; no sign-ups, keys or forecast calls). Open-Meteo's terms, licence, pricing FAQ and server code were read verbatim from its open-source repositories; MET Norway's from its documentation repository (last changed March 2023); Apple's from its developer site. MetService, Google, OpenWeather and Tomorrow.io are known only from search-engine summaries of their official pages and are marked *(summary)*.

### 6.1 Comparison

| | **Open-Meteo free** | Open-Meteo paid | MET Norway | MetService Point Forecast | Apple WeatherKit | OpenWeather One Call 3.0 | Google Weather |
|---|---|---|---|---|---|---|---|
| Cost | Free, non-commercial | About US$29/mo (summary) | Free, commercial allowed | Production from US$30/mo (summary) | 500k calls/mo with the Developer Program (about US$99/yr) | 1,000/day free; card required (summary) | 10k/mo free (summary) |
| A private household app qualifies | **Yes**: "private … apps that do not have subscriptions or advertising", "personal home automation" | n/a | Yes | Not on the free tier in production (summary) | Yes | Yes (summary) | Yes, but caching terms restrict persistence (summary) |
| Key | None | Yes | None; identifying User-Agent | Yes | Signed JWT | Yes | Yes (GCP billing) |
| Attribution | CC BY 4.0, a link next to the data | CC BY 4.0 | CC BY 4.0 / NLOD | Unread | Apple mark and legal link | Logo and link (summary) | Required (summary) |
| Hourly horizon | Up to 16 days | Same | About 10 days, hourly then 6-hourly | Up to 10 days (summary) | About 10 days | 48 hours (summary) | 240 h, 24 per page (summary) |
| NZ model | ECMWF IFS HRES (~9 km) first, then ICON, then GFS; no NZ regional model | Same | ECMWF HRES, no Nordic post-processing | NZ 4 km on paid tiers (summary) | Undisclosed | Proprietary | Proprietary |
| Probability of rain | Yes (ensembles) | Yes | Listed; NZ availability unconfirmed | Unconfirmed | Yes | Yes | Yes |
| Time zone | Fixed offset, ignores DST; use `unixtime` | Same | UTC | Unconfirmed | UTC | UTC plus offset | UTC plus offset |
| Limits | <10k/day, 5k/h, 600/min, **per IP** | Monthly budget | 20 req/s per application | Units (summary) | Monthly | 1k/day | Per project |
| SLA | None | 99.9% *target* | None | Paid support (summary) | Not stated | Not checked | Google Cloud (unchecked) |
| NZ warnings | No | No | No | Not via this API | NZ not listed | Unconfirmed | Unconfirmed |

### 6.2 Recommendation (D1)

**Open-Meteo's free API**, one adapter, no live fallback.

- **Cost and fit:** $0; HOME matches two of the published non-commercial examples; at most 24 calls a day against a 10,000 daily limit.
- **Simplicity:** no key, no account, one GET; every field M7 uses.
- **Quality:** essentially ECMWF IFS HRES for New Zealand, the same core model as MET Norway's global product. No free provider has a New Zealand regional model.
- **Obligations:** a CC BY credit link next to the data (D8); UTC storage (its local times ignore DST); HOME's own `fetched_at` (the response carries no issue time).
- **Risk:** no SLA, and the free limit is per IP on Vercel's shared egress, so `429`s will happen. The cache absorbs them.
- **Contingency, decided on evidence** (the `rate_limited` count in `weather.refresh` rows): a MET Norway adapter (free, User-Agent identified, honours `Expires` and `If-Modified-Since`; needs a contact string in env) or Open-Meteo Standard (a key, a target, a monthly cost).
- **Not recommended:** MetService (production needs a paid plan; the NZ model is on higher tiers), Apple (membership, JWT keys, mandatory branding), OpenWeather (card, 48 hours, licence ambiguity), Tomorrow.io (25 requests an hour; terms unclear), Google (caching terms likely conflict with a database cache; ten requests per fetch).

### 6.3 Location privacy

- At New Zealand latitudes, two decimal places move the point by at most about 0.55 km north–south and 0.45 km east–west (about 0.7 km). One decimal is about 11 km, a whole model cell.
- The model grid is about 9 km, and the provider already answers for its grid cell's centre, so a 0.7 km shift barely changes the forecast. The exception is elevation on a hillside or coast, which `HOME_ELEVATION` (to 10 m) corrects.
- Open-Meteo states that its server logs may contain coordinates and are deleted after 90 days; it is a Swiss operator. Each provider sees Vercel's address, the rounded point and HOME's User-Agent.

### 6.4 Forecast skill and the horizon (D6)

- NOAA's general guidance: a seven-day forecast is right about 80% of the time, a five-day one about 90%, and ten days or more only about half the time (summary).
- In Open-Meteo's New Zealand blend, IFS HRES is natively hourly only to about 3.75 days, then 3-hourly, then 6-hourly; hourly values beyond that are interpolated.
- Hence: part-of-day and span words for today and tomorrow, one day-level band for days 2–6, nothing beyond day 6, and a fetch of 8 days to cover day 6 fully across a DST change.

### 6.5 Severe-weather warnings (D7)

- MetService is New Zealand's authorised warning provider, and its public CAP feed (`alerts.metservice.com/cap/rss`) carries watches and warnings (summary, corroborated by NEMA's CAP-NZ standard).
- Its terms (summary) say content must not be altered, and its Code of Practice was not read. Apple imposes the same rule on its alerts.
- **Not in M7.** If wanted later: shown verbatim, credited, matched to the home point by a deterministic engine, never paraphrased by Kev, and never a push notification.

### 6.6 Sources

- Open-Meteo: `github.com/open-meteo/open-meteo-website` (terms, licence, pricing, docs) and `github.com/open-meteo/open-meteo` at `f625df2` (models, time zones); discussion #853 (per-IP limits on shared hosts).
- MET Norway: `github.com/metno/weatherapi-docs` (terms, licence, Locationforecast).
- Apple: developer.apple.com, WeatherKit REST documentation and attribution pages.
- MetService: data.metservice.com and developer.metservice.com pages; metservice.com CAP page; NEMA TS 04/18 (summaries).
- NOAA: gml.noaa.gov solar calculation details; NESDIS and SciJinks forecast reliability pages.
- ECMWF: verification and evaluation reports (2012, 2024) (summaries).

### 6.7 Not confirmed

1. Open-Meteo's current paid prices and currency; whether the live terms differ from the repository.
2. The exact preceding-hour semantics of Open-Meteo's `precipitation_probability` and `wind_gusts_10m` (Package 1b's contract test pins the mapping and records the source).
3. Open-Meteo's latency and uptime from Vercel's `syd1`, and how often its per-IP limit refuses there.
4. MET Norway's current terms, and whether it returns probability of rain and gusts for New Zealand.
5. MetService's API terms, tiers and the CAP Code of Practice.
6. Whether Apple or Google cover New Zealand warnings; Google's caching period for weather.
7. OpenWeather's licence; Tomorrow.io's free-plan terms.
8. Response sizes (estimated 10–25 KB; measured in Package 1b).
9. Whether Earth Sciences New Zealand's acquisition of MetService has changed data access.
10. Current Southern Hemisphere skill scores (the cited day 6–7 figure is older and has improved).

---

## 7. Environments, data and the production gate

- **Local and CI:**
  - the seeded fixture family, with the synthetic public point (Wellington's Civic Square, `-41.29`, `174.78`) as `HOME_LAT` and `HOME_LON`; the owner confirms it is not within a few kilometres of home, or another public point replaces it (ADR 0011 §13);
  - the fake provider (`HOME_TEST_WEATHER=fake`, refused when deployed, like `HOME_TEST_CALENDAR_FEEDS`);
  - scenario forecasts written straight into `weather_forecast` in `home_test` by the M5 scenario harness; no test reaches the network.
- **Preview:** the synthetic public point only, never the home's, and the throwaway synthetic account. The real provider is called from Preview.
- **Production:**
  - M7 deploys like any merged code, after Package 1a's migration has run;
  - `HOME_LAT`, `HOME_LON` and `HOME_ELEVATION` stay **unset** until the gate has opened (DEPLOY.md §E item 21, after item 11);
  - while the gate is closed, the refresh is refused even if a location is set, so no request reveals the location;
  - the boot line reports `weather location: set | absent | invalid`, never the value;
  - nothing else changes: no key, no secret.

---

## 8. Testing requirements

### 8.1 Unit (engines and adapter)

- **Every rule in §5 at its boundaries:**
  - bands at 20/21%, 0.19/0.2 mm, 59/60%, 0.99/1.0 mm, gusts 49/50 km/h, and a missing value;
  - freshness at 2:59, 3:00, 12:00 and 12:01;
  - refresh at 59 and 60 minutes, and 2:59 and 3:00 after `rate_limited`;
  - daylight rounding and the reference table;
  - gaps at touching ends, the 60-minute floor, the planning edges, overnight, multi-day, all-day (with and without household people), no-household-person timed events, scheduled tasks, skipped and changed occurrences, another zone, and both Pacific/Auckland DST change days;
  - openings at 119 and 120 minutes, an estimate one minute longer than the candidate, the weekday rule, day 1 versus day 2 wording, and the caps ±1.
- **Identity and lifecycle:** every row of §5.7's table.
- **Determinism:** shuffled input over seeded orders, repeated runs, frozen `now`, deep- and byte-equal.
- **Traceability:** every output has a known rule; every rule is documented in §5; every opening has facts that resolve to its inputs.
- **The absence rule:** in scenarios with nothing recorded, missing people, unassigned all-day events, a stale calendar or no forecast, no output asserts availability, suitability, need, or what anyone should do.
- **Forbidden phrases:** §5.8's lists over every template and every generated string.
- **Import boundaries:** the engines import no `db`, `app`, `kev`, `ui`, `integrations` or clock.
- **Adapter:** the exact request; normalisation; every error mapping; no logging.

### 8.2 The privacy invariant (unit and integration)

For each adult, add records only the other adult can see:

- a private event inside a weekend stretch;
- a private all-day event;
- a private scheduled task, and a private open task with an estimate and `dry_weather`;
- a private person on a private event;
- a private stale calendar;
- the other adult's responses on openings.

The reader's gaps, coverage, openings, keys, insights, Today model, `ForwardModel` and rendered Today and Forward pages must be identical before and after, deeply and byte for byte. The same records must change the other adult's own. This runs through the real services as `home_app`.

### 8.3 Integration (as `home_app`)

- **The refresh:** gated before any query or request; refused for Kev; single-flight; audited with `{ status, hours }` only and visible only to the triggering adult; the last good forecast kept on failure; retention; one row per provider.
- **Dismiss and Not useful on openings:** per user; audited with the kind only; idempotent; refused while the gate is closed; refused for crafted, foreign, stale and unlistable keys, and from a person's page.
- **A response on one surface hides the key on the other,** for that adult only.
- **Query counts:** Today and Forward each one more than M6's, and constant after 20 more events, tasks and a second calendar; `respondToInsight` likewise.
- **Export completeness** with `weather_forecast` excluded.

### 8.4 End to end (Playwright, seeded scenarios)

- Today and Forward Week with forecasts fresh, older, unusable and absent; with openings plain, task and qualified; at four viewports, with JavaScript on and off.
- The credit link wherever words are, and nowhere else.
- Dismiss and Not useful on an opening, from Today and from Forward, and gone from both.
- **No regression:** M5's Today and M6's Forward specs pass, with only the additions named in the Package 4 PR.
- **The two-adult privacy sweep** extended to openings.
- **Accessibility baseline:** axe; headings and landmarks; focus; 44px targets; no information by colour alone; `<details>` keyboard-operable.

### 8.5 Kept

Every M1–M6 test, including the M5 and M6 forbidden-phrase suites, unchanged.

### 8.6 Contract test matrix

**Fixture**, unless a row says otherwise:

- **People:** Sam and Alex (parents), Milo and Isla (children), all in the household; Nana Jo outside it.
- **Time:** `Pacific/Auckland`; `now` is Wednesday 14 October 2026, 07:03.
- **Location:** the synthetic public point.
- **Planning hours** 08:00–20:00; **daylight** for 17 and 18 October given as 06:30–19:30 (W16 pins the engine).
- **Records:** Football, weekly on Saturdays 09:00–10:00, Isla attending; Swimming, weekly on Wednesdays 15:30–16:15, Milo attending and Sam responsible; Nana Jo's birthday, all-day 20 October, no one on it; Paint the back fence (open, 180 minutes, `dry_weather` and `daylight`, assigned to Sam, project Back fence `active`); Sort the garage light (open, 30 minutes, no needs).
- **Calendar:** one household calendar, last success at 06:58 (`recorded`).
- **Forecast F0,** fetched 06:55: every hour of Saturday 17's planning hours at 10% or less and 0 mm; Sunday 18 has one hour at 40% and 0.1 mm, the rest dry; gusts under 50 km/h everywhere.

Results are exact unless marked otherwise.

#### W — Weather, freshness and daylight

| # | Given | Expect |
|---|---|---|
| W1 | A refresh with `HOME_LAT=-41.28664`, `HOME_LON=174.77557`, no elevation | One GET to `https://api.open-meteo.com/v1/forecast` with `latitude=-41.29`, `longitude=174.78`, the five hourly variables, `forecast_days=8`, `timeformat=unixtime`; no `timezone`; headers `accept: application/json` and `user-agent: HOME-weather/1` only |
| W2 | `HOME_ELEVATION=23` | `elevation=20` in the request; the exact coordinates and elevation appear nowhere else (request log, database, audit, client) |
| W3 | A valid provider response over 8 days | Every complete hour, in UTC order, with no gap or duplicate; precipitation, probability and gusts taken from the row stamped at each hour's end, temperature and wind from the row at its start |
| W4 | A response with a non-monotonic time, a length mismatch, a probability of 101, a negative amount or non-JSON | `bad_response`; nothing in `hours` changes; one audit row `{ status: 'bad_response', hours: 0 }` |
| W5 | Spans of hours: [10%, 20%, 20%] and [0, 0.1, 0.19 mm] / one hour at 21% / one at 0.2 mm / one at 60% / one at 1.0 mm / one with no probability | dry / showers / showers / rain / rain / no band (no words) |
| W6 | Gusts 49 km/h / 50 km/h in the span | No wind words / "windy" |
| W7 | `fetched_at` 2:59, 3:00, 12:00, 12:01 before `now` | fresh / older / older / unusable |
| W8 | Last attempt 59 minutes ago / 60 minutes / `rate_limited` 2:59 ago / 3:00 ago | No request / request / no request / request |
| W9 | Two refreshes at once | One provider call; the other returns `busy` and writes nothing |
| W10 | The provider times out / answers `429` / `500` / over 512 KiB | `timeout` / `rate_limited` / `unreachable` / `too_large`; `hours` and `fetched_at` unchanged; the attempt columns set; one audit row each |
| W11 | A failure when the last success is 24:01 old | `hours` cleared, `fetched_at` kept; Today shows `weather.stale` |
| W12 | `HOME_LAT` unset / `HOME_LAT=95` | No request, no cache read, no weather words, no refresh client, no error; boot line `absent` / `invalid` |
| W13 | Production (`VERCEL_ENV=production`), gate closed, location set | The refresh is refused with `real_data_closed` before any query or request; nothing written |
| W14 | F0 on Forward Week | Phrases for 14–20 October only; none for 21 October; a day whose planning hours the forecast does not fully cover has none |
| W15 | Today, 07:03, F0 with Wednesday's morning dry and afternoon and evening showery | "Looks dry until midday, then showers possible." (`weather.today`); at 19:30 in the evening state with Thursday rain likely all day: "Rain likely tomorrow." (`weather.tomorrow`) |
| W16 | Daylight for the synthetic point on 27 Sep 2026, 17 Oct 2026, 21 Dec 2026, 4 Apr 2027, 21 Jun 2027 | Within one minute of the committed NOAA table (17 October: about 06:29 and 19:43); rounded inward 06:30–19:30 (17 October), 08:00–16:45 (21 June) |
| W17 | `openMeteoPolicy` with another host, `http`, another path, a redirect, a private address | Each refused (`unsupported_destination`, `forbidden_destination`, `redirect_refused`, `address_rejected`); the calendar policy's tests pass unchanged |
| W18 | A failing refresh | One log line, `weather_refresh_failed` with the error name; the redaction test covers `lat`, `lon`, `latitude`, `longitude`, `elevation`, `coordinates`, and no URL is logged |
| W19 | Today with the sentence / Today with no sentence but an opening citing the forecast / Forward Week with phrases / any page without forecast words | One credit link with `rel="noreferrer"` after the sentence / after that opening / beside the Coming up label / no credit link |

#### G — Gaps and coverage (household scope unless stated; days in October 2026)

| # | Given | Expect |
|---|---|---|
| G1 | Sunday 18, nothing recorded | One gap, `gap:household:2026-10-18:0800-2000` |
| G2 | Saturday 17, Football 09:00–10:00 (Isla) | 08:00–09:00 and 10:00–20:00 |
| G3 | G2 plus Milo 10:00–11:00 and Isla 11:00–12:00 | 08:00–09:00 and 12:00–20:00; no gap at 10:00 or 11:00 |
| G4 | Sunday, Milo 08:30–09:15 | 09:15–20:00 only (08:00–08:30 is under the floor) |
| G5 | Sunday, an event 07:00–08:00 / 19:00–21:00 (Milo) | 08:00–20:00 / 08:00–19:00 |
| G6 | Sam, Friday 16 22:00 to Saturday 17 09:30, plus Football | Friday 08:00–20:00 (22:00 is after planning hours); Saturday 10:00–20:00 |
| G7 | Sunday, a timed event 14:00–15:00 with no one on it | Household: 08:00–14:00 and 15:00–20:00. Milo's scope: 08:00–20:00, its Why naming the event |
| G8 | G7 with only Nana Jo on it | As G7 |
| G9 | An all-day event Friday 16 to Saturday 17 (end date 18) with Sam | Household: no gaps on 16 or 17; 08:00–20:00 on 18. Sam's scope the same. Milo's scope on 16: 08:00–20:00 |
| G10 | Tuesday 20, Nana Jo's birthday (all-day, no one) | 08:00–20:00; the day's Why names the birthday |
| G11 | Sunday, Milo's birthday (from his record), a project target and a task due | 08:00–20:00 |
| G12 | Sunday, a task scheduled 10:00–11:00 assigned to Sam / with no assignee | Household 08:00–10:00 and 11:00–20:00 in both; Sam's scope blocked / not blocked; Milo's scope 08:00–20:00 |
| G13 | Football skipped on 24 October / changed on 31 October to 11:00–12:00 | 24th: 08:00–20:00 / 31st: 08:00–11:00 and 12:00–20:00 |
| G14 | Alex's weekly work series, weekdays 09:00–17:00 (kind `work`) | Thursday 15: 08:00–09:00 and 17:00–20:00 |
| G15 | `now` Sunday 18 10:07; Milo 09:00–10:00 | Key `gap:household:2026-10-18:1000-2000`, shown from 10:07. At 18:30: shown 18:30–20:00, same key. At 19:05: no gap |
| G16 | A zero-length event at 12:00 | No effect |
| G17 | Sunday 27 September 2026 (NZ DST starts) / Sunday 4 April 2027 (ends): Milo 01:30–09:00 local | Both: one gap 09:00–20:00, `gap:household:2026-09-27:0900-2000` / `…:2027-04-04:0900-2000`; the planning day is 12 hours on both |
| G18 | Sunday 18, an event kept in `Australia/Sydney` 08:00–09:00 with Milo | 08:00–10:00 and 11:00–20:00 |
| G19 | No live calendar / all healthy / one last success 24:01 ago / one failed / one never refreshed / only an archived calendar | `unknown` with no gaps / `recorded` / `partial` / `partial` / `partial` / `unknown` |
| G20 | G1–G18 inputs shuffled over eight seeds, repeated | Identical gaps, keys and order, deep and byte for byte |
| G21 | Every key from G1–G19, and a person scope | Matches `insightKey`; at most 200 characters; no text; `gap:{personId}:…` for a person |
| G22 | Sam, a timed event Friday 16 18:00 to Sunday 18 12:00 | Friday 08:00–18:00; Saturday none; Sunday 12:00–20:00 |
| G23 | An agenda covering 14–16 October asked for 17 October | Refused (incomplete agenda); nothing computed |
| G24 | A synced event with no annotations on a calendar whose usual person is Milo, Sunday 14:00–15:00 | Blocks Milo and the household; not Isla's scope |
| G25 | Sunday, Milo responsible (not attending) on an event 14:00–15:00 | Blocks Milo and the household |

#### O — Openings, identity and responses (F0; `now` 07:03 on 14 October unless stated)

| # | Given | Expect |
|---|---|---|
| O1 | The fixture on Forward Week | Two openings, in order: `open_window:household:2026-10-17:1000-1930:task:{paintFence}` and `open_window:household:2026-10-18:0800-1930` |
| O2 | O1's Saturday | "Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry." No plain opening on Saturday |
| O3 | O1's Sunday | "Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible." |
| O4 | Forecast F1 at 08:10 with Saturday showery | Saturday's task opening gone; `open_window:household:2026-10-17:1000-1930`: "Nothing is recorded for the household on Saturday, 10:00–19:30. The forecast for Saturday as of 08:10 has showers possible." |
| O5 | Back to a dry Saturday (F2) | The task key of O1 returns, with any response on it |
| O6 | Sunday's forecast changes to rain likely | Same key as O3; the sentence ends "has rain likely." |
| O7 | Alex dismisses Sunday's opening; the forecast is refreshed | Still hidden for Alex; shown for Sam |
| O8 | Milo, Sunday 13:00–14:00 | Candidates 08:00–13:00 and 14:00–19:30; the opening is `…:2026-10-18:1400-1930`, eligible despite O7's dismissal |
| O9 | Thursday 15 and Friday 16 with nothing recorded | No openings on either |
| O10 | Saturday's candidate 10:00–11:59 / 10:00–12:00 | No opening / an opening |
| O11 | The fence's estimate 600 minutes | No task opening; Saturday's plain opening |
| O12 | The fence's needs `two_people` / `[]`; no estimate; scheduled; project `paused`; done | No task opening in each case |
| O13 | A task with `daylight` only, 120 minutes, forecast unusable | Task openings on Saturday and Sunday naming it, with no weather sentence; the fence is not matched |
| O14 | The fence with the forecast 12:01 old | No task opening; Saturday plain, with no weather sentence |
| O15 | No location configured | Openings bounded by planning hours (Saturday 10:00–20:00); no task needing daylight is matched; no weather sentence |
| O16 | The calendar's last success 24:01 ago | Each opening's "Nothing is recorded" clause carries ", as far as HOME knows" (Sunday: "…on Sunday, 08:00–19:30, as far as HOME knows."); Why names the calendar; `data_health.stale` listed first |
| O17 | No live calendar | No openings on any surface |
| O18 | `now` Saturday 17 07:30, Today, with F0's values fetched at 06:55 that morning | One opening, Saturday's: "…Nothing is recorded for the household today, 10:00–19:30, and the forecast as of 06:55 looks dry then."; Sunday's not listed and not counted |
| O19 | O18, then Saturday's is dismissed | Sunday's appears, worded with "tomorrow" |
| O20 | `now` Friday 16 07:03, Today, with F0's values fetched at 06:55 that morning | Saturday's opening, worded with "tomorrow" |
| O21 | `now` Saturday 17 17:45 | Saturday's opening not current (1 h 45 min left); a response on its key is `not_eligible`, nothing written |
| O22 | Forward Week with one stale calendar | `data_health.stale`, then Saturday's opening shown; Sunday's under "+ 1 more" |
| O23 | Dismiss and Not useful on an opening from Today and from Forward / from a person's page / a crafted key with other times / gate closed | Accepted, audited with the kind only, hidden on both surfaces for that adult / `not_eligible` / `not_eligible` / refused before any query |
| O24 | Alex dismisses tomorrow's opening at 23:59; `now` moves to 00:01 | Same key; still hidden |
| O25 | A second task, "Stain the deck" (120 minutes, `dry_weather`, due 30 October), and the fence (no due date) | Saturday's opening names Stain the deck; Why lists Paint the back fence; key `…:task:{stainDeck}` |
| O26 | Every template, at every band, age and coverage | No word from the M5, M6 or M7 lists |

#### P — Privacy and the gate

| # | Given | Expect |
|---|---|---|
| P1 | Sam adds a private event Saturday 12:00–13:00, a private all-day event on Sunday, a private dry-weather task with an estimate, a private person on a private event and a private stale calendar | Alex's gaps, coverage, openings, keys, Today, Forward and rendered pages byte-identical; Sam's Saturday splits and Sam's Sunday has no gap |
| P2 | Alex dismisses and marks Not useful on openings | Sam's openings and responses unchanged |
| P3 | Sam's private event in P1 | Its title, times and existence appear nowhere in Alex's Why, facts, keys or counts |
| P4 | Both adults read the forecast | The same row; no actor data in it; the `weather.refresh` audit row is in the triggering adult's Activity only, with `{ status, hours }` |
| P5 | Schema, export, audit metadata, logs and client HTML after a refresh | No coordinate, elevation or provider URL anywhere |
| P6 | The export | `weather_forecast` excluded with its reason; export completeness passes |
| P7 | Production, gate closed | No refresh; Dismiss and Not useful refused; no opening can exist (no records) |
| P8 | A `via: 'kev'` actor calls the refresh | Refused before any query |

#### X — Cross-cutting: render, presentation, determinism, performance, regression

| # | Given | Expect |
|---|---|---|
| X1 | Today and Forward rendered with a provider that throws if called | Both render; no provider call; the refresh client posts after render only when due |
| X2 | Query counts for Today, Forward and `respondToInsight` | Each exactly one more than M6's; unchanged after 20 more events, tasks and a second calendar |
| X3 | The 300-event synthetic household | Gaps over seven days and openings each under 10 ms on the dev container; recorded in Package 5 |
| X4 | JavaScript off | The cached forecast with its time; Why opens; Dismiss and Not useful post and return to the same page with the opening gone; no refresh request |
| X5 | Four viewports | Axe clean; no horizontal scroll; 44px targets; on a phone, Today's headline, weather sentence and first Worth knowing row on the first screen |
| X6 | Each state in §4.4 | Exactly the table's output |
| X7 | The provider failing for 13 hours | Today: "The forecast hasn't updated since {when}."; Forward: no phrases, no credit; openings without weather; no word "error" |
| X8 | The M1–M6 suites | Pass; the M5 and M6 forbidden-phrase tests unchanged |
| X9 | Fixed `now` and forecast, rendered twice | Today and Forward byte-identical |
| X10 | `package.json` | No new runtime dependency |
| X11 | CSP | Unchanged; its unit, script and browser checks pass |
| X12 | Month, Season and a person's Coming up | No phrases, no credit, no openings |

---

## 9. Documentation

- **Package 0:** this contract and ADR 0011; the ROADMAP M6 and M7 rows; the status line in `CLAUDE.md`; the M6 contract and ADR 0009 status lines (Package 5 merged); dated annotations in SYSTEM-ARCHITECTURE (§2.2, §2.4, §2.6), FAMILY-DATA-MODEL (WeatherCache) and KEV-AGENT-MODEL (`find_free_windows`, `get_weather`).
- **Each package:**
  - ADR 0011 amended with an "Implementation" section and any changed decision;
  - this contract's status line updated.
- **Package 1a:** FAMILY-DATA-MODEL's `weather_forecast` entry.
- **Package 1b:** the runbooks' local-dev lines for `HOME_LAT`, `HOME_LON` and `HOME_TEST_WEATHER`.
- **Package 4:** `docs/concepts/TODAY.md` (its "As built" annotation, for M5 and M7) and `docs/concepts/FORWARD.md` (the weather line) annotated; BRAND.md's credit line and its superseded voice example.
- **Package 5:** `docs/m7/M7-ACCEPTANCE.md`; DEPLOY.md §E items 20–22 and the environment rows.

---

## 10. Acceptance criteria

### 10.1 Technical acceptance (synthetic data)

| # | Criterion | Measured by |
|---|---|---|
| 1 | **Correctness.** Bands, phrases, sentences, daylight, gaps, coverage, candidates, matching, templates and caps follow §5 exactly on every scenario and boundary in §8.1. | §8.6 W, G, O; scenario snapshots |
| 2 | **Determinism and identity.** Engines are pure. The same input and `now` give identical output regardless of input order. Ranking is total. Keys change exactly as §5.7 says, never with the forecast's numbers or the passage of time. | G20, O5–O8, O24; import-boundary test |
| 3 | **Explainability.** Every sentence, phrase and opening carries its rule and facts and shows them in place without JavaScript. An opening's Why names the commitments either side, who it covers, the calendars' freshness, daylight, the forecast's time and the limit sentence. | Traceability tests; X4 |
| 4 | **Privacy.** Nothing for one adult reflects anything only the other can see. The location is never stored, logged, exported or sent to the client. Responses and refresh audit rows are one adult's. | §8.2; P1–P8 |
| 5 | **No unsupported inference.** No availability, suitability, recommendation, need, travel or outdoor reading. No statement built on absence beyond "nothing is recorded", with its scope and limits. | Forbidden phrases (O26); absence tests; review checklist |
| 6 | **Freshness and uncertainty.** The forecast's age is always said or its words withheld, exactly at §5.1's limits. No hour-precise words beyond tomorrow and none beyond day 6. | W7, W14, W15, X7 |
| 7 | **Healthy quiet.** No opening on weekdays, on first run or without a firing rule. Today lists at most one opening and Forward two; openings never displace M5 or M6 insights. | O9, O17–O22 |
| 8 | **Accessibility.** The axe baseline at four viewports; keyboard; 44px; text, not icons; nothing by colour alone. | X5 |
| 9 | **Performance.** One more query per page, constant in record counts. No LLM or network on render. Engine and render times measured and recorded. | X1–X3 |
| 10 | **Reliability.** Today and Forward work with no location, no forecast, a failing provider, no calendars and no Kev. A refresh never runs twice at once and never more than hourly. | W8–W12, X6–X7 |
| 11 | **Scope.** Nothing in §1.3: no availability, `alignment`, warnings, Kev, proposals, writes outside HOME, learning, weather on Month or Season, or new dependency. One new table only. | Review checklist; `package.json` diff; migration list |
| 12 | **Production gate.** `HOME_REAL_DATA` stays closed. No real data or location is used. The refresh and responses are refused while it is closed. Earlier operational items remain open and are not marked complete. | W13, P7; DEPLOY.md §E unchanged except the new rows; acceptance doc |
| 13 | **Family usefulness (synthetic).** On the scenarios at phone width, the owner confirms from screenshots that the weather reads at a glance, that an opening reads as a fact rather than advice, and that nothing reads as an alarm or a nudge (concepts README design tests 1, 2, 7). | Screenshot evidence; owner review in Packages 4 and 5 |
| 14 | **Handover.** Each package had its stated review. Every Blocker and Important finding was fixed before merge. Carry-forwards are recorded. | Package reviews; M7-ACCEPTANCE |

### 10.2 Operational acceptance (real family use, after the gate opens)

These are DEPLOY.md §E items, added in Package 5, with the environment table's rows for `HOME_LAT`, `HOME_LON` and `HOME_ELEVATION`:

- **20. The forecast in Preview:** the synthetic public point set in Preview; the boot line reads `weather location: set`; Today and Forward Week show the forecast with the credit after a refresh; Activity shows `weather.refresh` with the status only; Preview's runtime logs show no coordinate or provider URL. (May be done while the gate is closed.)
- **21. The home location in Production, after the gate opens (item 11):** the owner sets `HOME_LAT` and `HOME_LON` (two decimal places) and, optionally, `HOME_ELEVATION`, and redeploys; the boot line reads `set`; the first refresh succeeds; the forecast reads sensibly against the sky outside; Production's logs show no coordinate.
- **22. Openings on a real weekend:** each adult opens Today and Forward Week before a weekend; any opening matches what is recorded; nothing private to the other adult appears; Dismiss and Not useful stay one adult's; the owner confirms that "nothing is recorded" reads as a fact, not as advice or a claim that anyone is free. Usefulness itself is evaluated in the M10 trial, with the `not_useful` review.

M7 is fully accepted only when both technical and operational acceptance are recorded.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| "Nothing recorded" read as "free" | The wording, the forbidden lists, the fixed limit sentence in every Why, weekends only, owner screenshot approval, item 22 |
| An under-recorded household gets openings everywhere | Weekends only (D14); at most one on Today and two on Forward, ranked last; Not useful; evaluated in the M10 trial |
| One adult's private time inferred from the other's view | Per-reader computation only; the invariant through the real services and in rendered pages; no system actor |
| The home location leaking | Env only, rounded at the boundary, redacted keys, no URL logged, no column, a privacy test over schema, export, audit, logs and HTML |
| Provider refusals on Vercel's shared IP | Hourly refresh by attempt, 3-hour wait after `429`, the last good forecast kept, a named contingency (D1) |
| Forecast wrongness read as HOME's fault | Bands not numbers; the time always available; no hour-precise words beyond tomorrow; credit to the source |
| DST errors from provider local times | `unixtime` only, UTC storage, HOME's own conversion; DST tests on both change days |
| Keys churning with each forecast | Weather never in a key; identity from the stretch only (§5.7) |
| Today's first screen crowded (M6 carry-forward) | One sentence, at most one opening, ranked last; X5 measures the first screen |
| The `safe-fetch` boundary weakened | A separate frozen policy; the calendar suite unchanged; a high-intensity review of Package 1b |
| Weather becoming a widget | Words only; no icons, numbers or charts on the surface; phrases at most four words |
| Unassigned events blocking too much or too little | D11 and D12 written down and tested (G7–G10); named in Why so the reader sees the evidence |
| A task opening feeling like a nudge | Facts only: the task as recorded, the stretch, the forecast; no "you could"; Dismiss and Not useful |

---

## 12. Decisions

### 12.1 Settled (inherited)

| Source | Decision |
|---|---|
| ADR 0008 §5, §6; ADR 0009 §5, §7 | Four layers; absence proves nothing; no free time from empty space |
| ADR 0008 §20 | The weather line comes with M7's adapter |
| ADR 0009 §17 | Not useful is explicit feedback, never learning |
| ADR 0009 §13, §19 | Response lifecycle; responses reach every surface |
| ADR 0007 §42; CLAUDE.md rule 13 | Integrations behind HOME-defined interfaces, one composition root per integration |
| CLAUDE.md rules 1, 5, 7, 9, 10, 15 | Privacy below the UI; code computes; external content is data; no real data; no secrets; insights derived |
| V0.1-SCOPE D11 | Home location in private configuration, never in source |
| ROADMAP "Not yet" | No push, no background jobs, no stored insights |

### 12.2 Open product decisions for the owner

Each decision is proposed in ADR 0011 at the section named. **Recommended** options are marked.

#### D1 — Weather provider and contingency (ADR 0011 §11)

| Option | Consequence |
|---|---|
| **A. Open-Meteo free, one adapter, no live fallback (recommended)** | $0, no key or account; CC BY credit on screen; occasional refusals on Vercel's shared IP, absorbed by the cache |
| B. Open-Meteo Standard (about US$29 a month, unconfirmed) | A key (a new secret), a 99.9% target, no shared-IP limit; a monthly cost |
| C. MET Norway as primary | Free; a contact string in env for its User-Agent; UTC; New Zealand probability and gusts unconfirmed |

**Recommendation:** A. If `rate_limited` rows recur in Production, the owner chooses B or a MET Norway adapter then, with that evidence.

#### D2 — Home location: where it lives and when it is set (ADR 0011 §13)

| Option | Consequence |
|---|---|
| **A. `HOME_LAT`, `HOME_LON`, optional `HOME_ELEVATION` in env; rounded to 2 dp (10 m); never stored; set in Production only after the gate opens (recommended)** | No schema, no screen; changing it is a Vercel setting and a redeploy; the first Production setting since M4 |
| B. A household settings row in the database | A migration, an edit screen, audit and export decisions, and a location in the database |
| C. One decimal place | About 11 km: a whole model cell; noticeably worse temperatures near hills and coasts |

**Recommendation:** A.

#### D3 — Forecast cache: storage, retention, export (ADR 0011 §14)

| Option | Consequence |
|---|---|
| **A. One `weather_forecast` row per provider; replaced on success; hours cleared after 24 hours of failure; no location column; excluded from export (recommended)** | One additive table; nothing personal stored; a location change shows the old forecast for up to an hour |
| B. A, plus the rounded coordinates in the row | A changed location is detected at once; the location is then in the database and its backups |
| C. No table (in-memory or framework cache) | Fetches on render on cold instances; non-deterministic; rejected (§3.1) |

**Recommendation:** A.

#### D4 — Refresh: gate and audit (ADR 0011 §16)

| Option | Consequence |
|---|---|
| **A. Gated like a family-domain write; one structural `weather.refresh` audit row per attempt, visible only to the triggering adult (recommended)** | Inert in Production until the gate opens, even if a location is set; rule 8 holds; no adult learns when the other opened HOME |
| B. Gated; audit rows household-visible | As A, but each adult's Activity shows the other's refreshes |
| C. Not gated, not audited (a cache, not a record) | Fewer rows; but a request could reveal the location before the gate opens, and rule 8 needs an exception |

**Recommendation:** A.

#### D5 — Forecast thresholds (ADR 0011 §17)

| Option | Consequence |
|---|---|
| **A. Dry: every hour ≤ 20% and < 0.2 mm. Rain likely: any hour ≥ 60% or ≥ 1.0 mm. Windy: gusts ≥ 50 km/h. Code constants, changed by ADR amendment after the M10 trial (recommended)** | Conservative "dry"; New Zealand showers often land in "showers possible" |
| B. Looser dry (≤ 30%, < 0.5 mm) | More dry days and task openings; more "dry" days that drizzle |
| C. Owner-set values | A settings surface M7 does not otherwise need |

**Recommendation:** A.

#### D6 — Horizon and freshness presentation (ADR 0011 §15, §17)

| Option | Consequence |
|---|---|
| **A. Part-of-day words for today and tomorrow; one day band for days 2–6; nothing beyond. Fresh under 3 h; older 3–12 h with its time; over 12 h withheld, with Today's stale line (recommended)** | Words never claim more precision than the forecast has |
| B. Hourly words for three days, day bands to day 9 | Precision the model does not have; contradicts §6.4 |
| C. Withhold anything over 3 hours old | More blank days when the provider is down |

**Recommendation:** A.

#### D7 — Severe-weather warnings (ADR 0011 §21)

| Option | Consequence |
|---|---|
| **A. None in M7 (recommended)** | Simpler; no feed, area matching or terms review |
| B. MetService CAP warnings, verbatim and credited, as an insight | A second integration, its Code of Practice, area matching, and a strong pull towards notifications |

**Recommendation:** A. B would be its own decision and package.

#### D8 — Attribution placement (ADR 0011 §20)

| Option | Consequence |
|---|---|
| **A. One credit per page with forecast words: on Today a small muted "Open-Meteo" link after the weather sentence (or, with no sentence, after the first opening citing the forecast); on Forward Week "Forecast as of {time} · Open-Meteo" beside the Coming up label; repeated in an opening's Why (recommended)** | Meets "a link next to" the data; one quiet mark per surface |
| B. One credit in the page footer | Probably not "next to" the data, as the licence asks |
| C. Inside Why only | Hidden until opened; doubtful against the licence |

**Recommendation:** A.

#### D9 — Planning hours (ADR 0011 §22)

| Option | Consequence |
|---|---|
| **A. 08:00–20:00, a code constant (recommended)** | No schema or screen; the same for everyone |
| B. 07:00–21:00 | Longer stretches; early and late hours rarely suit household jobs |
| C. Owner-set | A settings surface |

**Recommendation:** A.

#### D10 — Minimum opening length (ADR 0011 §26)

| Option | Consequence |
|---|---|
| **A. Two hours for openings; 60 minutes as the engine's floor (recommended)** | Short stretches are never offered; M8 can ask for an hour |
| B. One hour | Many short, low-value openings |
| C. Three hours | Fewer openings; matches the fixture's fence but not shorter jobs |

**Recommendation:** A.

#### D11 — Timed events with no household person (ADR 0011 §23)

| Option | Consequence |
|---|---|
| **A. Block the household scope and are named in Why; do not block a person's scope, but a person's gap names them (recommended)** | Never claims "nothing recorded" for the household over a recorded household event; does not silently block everyone's personal view |
| B. Block nothing | A recorded event inside "nothing is recorded for the household": false |
| C. Block every scope | One unassigned event erases every person's gaps |

**Recommendation:** A.

#### D12 — All-day events with no household person (ADR 0011 §23)

| Option | Consequence |
|---|---|
| **A. Do not block; named in the day's Why (recommended)** | Public holidays and birthdays-as-events do not erase weekends; the evidence is shown |
| B. Block the household's whole day | Every holiday and recorded birthday removes the day |

**Recommendation:** A. An all-day event *with* a household person always blocks that person and the household.

#### D13 — Coverage (ADR 0011 §25)

| Option | Consequence |
|---|---|
| **A. No live calendar: no gaps or openings. Any calendar failed, stale (24 h) or never refreshed: openings qualified, calendars named (recommended)** | A manual-only household gets no openings; nothing is offered over unknown data |
| B. Allow openings from manual records alone | A household that records little would see openings on almost every weekend |
| C. Withhold openings when any calendar is unhealthy | Fewer, but a single failing calendar silences them |

**Recommendation:** A.

#### D14 — Which openings ship, and on which days (ADR 0011 §29)

| Option | Consequence |
|---|---|
| **A. Plain and task openings, Saturday and Sunday only (recommended)** | Few, predictable; weekday work rarely recorded would otherwise make noise |
| B. A, plus any weekday with a stretch of four hours or more | Weekday openings where work is not on a calendar: likely noise |
| C. Task openings only | Fewer; no "nothing recorded" observations without a waiting task |

**Recommendation:** A, over B: the fixture's weekdays have no recorded work, and B would show an opening on every one of them, as it would for any household whose work is not on a calendar.

#### D15 — Caps and order (ADR 0011 §34)

| Option | Consequence |
|---|---|
| **A. Today one (today or tomorrow), Forward Week two; `open_window` after every existing family; chronological (recommended)** | Openings never displace M5 or M6 insights; never ranked by importance |
| B. Task openings ranked above plain ones | A judgement of importance M6 §5.3 avoids |
| C. Openings ranked before `busy_day` and `preparation` | More prominent; pushes Today's existing observations down |

**Recommendation:** A.

#### D16 — Placement (ADR 0011 §34, §37)

| Option | Consequence |
|---|---|
| **A. Today: sentence and one opening. Forward Week: day phrases and openings. Month, Season, a person's Coming up: nothing (recommended)** | Weather only where it is skilful; no per-person "nothing recorded" statements |
| B. A, plus per-person gaps on a person's Coming up | A statement about one person's time; closer to availability |
| C. A, plus gaps (no weather) on Month | Long-range "nothing recorded" lists on a summary view |

**Recommendation:** A. FORWARD.md's "only where it matters" line is replaced by a phrase on every Week day: no record says what is outdoors.

#### D17 — `alignment` (ADR 0011 §36)

| Option | Consequence |
|---|---|
| **A. Deferred; no "both adults" statements in M7 (recommended)** | No statement that is wrong for one adult or leaks the other's private time |
| B. Build it from each reader's view | "Both of you have nothing recorded" can be false for the other adult, by their private events |
| C. Build it with anonymous blocks from private events | A new disclosure of private time; needs its own privacy decision |

**Recommendation:** A. The ROADMAP M7 row is narrowed.

#### D18 — `weather_effect` (ADR 0011 §36)

| Option | Consequence |
|---|---|
| **A. Folded into task openings; no outdoor-event rule (recommended)** | A dry-weather task's opening appears and disappears with the forecast; nothing is guessed about events |
| B. A separate insight when the forecast turns wet over a dry-weather task | Duplicates the opening's disappearance as a warning; nudges |
| C. Infer outdoor events from titles | Inference from text; against ADR 0008 §6 |

**Recommendation:** A. The ROADMAP M7 row is narrowed.

#### D19 — The package plan (ADR 0011 §39)

| Option | Consequence |
|---|---|
| **A. Seven packages: 0, 1a (migration), 1b (weather), 2 (gaps), 3 (openings), 4 (screens), 5 (acceptance) (recommended)** | Migration-first; each engine reviewed before anything presents it |
| B. Merge 2 and 3 | One fewer review; a larger high-risk package |

**Recommendation:** A.

### 12.3 Considered and not proposed

| Item | Why not |
|---|---|
| Narrowing a stretch to its dry hours for a task opening | Weather would then shape the key, and hour-level dry timing is weak beyond a day. Revisit with M10 evidence. |
| Openings for a person (the task's assignee) rather than the household | A statement about one person's time is closer to availability; the household statement is the conservative one |
| Transport buffers or travel time around commitments | No record supports them (ADR 0009 §20) |
| Treating kind `work` or `school` as not blocking | Inference from kind; HOME states what is recorded |
| Temperature words ("mild", "cold") | Judgements; the numbers are in Why |
| A weather icon set or a temperature line | TODAY.md: "no weather widget"; words only |
| Using Open-Meteo's sunrise and sunset | Fixed-offset and grid-cell errors; HOME computes it better |
| Background refresh (cron) | ROADMAP "Not yet" |
| Planning hours per person or per day | Settings and schema M7 does not need |
