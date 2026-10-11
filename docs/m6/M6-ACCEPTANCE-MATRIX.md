# M6 Package 5: acceptance evidence matrix (assessor's working file)

Assessed on branch `m6/package-5-acceptance` = `main` at `6ede099` (PRs #59, #60, #61, #65, #66, #67 merged). Read-only: no repository file was edited. Unit tests were run locally; no database or browser was used. Mutation checks ran on an out-of-repo copy (`git archive HEAD`) in the scratchpad, with the repo's `node_modules` linked; the repo itself was not touched.

Result key: **PASS** = an assertion in a test that runs in CI proves it (I read the assertion). **PASS (weak)** = a test exists but asserts less than the requirement; the gap is named. **NOT VERIFIED** = only code reading, a doc, or a developer report supports it. **FAIL** = the contract is not met.

## 0. Counts

| Suite | Count | Source |
|---|---|---|
| Unit (`pnpm test`) | **82 files, 1,554 tests, all passed** (23.9 s) | Run here, 2026-10-11 |
| M6 unit files | forward-engine 71, forward-insights 23, conflicts-engine 57, conflict-insights 13, conflicts-performance 5, conflict-marks 3; with prototype-retired 7 and the today suites: 12 files, 263 tests | Run here (verbose) |
| Integration | Not readable: the CI log is served from a host `gh api` may not reach. The "Lint, typecheck, unit and integration tests" job on `6ede099` (run 38105649268) is **success**, every step green, including `pnpm check:private-terms` and `pnpm test:integration`. The count must come from the owner's CI log or a local `pnpm verify`. | `gh api …/jobs/114370504052` |
| End to end | PR #67 head `b5e84ba`: **218 passed (17.6 min), "Browser tests, full regression"** (run 38097583214). Main at `29339b9`: 207 passed. Main at `6ede099`: e2e job **still in progress** when checked. | Playwright run-summary annotations |

## 1. Evidence matrix

### 1A. Package 1 acceptance (contract §2.2)

| # | Requirement | Implementation | Evidence (file › test) | Result | Remaining action |
|---|---|---|---|---|---|
| P1-1 | `/prototype` gone with every exclusion; rule-14 clause; tag `m0.6-prototype` resolves on origin | Deleted; CLAUDE.md rule 14 | `tests/unit/prototype-retired.test.ts` (7 tests: directory gone, no source names it, exclusions). Tag checked here: `git ls-remote --tags origin m0.6-prototype` → `3d58390…` | PASS | — |
| P1-2 | Forward's agenda query count constant in events | `loadAgenda` → `readAgendaInputs` (one read) | `integration/forward-engine.test.ts` › "does not grow with the events, tasks or projects recorded" (`large.queries === small.queries` after +30 events, +30 tasks, +5 projects); `forward-screen.test.ts` › "is the agenda read plus exactly one query, and the same after more is recorded" (+20 events, 3 tasks, a project, a second calendar; `total === load + 1`) | PASS (CI) | Quote the logged numbers from CI in the acceptance doc |
| P1-3 | Today's suites pass unchanged; a scheduled task once on Today | `today.ts` leaves `task_scheduled` out of Also today, lines, Earlier | `unit/today/today-engine.test.ts` › "scheduled tasks on the shared agenda (M6 Package 1…)" (`todo.all` has t-plumber once; not in alsoToday, not in evening.earlier); M5 suites green in CI | PASS | "Unchanged" was not literal: one e2e names the Dismiss form explicitly (P3), and Today's footer copy changed (P4). Record both. |
| P1-4 | Boundary tests: units across month end, year end, both DST changes | `unitsOf` (forward.ts:275) | forward-engine › "Month: … clipped at day 30", "Month starting on a Sunday… across a year end", "Season: … with the year", "units are contiguous" (4 start dates × 3 horizons), "across the NZ DST start (27 Sep 2026)" (Week, series placement asserted in UTC), "across the NZ DST end (5 Apr 2026)" | PASS (weak) | DST-end test has no events and checks only the Month unit's `from/to`. Add: a weekly 09:00 series on Week and Season across 5 Apr 2026, asserting the occurrences stay on their days at 09:00 NZST (UTC 21:00) and the unit counts are unchanged. |
| P1-5 | A changed occurrence is notable | `entryOf` (no rule → not in `usualSeries`) | forward-engine › "a changed occurrence is its own row with no rule, so it is notable" | PASS | — |
| P1-6 | A fortnightly series is usual | `regularWeek` (profile.ts) feeds `usualSeries` | Only indirect: `unit/regular-week.test.ts` › "fortnightly is kept as fortnightly…", "a fortnightly series whose next occurrence is next week still shows". No Forward test uses `INTERVAL=2`. | PASS (weak) | Add to forward-engine: a `FREQ=WEEKLY;INTERVAL=2` series with a household person is `forward.usual` on its on-weeks across Month and Season, absent on off-weeks, never notable. |
| P1-7 | Caps and "+ N" | `selection` (forward.ts:344), `ROW_CAP` | forward-engine › "Week shows two per day; the rest are held, and '+ N' is exact", "Month and Season show three per unit", "nothing is lost…" (×3); forward-insights › "large data stays bounded…" (30 → 2/28, 3/27). Mutations "cap+1" and "+N off by one" each fail 8 tests (run here). | PASS | — |
| P1-8 | Load bands ±1 | `bandOf`, `LOAD_BANDS` | forward-engine › "a day with %i notable things is band %i" (0,1,2,3,4,5,9) and "a week with %i…" (0,1,4,5,9,10). Mutations moving band 3 to 6 / 11 each fail 1 test (run here). | PASS | Week/month band-2 lower edge is tested (5); its 4/5 edge yes; day 2/3 yes. Complete. |
| P1-9 | Engine imports no `db`, `app`, `kev`, clock | forward.ts imports | forward-engine › "no clock, no randomness, no database, screen, Kev or server import" (allow-list of imports) | PASS | — |

### 1B. Package 2 acceptance (contract §2.2)

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| P2-1 | Touching ends; one minute; identical; overnight; DST; routine and work-pair exclusions; same series; all-day; default people; changed occurrences | `conflicts()` (conflicts.ts:238–335) | conflicts-engine › "ends that touch do not overlap", "one minute of overlap…", "identical times…", "an overnight occurrence placed on two home days is one occurrence", "a home-zone series keeps its key across a DST change (NZ, April 2027)", "a series kept in another zone…two standing conflicts", "Today's routine occurrences… are excluded", "two work occurrences never conflict…", "a series never conflicts with itself", "all-day events take part in no conflict (T16…)", T4/T6 (changed). Default people: `integration/conflicts-default-people.test.ts` (3 tests through `connectCalendar`, `refreshCalendar`, `setEventPerson`). | PASS | DST: only the April (fall-back) change is tested for a standing key; no conflict test crosses the September change, and none has an overnight occurrence across a DST night. See check 13. |
| P2-2 | Every engine-level §5.7.4 test passes | — | §1I below | PASS | — |
| P2-3 | Keys stable across input order; fit `insightKey` | key built at conflicts.ts:321 | T19 (8 seeded Fisher–Yates shuffles of events, people, days and items; deep and byte equality; order-diversity check); T20 (×2, incl. the 161-character key) | PASS | — |
| P2-4 | Non-interference at unit level and through the real services | Services filter; engine sees only visible people | Unit: "a person the reader cannot see is on no occurrence for that reader". Integration: conflicts-engine › "Sam's private records change nothing in Alex's conflicts, and do change Sam's" (deep + byte equality; four private shapes) | PASS (CI) | — |
| P2-5 | Forbidden phrases | `sentence()` (conflicts.ts:205) | conflicts-engine › "the wording never infers…" (regex incl. "in two places", "double-booked", "worth deciding", lift/drive/pick up/drop off) | PASS | — |
| P2-6 | Mutation proof: identity input, exclusion, tie-break each fail a test | — | ADR §33 table (developer report). **Re-run here on a copy: all 10 sampled mutations killed** — touching ends (2 failed), no responsible precedence (11), date in standing key (17), same-event exclusion removed (1), work-pair (1), routine (1), visibility filter (1), person out of key (25), change taken as standing (17), overlap-start tie-break removed (3). | PASS (independently re-run for the unit-level mutations) | The integration-level mutations (`visibleTo`, default people in `readAgendaInputs`) remain developer-reported. |

### 1C. Package 3 acceptance (contract §2.2)

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| P3-1 | Conflicts on Today's items and in Worth knowing per §5.8 | `insights()` conflict family (insights/index.ts:313–331), `conflictMarks` (:361), Today page | conflict-insights (unit) › "a conflict of today with a place on Today is said on its items, not listed", "…marked on both of its entries…", "someone outside the household is marked on the Also today row", "…no place on the screen is listed, not lost", "looks only as far as Today's window: a conflict ten days out is not a Today insight"; e2e `today-conflicts.spec.ts` (2 tests, no-JS marks; Worth knowing listing) | PASS (weak on the window edge) | Window boundary not tested at ±1: add a unit case with a conflict at today+7 (listed) and today+8 (absent). |
| P3-2 | Not useful and Dismiss per user, audited, gated, idempotent | `respondToInsight` (domain/insights/today.ts:152–176), `respond` (service.ts:19–48) | `integration/conflict-insights.test.ts` › T17; "Not useful hides it for Sam, records the judgement, and is audited with the kind only" (audit +1; `already:true` writes nothing; meta `{"response":"not_useful"}`; Alex's Activity excludes it); "Sam turns Not useful into Dismiss"; "Dismiss and Not useful are refused in Production while the gate is closed, before any read" (query counter unchanged, `real_data_closed`) | PASS (CI) | — |
| P3-3 | Feedback changes nothing for the other adult | per-`user_id` reads | conflict-insights › T17; forward-screen › "Alex's responses change nothing in Sam's Forward, insights or marks…" (byte equality, every horizon, Milo's page) | PASS (CI) | — |
| P3-4 | A crafted, foreign or stale key is refused | eligibility (today.ts:166–171) | Crafted: conflict-insights › "a crafted or malformed key is refused…"; forward-screen › "a crafted, malformed or unknown-surface key is refused…". Foreign: conflict-insights privacy (Alex → Sam's private conflict `not_eligible`). **Stale: no test.** | **NOT VERIFIED (stale)** | Add to `conflict-insights.test.ts`: (a) `respond(h.sam, key.thursday)` with `now` = 2026-10-15 16:00 NZDT (overlap ended) → `not_eligible`, no row, audit count unchanged; (b) after Dentist moves to 15:45 (T13), the old T11 key → `not_eligible`. The code would refuse both (re-derived current conflicts only); no test proves it. |
| P3-5 | Service-level §5.7.4 lifecycle (P3) through real services | event services | conflict-insights › T3, T4, T5, T6, "T7 and T8", T14 (§1I) | PASS (CI) | — |
| P3-6 | Today's no-regression | — | M5 Today unit, integration and e2e suites green in CI (PR #67 full regression 218 passed) | PASS (CI) | Record the two intentional Today string changes. |

### 1D. Package 4 acceptance (contract §2.2)

| # | Requirement | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| P4-1 | Scenario e2e at four viewports, JavaScript on and off | `forward/page.tsx`, view | `e2e/forward.spec.ts` › "devices at {phone, tablet-portrait, tablet-landscape, desktop}: every horizon accessible, no horizontal scroll, 44px targets" (JS on, all three horizons, all folds open, axe); "Week without JavaScript…" (phone only) | PASS (weak) | JS off is tested on Week at phone only. Month and Season have no no-JS run, and no viewport but phone runs without JS. Add a no-JS loop over the three horizons at 375 and 1280: horizon links navigate, a row "+ N" opens, a Worth knowing Why opens, Dismiss posts and returns to the same horizon. |
| P4-2 | Every agenda item in the 30-day window reachable from Month | engine `rest`, The usual | Unit: forward-engine › "%s: nothing is lost — every agenda item in range is in exactly one place per unit" (×3). e2e › "nothing in the 30 days is lost on Month…" (each seeded record a row link or in The usual; project target, scheduled task) | PASS | Usual occurrences are reachable via their series in The usual, not on their day (see caveat 2). |
| P4-3 | Accessibility baseline holds | — | forward.spec device tests (axe serious/critical, 44px, no horizontal scroll at four viewports); "keyboard: Tab reaches the three horizon links and a summary; Enter opens it"; today-conflicts axe with marks and open Why | PASS (weak) | "No information by colour alone": the load band's `sr-only` text and the marks' words are in the code (coming-up.tsx) but no test asserts the text equivalent. Add: each `li[data-unit]` with band > 0 contains the sr-only "N things recorded". The "+ N" summary has no context of its own for a screen reader (ADR §35 caveat). |
| P4-4 | Two-adult sweep covers Forward and Coming up | — | `m3-privacy-sweep.spec.ts` (every route incl. `/forward` and `/people/{id}`, both adults, canary records dated today); forward.spec › "privacy: Alex never sees Sam's private title or its overlap, on any horizon or Sam's page" | PASS (weak) | The M3 sweep visits `/forward` (Week) only, not `?h=month` / `?h=season`; forward.spec covers those for one private pair. Add `/forward?h=month` and `/forward?h=season` to the sweep's static routes. |
| P4-5 | Owner approves headline wording and layout from screenshots | — | Screenshots `test-results/screenshots/forward-{horizon}-{viewport}.png` | NOT VERIFIED (owner's call) | Owner review in Package 5. |

### 1E. Unit requirements (contract §8.1)

| # | Requirement | Evidence | Result | Remaining action |
|---|---|---|---|---|
| U-1 | Overlap by one minute; touching; identical; overnight; all-day excluded | §1B P2-1 | PASS | — |
| U-2 | Units across month end, year end, both DST changes | P1-4 | PASS (weak) | DST end, as P1-4 |
| U-3 | Standing window across a DST change for a home-zone series keeps its key | conflicts-engine › "a home-zone series keeps its key across a DST change (NZ, April 2027)" (asserts one key, UTC hours {2,3}) | PASS | Add the September change too (same assertion over 2026-09-16…2026-10-14). |
| U-4 | Caps ±1; load bands ±1 | P1-7, P1-8 | PASS | — |
| U-5 | A changed occurrence of a usual series | forward-engine › "a changed occurrence is its own row…"; forward-insights › "a changed occurrence of a usual series…is notable with an occurrence key, and the standing conflict's old response does not hide it" | PASS | — |
| U-6 | Fortnightly cadence | P1-6; conflicts › "a series rule change that keeps the window keeps the standing key" uses INTERVAL=2 | PASS (weak) | As P1-6 |
| U-7 | Default people | Integration only (conflicts-default-people, 3 tests) | PASS (CI) | Unit not possible by design (resolved by the read); acceptable. |
| U-8 | Series people on a change | integration/conflicts-engine › T4 ("The change has no people of its own: it shows its series'") | PASS (weak) | The assertion checks only Milo's role (`attending`), not that Alex (responsible on the series) is on the change. Minor. |
| U-9 | Identity and lifecycle: every engine-level §5.7.4 case | §1I | PASS | — |
| U-10 | Determinism: shuffled input, repeated runs, frozen `now`, every horizon | Conflicts: T19 (strong). Forward: forward-engine › "%s: input order never changes the model" (×3). Insights: total-order test. | PASS (weak for Forward) | The Forward shuffle is `sort(() => ±1).reverse()` (an inconsistent comparator; few distinct orders) and does not shuffle people beyond a copy, days or items. Replace with T19's seeded Fisher–Yates over events, tasks, projects, people and the agenda's days and items, asserting deep and byte equality per horizon. |
| U-11 | Traceability: known rule; documented in §5; facts resolve to inputs | forward-engine › "every entry, load and headline carries a known rule and resolvable facts", "every rule … is written down in the contract"; conflicts-engine › "every conflict carries both occurrences…", "every rule is a known one and documented"; conflict-insights › "each conflict is an insight with the engine's key, rule, sentence and facts" | PASS (weak) | Forward's test checks fact counts, not that each fact id resolves to an input record. Small add: every fact id ∈ input event/person/task/project/calendar ids. |
| U-12 | Absence rule (missing people/responsibility, all-day travel, nothing recorded) | conflicts-engine › T16, "two overlapping occurrences with no shared recorded person: no conflict", "a child's occurrences with nobody else recorded state only the child's own overlap"; forward forbidden-word scans over [], ROUTINE, HOUSE | PASS | — |
| U-13 | Forbidden phrases: §5.5's list over every template and rendered string | conflicts-engine (full §5.5 set); forward-engine › "no character, availability or need words…"; forward-insights › "no rendered string the model carries uses a forbidden phrase, on any horizon" (>100 strings) | PASS (weak) | Forward's regex omits "in two places", "worth deciding", "nothing planned", "nobody's down", "lift". No scan of the rendered Forward HTML (M5 had one for Today). Add an e2e scan of `main` innerText on all three horizons and Milo's page with the §5.5 + M5 lists (titles and names exempt). |
| U-14 | Import boundaries | forward-engine › purity; conflicts-engine › "imports no database, app, Kev, UI or integration code, and reads no clock"; `today/explainability.test.ts` | PASS | — |

### 1F. The privacy invariant (contract §8.2, §3.4)

| # | Requirement | Evidence | Result | Remaining action |
|---|---|---|---|---|
| PR-1 | Private event overlapping a household event | integration: conflicts-engine (T18), conflict-insights privacy, forward-screen non-interference (all byte-equal) | PASS (CI) | — |
| PR-2 | Private people on household events | Domain refuses it (`references_private`, ADR §32); private person on private events: conflicts-engine T18 | PASS (CI) | — |
| PR-3 | Private tasks and projects | forward-engine and forward-screen integration (byte-equal on every horizon) | PASS (CI) | — |
| PR-4 | Private stale calendar | forward-engine integration (Sam's private calendar last synced 30 Sep; Alex byte-equal; Sam's headline qualified) | PASS (CI) | Not combined with conflicts in one run; acceptable. |
| PR-5 | The other adult's responses | forward-screen › "Alex's responses change nothing in Sam's Forward…" | PASS (CI) | — |
| PR-6 | Reader's conflicts, keys, insights, ForwardModel (every horizon), Coming up identical | forward-screen (`seen()` = model, conflicts, insights, responded, marks; Milo's marks) | PASS (CI) | — |
| PR-7 | Today model identical | M5 `today-engines.test.ts` (no conflicts in it); conflict-insights compares `readInsights` (Today's insights) byte-equal | PASS (weak) | No integration run composes Today's model *with* its conflict marks under the invariant. Marks are a pure function of the byte-equal insights and the M5-proven model, so the composition holds by construction; a one-line addition to conflict-insights comparing `conflictMarks(…, conflictPlacements(today(…)))` would make it explicit. |
| PR-8 | Rendered Forward and Today pages identical | e2e forward.spec privacy test checks absence of the title and the overlap count only | **NOT VERIFIED** | Add to forward.spec: Alex's `main` innerText for `/forward`, `?h=month`, `?h=season`, `/people/{milo}` and `/today` (fixed `x-home-test-now`, folds opened) captured before and after Sam adds a private overlapping event, a private task and a private project; assert equality. |
| PR-9 | The same records change the owner's own | every invariant test asserts Sam's side changes | PASS (CI) | — |

### 1G. Integration requirements (contract §8.3)

| # | Requirement | Evidence | Result | Remaining action |
|---|---|---|---|---|
| I-1 | Per user | T17; forward-screen cross-surface | PASS (CI) | — |
| I-2 | Audited, response kind only | conflict-insights (`{"response":"not_useful"}`, no key/title); forward-screen (every Sam meta matches `^\{"response":"(dismissed\|not_useful)"\}$`) | PASS (CI) | — |
| I-3 | Idempotent, no second audit row | conflict-insights (`already: true`, audit unchanged); worth-knowing (M5) | PASS (CI) | — |
| I-4 | Refused while the gate is closed, before any query | conflict-insights gate test (both kinds; query counter unchanged) | PASS (CI) | — |
| I-5 | Refused for crafted, foreign, stale, unlistable keys | crafted/foreign/unlistable: PASS (forward-screen "a birthday or busy-day key is not eligible on Forward or Milo's page"). Stale: none | **NOT VERIFIED (stale)** | As P3-4 |
| I-6 | A response on one surface hides the key on the others, for that adult only | forward-screen › "Sam dismisses a conflict from Forward: gone from Forward (every horizon), Today and Milo's Coming up; Alex unchanged"; "Not useful from Milo's page…the same everywhere" | PASS (CI) | — |
| I-7 | §5.7.4 P3 cases through the real event services | §1I (T5, T6, T8, T14 P3; T3, T4, T7 too) | PASS (CI) | — |
| I-8 | Forward's query count constant | P1-2 | PASS (CI) | — |

### 1H. End to end (contract §8.4)

| # | Requirement | Evidence | Result | Remaining action |
|---|---|---|---|---|
| E-1 | Forward scenarios at four viewports, JS on and off: horizon links, "+ N", Why, The usual, Dismiss, Not useful | forward.spec (11 tests): Week no-JS (links, marks, Why, Not useful post); Month (folds, Dismiss); Season (The usual); devices ×4 | PASS (weak) | Only one scenario is seeded. Contract §7 names an ordinary week, a month with a one-off and a standing overlap, a season, **quiet, first run and stale**: the last three are not seeded for Forward in any e2e or render test. Add (forward.spec): first run (no calendar, no events → "HOME doesn't know your calendars yet." and "Connect a calendar ›", no Coming up rows with items); quiet ("Nothing recorded in the next seven days." or "…besides the usual", each unit "Nothing recorded…"); stale (headline then `getByTestId('qualifier')` "As far as HOME knows.", Worth knowing's `data_health` row, no alarm words). Also P4-1. |
| E-2 | No regression: every item of the old 30-day Forward reachable from Month | P4-2; older specs (`events`, `occurrence-changes`, `synced-events`, `home-tasks`, `today`, `today-screen`, `smoke`) moved to `li[data-unit]` | PASS (CI) | — |
| E-3 | Today: marks, Worth knowing conflicts, Not useful; M5 specs pass | today-conflicts.spec (2); today-screen.spec (kept) | PASS (CI) | Not useful on a non-conflict family (birthday, calendar) is not exercised anywhere; see R-3. |
| E-4 | Coming up: a person's conflict marks | forward.spec › "Milo's Coming up marks the overlap with Why; Not useful there clears it from Forward too"; forward-screen › "Milo's page marks Milo's items only" | PASS | — |
| E-5 | Two-adult privacy sweep extended to Forward and Coming up | P4-4 | PASS (weak) | As P4-4 |
| E-6 | Accessibility: axe, headings/landmarks, focus, 44px, no colour alone, `<details>` keyboard-operable | P4-3 | PASS (weak) | As P4-3 |

### 1I. Identity and lifecycle T1–T20 (contract §5.7.4)

| T | Unit (conflicts-engine) | Service level (integration) | Result | Notes |
|---|---|---|---|---|
| T1 | "T1: one standing conflict…said once at the next Wednesday" (one key, 13 instances, text) | conflicts-engine int. "both adults see the same household conflicts" (13 instances) | PASS | — |
| T2 | "T2: Alex made responsible on Tutoring too…" | — | PASS | — |
| T3 | "T3: four weeks later…the key is the same" | conflict-insights "T3: four weeks on…still answered" | PASS | — |
| T4 | "T4: a changed occurrence is its own conflict…" | conflict-insights "T4…eligible despite the standing dismissal"; conflicts-engine int. T4 | PASS | Integration does not assert the standing key stays in `all` (only absent from `current`). Minor. |
| T5 (P3) | engine-level form | conflict-insights "T5: the change returned to its series…still dismissed" (`returnOccurrenceToSeries`) | PASS | — |
| T6 (P3) | engine-level form | conflict-insights "T6: the put-away change restored…applies again" | PASS | "Put away" is done by `returnOccurrenceToSeries`, which archives the change row (events/service.ts:389); then `restoreEvent`. A separate `archiveEvent` on the change row is not exercised; same mechanism. |
| T7 | "T7: the 21 October Tutoring skipped…" | conflicts-engine int. T7 (`skipEventOccurrence`; next date asserted) | PASS | — |
| T8 (P3) | engine-level form | conflict-insights "T7 and T8: …skipped, then put back…response unchanged" | PASS | — |
| T9 | "T9: …a new standing key, w1600-1615" | — | PASS (weak) | "Eligible; the old response matches nothing" is implied by key inequality, not asserted with a response. |
| T10 | "T10: Tutoring adds Mondays…" | — | PASS | — |
| T11 | "T11: Art club and Dentist…" | conflict-insights fixture | PASS | — |
| T12 | "T12: Dentist's end moves to 17:00: the same key" | — | PASS | — |
| T13 | "T13: Dentist moves to 15:45–16:45: a new key" | — | PASS | — |
| T14 (P3) | engine-level form | conflict-insights "T14: Dentist archived, then restored…" | PASS | — |
| T15 | "T15: …ends touch, no conflict" | — | PASS | — |
| T16 | "all-day events take part in no conflict (T16…)" | — | PASS | — |
| T17 (P3) | — | conflict-insights "T17: Alex dismisses the Thursday conflict; it is gone for Alex only" | PASS | — |
| T18 | unit visibility case | conflicts-engine int. non-interference; conflict-insights privacy; forward-screen | PASS | "Pages identical": see PR-8. |
| T19 | "T19: seeded shuffles…" | — | PASS | — |
| T20 | "T20: every key matches insightKey…", "T20: the longest key…161" | — | PASS | — |

### 1J. ADR 0009 decisions with testable behaviour

| # | Decision | Implementation | Evidence | Result | Remaining action |
|---|---|---|---|---|---|
| D-1 | §10–§11 rules, exclusions; responsible replaces overlap | conflicts.ts:255–330 | §1B | PASS | — |
| D-2 | §13 order: responsible, overlap start, key | `compareConflicts` (conflicts.ts:388) | conflicts-engine › "responsible first, then the earlier overlap, then the key"; mutation run here (3 failed) | PASS | — |
| D-3 | §14 Why: rule sentence, both occurrences with times and people, the overlap, standing repeat + next, responsible wording; never places or reasons | `ConflictExplanation` (_insights/explanation.tsx) | e2e asserts the overlap lead and both links (Week no-JS, Today, Milo's page). **Nothing asserts the standing line ("Both repeat… The next is…"), the responsible lead, or each commitment's date, times and role.** | PASS (weak) | Add a render test (`tests/unit/insights/conflict-explanation.test.tsx`, `renderToStaticMarkup`): standing overlap → "Both repeat, and they overlap at this time each time. The next is Wednesday 21 October."; responsible → "…recorded as responsible for both of these…"; each row's detail "Thursday 15 October, 15:00–16:00 · Milo attending"; no place text. |
| D-4 | §15 hierarchy; Week first; units; notable/usual; row order (Week by kind; Month/Season chronological, §35) | forward.ts, forward-view.tsx | forward-engine (units, notable, order tests, "Month and Season rows are chronological…"); forward-insights; e2e headline/Worth knowing/Coming up order implicit | PASS | Section order (headline, Worth knowing, Coming up, The usual, Today ›) on the rendered page is not asserted (M5 asserted Today's by headings and focus order). Add to forward.spec. |
| D-5 | §16 headline closed set; qualifier | forward.ts:497–545 | forward-engine › every headline rule (first run, nothing, usual, listed, counted, qualified, two overlaps) | PASS (engine) / NOT VERIFIED (render of qualifier and first run) | E-1 |
| D-6 | §17 Not useful hides as Dismiss; changes no rule/ranking/other insight; Kev does not read it | respondToInsight; no reader of the kind (§5 below) | conflict-insights › "Not useful changes no rule, ranking or other insight…" | PASS (CI) | — |
| D-7 | §18 per-surface listing; ranking; Today 3, Forward 2; "+ N more" genuine | `FORWARD_LISTED`, `insights()` `listed`/`shown` | forward-insights (Week lists data_health only; Month/Season list conflicts; two shown, exact "+ N more"; "nothing past the horizon"); conflict-insights ranking; e2e Month "two shown" and exact `+ {total-2} more`. Mutations "listed ignored" (14 failed), "+N counts on-object" (20 failed) run here. | PASS | — |
| D-8 | §19 response reaches every surface; re-derive over 90 days; conflict accepted from any surface; others only where listed | today.ts:152–176 | forward-screen cross-surface and refusals | PASS (CI) | Acceptance of a `data_health` key from `forward` is not tested (only refusals). Minor. |
| D-9 | §22 load in ink, never accent; text equivalent | coming-up.tsx (`text-ink-2`, sr-only text) | Code only; e2e axe | NOT VERIFIED (text equivalent) | P4-3 |
| D-10 | §26 scheduled tasks on Forward, once on Today | agenda engine; forward.ts rowRank 5 | forward-engine › "open scheduled tasks are notable, counted and ordered…"; today-engine (P1-3); e2e "nothing…lost" (scheduled task link) | PASS | — |
| D-11 | §27 marks: Sun ● only for conflicts, ○ otherwise | worth-knowing.tsx, conflict-marks.tsx | Code; e2e checks `data-conflict`/`data-insight` | PASS (weak) | Class names not asserted; low value. |
| D-12 | §28 Coming up marks: same engine, same keys | person.ts, people/[id]/page.tsx | forward-screen › "Milo's page marks Milo's items only"; e2e Milo's page | PASS | — |
| D-13 | §32 coverage invariant | forward.ts:393–396; conflicts.ts:240–241 | forward-engine "the coverage invariant" (7 tests); conflicts "refuses an agenda that does not cover the window"; mutation "coverage check removed" (4 failed) | PASS | Note: `conflictsOver` (domain/insights/conflicts.ts:26–37) passes `coverage: window`, so the conflict engine's own check is satisfied by assertion, not by the agenda's real range. Every caller does load at least that window (Forward 90, Today 8, person 30, response 90), so nothing is wrong today; the guard is weaker than Forward's. Record, or pass the loaded range. |
| D-14 | §35 Season clipped month labelled by days | `unitsOf` | forward-engine › "a month the horizon ends inside is labelled by the days it covers…" | PASS | — |
| D-15 | §35 marks bounded in the fold (2, then 12 in full, then sentences, exact count) | conflict-marks.tsx, folds.ts | `unit/insights/conflict-marks.test.tsx` (190 conflicts, 19 marks; Why count, 28 forms, the "come forward" line) | PASS | — |
| D-16 | §35 Worth knowing fold bounded (12 in full, then sentences) | worth-knowing.tsx | **None.** Mutation "fold unbounded" (`full={true}`) survived the unit suites here. | **NOT VERIFIED** | Add `tests/unit/insights/worth-knowing.test.tsx`: 20 insights → 2 shown; "+ 18 more"; `>Why<` count 14; forms 28; every insight's text present. |
| D-17 | §35 Month/Season keep a timed event's time | coming-up.tsx | e2e (ADR: 17:00, 06:30, moved 17:00 on Month in occurrence-changes/synced-events specs) | PASS (CI) | — |
| D-18 | §35 chronological Month/Season | `compareRow` | forward-engine › "Month and Season rows are chronological…"; mutation "month rows by kind" (2 failed) | PASS | — |

## 2. The 18 technical checks

| # | Check | Covered by | Genuine gap? |
|---|---|---|---|
| 1 | Forward Week / Month / Season | P1-4, D-4, D-14, E-1; e2e Week, Month, Season | **Partly.** Quiet, first-run and stale Forward screens are untested at render (E-1). Test: forward.spec, three scenarios as E-1. |
| 2 | 90-day horizon coverage (the invariant) | D-13 (7 engine tests, 1 conflict test, a killed mutation) | No for Forward. Minor: `conflictsOver` asserts coverage = window (D-13). |
| 3 | Usual vs notable | P1-5, P1-6, U-5; forward-engine "series outside the household's regular week…", "a usual occurrence in a current conflict is notable…"; mutations "conflicted usual stays usual", "household filter removed" killed | **Small:** fortnightly on Forward (P1-6). Test in forward-engine as P1-6. |
| 4 | No assumptions about unavailable information | U-12, U-13, P2-5, T16 | **Small:** Forward regex omits several §5.5 phrases; no rendered-page scan (U-13). |
| 5 | Deterministic conflicts | P2-3 (T19), D-2, conflicts mutations | No. |
| 6 | Standing and occurrence identities | T1–T15, T20; "an unchanged series occurrence paired with a one-off…"; "two windows" | No (T9's "old response matches nothing" implied, not asserted). |
| 7 | Changed, skipped, archived and restored events through real services (T3–T8, T14) | §1I, conflict-insights lifecycle (6 tests) | No. |
| 8 | Per-adult Dismiss and Not useful | P3-2, P3-3, I-1–I-6 | **Yes, one:** stale-key refusal (P3-4). Also Not useful on non-conflict families untested (R-3). |
| 9 | Today and Coming up integration | P3-1, E-3, E-4, D-12 | Small: Today window ±1 (P3-1). |
| 10 | Cross-surface response consistency | I-6 (Forward ↔ Today ↔ Milo's page, both directions for one adult) | Small: "same key, **wording and facts**" (criterion 6) is asserted only for keys. Test in forward-screen: for `key.art`, Today's `readInsights` item, Month's `worth` item and Milo's `personInsights` item have equal `text` and `facts`. |
| 11 | Actor-aware privacy and non-interference (§8.2) | §1F | **Yes, one:** rendered pages (PR-8). |
| 12 | Real-data gate and audited writes | I-2, I-4; `real-data-gate.test.ts`; §5(c) | No. |
| 13 | Timezone and DST | Forward units: DST start with a series (Week), DST end with no items (Month); UTC/London/New York zone days. Standing window: NZ April 2027 change (key kept), London zone change (two keys). Overnight: forward-engine overnight test and conflicts overnight test, both in October (no DST). Agenda-level overnight across DST is M5's (`agenda-placement.test.ts`). | **Yes, small:** (a) Forward DST end with items (P1-4); (b) a standing key across the September 2026 change; (c) an occurrence-level overlap on the DST night (e.g. 27 Sep 2026 01:30–03:30 NZ against 01:45–02:15 wall clock) asserting its UTC key and `when`; (d) the "DST-change night" second standing key the ADR §33 describes (`w0130-0230`) has no test. All in conflicts-engine / forward-engine. |
| 14 | Accessibility and no-JS | P4-1, P4-3, E-6 | **Yes:** no-JS only Week at phone; no text-equivalent assertion; no section/heading order check on Forward. |
| 15 | Responsive layouts (four viewports) | device tests (axe, scroll, 44px, screenshots) | **Yes, small:** the two-column layout at ≥768px and criterion 13's "switch, headline and Worth knowing above the fold at phone width" are not asserted (M5 asserted the fold for Today). Test in forward.spec: at 375×812 the nav, headline and first Worth knowing row have `boundingBox().y + height < 812` on Month (which has Worth knowing); at 768 and 1280 `section[aria-labelledby=forward-coming]` is to the right of the header. |
| 16 | Bounded presentation and exact counts | P1-7; forward-insights large data; conflict-insights 435; conflict-marks 190 | **Yes:** Worth knowing's fold past twelve (D-16). |
| 17 | Performance and query behaviour | Query counts: P1-2 (CI). Engine time, re-run here: agenda 172 ms + three horizons 58 ms (300 events); conflicts 300 events 24–29 ms, 1,200 events 138–181 ms; Today 8 days 5.5 ms. | **Yes:** **render time over 90 days is not measured** (contract §3.7 assigns it to Package 5; criterion 9). ADR §35's "375 overlaps: agenda ~80 ms, engine ~12 ms" has no test behind it (developer report). Test: a forward.spec "render time" case mirroring today-screen.spec's: median of 5 warm loads of `/forward?h=season` for the scenario and with 300 extra events, logged. |
| 18 | M1–M5 regression safety | CI: PR #67 full regression 218 passed; main `29339b9` 207 passed; unit 1,554 here; integration job green on `6ede099` | No, provided `6ede099`'s e2e (in progress) finishes green and the full `pnpm verify` is run for Package 5 (contract §2.3). |

## 3. Stage 4: caveat classification

| Caveat | Class | Deciding clause | Note |
|---|---|---|---|
| Season shows the earliest three per month, not "significant milestones" | **C** | Contract §5.3 caps (Season 3 per month) and "by kind and time, never by importance"; Month/Season chronological (§5.3 refinement, ADR §35) | Choosing "significant" items would be ranking by importance, which §5.3 forbids. |
| Usual commitments only under The usual on Forward | **C** | §5.2, §5.3 ("The usual stays the usual… a row is not filled with every series occurrence"), ADR §15 ("Rows show notable items only"); §2.2 P4 reachability satisfied via The usual (P4-2) | Related: contract §4.2's Month example draws Swimming in every week of a standing conflict, but the engine marks only the next pair as conflicted, so later repeats are usual and not drawn. The approved §5.3 refinement governs; record it. |
| "Camp today." for a multi-day carry-over in the listed headline | **C** (owner's call; B if the owner objects to it on the screenshots) | §5.5 templates are indicative; ADR §16 "final copy is approved by the owner from screenshots"; nothing in §5.5's forbidden list is breached | True as stated (it is on today) but reads as starting today. A one-line wording change ("Camp, until Friday.") would be small. |
| Scheduled tasks before timed items on Week | **C** | §5.3 Week order: "6. scheduled tasks; 7. timed items by start" | The code follows the contract exactly; changing it needs a contract and ADR amendment. |
| Later repeats of a standing conflict unmarked on Coming up | **C** | §5.7.1 "Said: once, at its next occurrence in the window"; ADR §13 | — |
| Dense conflict disclosures (two in full, twelve more in full, then sentences) | **C** | ADR §35 approved correction (owner) | Criterion 3 ("every … mark … shows them in place") is not met to the letter past 14 marks on one entry. Record it in M6-ACCEPTANCE as an approved deviation; tested (D-15). |
| Worth knowing's fold beyond twelve without actions | **B** | ADR §35 approves the behaviour (C), but §2.2 Package 5 requires "evidence that cites tests" and none exists (D-16; mutation survived) | Add the render test in D-16. Same criterion 3 note. |

### Other findings (not in the caveat list)

| # | Finding | Class | Clause |
|---|---|---|---|
| R-1 | Stale or no-longer-current key refusal untested | **B** | §2.2 P3, §8.3 |
| R-2 | Forward quiet, first-run and stale screens untested at render; failed calendar asserted only as "no alarm" (`synced-events.spec.ts`), never that the qualifier and the `data_health` row appear | **B** | §7 scenarios; criterion 10 ("A failing or stale calendar is said, not hidden") |
| R-3 | Not useful on a non-conflict insight (birthday, calendar) untested at render and through `respondToInsight` | **B** | §4.5 "Not useful in every Why"; §8.3 |
| R-4 | Render time for Forward not measured | **B** (Package 5's own deliverable) | §3.7 "Measured in Package 5"; criterion 9 |
| R-5 | Rendered-page identity under the privacy invariant not tested | **B** | §8.2 |
| R-6 | No-JS only Week at phone; above-the-fold and two-column layout not asserted | **B** | §8.4; criteria 8, 13 |
| R-7 | Standing and responsible Why text not render-tested | **B** | Criterion 3; ADR §14 |
| R-8 | `conflictsOver` asserts coverage = window | **C** (record) | ADR §32/§33 |
| R-9 | "+ N" row fold label has no context for a screen reader | **C** (ADR §35 caveat) or B if cheap (an `aria-label` such as "3 more on Thursday 15") | Criterion 8 |
| R-10 | §3.5 says "every count or absence on Forward is qualified"; only the headline carries the qualifier | **C** | §4.1 item 2 and the §4.2 stale example show one qualifier under the headline; record the reading |
| R-11 | Weak Forward shuffle; Forward forbidden regex incomplete; T9 response not asserted; Today window ±1; DST items in check 13 | **B** (small test additions) | §8.1 |

No **A** (blocker) found: no contract clause is breached by the code I read. Every gap is missing or weak evidence, or an approved and recorded deviation.

## 4. Stage 5: read-only code checks

| | Check | Finding |
|---|---|---|
| (a) | No code path reads `not_useful` except export and respondToInsight's eligibility/idempotence | **Holds.** `grep not_useful` in `src`: only the form action (`src/app/_insights/actions.ts:21,43`), the button (`responses.tsx:43–45`) and the enum (`src/db/schema/insight-response.ts:10`). The response *kind* is read back only by `respondedKeys` (`src/domain/insights/service.ts:62–67`), whose kind is compared at `src/domain/insights/today.ts:173–174` (idempotence), and by `listOwnResponses` for export (`src/domain/export/service.ts:116`, `spec.ts:219`). `insightsFor` uses only the keys (`today.ts:95–99`). `withResponses`/`readConflicts` expose the kind map (`src/domain/insights/conflicts.ts:47, 51–63, 93–102`) but **no production code calls them** (tests only). There is no `src/kev`. Activity shows only the label "An insight answered" (`settings/activity/labels.ts:54`). |
| (b) | Audit meta for `insight_response.respond` is `{response}` only | **Holds.** `src/domain/insights/service.ts:41–46`: `meta: { response: row.response }`, subject the response row, record `{ visibility: 'private', createdBy }`. Integration asserts the exact JSON (forward-screen, conflict-insights). |
| (c) | `assertFamilyWritesOpen` precedes any read; gate = `VERCEL_ENV=production` requires `HOME_REAL_DATA=open` | **Holds.** `src/domain/insights/today.ts:161` (gate), `:162` (actor), `:163–165` (schemas), first read `:166`. `src/domain/common/guards.ts:11–13` → `src/lib/env.ts:217–222` (`VERCEL_ENV !== 'production'` → open; else exactly `'open'`). Tested with a query counter. Note: `respond` itself (service.ts:19–26) does not call the gate; its only caller in `src` is `respondToInsight`. |
| (d) | No external write to any calendar | **Holds.** `src/integrations` is unchanged since `274dad6` (no diff). Its only network path is `src/integrations/net/safe-fetch.ts` with `method: 'GET'` (`:183`, "GET only", `:11`). No PUT/POST/DELETE/PATCH in `src/integrations`. |
| (e) | No real family data; `pnpm check:private-terms` | `scripts/check-private-terms.mts` scans every tracked file (except the lockfile and images) for the comma-separated terms in the `HOME_PRIVATE_TERMS` secret, case-insensitively, reporting only file and term index; when the secret is unset it emits a `::warning` and exits 0 (it cannot check). In CI on `6ede099` the step succeeded **and no such warning annotation appears** on the job, so the secret was set and the scan was clean (inference from annotations; the log itself is not reachable). It cannot be run meaningfully here (no secret). Spec fixtures use synthetic names (`fw `, `tc ` titles; Milo, Sam, Alex, Isla, Nana Jo). |
| (f) | No new migration since 0007; no new runtime dependency across M6 | **Holds.** `git diff b870924 HEAD -- package.json pnpm-lock.yaml src/db/migrations src/db/schema` is empty; so is `git diff 274dad6 HEAD -- src/db package.json pnpm-lock.yaml src/integrations src/trust`. Journal ends at `0007_calendar_schema`. `vercel.json` has no crons. |

## 5. Mutation sample (run here, out of repo, unit suites)

Killed (tests failed): touching ends (2), responsible precedence (11), date in standing key (17), same-event exclusion (1), work-pair (1), routine (1), visibility filter (1), person out of key (25), change as standing (17), overlap-start tie-break (3), cap+1 (8), "+N"+1 (8), day band 3 at 6 (1), period band 3 at 11 (1), conflicted usual stays usual (2), Month rows by kind (2), coverage check removed (4), headline overlaps not range-limited (1), household filter removed (1), weeks end Monday (4), listed ignored (14), conflict window ignored (1), marks ignore responses (2), "+N more" counts on-object (20), today conflict marked and listed (7).

Survived: Worth knowing fold unbounded (`full={true}`): **no test** (D-16). (`FOLDED_FULL` 12→13 also survived, but the tests use the constant symbolically; not a defect.)

## 6. Overall judgement

The technical criteria hold in substance. The engines are pure and determinism, identity, the coverage invariant, the per-surface listing and the privacy invariant at data level are proven by tests I read and partly re-ran. 25 of 26 mutations I tried were killed. Every P3 lifecycle case runs through the real event services. Responses are per adult, audited with the kind only, idempotent and gated before any query. No migration, runtime dependency or external write was added. I found no blocker. Package 5 cannot yet claim "every criterion met, with evidence that cites tests" for all of §10. These are the honest NOT VERIFIED rows: the stale-key refusal (P3-4, I-5); rendered-page identity under §8.2 (PR-8); Worth knowing's bounded fold (D-16); Forward's render time (check 17, a Package 5 deliverable); the quiet, first-run and stale Forward screens (E-1, D-5; criterion 10); the text equivalents of the load indicators (D-9); the owner's screenshot approval (P4-5, criterion 13); and criterion 14's review history, which rests on the PR record. The weak rows to tighten are the no-JS and layout coverage, the standing and responsible Why text, fortnightly-is-usual on Forward, the Forward shuffle, the forbidden-phrase list and rendered scan, and the DST cases in check 13. Each is a small, targeted test (class B), not a code change.
