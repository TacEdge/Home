# M7 — Weather and Free Windows: acceptance check

Checked against `M7-BUILD-CONTRACT.md` §2.2, §8, §9, §10 and §11, and ADR 0011, on 2026-10-13 (Package 5), first on `main` at the Package 4 merge (`331bf7b`; PRs #70, #71, #72, #75, #76, #78), then **reconciled on `main` at `a1f1ce3`**, which adds PR #80 (the owner-approved acceptance evidence corrections Q1–Q6 and Q8, tests only; ADR 0011 §47). Each requirement was checked against the code and the tests that run in CI, reading the assertions rather than the test titles and reusing the evidence of Packages 1a–4 where it holds. This package changes no product code, test, script or configuration; the tests it cites from PR #80 merged on `main` before this reconciliation. Synthetic data only: the fixture family, seeded scenarios on fixed synthetic days, scenario forecasts written by the test harness and the contract's synthetic public point (Wellington's Civic Square). No real calendar, address, location or family data was used anywhere. `HOME_REAL_DATA` stays closed, and no weather location or location key is set in Production.

**Verdict after PR #80: the technical acceptance evidence for M7 is complete on synthetic data. Recommendation: accept M7 (technical, on synthetic data), subject to the owner's sign-off and screenshot judgement (criterion 13); M7 is not declared accepted here.** Every row the assessment found weak because a test asserted less than the requirement (Q1–Q6), and the redaction scan that could fail by chance on a timestamp (Q8), now has a test that CI runs: the owner approved the corrections and PR #80 built them as tests only, each with its mutation proof (ADR 0011 §47). No matrix row is FAIL or Not verified and no caveat is class A. Package 2's mutation proof was re-run for this reconciliation (row 2-3), and the review record for criterion 14 is the ADR's. Three rows stay Met (weak), outside the approved corrections and named in §8 (E-1, U-7, E-6), and three carry a recorded limitation (W9, X6, the browser rows). The owner approved both product decisions on 2026-10-13, with behaviour unchanged (§8). Operational acceptance on the family's real use remains DEPLOY.md §E items 20–22.

*Original assessment (2026-10-13, on `331bf7b`):* verdict B, accept M7 on synthetic data after targeted corrections. No row was FAIL and no caveat class A; a few rows were weak because a test asserted less than the requirement (Q1–Q6), one test could fail by chance on a timestamp (Q8), and two product decisions, the screenshot review and the review record were left for the owner.

The full evidence matrix (167 requirement rows, each with its implementation, the test and its assertion, a result and the remaining action) is `M7-ACCEPTANCE-MATRIX.md`, the assessor's working file. This document summarises it and adds the walkthrough, the measurements and the decision. Both were reconciled after PR #80: where they cite evidence, they cite the final tests.

## 1. Contract coverage (summary; the full matrix is `M7-ACCEPTANCE-MATRIX.md`)

Result key: **Met** = an assertion in a test that runs in CI proves it; **Met (weak)** = a test exists but asserts less than the requirement, named; **Not verified** = only code reading, a document or a developer report supports it; **Owner** = the owner's judgement. A Met row may carry a limitation recorded in ADR 0011 §47 (named in §8).

| Area (contract) | Rows | Met | Met (weak) | Not verified | Owner |
|---|---|---|---|---|---|
| Package 1a acceptance (§2.2) | 5 | 5 (1a-5 by reading FAMILY-DATA-MODEL) | 0 | 0 | 0 |
| Package 1b acceptance (§2.2) | 8 | 8 (1b-1: W9's timeouts, Q1) | 0 | 0 | 0 |
| Package 2 acceptance (§2.2) | 3 | 3 (2-3: the mutation proof re-run, five mutations, each failing named tests) | 0 | 0 | 0 |
| Package 3 acceptance (§2.2) | 4 | 4 | 0 | 0 | 0 |
| Package 4 acceptance (§2.2) | 5 | 4 (4-1: no-JS at four viewports, Q6) | 0 | 0 | 1 (4-5: screenshots) |
| Package 5 acceptance (§2.2) | 1 | 1 (this document, the matrix, DEPLOY §E 20–22) | 0 | 0 | 0 |
| W: weather, freshness, daylight (§8.6) | 23 | 23 (W9, Q1; W18, Q8) | 0 | 0 | 0 |
| G: gaps and coverage (§8.6) | 25 | 25 | 0 | 0 | 0 |
| O: openings, identity, responses (§8.6) | 26 | 26 | 0 | 0 | 0 |
| P: privacy and the gate (§8.6) | 8 | 8 (P1, Q3; P5, Q8) | 0 | 0 | 0 |
| X: cross-cutting (§8.6) | 12 | 12 (X1, Q2; X4 and X5, Q6; X6, Q5) | 0 | 0 | 0 |
| Unit requirements (§8.1) | 10 | 9 | 1 (U-7: absence by word lists) | 0 | 0 |
| Privacy invariant (§8.2) | 2 | 2 (PI-1, PI-2, Q3) | 0 | 0 | 0 |
| Integration (§8.3) | 5 | 5 (I-2, Q4) | 0 | 0 | 0 |
| End to end (§8.4) | 6 | 4 | 2 (E-1: unusable, absent and qualified states in the browser at phone only; E-6: keyboard) | 0 | 0 |
| ADR decisions with testable behaviour | 24 | 24 | 0 | 0 | 0 |
| **All rows** | **167** | **163** | **3** | **0** | **1** |

The §10.1 criteria, by the same reading:

| # | Criterion | Status | Where the evidence is (matrix rows) |
|---|---|---|---|
| 1 | Correctness: bands, phrases, sentences, daylight, gaps, coverage, candidates, matching, templates and caps follow §5 on every §8.1 boundary | Met | W1–W17, G1–G25, O1–O25, U-3; 2-3 (Package 2's mutations re-run) |
| 2 | Determinism and identity | Met | G15, G20, O5–O8, O24, U-4, U-5, U-8 |
| 3 | Explainability: rule and facts in place without JavaScript; an opening's Why names both sides, who it covers, the calendars, daylight, the forecast's time and the limit sentence | Met | U-6, X4 (no-JS at four viewports, Q6), the opening-Why unit and integration tests |
| 4 | Privacy | Met | P1–P8, W18, W21, W23, PI-1, PI-2; the rendered invariant now covers the private person and the scheduled task and compares the models (Q3); the redaction scan cannot fail by chance (Q8) |
| 5 | No unsupported inference | Met (weak) | O26, U-7, 3-2; scope checks (no `alignment`, `weather_effect`, warning or outdoor code); absence proven by word lists, as in M6 (an accepted limitation, §9) |
| 6 | Freshness and uncertainty | Met | W7, W11, W14, W15, W20, X7 |
| 7 | Healthy quiet | Met | O9, O17–O22 |
| 8 | Accessibility | Met (weak) | X5 (axe, no scroll and 44px on Today and Forward Week at four viewports, Q6); E-6: keyboard rests on native `<details>`, links and buttons and axe, with no keyboard test of the weather Why or credit link |
| 9 | Performance | Met | X1 (transports spied, Q2), X2, X3; §5 below |
| 10 | Reliability | Met | W8–W12 (W9's timeouts, Q1), W20–W23, X6 (first run with a forecast, Q5; Today's at integration level), X7 |
| 11 | Scope | Met | X10, the migration list (`0008` only), a grep of `src` |
| 12 | Production gate | Met | W13, P7; DEPLOY §E 20–22 and the environment rows added by this package, earlier items left open; §3 below |
| 13 | Family usefulness (synthetic) | **Owner** | 4-5; the screenshot set (§4) and the curated 12-screenshot set provided for review (synthetic, not committed). Not marked met: the judgement is the owner's |
| 14 | Handover | Met (record in ADR) | Each package's focused review, requested by the owner, reported in session and recorded in ADR 0011 §43–§48 and the PR bodies; every Blocker and Important finding fixed before merge (PR #76's openings held unlisted until Package 4 and the conservative project rule, §45; PR #78's presentation corrections, §46; PR #80's evidence corrections, §47); carry-forwards #73, #74, #77 (§7). GitHub holds no review objects on the M7 PRs (#70–#72, #75, #76, #78, #80); the contract asks that each package "had its stated review", measured by "Package reviews; M7-ACCEPTANCE", which this record meets (§8) |

## 2. Technical acceptance

### A. Weather

- **Request and privacy.** The adapter's GET is exactly §5.1's: the rounded point, five variables, eight days, `unixtime`, no time zone, two headers (W1, asserted with `toEqual`; captured headers). Elevation is rounded to 10 m and the exact values appear nowhere (W2, through the adapter, the service, the logs and the markup). The approved host, `https`, path, redirect and private-address refusals hold with no DNS lookup for a wrong host (W17). The calendar `safe-fetch` suite is unchanged (1b-7).
- **Normalisation and failures.** Preceding-hour values map to the hour they describe across both DST windows (W3). Every malformed answer, timeout, `429`, `500` and oversize body gives one of §5.1's codes, leaves the hours and `fetched_at` unchanged, sets the attempt, writes one audit row and leaks nothing into the error, log, response, audit or row (W4, W10, W18, W23).
- **Freshness and location.** 2:59 fresh, 3:00 older, 12:00 older, 12:01 unusable (W7); a failure at 24:01 clears the hours (W11). A changed location, elevation or key shows no forecast until a successful refresh, and the first attempt clears the old hours (W20, W21). The location fingerprint matches the committed vectors, recomputed independently with `openssl` (1b-4).
- **Refresh.** Hourly by attempt and three hours after `rate_limited` (W8); single-flight under a transaction-level advisory lock, one provider call for two requests (W9); a refresh stopped after the fetch writes nothing and releases its lock at once or within the idle timeout (W22); unconfigured or invalid settings make no query and no request (W12); the gate refuses before any query (W13); Kev and system actors are refused (P8). On the backend that holds the lock, during the fetch, `statement_timeout` is `5s` and `idle_in_transaction_session_timeout` `25s`; an 8-second statement is cancelled after about 5 s, and both settings are gone after commit (Q1, `weather.test.ts` › "W9, §5.1: the timeouts take effect inside the refresh's own transaction"). The 25 s timeout's effect is proven by W22 (a limitation recorded in ADR §47).
- **Daylight.** Within one minute of the reference table on every date (W16). The table was computed with PyEphem (ADR 0011 §43); for this package it was recomputed with an independent implementation of NOAA's spreadsheet algorithm: all ten instants within 3 seconds.

### B. Free windows (gaps and coverage)

- G1–G25 are asserted in `tests/unit/gaps/gaps-engine.test.ts`, each named with its row, with exact text and keys: the 60-minute floor, planning edges, overnight events, a timed event with no household person blocking the household but not the person it lacks (and named in Why), all-day rules, scheduled tasks, skipped and changed occurrences, both DST Sundays, another zone, coverage in six cases and an uncovered day refused (`GapRangeError`).
- Keys are stable across eight shuffled seeds (deep and byte equality) and as `now` moves, and fit `insightKey` (G15, G20, G21). P1 holds for gaps and coverage through the real services (`tests/integration/gaps.test.ts`).
- The Package 2 mutation proof was re-run for this reconciliation on an out-of-repo copy of `e70e61c` (2-3): dropping the unassigned rule failed 7 tests in `gaps-engine.test.ts`, letting an unassigned all-day event block 2, removing the household filter 3, keying from the clipped start 2, and dropping the interval tie-break 1 (G20). Each was restored; no repository file changed.

### C. Openings

- O1–O26 are asserted at unit level (`tests/unit/openings/openings-engine.test.ts`), with O1–O3, O7, O18–O21 and O23 also through the real services (`tests/integration/openings.test.ts`). Weekends only (O9); 119 versus 120 minutes on the shown span (O10); task eligibility from recorded fields only, never a title (O11–O13, the conservative project rule O12a–g, ADR §45); a forecast over 12 hours old gives plain openings (O14); no location gives planning hours with no daylight and no weather (O15); partial coverage qualifies (O16); no live calendar gives none (O17).
- **Identity.** A refreshed forecast keeps the key and changes only the ending (O5, O6); a dismissed opening stays hidden after the forecast refreshes, for that adult only (O7); a moved commitment gives a new key that is eligible again (O8); midnight keeps the key (O24).
- **Responses.** Dismiss and Not useful from Today and Forward are audited with the kind only, idempotent and hidden on both surfaces; a person page or crafted key is `not_eligible`; the gate refuses before any query (O23); a not-current opening is refused and nothing is written (O21). A key derivable only for the other adult is refused for Alex on both surfaces with nothing written, while Sam's own responses to it are accepted (I-2, Q4, `openings.test.ts` › P3 › "I-2: a foreign key…").
- **Listing.** Today lists at most one and Forward Week two, after every other family; "+ N more" counts them (O18–O22, ADR §45). Every template and rendered string passes the M5, M6 and M7 forbidden lists, and "likely" appears only in "rain likely" (O26, 3-2).

### D. Presentation

- Today: the sentence after the headline, its Why and the credit link; the stale line with no credit; the evening sentence about tomorrow (W15, X6, X7). Forward Week: a muted phrase per day for today to today + 6 only, and one credit line beside Coming up (W14, W19). Month, Season and a person's page show no phrase, credit or opening and read no forecast (X12).
- The credit link appears wherever forecast words are and nowhere else, as a real link with `rel="noreferrer"` and a 44px target (4-3, W19). On a phone, the headline, the weather sentence and the first Worth knowing row are on the first screen (4-2). Axe, no horizontal scroll and 44px targets on Today and Forward Week at four viewports with every Why open (X5, Q6).
- Without JavaScript: the cached forecast with its time, Why as `<details>`, Dismiss and Not useful as forms that post back with the opening gone, and no refresh (X4), at each of the four viewports (4-1; Q6, `weather.spec.ts` › "X4 at {vp}", "X4, O23 at {vp}").
- Two renders with a fixed `now` and forecast are byte-identical for both adults (X9). First run (no live calendar) with a fresh forecast: Forward Week keeps its phrases and credit line with no openings, and Today's `first_run` state keeps the weather sentence and one credit link (X6, Q5; integration level). The two-adult sweep covers Today and Forward Week with openings (4-4).
- **Evening sentence.** Contract §4.4's example ("Tomorrow: looks dry until midday, then showers possible.") is the two-run shape of §5.2's `weather.tomorrow` template; the as-built "Rain likely tomorrow." is its one-run shape ("{Band} tomorrow."). Both are §5.2's, so the contract is unchanged.

## 3. Privacy and the gate

| Check | Result | Evidence |
|---|---|---|
| No real family data is enabled | Holds | `HOME_REAL_DATA` is not `open` anywhere; nothing in this package touches Vercel settings. Every acceptance record, forecast and screenshot is synthetic. CI's `check:private-terms` step passed on `331bf7b` and on PR #80's head `8a463b3` |
| No real location is used or set | Holds | Production's `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` and `HOME_WEATHER_LOCATION_KEY` stay unset until DEPLOY §E item 21, after the gate (item 11). Tests and fixtures carry only the contract's synthetic public points (1b-3) |
| The location is never stored, logged, exported or sent to the client | Holds | No coordinate, elevation or location column; the fingerprint only in its column (1a-3, P5); six redacted log keys (W18, `weather-log.test.ts`); nothing location-bearing in the markup (W2, weather-screens) |
| The location key never leaves `env.ts`; no error carries the location or the key | Holds | W21 (key cases, boot line with no value), W4, W10, W23 (errors carry the code only) |
| The refresh and responses are refused while the gate is closed | Holds | W13 and the gate test in `openings.test.ts`: `real_data_closed` before any query, query count unchanged |
| Nothing for one adult reflects what only the other can see | Holds at data level, in the page models and on the rendered pages | P1 (gaps through the real services; rendered Today and Forward byte-identical, with the private person on a private event and the private scheduled task, and the Today model, `ForwardModel` and both listings deep- and JSON-equal, Q3; the browser sweep's `main` byte-equal), P3; a foreign opening key refused (I-2, Q4) |
| Responses and refresh audit rows are one adult's | Holds | P2 (Alex's responses change nothing of Sam's), P4 (the refresh audit in the triggering adult's Activity only, `{status, hours}`), O23 (kind only) |
| Kev has no path | Holds | P8 (Kev, sync and system actors refused before any query); no Kev code exists for M7 |
| No external write; no new dependency; one table | Holds | The provider call is a GET under a frozen policy (W17, §19); `package.json` and the lockfile unchanged across M7 (X10); one migration, `0008` (1a-1) |
| Export excludes the forecast with its reason | Holds | P6, `export-completeness.test.ts` |

## 4. Product walkthrough (screenshot review, not a test result)

Walker B seeded the fixture family on fixed synthetic days (Wednesday 14 October 2026 at 07:03 and 19:30, Saturday 17 October at 07:30, NZDT) with the fake provider's synthetic forecast on the weather server, and scenario 9 on the main server (no weather configured). Each scene was captured at phone, tablet-portrait and desktop, with a separate phone first-screen shot, and with the first screen at every viewport for each Why-open scene: **100 screenshots**. They are in this session's scratchpad (`m7-walk/`, with `metrics.tsv` and `text.txt`), synthetic and never committed, as in M6; the same scenes are reproducible from `tests/e2e/weather.spec.ts` (`test-results/screenshots/weather-*`) and the walkthrough brief.

| Scene | Phone | Tablet-portrait | Desktop |
|---|---|---|---|
| 01 Today, fresh forecast | ✓ (+ first screen) | ✓ | ✓ |
| 02 Today, forecast 14 hours old (stale line) | ✓ (+ first screen) | ✓ | ✓ |
| 02b Today, forecast 10 hours old ("As of …") | ✓ (+ first screen) | ✓ | ✓ |
| 03 Today, Saturday, with an opening | ✓ (+ first screen) | ✓ | ✓ |
| 04 Today, evening | ✓ (+ first screen) | ✓ | ✓ |
| 05 Forward Week | ✓ (+ first screen) | ✓ | ✓ |
| 06 Forward Week, openings | ✓ (+ first screen) | ✓ | ✓ |
| 07a Today, an opening's Why open | ✓ (+ first screen) | ✓ (+ first screen) | ✓ (+ first screen) |
| 07b Forward, an opening's Why open | ✓ (+ first screen) | ✓ (+ first screen) | ✓ (+ first screen) |
| 08a Today, the weather Why open | ✓ (+ first screen) | ✓ (+ first screen) | ✓ (+ first screen) |
| 08b Forward, the credit line's Why open | ✓ (+ first screen) | ✓ (+ first screen) | ✓ (+ first screen) |
| 09a/09b Today and Forward, no weather configured | ✓ (+ first screen) | ✓ | ✓ |
| 10a/10b Today and Forward, no calendars | ✓ (+ first screen) | ✓ | ✓ |
| 11 Forward Week as Alex | ✓ (+ first screen) | ✓ | ✓ |
| 12a/12b Forward Month and Season | ✓ (+ first screen) | ✓ | ✓ |
| 13a/13b Forward and Today, a stale calendar | ✓ (+ first screen) | ✓ | ✓ |
| 14a/14b Forward and Saturday's Today, two calendar-health rows | ✓ (+ first screen) | ✓ | ✓ |
| 15 Forward, forecast over 12 hours old | ✓ (+ first screen) | ✓ | ✓ |

What follows is the reading of them: evidence for the owner's judgement, not a substitute for it.

- **Hierarchy.** On Today the order is headline, then "Looks dry until midday, then showers possible.", then the credit and Why, then "What this is based on ›". The phone's first screen holds the headline, the sentence and the first Worth knowing row in every Today scene. On Saturday the opening is the second Worth knowing row, after the birthday, and still on the first screen. Tablet and desktop keep two columns.
- **Uncertainty.** An older forecast says its age ("As of yesterday 21:00, looks dry until midday, …"). An unusable one gives a single muted line ("The forecast hasn't updated since yesterday."), with no credit, no Why and no "error". A stale calendar puts "As far as HOME knows." under the headline and its `data_health` row first, and qualifies the opening with ", as far as HOME knows". A forecast over 12 hours old removes Forward's phrases and credit and leaves the openings plain.
- **No availability claims.** Openings read "Nothing is recorded for the household on Sunday, 08:00–19:30." and the task form says what is recorded; every opening's Why ends with the limit sentence. Nothing says free, good, best or suitable.
- **Visual language.** Words only. There are no icons, fills or red; phrases are muted and at most two words in the scenes. The Sun appears only in the wordmark: no weather or opening "needs you". No horizontal overflow at any viewport (checked in the DOM).
- **Cognitive load.** One sentence on Today, one short phrase per day on Week, one credit line. The opening Why is long, but it is closed by default and is the evidence the contract requires (§4.5). Two calendar-health rows push the openings behind "+ N more" (Important 2 below).
- **Dismiss and Not useful.** Dismiss is visible on every row. Not useful sits only inside an opening's Why, as the contract places it (§4.8). Both work without JavaScript (X4).
- **Credit.** Present wherever forecast words are and nowhere else: 0 on the stale, no-weather, Month, Season and over-12-hours scenes; one visible elsewhere with every Why closed.
- **Privacy.** Alex's Forward Week has the same layout and openings, with nothing of Sam's private records.

**Walker B's findings.** No blocker.

- **Important (owner decisions, not defects; both approved by the owner on 2026-10-13, behaviour unchanged, §8):**
  1. Openings appear with no weather configured, which is Production's state until the gate opens: "Saturday, 10:00–20:00" and "Sunday, 08:00–20:00", bounded by planning hours (O15, contract §3.6, as designed).
  2. Calendar-health rows push openings behind "+ N more" (contract §5.8, as designed).
- **Minor:**
  1. The §4.4 evening example versus the approved one-run shape (§2 D above).
  2. Forward's credit-line Why sits on its own line above Today's row and may read as belonging to it.
  3. Today's "Why ›" wraps alone at desktop after a long sentence.
  4. Straight apostrophes in "hasn't" (`src/domain/engines/weather.ts`) and "isn't … anyone's" (the limit sentence, `src/domain/engines/insights/openings.ts`), where other copy is curly.
  5. The calendar line gives a full date for today (M5's helper).
  6. The forecast span in an opening's Why is in whole hours (10:00–20:00) while the opening ends at 19:30 (ADR §45's rule).
  7. Two Open-Meteo links are visible a few lines apart with the weather Why open.
  8. Fixture oddities inherited from M6 (Nana Jo's birthday twice on Tuesday 20; the canary event).

## 5. Performance

| Measure | Value | Source |
|---|---|---|
| Gaps, 300-event household, 7 days (87 gaps), five scopes | 1.3 ms warm, 3.4 ms cold | `gaps-performance.test.ts`, run for this package |
| Gaps, 90 days (1,141 gaps) | 18.1 ms warm, 21.8 ms cold | Same |
| Openings, Forward Week, 300 events and 100 waiting tasks | 3.8 ms warm, 6.7 ms cold | `openings-performance.test.ts`, run for this package |
| Daylight, seven home dates | 0.022 ms (median of 15 × 50) | Micro-benchmark of `daylightFor`, no database |
| Today's sentence and seven day phrases over a 191-hour forecast | 1.14 ms warm; the whole weather set 1.49 ms warm, 19.5 ms on first call | Micro-benchmark |
| `respondToInsight`'s pure 90-day read (placement, conflicts, openings) | 211.8 ms warm, 251.0 ms cold, of which M6's placement and conflicts 203.5 ms | Same run |
| Queries: Today, Forward Week, `respondToInsight` | 8 with weather, 7 without (the M6 set, weather unconfigured); constant after 20 more events, 20 tasks and a second calendar | Asserted (+1, constant) in `integration/openings.test.ts`; Today and Forward also in `weather-screens.test.ts` X2 |
| Forecast read; refresh | 1 query; 9 statements including `BEGIN` and `COMMIT` | Asserted in `integration/weather.test.ts` › performance |
| Compose Today / Forward Week (300 events, 90 days) | About 35 ms / 80 ms; render about 40 ms each | ADR 0011 §46 (developer report; needs the database) |

X3's bound (under 10 ms for seven-day gaps and for openings) holds on these numbers; the tests assert a looser `< 100` ms and log the values.

**Render, indicative only** (walker B, development server, warm, one sample per scene and viewport; time to first byte and HTML size). The development server is several times slower than a production build (M6-ACCEPTANCE §6), so these numbers are for comparison between scenes, not for §3.8:

| Page | TTFB (ms) | HTML |
|---|---|---|
| Today (fresh, older, evening, no calendars) | 140–226 | 45–49 KB |
| Today with an opening | 158–213 | 58 KB |
| Today, no weather configured | 166–179 | 44.5 KB |
| Today, two calendar-health rows | 206–252 | 75.5 KB |
| Forward Week with weather | 220–297 | 84 KB |
| Forward Week, a stale calendar | 246–282 | 94 KB |
| Forward Week, two calendar-health rows | 285–353 | 102.5 KB |
| Forward Week, no weather configured | 193–214 | 70.4 KB |
| Forward Week, forecast over 12 hours old | 207–341 | 70.8 KB |
| Forward Week, no calendars | 201–269 | 60.4 KB |
| Month, Season | 150–202 | 50–51 KB |

Weather adds about 4 KB to Today and 14 KB to Forward Week; an opening adds about 9 KB to Today.

**Query behaviour.** No N+1: each page reads the agenda once (M6's single 90-day read) and the forecast once, and hands the same read to its words and its openings (ADR §46). The count is constant in what is recorded (X2). Nothing calls the provider at render: the compose sources import no integration, `layer-exceptions.test.ts` lets only the route reach the provider, and ESLint bans the import. The runtime X1 test renders both pages for both adults with a refresh due while `fetch` and the `node:https` and `node:http` `request` and `get` all throw, and none is called (Q2; `safe-fetch` sends through `transport.request`, `safe-fetch.ts:226`). In the browser, the refresh posts after render only when due: 0 posts on a fresh forecast, 1 when stale or absent.

## 6. Regression and CI

| PR | Package | Head | Required checks | End to end |
|---|---|---|---|---|
| #70 | 0, contract and ADR | — | Documentation only (low tier) | — |
| #71 | 1a, forecast table | `dea8f64` | All four green | 227 passed (18.5 min), full regression |
| #72 | 1b, weather | `d528280` | All four green | 227 passed (18.2 min), full regression |
| #75 | 2, gaps and coverage | `b1526e7` | All four green | 227 passed (17.6 min), full regression |
| #76 | 3, openings | `8360815` | All four green | 227 passed (17.5 min), full regression |
| #78 | 4, the screens | `4e18308` | All four green | 247 passed (15.4 min), full regression |
| main | after #78 | `331bf7b` | All four green | 247 passed (22.2 min), full regression |
| #80 | evidence corrections (Q1–Q6, Q8) | `8a463b3` | All four green | 256 passed (23.2 min), full regression; merged as `a1f1ce3` |

The four required checks are: lint, typecheck, unit and integration; end to end; secret scan; Vercel bundle build. On `331bf7b` the first job's steps were all green, including `check:private-terms`, `test:integration`, `build`, the misconfigured boot, the production CSP and the previous-schema check with its self-test. Integration counts are not readable here (the job log is served from a host the CLI cannot reach).

- **Unit, run for this package on `331bf7b`:** 98 files, 1,978 tests, all passed (32.2 s); M7's 15 files hold 398 tests.
- **Earlier suites:** every M1–M6 spec runs in the full regression. Changes to earlier suites are named: two Today insight unit suites (the rule map and the explainability reader), three `now:` additions, and one `forward.spec.ts` addition (a quiet Week now shows two openings) (3-3). The M5 and M6 forbidden lists are unchanged (X8).
- **The M5 quiet-day fix (commit `8360815`, PR #76).** From 13 October the fixture's 20 October birthday fell inside Worth knowing's week, so `tests/e2e/today.spec.ts`'s quiet-day test failed on main by wall-clock date. The fix clears every date of birth and project target for that test. This is an M5 spec reading the real date, **not M7 behaviour**.
- **PR #80 (tests only):** Q1–Q6 and Q8, each with a mutation shown to fail it and restored (ADR 0011 §47); the weather spec grows from 20 to 29 tests.
- **This package:** documentation only. Its own CI run (critical tier) is on its PR.

## 7. Known caveats

Class **A** = a blocker: acceptance cannot proceed until it is fixed. **B** = a targeted correction proposed before sign-off (evidence or documentation, no behaviour change); every B below is **closed**. **C** = accepted by design, by owner decision or as a recorded carry-forward.

| Caveat | Class | Reason |
|---|---|---|
| `statement_timeout '5s'` set but its value asserted by no test | B, **closed** | Q1, PR #80: both values read on the refresh's own connection, the 5 s cancel observed, statements 3–4 asserted in full; the 25 s effect through W22 (limitation, ADR §47) |
| X1's runtime check stubbed only `fetch`, but `safe-fetch` sends through `node:https` | B, **closed** | Q2, PR #80: the `node:https` and `node:http` transports are spied with a refresh due |
| Private person on a private event and private scheduled task missing from the rendered invariant; models compared via HTML | B, **closed** | Q3, PR #80: both added; models and listings deep- and JSON-equal |
| A foreign opening key response was not exercised separately | B, **closed** | Q4, PR #80 (I-2) |
| First-run Today and Forward with a forecast never rendered | B, **closed** | Q5, PR #80, at integration level (limitation, ADR §47) |
| No-JS and Today's 44px only at phone | B, **closed** | Q6, PR #80: four viewports |
| The location-redaction scan matched `41.29` inside a timestamp | B, **closed** (Q8, PR #80: `locationLeaksIn`) | Found on this PR's own CI (`5aac2ee`, docs only): `tests/integration/weather.test.ts:161` failed because an export's `"at":"…T23:34:41.295Z"` contains `41.29`, one of `LOCATION_LEAKS` (`tests/fixtures/weather.ts:49`). A false positive that depends on the wall clock, not a leak; the job was re-run once |
| Scenario screenshots only at phone in PR #78 | B, **closed** | Walker B's 100 screenshots at three viewports (§4) |
| `docs/runbooks/LOCAL-DEV.md` said the refresh was "not yet asked for by any screen" | B, **closed** | Corrected in this package |
| PR #78's body says "four viewports with JavaScript on and off" and "tested with a throwing fetch" | C (record) | It overstates the evidence; this document is correct (X1, X4) |
| Openings appear with no weather configured (Production's state until the gate) | C, **owner-approved** (2026-10-13) | Plain openings remain available without configured weather; behaviour unchanged (O15, §3.6) |
| Calendar-health rows push openings behind "+ N more" or past Today's three | C, **owner-approved** (2026-10-13) | Calendar-health insights keep their priority over openings; behaviour unchanged (§5.8 ranking, D15; tested, O22 and the listing test) |
| Forward's phrase placement: heading line on a day with entries, the "Nothing recorded besides the usual" line on an empty day | C | Both are the row's end (§4.2); the owner approved the copy (ADR §46) |
| Qualifier placement on task openings (ends the "Nothing is recorded" clause before ", and the forecast …") | C | O16's "clause" supports it; owner-approved with the copy (ADR §45, §46) |
| Weather and opening Why length | C / owner | Approved at Package 4 (ADR §46); readability on a real day is §E 22 and the M10 trial |
| Weekday openings excluded | C | Owner decision D14 |
| Unassigned commitments (no household person) | C | Owner decisions D11, D12; named in Why (G7, G8, G10) |
| Partial coverage | C | Qualified and calendars named (O16, D13) |
| Forecast absent or over 12 hours old | C | No words, the stale line on Today only, plain openings (X6, X7, O14) |
| After a location change within 3 hours of a `429`, no forecast for up to 3 hours | C | Amendment 1; W20's third case |
| Daylight table computed with PyEphem | C | Recomputed independently for this package (NOAA algorithm, within 3 s) |
| Neon's pooler and `idle_in_transaction_session_timeout` unobserved | C, operational | Proven against Postgres 16 only (W22, ADR §43); first observed in a deployed environment at §E item 20 |
| Elevation range −500 to 9,000 m; a lone coordinate is `invalid` | C | Owner-approved at Package 1b (ADR §43) |
| "Windy at times." on tomorrow's sentence | C | Owner-approved reading (ADR §43) |
| Longest candidate on the shown span; Today's opening window unchanged in the evening; `respondToInsight` reads the forecast for every key | C | Contract silent; consistent with X2 (ADR §45) |
| `hoursCovering` assumes consecutive unique cached hours | C | The service writes only consecutive rows; only a hand-written row could break it (ADR §45) |
| "Around 14°C." on a flat forecast | C | Approved wording (ADR §46) |
| Browser specs depend on the fixture family's records | C | As M5 and M6; recorded in ADR §47 |
| Weather spec isolation: other specs' manual events on 17–18 October 2026 are not cleared | C (carry-forward) | Robustness only (one worker; a residue would fail the spec, not hide a defect); archive non-`ws` events in the window or assert the precondition |
| M5's `today.spec.ts` quiet-day test failed by wall-clock date (fixed in `8360815`) | C | Not M7 behaviour; some browser specs still read the real date |
| Issue #73: the route logs nothing structured for errors outside the service | C (carry-forward, tracked) | Still returns 500 `{changed:false}`; nothing leaks |
| Issue #74: no pool `'error'` listener for idle clients | C (carry-forward, tracked) | Pre-existing; M7 added the checked-out client's listener |
| Issue #77: intermittent 5 s Activity and audit test timeouts | C (carry-forward, tracked) | Test infrastructure, pre-existing |
| Package 2's mutation proof was a developer report | **Closed** | Re-run for this reconciliation on an out-of-repo copy (2-3) |
| Walker minors 2–8 (§4): the credit-line Why's position, Today's Why wrapping at desktop, straight apostrophes in two strings, the calendar line's full date for today, whole-hour forecast spans in an opening's Why, two credit links with the weather Why open, fixture oddities | C | Presentation polish; any change is a product change for the owner to approve, not an acceptance correction |
| Contract §4.4's evening example versus the one-run sentence | C | Both shapes are §5.2's (§2 D) |

No caveat is class A.

## 8. Outstanding

**Evidence corrections: done.** The owner approved Q1–Q6 and Q8, and PR #80 built them as tests only (ADR 0011 §47; the matrix's §6 lists each test, what it asserts and its mutation result). Q7, the scenario screenshot set, is met by walker B's screenshots (§4).

**Remaining weak or limited rows** (none is FAIL or Not verified):

| Row | Grade | Reason |
|---|---|---|
| W9 | Met, limitation recorded | The 25 s idle timeout is proven by its value on the refresh's connection; its effect only through W22 (ADR §47) |
| X6 | Met, limitation recorded | Today's first run with a forecast is proven at integration level only; a browser test would need the fixture family's events archived for the shared browser database (ADR §47) |
| X4 and the browser rows | Met, limitation recorded | The browser tests depend on the fixture family's records (ADR §47; as M5 and M6) |
| E-1 | Met (weak) | The unusable, absent and qualified states are rendered in the browser at phone only; their HTML is viewport-independent and asserted at integration level, and the layout is checked at four viewports on the fullest pages |
| U-7, criterion 5 | Met (weak) | Absence proven by word lists, as M6 (an accepted limitation, §9) |
| E-6, criterion 8 | Met (weak) | Keyboard rests on native elements and axe; no keyboard test of the weather Why or credit link |

**Owner decisions: approved by the owner on 2026-10-13, behaviour unchanged.**

1. **Openings with no weather configured.** Plain openings remain available without configured weather, bounded by planning hours ("Saturday, 10:00–20:00", "Sunday, 08:00–20:00"), with no daylight and no weather (contract §3.6, O15). Production has no location until §E item 21.
2. **Calendar-health rows ahead of openings.** Calendar-health insights keep their priority over openings, which rank last and may sit behind "+ N more" (contract §5.8 ranking, D15).

**Screenshot approval (criterion 13): outstanding, the owner's.** The curated 12-screenshot set (synthetic, uncommitted, scratchpad `m7-curated/` with its INDEX), drawn from walker B's 100 (§4), was provided for review. The owner confirms, at phone width, that the weather reads at a glance, that an opening reads as a fact rather than advice, and that nothing reads as an alarm or a nudge (concepts README design tests 1, 2 and 7).

**Criterion 14 (handover): met on the ADR record.** Each package's focused review was requested by the owner and reported in session; its outcome and the owner's decisions are recorded in ADR 0011 §43 (1b), §44 (2), §45 (3), §46 (4, with the owner-approved presentation corrections), §47 (the evidence corrections) and §48 (this package), and in the PR bodies. Every Blocker and Important finding was fixed before its PR merged; carry-forwards are #73, #74 and #77. GitHub holds no review objects, because the owner merged each PR. That is the only gap, and it is not one under the contract: criterion 14 asks that "each package had its stated review", measured by "Package reviews; M7-ACCEPTANCE", and names no review object.

**Gate and location (checked for this reconciliation).** `HOME_REAL_DATA` stays closed and Production's weather location and location key stay unset: DEPLOY §E items 20–22 are open, and nothing in this repository sets them. `git grep -n "HOME_REAL_DATA=open"` finds only documentation that tells the owner when to set it (CLAUDE.md, ADR 0006, the M3 contract, M4–M6 acceptance, DEPLOY.md). `HOME_LAT` is empty in `.env.example`, and the only coordinates in committed files are the contract's synthetic public points (Wellington's Civic Square, Christchurch's Cathedral Square, and the out-of-range `95` of W12).

## 9. Accepted limitations

| Item | Class | Deciding clause | Note |
|---|---|---|---|
| Weekends only | C | D14 | Weekday openings wait for the M10 trial's evidence |
| No `alignment`, no `weather_effect` insight, no warnings | C | §1.3, D7, D17 | `weather_effect` is folded into task openings; the others are deferred |
| Openings without a forecast are plain | C | §3.6, O14, O15 | No daylight without a location |
| Absence proven by word lists | C | §5.8, criterion 5 | As M6; an availability claim phrased another way would need review, which the copy has had (ADR §46) |
| One forecast read per page, Month and Season without weather | C | D16, X12 | Weather words are for the coming week only |
| Open-Meteo's free terms are non-commercial | C | §11, rule 16 | HOME is this household's only |
| The carry-forward issues #73, #74, #77 | C | §2.1 | Tracked; none is M7 behaviour |

## 10. Operational acceptance

DEPLOY.md §E items 20–22 (added by this package, exactly as contract §10.2 sets them), with their evidence rows, and the environment table's rows for `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` and `HOME_WEATHER_LOCATION_KEY`:

- **20, the forecast in Preview.** May be done while the gate is closed: the synthetic point and a Preview-only key only.
- **21, the home location in Production.** After the gate opens (item 11).
- **22, openings on a real weekend.** After 21, and after Today's and Forward's items (16–19).

M7 is fully accepted only when both technical and operational acceptance are recorded.

## 11. Recommendation

**Accept M7 (technical, on synthetic data), subject to the owner's sign-off and screenshot judgement (criterion 13).** The technical acceptance evidence is complete on synthetic data: nothing in the code breaks the contract, every §10.1 criterion cites tests (criterion 13 cites the screenshots for the owner's judgement, and criterion 14 the ADR's review record), the corrections the assessment proposed are built and merged (PR #80), and no matrix row is FAIL or Not verified. The three weak rows and three recorded limitations are named in §8.

*Original recommendation (2026-10-13, on `331bf7b`):* accept on synthetic data after targeted corrections (B), subject to the owner's sign-off; the corrections have since been made (PR #80).

Sign-off means the owner:

1. approves the screenshots for criterion 13;
2. accepts this assessment, with the weak and limited rows in §8.

Then the contract, ADR 0011, CLAUDE.md and ROADMAP can record M7 as technically accepted on synthetic data. Until then **M7 is not declared accepted**: the status lines say "Package 5 (acceptance assessment) in review; technically accepted only on owner sign-off". Operational acceptance remains DEPLOY.md §E items 20–22. `HOME_REAL_DATA` stays closed, no location or location key is set in Production, earlier §E items stay open, and nothing is merged or closed by this document.
