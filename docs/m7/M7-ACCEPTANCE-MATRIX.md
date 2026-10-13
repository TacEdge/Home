# M7 Package 5: acceptance evidence matrix (assessor's working file)

Dated 2026-10-13. First assessed on branch `m7/package-5-acceptance` = `main` at `331bf7b` (PRs #70, #71, #72, #75, #76, #78 merged). **Reconciled the same day** on `main` at `a1f1ce3` (merged into this branch as `e70e61c`), which adds PR #80: the owner-approved evidence corrections Q1–Q6 and Q8, tests only, recorded in ADR 0011 §47. Every row those tests touch is re-graded below and cites the final test. Assessment only: no product code, test, script or configuration changed; Postgres was not used (the shared `*_test` database was held by a browser run). Unit tests were run locally (`pnpm test`); integration and browser evidence is read from the test source and from the CI check-runs. Synthetic data only; `HOME_REAL_DATA` closed; no weather location or location key set in Production. `M7-ACCEPTANCE.md` summarises this file and adds the walkthrough, the measurements and the decision. The coordinator's verifications and corrections are in §7; rows they change say so.

Result key (as M6): **Met** = an assertion in a test that CI runs proves it (the assertion was read, not the title). **Met (weak)** = a test exists but asserts less than the requirement; the gap is named. **Not verified** = code reading, a document or a developer report only. **Owner** = the owner's judgement. **Operational** = DEPLOY.md §E items 20–22 (real use, after the gate). **FAIL** = the code contradicts the contract. "Q*n*" names a targeted evidence correction the assessment proposed; the owner approved Q1–Q6 and Q8 and they were built in PR #80 (§6). A row marked "limitation recorded" is Met, with a named limitation accepted in ADR 0011 §47.

## 0. Counts and CI

| Suite | Count | Source |
|---|---|---|
| Unit (`pnpm test`) | **98 files, 1,978 tests, all passed** (32.2 s) | Run here, 2026-10-12 23:05 UTC, on `331bf7b` |
| M7 unit files | weather-env 49, open-meteo-adapter 43, open-meteo-policy 36, weather-engine 37, daylight 18, weather-route 20, weather-rules 13, weather-log 14, weather-boot 5, weather-screens 24, gaps-engine 48, gaps-performance 4, openings-engine 79, openings-performance 2, layer-exceptions 6: **15 files, 398 tests** | Run here (verbose) |
| Integration | Not readable (job logs are served from a blob host `gh api` refuses). `Lint, typecheck, unit and integration tests` is **success** on every M7 head and on `331bf7b` (completed 23:06 UTC), every step green incl. `check:private-terms`, `test:integration`, `build`, misconfigured-boot, production CSP, previous-schema and its self-test | check-runs; `actions/jobs/115035927354` |
| End to end | **#71 227 passed (18.5 m); #72 227 (18.2 m); #75 227 (17.6 m); #76 227 (17.5 m); #78 247 (15.4 m)** — every one "Browser tests, full regression" | Playwright run-summary annotations |
| PR #80 `8a463b3` (evidence corrections, Q1–Q6, Q8) | All four required checks green; End-to-end **256 passed (23.2 m)**, full regression (the weather spec grows from 20 to 29 tests, Q6); mutation results in ADR 0011 §47 | check-runs; Playwright run summary |
| Main `331bf7b` | Vercel bundle build success; Secret scan success; Lint/typecheck/unit/integration **success**; End-to-end **success, 247 passed (22.2 m)**, full regression, completed 23:24 UTC | check-runs |

Required checks per head (Lint+unit+integration · End-to-end · Secret scan · Vercel bundle build): #71 `dea8f64` ✓✓✓✓ · #72 `d528280` ✓✓✓✓ · #75 `b1526e7` ✓✓✓✓ · #76 `8360815` ✓✓✓✓ · #78 `4e18308` ✓✓✓✓. GitHub records no review objects on any M7 PR (0 reviews each; owner `TacEdge` merged all); the owner-requested focused reviews were reported in session and their outcomes are recorded as text in ADR 0011 §43–§48 and the PR bodies (criterion 14, §4).

Issues: **#73** open, "Weather refresh route: log a structured line for errors from outside the service". **#74** open, "Database pool: handle errors on idle connections (no pool 'error' listener)". **#77** open, "Intermittent 5 s timeouts in Activity/audit-reading integration tests (previous-schema step and cache-less runs)". Commit `8360815` (PR #76): `tests/e2e/today.spec.ts` quiet-day test now clears every date of birth and project target, because from 13 October the fixture birthday on 20 October fell inside Worth knowing's week and the test failed on main by wall-clock date (an M5 spec, not M7 behaviour).

Independent checks made here: the three committed HMAC vectors recomputed with `openssl dgst -sha256 -mac HMAC` (all three equal); the W16 reference table recomputed with an independent implementation of NOAA's spreadsheet algorithm (all ten instants within 3 s of the committed values, which were computed with PyEphem); engine micro-benchmarks (`tsx`, no DB) in `m7-p5-evidence.md` §3; at reconciliation, Package 2's mutation proof re-run on an out-of-repo copy of `e70e61c` (`git archive`, five mutations of `src/domain/engines/gaps.ts`, row 2-3).

## 1. Package acceptance (contract §2.2)

### 1A. Package 1a

| # | Requirement | Implementation | Evidence (file › test › what it asserts) | Result | Remaining action |
|---|---|---|---|---|---|
| 1a-1 | Additive; creates only `weather_forecast`; previous-schema passes | `src/db/migrations/0008_weather_forecast.sql:1-18` | `integration/migrations.test.ts` › "0008 only creates weather_forecast…" (one statement, `CREATE TABLE "weather_forecast"`, no other DDL); CI step "Previous-schema compatibility" success on #71 | Met | — |
| 1a-2 | `home_app` select/insert/update; privilege test | default privileges `0002_app_role` | `integration/app-role.test.ts` › "can SELECT, INSERT, UPDATE and DELETE weather_forecast…" (rolled-back writes as `home_app`); migrations › "…home_app has SELECT, INSERT, UPDATE and DELETE, nothing more" | Met | — |
| 1a-3 | Exact §3.9 columns; fingerprint format `CHECK` and null-only-while-hours-null `CHECK`; no coordinate/elevation/location/user column | `src/db/schema/weather.ts`; SQL constraints | migrations › "has exactly the contract columns, types, nullability and defaults" (`toEqual` the list); "…no coordinate, elevation, location, address, user…"; "has the provider, status, fingerprint-format and fingerprint-while-hours CHECKs, and nothing else" (+ violation cases via `expectCode`) | Met | — |
| 1a-4 | Export lists it excluded with reason | `src/domain/export/spec.ts:277` | `unit/export-completeness.test.ts:140-144` (exact reason string; not exported; no column exclusions) | Met | — |
| 1a-5 | FAMILY-DATA-MODEL entry | docs | `docs/FAMILY-DATA-MODEL.md` › `weather_forecast` (columns, both `CHECK`s, the fingerprint under `HOME_WEATHER_LOCATION_KEY`, never a coordinate), read by the coordinator | Met (document) | — |

### 1B. Package 1b

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| 1b-1 | W1–W18, W20–W23, P4–P8 pass | see §2 | §2 rows (W9's timeout values now asserted, Q1; X1's transports now spied, Q2) | Met | — |
| 1b-2 | Request exactly §5.1; contract test fixes preceding-hour normalisation | `open-meteo.ts:76-86,114-155` | adapter › W1 (`toEqual` the exact URL; param keys exactly 5; no timezone); W3 "each hour [t, t+1h)…" (`toEqual` mapping: temp/wind row t, rain/prob/gust row t+1) | Met | — |
| 1b-3 | No test/fixture/log carries anything but synthetic points; redaction test covers every new key | `src/lib/log.ts:42-47,81-82` | `unit/weather/weather-log.test.ts` › "every new key is on the list", "%s, at any depth, any case, with a prefix" (6 keys); CI `check:private-terms`; grep here: only the contract's two synthetic public points appear (Wellington's Civic Square, rounded and unrounded, and Christchurch's Cathedral Square for W20) | Met | — |
| 1b-4 | Fingerprint matches committed vector; changed location/elevation/key shows nothing until a successful refresh | `env.ts:358-375`; `service.ts:140` | weather-env › "matches the committed HMAC-SHA256 test vectors" (`toBe` hex) — recomputed here with openssl, identical; integration W20/W21 (§2) | Met | — |
| 1b-5 | Refresh only through the route; no render calls provider; `maxDuration = 30`, no `after`/`waitUntil` (static); stopped-before-commit writes nothing | `route.ts:10`; `entry.ts` | weather-route › "exports maxDuration = 30…", "imports neither after nor waitUntil…", "the whole request path has no background work…"; `unit/layer-exceptions.test.ts` (nothing under `src/app` reaches the provider except the route via the entry); W22 | Met | — |
| 1b-6 | Every failure one of §5.1's codes; nothing location-bearing in error/log/response/audit/row | adapter `:50-61,166-184`; service `:212-221,285-291` | W4, W10, W18, W23 (§2) | Met | — |
| 1b-7 | Calendar `safe-fetch` suite passes unchanged | `safe-fetch.ts` defaults | `git diff fc2e179..331bf7b -- tests/unit` shows no change to the calendar safe-fetch tests (only `ics-adapter.test.ts` +2 lines for the `rate_limited`→`unreachable` mapping); policy › "the calendar behaviour is unchanged: a 429 is unreachable…" | Met | — |
| 1b-8 | Daylight within 1 minute of NOAA table on the five dates | `daylight.ts:91-128` | daylight › W16 `it.each(REFERENCE)` (`< 60_000` ms both ends; rounded clock exact). Table computed with PyEphem (ADR §43 caveat); **recomputed here with NOAA's spreadsheet algorithm: within 3 s on all ten instants** | Met | Record the independent recomputation in the acceptance doc |

### 1C. Package 2

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| 2-1 | G1–G25 at unit level; P1 for gaps and coverage through the real services | `engines/gaps.ts:252` | gaps-engine G1–G25 (§2); `integration/gaps.test.ts` › P1 (two cases, deep and byte equality, ids absent, Sam's changes) | Met | — |
| 2-2 | Keys stable across input order; fit `insightKey` | `gaps.ts` key build | G20 (8 seeds, deep and byte), G21 (`insightKey`, ≤200, no text) | Met | — |
| 2-3 | Mutation proof: unassigned rule, all-day exception, household filter, clipping identity, a tie-break each fail | — | ADR §44 (developer report, 20+ mutations); **re-run at reconciliation** on a `git archive` copy of `e70e61c` with `node_modules` linked, `vitest run tests/unit/gaps/gaps-engine.test.ts` (48 pass unmutated): dropping `\|\| (person === null && !t.household)` (D11) fails 7 (G7, G8, G12, A, C, the tie-break test, the shown-span Why test); letting an all-day event with no household person block (D12) fails 2 (G10, the tie-break test); `input.people` unfiltered by `inHousehold` fails 3 (G8, G10, facts resolve); the key from `shownFrom` instead of the stretch start fails 2 (G15, the shown-span Why test); `byRef` dropped from the interval sort fails 1 (G20). Each restored; no repository file changed | Met | — |

### 1D. Package 3

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| 3-1 | O1–O26 and P2–P3; O23 through the real services | `engines/insights/openings.ts:219-365` | openings-engine O1–O26; `integration/openings.test.ts` O1–O3, O7, O18–O21, O23, P2, P3 | Met | — |
| 3-2 | Every template and rendered string passes M5, M6, M7 lists | — | openings-engine › O26 (full combined regex + "likely" only in "rain likely"); `integration/weather-screens.test.ts` › "Today and Forward Week, in every state…" (rendered text) | Met | — |
| 3-3 | M5/M6 insight suites unchanged except where an opening is now listed, named in the PR | — | Diff since `fc2e179`: `today/insights-engine.test.ts` (rule map +2, every-rule check excludes `open_window.*`), `today/explainability.test.ts` (also reads the M7 contract), three `now:` additions, `forward.spec.ts` one named addition (quiet Week shows two openings), `today.spec.ts` quiet-day fix (8360815). No forbidden list changed | Met | Record the list in the acceptance doc |
| 3-4 | Implementation note: project must be in reader's visible, unarchived list with status not paused/done (conservative rule, PR #76) | `openings.ts` `waiting` + `LIVE_PROJECT_STATUSES` (`idea`,`active`) | openings-engine O12a–O12g (missing, paused, done, unknown status, no project, other match named instead; nothing of the project emitted); integration › "a visible active project matches; paused…; archived…", "Alex's task in Sam's household project…private and done…" | Met | — |

### 1E. Package 4

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| 4-1 | W19, X1, X4–X7, X9, X12 pass at four viewports, JS on and off | Today/Forward compose and views | e2e `weather.spec.ts` › "X4 at {vp}: without JavaScript the cached forecast stands…" (older sentence `toHaveText`, one visible credit, Why opens with "yesterday 21:00", no horizontal scroll, 0 posts), "X4, O23 at {vp}: Dismiss and Not useful on an opening, from Today, without JavaScript…" and "X4 at {vp}: without JavaScript, the phrases and credit line stand; Dismiss from Forward…" (7 phrases, credit line, one visible credit, no scroll, 0 posts, the opening gone), each at all four `VIEWPORTS` (Q6); "axe, no horizontal scroll and 44px targets…" at four viewports, JS on; integration `weather-screens.test.ts` for every state's HTML (viewport-independent) | Met | The unusable, absent and first-run states are rendered in the browser at phone only (E-1); their HTML is asserted at integration level |
| 4-2 | Phone: headline, weather sentence, first Worth knowing row on the first screen | `today-view.tsx:80-118` | e2e › "X5, O18: on a phone the headline, the weather sentence and the first Worth knowing row…" (each locator within the first viewport) | Met | — |
| 4-3 | Credit link wherever forecast words are, nowhere else | `credit.tsx:11-20`; `compose.ts:113`, forward `compose.ts` `creditFor` | integration W19 tests; e2e X12 (Month, Season, person: 0 links), stale (0); unit › "the credit link is rendered by exactly the weather pieces and the Worth knowing row" | Met | — |
| 4-4 | Two-adult sweep covers Today and Forward Week with openings | — | e2e › "P1: Sam's private Saturday event, Sunday all-day event and dry-weather task change Sam's Forward and not Alex's" (Alex's `main` innerHTML byte-equal on `/forward` and `/today`, with openings present); `m3-privacy-sweep.spec.ts` itself unchanged | Met | — |
| 4-5 | Owner approves wording and layout from screenshots | — | ADR §46 "Presentation corrections (owner-approved, after review)"; walker B's 100 synthetic screenshots (`M7-ACCEPTANCE.md` §4) and the curated 12-screenshot set with its INDEX (scratchpad `m7-curated/`), synthetic, never committed | Owner | The owner's approval from the curated set is outstanding (criterion 13) |

### 1F. Package 5

| # | Requirement | Result | Remaining action |
|---|---|---|---|
| 5-1 | Every §10 criterion met, with evidence that cites tests | Met: `docs/m7/M7-ACCEPTANCE.md` (§1 maps each §10.1 criterion to these rows), this matrix (reconciled after PR #80), `docs/runbooks/DEPLOY.md` §E items 20–22 with their evidence rows and the environment rows for `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION`, `HOME_WEATHER_LOCATION_KEY`; the stale LOCAL-DEV weather line corrected | Criterion 13 is the owner's (screenshots) |

## 2. Contract test matrix (§8.6)

### W — weather, freshness, daylight

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| W1 | Exact GET, rounded point, five variables, 8 days, unixtime, no timezone; two headers only | `open-meteo.ts:76-86`; `safe-fetch.ts:107-113` | adapter › W1 (exact URL `toEqual`, keys list); policy › "sends only accept: application/json and user-agent: HOME-weather/1 (no cookie, credential, encoding or HOME header)" (captured request headers) | Met | — |
| W2 | `HOME_ELEVATION=23` → `elevation=20`; exact values nowhere else | `env.ts` `parseElevation` | adapter › W2; env › "coordinates to two decimals, elevation to 10 m; the exact values are nowhere in the result"; integration `weather.test.ts` › W2 (stored, audited, logged); weather-screens › "nothing about the location reaches the markup" | Met | — |
| W3 | Every complete hour, UTC order, no gap/duplicate, preceding-hour mapping | `normaliseOpenMeteo` `:114-155` | adapter › W3 ×5 incl. 192→191 and both DST windows | Met | — |
| W4 | Malformed answers → `bad_response`; hours unchanged; one audit `{bad_response,0}`; no leak anywhere | adapter `:114-143`; service `:212-283` | adapter › W4 (20 shapes, error JSON is `{code,name}` only); integration › "W4, W10, W18…" `bad_response` ×3 (hours/fetched_at/fingerprint unchanged, attempt set, audit metas exact, `clean()` over logs, audit, row, outcome) | Met | — |
| W5 | Bands at 20/21 %, 0.19/0.2 mm, 59/60 %, 0.99/1.0 mm, missing | `bandOf` `weather.ts:108` | weather-engine › W5 (11 cases `toBe`) | Met | — |
| W6 | Gusts 49/50 | `windyOf` `:130` | weather-engine › W6 | Met | — |
| W7 | 2:59 fresh, 3:00 older, 12:00 older, 12:01 unusable | `forecastAge` `:93` | weather-engine › W7 (4 cases); integration › "freshness follows fetched_at…" | Met | — |
| W8 | 59/60 min; `rate_limited` 2:59/3:00 | `rules.ts:36-43` | weather-rules › W8; integration › "59 minutes: not due, no request; 60: a request", "rate_limited: 2:59 no request; 3:00 a request" (provider call counts) | Met | — |
| W9 | Two at once → one provider call; lock held across fetch; other `busy`, nothing written | `service.ts:197-207` | integration › W9 (held fetch, `pg_locks` advisory count 1 during fetch, two `busy`, 1 call, 1 audit, 1 row, 0 locks after); `weather.test.ts` › "W9, §5.1: the timeouts take effect inside the refresh's own transaction" (Q1: a probing provider on a one-connection pool reads `statement_timeout` = `5s` and `idle_in_transaction_session_timeout` = `25s` on the backend holding the advisory lock, `{locks:1, tx:true}`; `pg_sleep(8)` cancelled with `57014` in 4.9–7.5 s; after commit the same backend is back to its baseline, `SET LOCAL`); "performance…" asserts statements 3 and 4 in full (`/^set local statement_timeout = '5s'$/i`, `/^set local idle_in_transaction_session_timeout = '25s'$/i`) | Met | Limitation recorded (ADR §47): the 25 s idle timeout is proven by its value; its effect by W22 only |
| W10 | timeout/429/500/>512 KiB → codes; hours, fetched_at unchanged; attempt set; one audit each; no leak | adapter `FETCH_CODES`; policy limits | adapter › W10 (14 cases: fresh error, message = code, no cause, no leak in message/JSON/stack/String); integration W10 ×4 (as W4) | Met | — |
| W11 | Failure at 24:01 clears hours, keeps fetched_at; Today shows `weather.stale` | `service.ts:253-262` | integration › W11 (row fields; read `unusable`; `staleSentence` text) and "a failure at 23:59 keeps the hours" | Met | — |
| W12 | `HOME_LAT` unset / 95: no request, no cache read, no words, no refresh client, no error; boot line | `weatherConfig` `env.ts:380`; `service.ts:122,190` | integration › W12/W21 `it.each` (5 cases: `readForecast` → `{configured:false}`, refresh `not_configured`, **0 queries**, 0 calls); weather-boot; weather-screens › "…a location with no key, or none, says nothing and asks for nothing" (`askWeather` false, 0 credit links) | Met | — |
| W13 | Production, gate closed → `real_data_closed` before any query/request | `service.ts:186` | integration › W13 (0 queries, 0 calls, no row, no audit; also `''`,`OPEN`,`' open'`,`true`); weather-route › W13 (200 `{changed:false}`) | Met | — |
| W14 | Phrases 14–20 Oct only; not 21; uncovered day none | `dayPhrase` `:331` | weather-engine › W14 ×4; weather-screens integration › "a phrase on each of the seven days…"; e2e › W14 (7 phrases `toHaveText` list) | Met | — |
| W15 | 07:03 sentence; 19:30 evening "Rain likely tomorrow." | `todaySentence`/`tomorrowSentence` | weather-engine › W15 ×7; integration and e2e evening tests | Met | — |
| W16 | Daylight within 1 min of table; rounded 06:30–19:30, 08:00–16:45 | `daylight.ts` | daylight › W16; recomputed here independently (NOAA spreadsheet algorithm, ≤3 s) | Met | — |
| W17 | Other host, http, path, redirect, private address refused | `isApprovedOpenMeteoUrl` `safe-fetch.ts:89` | policy › W17 (14 URL shapes `unsupported_destination` with **no DNS lookup**; 5 private resolutions `forbidden_destination`; redirect `redirect_refused` after exactly one request) | Met | The contract's code list is looser than the row's five cases; the private address is `forbidden_destination` (calendar semantics), not `address_rejected`. Wording only |
| W18 | One log line `weather_refresh_failed` + code only; redaction covers six keys; no URL/query/canonical/key/fingerprint | `service.ts:285-291`; `log.ts` | integration W10 block (exactly one JSON line, keys `['code','event','level','ts']`); weather-log ×14; P5 (fingerprints absent from logs); every scan is `clean()` → `locationLeaksIn` (`tests/fixtures/weather.ts`, Q8): a coordinate matches only as a standalone number, so a timestamp cannot trip it by chance; `tests/unit/weather/location-leaks.test.ts` › "passes …" (a timestamp holding `41.29`, a uuid, longer numbers) and "catches …" (`-41.29`, `41.29,`, `"lat":-41.29`, `latitude=-41.29`, `174.78`, `"lon":174.78`, the URL, key and canonical prefix) | Met | — |
| W19 | Credit: after sentence / after the citing opening / beside Coming up / none without words; `rel="noreferrer"` | `CreditLink`; compose `creditFor` | unit › credit link (`rel`, same tab, name, 44 px class); integration › Today W19 and "a part the forecast does not cover gives no sentence; an opening that cites the forecast carries the credit instead"; e2e › W19 tests, X12 | Met | — |
| W20 | Wellington→Christchurch: no forecast, daylight Christchurch's, due at once, first attempt clears; success stores new fingerprint; failure nulls and 60-min wait; within 3 h of `rate_limited` nothing | `rules.ts:27-42`; `service.ts:140,240-252` | integration › W20 ×3 (read `none`; point; `p.points` Christchurch; row nulls; `not_due` at 60, ok at 61; fingerprint vector 2; `rate_limited` case no call, `refreshDue:false`) | Met | — |
| W21 | Key unset / invalid / = `HOME_FINGERPRINT_KEY`: unconfigured; rotated or elevation alone: mismatch | `weatherKeyFrom` `env.ts:335` | env › KEY_CASES ×10 (`key_missing`, point kept, boot line); integration › W12/W21 (incl. `= HOME_FINGERPRINT_KEY`, 0 queries) and "W21: a rotated key / HOME_ELEVATION changed alone is a mismatch" | Met | — |
| W22 | Stopped after fetch: nothing written, no audit, lock released (at once / ≤25 s), next request fetches | one transaction, writes after fetch | integration › W22 ×2 (`pg_terminate_backend`: row and audit unchanged, lock gone, next fetches; idle: released in 20–27 s, other adult proceeds, frozen one fails, audits exactly two) | Met | Neon's pooler behaviour is unobserved (ADR §43): DEPLOY §E 20 |
| W23 | Unexpected exception: `{changed:false}`, rollback, one `unexpected` log line, no leak | `service.ts:285-290`; `route.ts:41-45` | integration › W23 (thrown carries the URL; error message fixed, no cause, row equal, audit unchanged, one error line, 0 locks); weather-route › W23 (500 `{changed:false}`) | Met | Errors raised outside the service (e.g. `getActor`) are issue #73 |

### G — gaps and coverage

All G rows are asserted in `tests/unit/gaps/gaps-engine.test.ts`, each test named with its row; I read G1–G5, G7, G12, G15–G18, G19, G20, G21, G22, G23 in full. Implementation `src/domain/engines/gaps.ts:252-425` (`coverageOf` `:223`, `scheduledTasks` `:96`).

| # | Requirement (short) | Evidence (what it asserts) | Result | Remaining action |
|---|---|---|---|---|
| G1 | Empty Sunday: one gap, key exact | key `toEqual` | Met | — |
| G2 | Football: 08–09, 10–20 | `said()` text exact | Met | — |
| G3 | Back-to-back merge | exact | Met | — |
| G4 | 60-min floor drops 08:00–08:30 | exact | Met | — |
| G5 | Planning edges clip | exact ×2 | Met | — |
| G6 | Overnight into Saturday | exact | Met | — |
| G7 | No-household-person timed event blocks household, not Milo; Why names it | exact + `unblocking`; also through real services (`integration/gaps.test.ts` › G7) | Met | — |
| G8 | Only Nana Jo: as G7 | exact | Met | — |
| G9 | All-day with Sam, exclusive end | exact; also integration › G9 | Met | — |
| G10 | All-day no-one does not block; named | exact + unblocking | Met | — |
| G11 | Birthday, target, task due never block | exact | Met | — |
| G12 | Scheduled task assigned/unassigned | exact both | Met | — |
| G13 | Skipped / changed occurrence | exact; also integration › G13 | Met | — |
| G14 | Work series blocks | exact | Met | — |
| G15 | Key stable as now moves; 19:05 none | key at 10:07, 18:30 and 5 more clocks; shown `from`; none at 19:01/19:05 | Met | — |
| G16 | Zero-length no effect | exact | Met | — |
| G17 | Both DST change Sundays; 12-hour day | keys exact; Isla's stretches `12 * 3_600_000` | Met | — |
| G18 | Sydney-zone event | exact | Met | — |
| G19 | Coverage 6 cases | rule per case; no gaps when unknown | Met | — |
| G20 | 8 seeds shuffled, deep and byte | deep + `JSON.stringify` equal | Met | — |
| G21 | Keys match `insightKey`, ≤200, no text, person scope | regex + length | Met | — |
| G22 | Multi-day timed Fri→Sun | exact | Met | — |
| G23 | Uncovered day refused | `GapRangeError`, nothing computed | Met | — |
| G24 | Calendar's usual person (synced, no annotations) | exact; also integration › G24 through `connectCalendar`/refresh | Met | — |
| G25 | Responsible, not attending | exact | Met | — |

### O — openings, identity, responses

Implementation `src/domain/engines/insights/openings.ts` (candidates `:240-271`, matching `:281-296`, keys `:322-340`), listing `engines/insights/index.ts:172-181,362-392`, responses `domain/insights/today.ts:232-300`. Unit `tests/unit/openings/openings-engine.test.ts` (fixture `tests/unit/openings/fixture.ts`).

| # | Requirement (short) | Evidence | Result | Remaining action |
|---|---|---|---|---|
| O1 | Two openings, keys and order | unit O1 (`toEqual` keys); integration O1–O3 through real services; e2e W14 test (two rows, exact text) | Met | — |
| O2 | Saturday task sentence exact; no plain Saturday | unit O2 `toBe` text; e2e `SAT_TASK` | Met | — |
| O3 | Sunday plain exact | unit O3; e2e `SUN_PLAIN` | Met | — |
| O4 | F1 showery: task gone, plain key + text | unit O4 | Met | — |
| O5 | Dry again: task key returns with response | unit O5 | Met | — |
| O6 | Rain likely: same key, new ending | unit O6 | Met | — |
| O7 | Dismissed, forecast refreshed: still hidden for Alex, shown for Sam | unit O7; integration openings › O7; weather-screens › "Dismiss on an opening…changed forecast keeps it gone"; e2e identity test | Met | — |
| O8 | Milo 13–14: new key 1400-1930, eligible despite O7 | unit O8; e2e identity ("on Sunday, 12:30–19:30" shown again after a dismissal) | Met | — |
| O9 | No weekday openings | unit O9; "weekends only" test | Met | — |
| O10 | 119 vs 120 min | unit O10; "exactly 120…119 dropped, on the shown span" | Met | — |
| O11 | Estimate 600: plain | unit O11; +1-minute estimate test | Met | — |
| O12 | two_people, [], no estimate, scheduled, paused, done | unit O12 `it.each` + O12a–g | Met | — |
| O13 | Daylight-only task, forecast unusable | unit O13 | Met | — |
| O14 | Forecast 12:01 old: plain, no weather | unit O14 | Met | — |
| O15 | No location: planning hours, no daylight match, no weather | unit O15 | Met | Owner decision approved 2026-10-13, behaviour unchanged: plain openings remain available without configured weather (contract §3.6) |
| O16 | Partial: qualifier; Why names calendar; `data_health.stale` first | unit O16; integration weather-screens › O16/O22; e2e stale test (`data-insight` first is `data_health.stale`; text "on Sunday, 08:00–19:30, as far as HOME knows") | Met | On task openings the qualifier ends the "Nothing is recorded" clause before ", and the forecast…" (ADR §45); the §5.6 template literally says "before the first full stop". O16's row ("clause") supports the build; owner already approved the copy (§46). Record as an approved reading |
| O17 | No live calendar: none anywhere | unit O17 | Met | — |
| O18 | Saturday 07:30 Today: one, "today…then" | unit O18; integration O18/O20; e2e X5/O18 | Met | — |
| O19 | Dismiss Saturday's: Sunday's with "tomorrow" | unit O19; integration O23 test; e2e no-JS O23 | Met | — |
| O20 | Friday Today: Saturday's "tomorrow" | unit O20; integration O18/O20 | Met | — |
| O21 | Saturday 17:45 not current; response `not_eligible`, nothing written | unit O21 (not derived); integration › "refused as not eligible…a not-current opening (O21)" (both keys, both surfaces, 0 rows, audit unchanged) | Met | — |
| O22 | Stale + Saturday shown; Sunday under "+ 1 more" | unit O22; integration weather-screens O22 | Met | Owner decision approved 2026-10-13, behaviour unchanged: calendar-health insights keep their priority over openings (§5.8, D15) |
| O23 | Accepted from Today and Forward, audited kind only, hidden both surfaces; person page / crafted → `not_eligible`; gate closed refused before any query | integration › O23 ×4 (`already:false`→`true` idempotent, audit +1 then +0, person ×2, crafted ×2, Wednesday-only key from Today; gate: query count unchanged, `real_data_closed`); e2e no-JS O23 | Met | — |
| O24 | 23:59 → 00:01 same key, still hidden | unit O24; "midnight passes" lifecycle test | Met | — |
| O25 | Stain the deck named; fence listed; key | unit O25 | Met | — |
| O26 | No forbidden word at any band/age/coverage | unit O26 (combined M5+M6+M7 regex; "likely" only in "rain likely"); integration rendered-text scan | Met | — |

### P — privacy and the gate

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| P1 | Sam's private records leave Alex's gaps, coverage, openings, keys, Today, Forward and rendered pages byte-identical; Sam's change | services filter by actor | gaps.test P1 ×2 (event, all-day, scheduled task, private person on private event, stale calendar; overnight task); openings.test P3; `weather-screens.test.ts` › "P1, P3: … Sam's private event, all-day event, dry-weather task, private person on a private event, scheduled task and stale calendar change Sam's pages and not Alex's: rendered bytes, models and listings (PI-1, PI-2)" (Q3: Alex's rendered Today and Forward `toBe` before; Today model, `ForwardModel` and both Worth knowing listings `toEqual` and `JSON.stringify`-equal; no private id in Alex's HTML or models; Sam's Today and Forward change; not vacuous: Alex's pages carry openings); e2e P1 (`main` innerHTML) | Met | — |
| P2 | Alex's responses change nothing of Sam's | per-`user_id` | openings.test › Dismiss/Not useful tests (Sam's openings and `responded` byte-identical) | Met | — |
| P3 | Sam's private event nowhere in Alex's Why, facts, keys, counts | — | openings.test P3 (ids and titles absent, deep and byte); weather-screens P1 (no "Sam private" in Alex's HTML) | Met | — |
| P4 | Same row for both; no actor data; audit in triggering adult's Activity only, `{status,hours}` | `service.ts:274-282` | integration › P4 ×2 (both read the same; `listAudit` Alex has it, Sam `[]`) | Met | — |
| P5 | No coordinate/elevation/URL/query/canonical/key anywhere; fingerprint only in its column | — | integration › P5 (after ok, `rate_limited`, location change with elevation 37, failure, success: row, audit, logs, export for both adults, schema columns; fingerprints absent from audit, logs, export), scanned with `locationLeaksIn` (Q8; a timestamp no longer fails it by chance, a planted `174.78` in the export still does, ADR §47); weather-screens › markup check; weather-route (response bodies) | Met | — |
| P6 | Export excludes it with reason | `spec.ts:277` | export-completeness unit; P5 (`records` has no `weatherForecast`) | Met | — |
| P7 | Production gate closed: no refresh; responses refused; no openings (no records) | guards | W13; openings.test › "the gate closed: refused before any query"; "no opening can exist" is by construction (no records in Production) | Met | — |
| P8 | Kev actor refused before any query | `assertCanWrite` | integration › P8 (Kev, sync, system; 0 queries, 0 calls); weather-route › P8 | Met | — |

### X — cross-cutting

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| X1 | Render with a provider that throws: both render, no call; client posts after render only when due | compose files import no integration | `weather-screens.test.ts` › "X1, X9: … nothing is fetched while rendering, even with a refresh due: no fetch, no node:https or node:http request or get" (Q2: a forecast due a refresh, `askWeather` true on both pages; global `fetch`, `https.request`, `https.get`, `http.request`, `http.get` all throw, with `syncBuiltinESMExports`; none called after each render, for both adults); static checks: compose-source unit test, `layer-exceptions.test.ts`, the ESLint ban; e2e counts posts (0 fresh, 1 stale/none) | Met | — |
| X2 | Today, Forward, `respondToInsight` each +1; constant after +20 events, tasks, 2nd calendar | one `readForecast` per page | `integration/openings.test.ts` › "…respondToInsight one more; all constant after 20 more events, tasks and a second calendar" (`withWeather.respond === without.respond + 1`; `larger` `toEqual` `withWeather` incl. `respond`); weather-screens › X2 (composeToday/composeForward +1, constant; Month unchanged; its respond count only `> 0`) | Met | PR #78's note is right for `weather-screens.test.ts`, but Package 3's `openings.test.ts` does assert `respondToInsight` +1 and constant. The baseline is "weather unconfigured (key missing)", which is M6's query set — say so |
| X3 | 300-event household: gaps over 7 days and openings each <10 ms; recorded | — | gaps-performance (asserts `< 100` ms warm, logs numbers); openings-performance (asserts `< 100` ms). Run here: gaps 7 d **1.3 ms warm / 3.4 ms cold**; openings Forward Week **3.8 ms warm / 6.7 ms cold** | Met | Assertion bound is 10× looser than X3's 10 ms; the numbers are measured and recorded |
| X4 | No JS: cached forecast with time; Why opens; Dismiss/Not useful post back with it gone; no refresh | native `<details>`, forms | e2e › "X4 at {vp}" Today, "X4, O23 at {vp}" Today, "X4 at {vp}" Forward, each at all four viewports (Q6; see 4-1) | Met | Limitation recorded (ADR §47): the browser tests depend on the fixture family's records |
| X5 | Four viewports: axe, no h-scroll, 44 px; phone first screen | — | e2e › "X5 at {phone,…}" › "axe, no horizontal scroll and 44px targets on Today and Forward Week with every Why open" (axe and no-scroll on both; the 44 px loop now runs over `[today.page, week.page]`, Q6); first-screen test | Met | — |
| X6 | Each §4.4 state exactly | compose + views | integration › X6 tests (none, key missing, absent, older, unusable, evening, partial); `weather-screens.test.ts` › "X6: first run (no live calendar) with a fresh forecast" (Q5: with every calendar archived, Forward Week has 7 phrases, "Forecast as of 06:55 · Open-Meteo", one visible credit, no openings; with nothing recorded as well, Today's state is `first_run`, the weather sentence and one visible credit link, no opening; not vacuous: openings listed before); e2e X6 | Met | Limitation recorded (ADR §47): Today's first run with a forecast is proven at integration level only. "Another location's forecast" at render rests on the read returning `none` (W20) |
| X7 | 13 h failing: stale line; Forward none; openings without weather; no "error" | `staleSentence`; `usable()` | integration › X7 ×2; e2e › X6/X7 Today, X7 Forward (14 h old) | Met | — |
| X8 | M1–M6 suites pass; M5/M6 forbidden tests unchanged | — | CI full regression green on every head; forbidden lists untouched in the diff | Met | — |
| X9 | Fixed now and forecast: byte-identical twice | — | weather-screens › X1/X9 (`toBe` for both adults, both pages) | Met | — |
| X10 | No new runtime dependency | — | `git diff fc2e179..331bf7b -- package.json pnpm-lock.yaml` empty | Met | (Diff evidence, not a test) |
| X11 | CSP unchanged; checks pass | `src/proxy.ts` unchanged | unit `csp.test.ts`; weather-screens.tsx › "the Content-Security-Policy gains nothing…"; CI "production CSP" step; `csp.spec.ts` in full regression | Met | — |
| X12 | Month, Season, person: no phrases, credit, openings | `compose.ts` reads forecast on Week only | integration X12 (no forecast read); e2e X12; unit source checks | Met | — |

## 3. §8.1–§8.4 requirements not already a row

| # | Requirement | Evidence | Result | Remaining action |
|---|---|---|---|---|
| U-1 | Fingerprint canonical string (two decimals, negative lat, `none`) and committed vector | env › canonical string; vectors | Met | — |
| U-2 | Daylight rounding | daylight › "rounding inward…" | Met | — |
| U-3 | Openings: 119/120, estimate +1, weekday, day 1 vs day 2 wording, caps ±1 | openings-engine › O10, +1 estimate, weekends, "today and tomorrow describe the candidate's hours; days 2–6 the day's", "caps ±1…zero, one, two and three" | Met | — |
| U-4 | Every §5.7 identity row | openings-engine › "identity and lifecycle" ×9 | Met | — |
| U-5 | Determinism (shuffle, repeat, frozen now, deep/byte) | G20; openings 8 seeds; weather-engine determinism | Met | — |
| U-6 | Traceability: known rule, documented in §5, facts resolve | openings › "every opening carries a known rule, documented in the contract…"; gaps › facts; explainability reads the M7 contract | Met | — |
| U-7 | Absence rule over nothing-recorded, missing people, unassigned all-day, stale calendar, no forecast | forbidden-list scans across those scenarios (O26, gaps, weather-engine, rendered) | Met (weak) | The rule is proven as "no forbidden word"; no scenario asserts the absence of an availability *claim* phrased otherwise (as M6) |
| U-8 | Import boundaries (no db/app/kev/ui/integrations/clock) | weather-engine, gaps, openings › "the engines import no …" | Met | — |
| U-9 | Adapter: no logging; errors map; nothing raw | adapter › "logs nothing, touches no database…"; W10 | Met | — |
| U-10 | `/weather/refresh` static config | weather-route static ×4 | Met | — |
| PI-1 | §8.2 inputs: private weekend event, all-day, scheduled task, open dry task with estimate, private person on private event, private stale calendar, other adult's responses | gaps P1 (all but the open task and responses); openings P3/P2 (event, all-day, open task, stale calendar, responses); rendered and models, `weather-screens.test.ts` › P1 (event, all-day, open task, private person on a private event, scheduled task, stale calendar; Q3) | Met | — |
| PI-2 | §8.2 outputs: gaps, coverage, openings, keys, insights, Today model, `ForwardModel`, rendered pages | gaps (gaps, keys, coverage); openings (openings, keys, order, facts, `responded`); `weather-screens.test.ts` › P1 (rendered HTML `toBe`; Today model, `ForwardModel`, both listings deep- and JSON-equal; Q3) | Met | — |
| I-1 | Refresh: gate, Kev, single-flight, audit visibility, last good kept, retention, one row, fingerprint, stop-before-commit | W8–W13, W20–W22, P4, P8 | Met | — |
| I-2 | Responses on openings: per user, kind-only audit, idempotent, gated, refused crafted/foreign/stale/unlistable/person page | openings.test O23 (crafted, person, unlistable-on-Today, stale O21, gate, idempotent); `openings.test.ts` › P3 › "I-2: a foreign key, derivable only from Sam's private task, is refused for Alex on Today and Forward Week, with nothing written; Sam's own response to it is accepted" (Q4: Alex's Dismiss and Not useful → `not_eligible` from Forward Week on Wednesday and Today on Saturday 07:30; no `insight_response` row; audit count unchanged; Sam's own responses `ok` on both surfaces, one row, audit +2) | Met | — |
| I-3 | A response on one surface hides the key on the other, for that adult | openings.test Dismiss from Today → responded on Forward (and vice versa); e2e | Met | — |
| I-4 | Query counts (X2) | X2 | Met | — |
| I-5 | Export completeness | P6 | Met | — |
| E-1 | Fresh/older/unusable/absent × plain/task/qualified × four viewports × JS on/off | e2e weather.spec: no-JS older forecast, task and plain openings at four viewports (Q6); fresh with every Why open at four viewports (axe, scroll, 44 px); unusable, absent and qualified at phone | Met (weak) | The unusable, absent and qualified states are rendered in the browser at phone only. Their HTML is viewport-independent and asserted at integration level (X6, X7, O16), and the layout is checked at four viewports on the fullest pages; recorded, no correction proposed |
| E-2 | Credit wherever words, nowhere else | W19 | Met | — |
| E-3 | Dismiss and Not useful from Today and Forward, gone from both | e2e (Today both; Forward Dismiss); integration (Not useful from Forward) | Met | — |
| E-4 | No regression; only named additions | full regression 247 on #78; `forward.spec.ts` one named addition | Met | — |
| E-5 | Two-adult sweep extended to openings | 4-4 | Met | — |
| E-6 | Accessibility baseline: axe, headings/landmarks, focus, 44 px, colour, `<details>` keyboard | axe at four viewports; 44 px partial; `<details>` native | Met (weak) | No keyboard/focus test was written for the weather Why or credit link (native elements; axe only) |

## 4. §10.1 criteria

| # | Criterion | Status | Rows |
|---|---|---|---|
| 1 | Correctness | Met | W1–W17, G1–G25, O1–O25, U-3 |
| 2 | Determinism and identity | Met | G15, G20, O5–O8, O24, U-4, U-5, U-8 |
| 3 | Explainability | Met | U-6, X4, unit opening-Why tests, integration "an opening's Why sets out its evidence…" |
| 4 | Privacy | Met | P1–P8, W18, W21, W23, PI-1, PI-2 (Q3, Q8) |
| 5 | No unsupported inference | Met (weak) | O26, U-7, 3-2; scope checks (no Kev directory exists; no `alignment`, `weather_effect`, outdoor or warning code) |
| 6 | Freshness and uncertainty | Met | W7, W11, W14, W15, W20, X7 |
| 7 | Healthy quiet | Met | O9, O17–O22; Forward quiet Week now shows two openings (named) |
| 8 | Accessibility | Met (weak) | X5 (Q6: 44 px on Today and Forward at four viewports); E-6 weak (keyboard by native elements and axe only) |
| 9 | Performance | Met | X1 (Q2), X2, X3 |
| 10 | Reliability | Met | W8–W12 (W9, Q1), W20–W23, X6 (Q5; Today's first run at integration level), X7 |
| 11 | Scope | Met | X10, migration list (0008 only), grep of `src` |
| 12 | Production gate | Met | W13, P7; DEPLOY §E 20–22 and the environment rows written by this commit, earlier items left open |
| 13 | Family usefulness (synthetic) | Owner | 4-5; walker B's screenshot set (`M7-ACCEPTANCE.md` §4) and the curated 12-screenshot set provided for review |
| 14 | Handover | Met (record in ADR) | The owner-requested focused reviews were reported in session; outcomes and owner decisions are recorded in ADR 0011 §43–§48 and the PR bodies; every Blocker and Important finding was fixed before merge (PR #76: openings held unlisted until Package 4 and the conservative project rule, §45; PR #78: the presentation corrections, §46; PR #80: the evidence corrections, §47); carry-forwards #73, #74, #77. No GitHub review objects: the contract asks that each package "had its stated review", measured by "Package reviews; M7-ACCEPTANCE", not for a review object |

## 5. ADR decisions with testable behaviour

| # | Decision | Evidence | Result |
|---|---|---|---|
| D1 | Open-Meteo free, one adapter, no fallback | adapter + policy suites; only `openMeteoProvider` and the fake in `entry.ts` | Met |
| D2 | Env location, rounded 2 dp / 10 m, never stored | env rounding tests; P5 | Met |
| D3 | One row per provider; keyed fingerprint; retention; export excluded | 1a rows, W9 (one row), W11, W20, P6 | Met |
| D4 | Gated; one private audit row per attempt | W13, P4, P8 | Met |
| D5 | Thresholds 20 % / 0.2 mm / 60 % / 1.0 mm / 50 km/h | weather-engine constants test; W5, W6 | Met |
| D6 | Horizon and freshness 3/12 h | W7, W14, W15, constants (`FRESH_HOURS 3`, `USABLE_HOURS 12`, `HORIZON_DAYS 7`) | Met |
| D7 | No severe-weather warnings | grep `src`: none | Met (scope) |
| D8 | Attribution placement | W19 | Met |
| D9 | Planning hours 08:00–20:00 constant | `planning.ts:7-8`; constants tests | Met |
| D10 | 120 openings / 60 floor | O10, G4, "60 kept 59 dropped" | Met |
| D11 | No-household-person timed events block household only, named | G7, G8 | Met |
| D12 | All-day no-household-person does not block, named | G10 | Met |
| D13 | Coverage unknown/partial/recorded | G19, O16, O17 | Met |
| D14 | Weekends only | O9, weekends test | Met |
| D15 | Caps 1/2; after every family; chronological | ranking and caps tests; openings.test listing test | Met |
| D16 | Placement: Today, Forward Week only | X12 | Met |
| D17 | No `alignment` | grep: none | Met (scope) |
| D18 | No outdoor rule; title never read | "a requirement is never inferred from a title" | Met |
| §8 | Facts: ids, dates, instants only; `forecast` and `daylight` kinds | traceability tests | Met |
| §19 | Frozen second policy; 429 `rate_limited` | policy › "is frozen…", "10 seconds, 512 KiB, no redirects; a 429 is rate_limited" | Met |
| §43 | Key may not equal any other secret (5 listed) | env KEY_CASES + `_PREVIOUS` | Met |
| §43 | `HOME_TEST_WEATHER` refused when deployed | env › "HOME_TEST_WEATHER (the fake provider) is refused when deployed" | Met |
| §45 | Conservative project rule | 3-4 | Met |
| §46 | One forecast read per page; refresh mounted on Today and Week only when configured, due and gate open | X2; weather-route › "is mounted on Today and Forward Week only"; integration `askWeather` assertions | Met |

## 6. Evidence corrections: what was done (PR #80)

The assessment proposed Q1–Q6 and Q8; the owner approved them, and they were built as tests only in PR #80 (merged as `a1f1ce3`; all four required checks green on `8a463b3`, Playwright 256 passed in 23.2 min). No file under `src/` changed. Each mutation was applied to `src/`, shown to fail the new test and restored (ADR 0011 §47).

| # | Closes | Test (file › name) | What it asserts | Mutation result (ADR §47) |
|---|---|---|---|---|
| Q1 | W9, 1b-1; §5.1 timeouts | `tests/integration/weather.test.ts` › "W9, §5.1: the timeouts take effect inside the refresh's own transaction"; "performance (recorded in the PR)" | On the backend holding the advisory lock, during the fetch: `statement_timeout` `5s`, `idle_in_transaction_session_timeout` `25s`; `pg_sleep(8)` cancelled `57014` after 4.9–7.5 s; baseline restored after commit (`SET LOCAL`); statements 3 and 4 matched in full | `'5s'` → `'30s'` fails it; `SET LOCAL` → `SET` fails the after-commit check |
| Q2 | X1 | `tests/integration/weather-screens.test.ts` › "X1, X9: … even with a refresh due: no fetch, no node:https or node:http request or get" | With a refresh due (`askWeather` true), `fetch`, `https.request`/`get`, `http.request`/`get` throw and none is called after each render, both adults, both pages; byte-identical renders | Today's composition calling the refresh with the real provider fails on the `https.request` spy |
| Q3 | P1, PI-1, PI-2 | `weather-screens.test.ts` › "P1, P3: … private person on a private event, scheduled task … rendered bytes, models and listings (PI-1, PI-2)" | Alex's rendered Today and Forward byte-identical; Today model, `ForwardModel` and both listings deep- and JSON-equal; no private id; Sam's pages change | Private scheduled tasks, or private people, let through the domain reads: each fails it |
| Q4 | I-2 | `tests/integration/openings.test.ts` › P3 › "I-2: a foreign key, derivable only from Sam's private task, is refused for Alex on Today and Forward Week, with nothing written; Sam's own response to it is accepted" | Alex's Dismiss and Not useful `not_eligible` on both surfaces; no row; audit unchanged; Sam's own responses accepted | The eligibility check bypassed for opening keys fails it (and the crafted-key test) |
| Q5 | X6 (first run) | `weather-screens.test.ts` › "X6: first run (no live calendar) with a fresh forecast" | Forward Week: 7 phrases, credit line, no openings; Today `first_run` with the weather sentence, one visible credit link, no opening | The weather hidden on first run fails it |
| Q6 | 4-1, X4, X5, E-1 (browser breadth) | `tests/e2e/weather.spec.ts` › "X4 at {vp}" (Today), "X4, O23 at {vp}", "X4 at {vp}" (Forward), "X5 at {vp}" › "axe, no horizontal scroll and 44px targets on Today and Forward Week with every Why open" | The three no-JS tests at all four viewports (Forward's now also checks phrases, credit line and no overflow); 44 px on Today and Forward Week. The spec grows from 20 to 29 tests | — (breadth; the assertions are the existing ones) |
| Q8 | W18, P5 (reliability) | `tests/fixtures/weather.ts` › `locationLeaksIn` (used by `clean()` in `weather.test.ts` and the adapter, route and boot unit tests); `tests/unit/weather/location-leaks.test.ts` | A numeric leak matches only as a standalone number (a timestamp, uuid or longer number passes); `-41.29`, `41.29,`, `"lat":-41.29`, `latitude=-41.29`, `174.78`, `"lon":174.78`, the URL, key and canonical prefix are caught | The latitude planted in the audit meta fails W2, W4/W10 and P5; `174.78` planted in the export fails P5 |

Q7 (the scenario screenshot set) is satisfied without a test: walker B's 100 synthetic screenshots (`M7-ACCEPTANCE.md` §4), and the curated 12-screenshot set provided for the owner's review.

**Limitations that remain (ADR 0011 §47), recorded on their rows:** the 25 s idle timeout's effect is proven only through W22 (W9); Today's first run with a forecast is proven at integration level only (X6); the browser tests depend on the fixture family's records (X4).

## 7. Coordinator's verifications and corrections (2026-10-13)

- **X1 confirmed weak** (at the original assessment; closed by Q2, §6). `src/integrations/net/safe-fetch.ts:226` sends through `transport.request` (`node:https`), so the X1 test's global-`fetch` stub could not catch a provider call. The test now spies the `node:https` and `node:http` transports too (Q2), and X1 is **Met**.
- **1a-5** read in `docs/FAMILY-DATA-MODEL.md`: Met (document).
- **5-1** is met by this commit (the acceptance document, this matrix, DEPLOY §E 20–22 and the environment rows).
- **Q7** is met by walker B's screenshots for owner review, at three viewports (phone, tablet-portrait, desktop), in the session scratchpad and never committed, as in M6.
- **Q1–Q6** were recorded as targeted evidence corrections for the owner's approval; the owner approved them with Q8 and they were built in PR #80 (§6).
- **Q8** (found on this package's own CI, `5aac2ee`): the W18/P5 redaction scan in `tests/integration/weather.test.ts` treats `41.29` as a leak anywhere, so an export timestamp such as `…T23:34:41.295Z` fails it by chance. Not a leak; fixed by `locationLeaksIn` in PR #80 (§6).
- **LOCAL-DEV.md**'s weather paragraph said the refresh was "not yet asked for by any screen"; it has been mounted on Today and Forward Week since PR #78. Corrected in this commit (documentation).
- **Evening sentence.** Contract §4.4's example "Tomorrow: looks dry until midday, then showers possible." is the two-run shape of §5.2's `weather.tomorrow` template; the as-built "Rain likely tomorrow." is its one-run shape ("{Band} tomorrow."). Both are §5.2's; the contract is not changed.

## 8. Summary of non-Met rows (after reconciliation)

- **FAIL:** none.
- **Not verified:** none. (At the original assessment: 2-3, closed by the re-run in this reconciliation; criterion 14, graded Met on the ADR record, §4.)
- **Met (weak):** E-1 (the unusable, absent and qualified states in the browser at phone only; HTML asserted at integration level), U-7/criterion 5 (absence proven by word lists, as M6), E-6/criterion 8 (keyboard by native elements and axe; no keyboard test of the weather Why or credit link).
- **Met, limitation recorded (ADR 0011 §47):** W9 (the 25 s idle timeout's effect through W22 only), X6 (Today's first run with a forecast at integration level only), X4 and the browser rows (the fixture family's records).
- **Owner:** 4-5, criterion 13 (the screenshot approval, from the curated set). The two owner decisions are **approved (2026-10-13), behaviour unchanged**: plain openings without configured weather (contract §3.6, O15); calendar-health insights ahead of openings (§5.8, D15).
- **Operational:** DEPLOY §E 20 (Preview forecast, Neon pooler idle-timeout), 21 (Production location after the gate), 22 (real weekend openings).

**Recount** (the 167 rows of §1–§3 and §5, the §4 criteria separately):

| Area | Rows | Met | Met (weak) | Not verified | Owner |
|---|---|---|---|---|---|
| Package acceptance (§1) | 26 | 25 | 0 | 0 | 1 (4-5) |
| W, G, O, P, X (§2) | 94 | 94 | 0 | 0 | 0 |
| §8.1–§8.4 (§3) | 23 | 20 | 3 (U-7, E-1, E-6) | 0 | 0 |
| ADR decisions (§5) | 24 | 24 | 0 | 0 | 0 |
| **All rows** | **167** | **163** | **3** | **0** | **1** |
| §10.1 criteria (§4) | 14 | 11 (14 on the ADR record) | 2 (5, 8) | 0 | 1 (13) |
