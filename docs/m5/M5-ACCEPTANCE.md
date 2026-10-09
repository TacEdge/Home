# M5 — Intelligent Today: acceptance check

Checked against `M5-BUILD-CONTRACT.md` §10 on 2026-10-09 (Package 5), on `main` at the Package 4 merge (b056c61) plus this package. Each criterion was checked against the code and the tests that run in CI, reusing the evidence of Packages 0–4 where it already holds and adding tests only where it was missing. Synthetic data only: the fixture family, seeded scenarios on a fixed synthetic day (Thursday 11 February 2027) and synthetic calendar feeds. No real calendar, address or family data was used anywhere.

**Verdict: M5 is technically accepted on synthetic data. It is not operationally accepted.** Every technical criterion is met (§1), no Blocker or Important finding is open (§9), and the whole suite is green locally and in CI. Criterion 8 (household usefulness) rests on the owner's review of the screenshots (§3); no automated test proves it. Operational acceptance on the family's real records needs DEPLOY.md §E items 16–17, which wait on the gate (item 11), the first real calendar (item 14) and, before them, M1's items 1–6 and M3's restore rehearsal (items 7–8). `HOME_REAL_DATA` stays closed.

## 1. Criteria (contract §10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | **Correctness**: person lines, *Also today*, To do, evening, headline and detectors follow §5 on the scenarios and every §8.1 boundary | Met | `tests/unit/today/today-engine.test.ts` (41: every headline rule, routine, person lines and their selection, Also today, To do order, evening and its review fixes A–H, overnight, DST, determinism, quiet/first-run/stale); `insights-engine.test.ts` (18: every detector at its boundaries, ranking, "+ N more", dismissals, keys, the failure episode); `today-screen.spec.ts` (ordinary, full, quiet, first run, stale, evening with and without an all-day event, overnight, changed occurrence, multi-day, Also today). |
| 2 | **No regression**: every item M3/M4 Today showed still appears; Forward, *Coming up*, the regular week unchanged except overnight | Met | `today-screen.spec.ts` "nothing is lost" (every event, every due task, the to-sort line); `today.spec.ts` (the M3 Today checks on the real date, kept); `synced-events.spec.ts`, `events.spec.ts`, `regular-week.spec.ts`, `occurrence-changes.spec.ts` and the Forward suites, all green; the overnight change is Package 1's (ADR 0008 §30). |
| 3 | **Privacy**: nothing reflects what the reader cannot see; dismissals are per user | Met | §4 below. |
| 4 | **Determinism**: pure engines; same input and `now`, same output in any input order | Met | `today-engine.test.ts` and `insights-engine.test.ts` (shuffled input, repeated runs, frozen `now`, equal-time ties); `explainability.test.ts` (no clock, randomness, database, `app`, `kev`, `trust`, `integrations` import in the engines); `today-view.test.tsx` (the view reads no clock and imports no service). |
| 5 | **Traceability and explainability**: rule id and source records on every headline, line and insight; facts in place without JavaScript | Met | `explainability.test.ts` (every rule documented in the contract; every statement has facts; exact person-line templates); `today-view.test.tsx` (Why and the headline's facts render from the records); `today-screen.spec.ts` (the headline's facts and each insight's Why open without JavaScript; explanations resolve only the reader's records, §4). |
| 6 | **No inference, no absence-as-meaning** | Met | `explainability.test.ts` (forbidden phrases across every sentence of a week, with titles and names exempt); `today-view.test.tsx` and `today-screen.spec.ts` (no need, lift, driving, free, busy, urgent, overdue or "should" anywhere on the screen; an unattended child's item shows only who is recorded). No transport or `coordination_gap` exists (ADR 0008 §21). |
| 7 | **Healthy quiet**: a quiet day is one line; no insight without a rule; ≤ 3 insights; "+ N more" genuine | Met | `today-screen.spec.ts` (quiet: the headline and its record of looking, no sections; Worth knowing three and "+ 1 more"; a dismissed insight is neither shown nor counted); `insights-engine.test.ts` (on-object and dismissed insights never counted). |
| 8 | **Household usefulness**: headline, Worth knowing and Everyone's day above the fold on a phone; the owner confirms five-second comprehension | Met for the measurable part; **owner's call** for the rest | `today-screen.spec.ts` "acceptance screens" asserts the headline and the start of Everyone's day are on the first phone screen in the morning, midday, late-afternoon, full and stale scenes; §3 below is the screenshot assessment for the owner. |
| 9 | **Accessibility**: axe clean at four viewports; keyboard; 44px; no colour-only meaning | Met | §5 below. |
| 10 | **Performance**: loader query count independent of event count; no LLM or network on render; render time measured | Met | §6 below. |
| 11 | **Scope**: no transport, conflicts, weather, free windows, availability, Kev, proposals, sheets, stored insights, notifications, jobs, schema or runtime dependency | Met | M5 added no migration (the journal still ends at `0007`), no runtime dependency (`package.json` unchanged across #53–#57 and this package), no Kev or LLM call, no stored insight (only the existing `insight_response`), no background job and no external request. |
| 12 | **Production gate and operations** | Met | Dismiss refused while the gate is closed, before any read (`worth-knowing.test.ts`); every family-domain write refused (`privacy.test.ts`); the test time source refused in production and on Vercel (`env.test.ts`); M1, M3 and M4 items open and unchanged (§7). |
| 13 | **Handover**: each package reviewed at its intensity; every Blocker and Important fixed before merge | Met, pending the owner | §8 below. Acceptance itself is the owner's. |

## 2. Functional results (the integrated experience)

| Area | Behaviour | Evidence |
|---|---|---|
| Headline | Closed set of factual sentences with rule ids; the late-evening second sentence; the qualifier "As far as HOME knows." on its own line | engine and view tests; `today-screen.spec.ts` |
| Everyone's day | The engine's people and order; two lines on the surface, the earliest still to come first, the rest under "+ N more"; routine as a word; others recorded shown on one-offs; names level with their first line | `today-engine.test.ts` (selection at morning, mid-afternoon, 17:00, evening, overnight, all-day, ties); `today-screen.spec.ts` (17:00 regression, alignment at four viewports) |
| Also today | Items with no household person, in the agenda's rows, once | `today-screen.spec.ts` |
| To do | Three, in the engine's order, dates in words; "N more to do ›" to the full list | engine and e2e tests |
| To sort | The reader's own waiting captures, in words | `today-screen.spec.ts`, `capture-sort.spec.ts` |
| Worth knowing | Up to three; Why; Dismiss; "+ N more"; the approved families only | `today-screen.spec.ts`, `worth-knowing.test.ts` |
| Dismiss | Per adult, idempotent, refused for keys the reader cannot see, gated | `worth-knowing.test.ts` (15) |
| Evening | All day today (all-day events and, from this package, birthdays), Tomorrow morning, Before then, To do, To sort, Earlier today folded | `today-view.test.tsx`, `today-screen.spec.ts` |
| Quiet and first run | "Nothing on today." with the calendars looked at; first run points at Connect a calendar and, from this package, still shows Worth knowing | `today-view.test.tsx`, `today-screen.spec.ts` |
| Stale and failed calendars | The headline qualified; Worth knowing says which and how, once; a failure's dismissal lasts one failure episode | `today-screen.spec.ts`, `insights-engine.test.ts`, `worth-knowing.test.ts` |
| Overnight, recurring, changed | Carried-over items on both days, never called finished while running; a changed occurrence at its new time; a multi-day item by its day | `today-engine.test.ts` (A–H), `today-screen.spec.ts` |

### Corrections made in this package

- **First-run insights** (Package 4 carry-forward). First run hid Worth knowing altogether, so a household with birthdays or a project recorded before any calendar lost those insights. Worth knowing now shows on first run as on any day, and is absent when empty. A calendar insight cannot occur there (there is no calendar). `today-view.test.tsx` (shown with a birthday next week; absent when there is nothing); a mutation restoring the old rule fails it.
- **Evening birthdays** (Package 3 carry-forward). In the evening a household person's birthday was folded into Earlier today with the finished events. Birthdays now stay in view under "All day today" with all-day events: they are the day's, not a time's. The engine is unchanged; the headline still speaks only of timed events. `today-view.test.tsx`; a mutation restoring the old fold fails it.
- **The failure episode across disconnect and reconnect** (Package 4 review). Now proved through the real calendar services and a synthetic provider (`worth-knowing.test.ts`, "a failure episode across disconnect and reconnect"): a failure is one key; Sam's dismissal holds through another failure; disconnecting removes the insight for both; reconnecting (no success since) is the same episode and key, Sam's dismissal intact and Alex's own possible; a success ends it; the next failure is a new key for both.

## 3. Five-second comprehension (screenshot review, not a test result)

Screenshots for the owner, from `today-screen.spec.ts` "acceptance screens" (`test-results/screenshots/today-acceptance-*`, never committed): morning 07:03, midday 12:30, late afternoon 17:00, evening 21:40, quiet, full, stale and first run, each at phone, tablet and desktop. What follows is my reading of them; it is evidence for the owner's judgement, not a substitute for it, and no automated test proves household usefulness.

- **What is on.** The headline answers it in one line ("Four things on today, besides the usual."); the second sentence names who is out after 6. On a phone the headline and the start of Everyone's day are on the first screen in every weekday scene (asserted).
- **What is next.** From late afternoon, each card leads with what is still to come (17:00: Alex's 15:30 Swimming and 18:15 Pilates, the finished morning under "+ 1 more"). Times are in every line, so "next" is readable without a time-of-day label.
- **Who.** One line per person, name level with their first item; others recorded shown beside one-offs only; routine as a quiet word.
- **Worth knowing.** Two or three calm sentences under the headline, each with Why and Dismiss; absent when there is nothing. It does not crowd Everyone's day on a phone, and sits in the left column on a tablet.
- **Tasks and captures.** To do, "N more to do ›" and "N things to sort ›" are in a fixed place below the day.
- **Reading order.** Date, headline, Worth knowing, Everyone's day, Also today, To do, To sort, Forward on every viewport (tested by heading order and focus order).
- **Evening.** "Today's timed events have finished." when something is all-day, then All day today, Tomorrow morning and Before then; the day folded under Earlier today.
- **Observations, not defects.** A full day's cards are tall on a tablet (each line keeps its 44px target). The development server's issue badge appears in some captures: the long-standing dev-only hydration warning (M4-ACCEPTANCE §6), likely set off by the screenshot tool hiding the caret; it does not exist in production builds. No redesign is proposed.

## 4. Privacy and explainability

Reused, still green: the Package 2 non-interference invariant through the real services (`today-engines.test.ts`: the other adult's private records change nothing in a reader's model or insights at 07:03 and 22:00); the M3 two-adult sweep over every route, Today included (`m3-privacy-sweep.spec.ts`); the gate over every write (`privacy.test.ts`).

M5's own, `worth-knowing.test.ts` (15, through the real services as `home_app`) and `today-screen.spec.ts`:

- Each adult sees the household's insights and their own private one, never the other's: not by key, text, facts, basis or count; a household project's task count counts only the reader's visible tasks.
- Sam's page text is byte-identical before and after Alex adds private records on the same day.
- Explanations resolve only the reader's own records; links point only at what the reader can open.
- Dismissals are per adult, read back by `user_id` only; household insights are dismissed independently by each adult, including a calendar's failure episode.
- A crafted dismissal (the other adult's private insight, a made-up or malformed key, one already said on its item) is refused and writes nothing; the closed gate refuses before any query.
- Activity shows an insight response to its owner only; the audit row carries the response kind, never the key or any words.
- No transport inference or unsupported claim (criterion 6); every statement keeps its rule id and facts (criterion 5).

## 5. Accessibility and devices

From `today-screen.spec.ts` and the kept M3 device sweep (`m3-device-sweep.spec.ts`, which includes Today):

- **Axe**: no serious or critical violation at phone, tablet portrait and landscape, and desktop, for the ordinary, quiet, evening, first-run and Worth knowing scenes, with every disclosure closed and open.
- **No horizontal scroll** at the four viewports and at 320px; the longest headline wraps inside 320px.
- **44px targets** and **visible focus** on every control in reading order (keyboard walk); disclosures open by keyboard.
- **No-JS**: the headline's facts, Why, "+ N more", Dismiss and every link work without JavaScript.
- **Refusal focus**: a refused dismissal shows a calm message in place and moves focus to it.
- **Capture bar** never covers the last control. **Reduced motion**: Today adds no animation; the global reduced-motion rule applies.
- **The shared header at 320px** (measured): the wordmark and the Today/Forward switch touch (0px apart) without overlapping, and nothing scrolls sideways. A shell matter, carried to the shell backlog; not an M5 defect.

## 6. Performance

Measured on this container (one local Postgres, one Playwright worker, the dev server for page timings). Observations, not a controlled benchmark.

| Measure | Result | Evidence |
|---|---|---|
| Today's data load | **8 queries**, the same with 1 event or 31, more tasks, projects and captures (it was 13 before Package 3) | `today-data.test.ts` |
| The agenda read | 7 queries batched for 8 or 38 events (per-event reads would be 20 → 80) | `agenda-inputs.test.ts` |
| Worth knowing | **1 query** (the reader's responses), none when there are no insights | `worth-knowing.test.ts` |
| Engines (today + insights, agenda included) | **75 ms** per run over 300 events in a week | `explainability.test.ts` |
| Today page render, dev server, median of 5 warm loads | **422 ms** ordinary day; **998 ms** with 300 extra events across the week | `today-screen.spec.ts` "render time" |

Recurrence is expanded once per request by the agenda engine; Today and the insights engine read its output. No LLM, no network on render (refresh-on-use runs after render, as in M4). The development-server timings include its overhead and are an upper bound for a production build.

## 7. Operational readiness

| | Status |
|---|---|
| **A. Technical acceptance on synthetic data** | **Complete** (this document). |
| **B. Operational acceptance with real family use** | **Not started, by design.** M5 adds no Production setting, key or migration; it deploys like any merged code with the gate closed. Its real-use checks are DEPLOY.md §E items 16–17, after the gate (item 11) and the first real calendar (item 14), which in turn need M1's items 1–6, M3's restore rehearsal (items 7–8), the export check and logging review (items 9–10), and M4's keys and Preview calendar (items 12–13). None is recorded as passed. |

Nothing in this package touched Production: no gate change, no calendar connected, no credential or key set, no migration run.

## 8. Reviews and defects fixed

Each package had a focused independent review at its stated intensity; every Blocker and Important finding was fixed before its merge.

| Package | PR | Review | Fixed before merge |
|---|---|---|---|
| 0 Contract and ADR | #53 | Owner approval | Refinements to §20–§26 as directed |
| 1 Agenda groundwork | #54 | High | Review findings (ADR 0008 §30) |
| 2 Engines | #55 | High (B) | I-1 evening triggered by a carry-over; all-day evening wording; carried-over counts (§31) |
| 3 Today screen | #56 | Medium (B) | Upcoming items hidden behind finished ones; name alignment (§32) |
| 4 Worth knowing and Dismiss | #57 | High (B, then A) | A failed calendar's dismissal returned daily: now one failure episode (§33) |
| 5 Acceptance | this PR | Milestone | First-run insights; evening birthdays; reconnect proof (above) |

## 9. Remaining findings and carry-forwards

- **Blocker:** none. **Important:** none.
- **Minor, not blocking:**
  - A dismissal submitted from a page loaded before midnight may be refused if the insight's key has changed overnight ("That can't be done with this one."); reloading shows the current insights.
  - Dismiss is offered in Production while the gate is closed and then refused with "HOME isn't open for family data yet.", as every write is.
  - The shared header at 320px: wordmark and switch touch (shell backlog).
  - A full day's person cards are tall on a tablet; time-of-day words on cards and fading past items remain deferred (§32).
  - The dev-only hydration warning (M4-ACCEPTANCE §6) still shows as a badge in development screenshots.
  - In this package's full `pnpm verify`, one integration test this package does not touch (`proposals.test.ts`, "privacy of the log", which scans the whole audit log) hit vitest's 5-second timeout once. It passed alone (3.4s) and in a full rerun of the integration suite (722 of 722). It is reported here, not treated as fixed; watch for it in CI.
- **Kept from earlier milestones:** parallel browser workers need per-worker databases (M4-ACCEPTANCE §9); `check-export.mts` needs Node 22.18 or later.

## 10. Owner actions

In DEPLOY.md §E order, recording each with its date and evidence there (counts and yes/no only):

1. **M1 acceptance**, items 1–6.
2. **M3's restore rehearsal**, items 7–8; then accept M3.
3. **The export check and logging review**, items 9–10; **M4's keys and Preview test calendar**, items 12–13.
4. **Open the gate** (item 11): `HOME_REAL_DATA=open` in Production only.
5. **The first real calendar and its logging review**, items 14–15; then accept M4.
6. **Today on a real day** and **the five-second check**, items 16–17; then accept M5.
7. Meanwhile, review this package's screenshots (§3) and confirm criterion 8 for the synthetic scenes.

## 11. Acceptance status

- **Technical acceptance (synthetic data): complete.** Criteria 1–12 are met; 8 rests on the owner's screenshot review for its subjective part; 13 is met pending the owner.
- **Operational acceptance (real family use): outstanding.** It waits on DEPLOY.md §E items 1–17, all owner steps.
- **M5 is therefore not fully accepted.** Do not start M6 before the owner says so.
