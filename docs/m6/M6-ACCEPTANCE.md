# M6 — Forward Coordination: acceptance check

Checked against `M6-BUILD-CONTRACT.md` §2.2, §8 and §10 on 2026-10-11 (Package 5), on `main` at the Package 4 merge (6ede099; PRs #59, #60, #65, #66, #67). Each requirement was checked against the code and the tests that run in CI, reading the assertions rather than the test titles and reusing the evidence of Packages 1–4 where it holds. This package changes no product code. Synthetic data only: the fixture family, seeded scenarios on fixed synthetic days and synthetic calendar feeds. No real calendar, address or family data was used anywhere, and `HOME_REAL_DATA` stays closed.

**Verdict: B — accept M6 once a small set of evidence gaps is closed. No contract clause is breached by the code; no blocker was found.** The engines are pure and deterministic, conflict identity and its lifecycle hold through the real services, responses are one adult's and audited with the kind only, the privacy invariant holds byte for byte at the data level, no migration, dependency or external write was added, and the full browser regression is green. What stops an unqualified A is the contract's own standard for this package, "every criterion met, with evidence that cites tests" (§2.2): eight requirements rest on code reading or a developer report rather than a test (§8 below), and two rest on the owner (screenshot approval, criterion 13; the review record, criterion 14). Every gap is a targeted test or an owner decision, not a code change. Operational acceptance on the family's real records needs DEPLOY.md §E items 18–19, which wait on the gate (item 11), the first real calendar (item 14) and Today's items (16–17).

The full evidence matrix (about 110 rows, each with its implementation, the test and its assertion, a result and the remaining action) is `M6-ACCEPTANCE-MATRIX.md`, the assessor's working file; this document summarises it and adds the walkthrough, the measurements and the decision.

## 1. Contract coverage matrix (summary; the full matrix is `M6-ACCEPTANCE-MATRIX.md`)

Result key: **Met** = an assertion in a test that runs in CI proves it; **Met (weak)** = a test exists but asserts less than the requirement, named; **Not verified** = only code reading, a document or a developer report supports it; **Owner** = the owner's judgement.

| Area (contract) | Rows | Met | Met (weak) | Not verified | Owner |
|---|---|---|---|---|---|
| Package 1 acceptance (§2.2) | 9 | 7 | 2 (DST end with no items; fortnightly only indirect) | 0 | 0 |
| Package 2 acceptance (§2.2) | 6 | 6 | 0 (DST: only April for a standing key) | 0 | 0 |
| Package 3 acceptance (§2.2) | 6 | 5 | 0 | 1 (a stale key refused) | 0 |
| Package 4 acceptance (§2.2) | 5 | 1 | 3 (no-JS Week only; text equivalents; sweep's Month/Season) | 0 | 1 (screenshots) |
| Unit requirements (§8.1) | 14 | 8 | 6 (DST end, fortnightly, series people on a change, Forward shuffle, fact resolution, Forward forbidden list) | 0 | 0 |
| Privacy invariant (§8.2) | 9 | 7 | 1 (Today's model with marks, by construction) | 1 (rendered pages) | 0 |
| Integration (§8.3) | 8 | 7 | 0 | 1 (stale key) | 0 |
| End to end (§8.4) | 6 | 2 | 4 (quiet/first-run/stale Forward scenes; sweep; accessibility text) | 0 | 0 |
| Identity and lifecycle T1–T20 (§5.7.4) | 20 | 19 | 1 (T9's "old response matches nothing" implied) | 0 | 0 |
| ADR decisions with testable behaviour | 18 | 13 | 2 (Why text at render; mark glyphs) | 3 (first run and qualifier at render; load text equivalents; Worth knowing's fold) | 0 |

The §10.1 criteria, by the same reading:

| # | Criterion | Status | Where the evidence is (matrix rows) |
|---|---|---|---|
| 1 | Correctness: units, notable/usual, rows, caps, bands, headline, conflicts, per-surface insights on every scenario and §8.1 boundary | Met (weak) | P1-4…P1-8, P2-1, U-1…U-6, D-4, D-7; DST and fortnightly rows weak |
| 2 | Determinism and identity | Met | P2-3 (T19), U-10, T1–T20, D-13; 25 of 26 sampled mutations killed |
| 3 | Explainability: rule and records on every headline, indicator, mark and insight, in place without JavaScript; a conflict's Why names both occurrences, times, person, overlap | Met (weak), with an approved deviation | U-11, D-3 (standing and responsible Why text not render-tested); past the first fourteen marks on one entry, and past twelve folded insights, an entry is its sentence only (ADR §35, approved) |
| 4 | Privacy: nothing for one adult reflects the other's private records; responses per user | Met at data level; **not verified at render** | PR-1…PR-9; PR-8 (rendered pages) is the gap |
| 5 | No unsupported inference | Met (weak) | U-12, U-13, P2-5, T16; Forward's regex omits some §5.5 phrases and no rendered-page scan |
| 6 | Cross-screen consistency: same key, wording and facts on Today, Forward and Coming up; a response on one hides it on all | Met for keys and responses; wording and facts asserted only via keys | I-6, D-12 |
| 7 | Healthy quiet: a unit with nothing says so; no insight without a rule; Forward lists two, Today three; "+ N more" genuine; a recurring overlap said once | Met | D-7, T1, T3, forward-engine load text; quiet Forward scene not render-tested (E-1) |
| 8 | Accessibility: axe at four viewports, keyboard, 44px, text equivalents, no colour alone | Met (weak) | P4-3, E-6; load-band text equivalent and "+ N" label context not asserted |
| 9 | Performance: query count independent of records; no LLM or network; render and engine time over 90 days measured | Met; **render time measured in this package (§6)** | P1-2, check 17 |
| 10 | Reliability: works with Kev absent and no calendars; a failing or stale calendar is said; `now` injected | Met in the engine; **stale and first-run Forward not render-tested** | D-5, E-1, R-2 |
| 11 | Scope | Met | §5 below; code check (f) |
| 12 | Production gate | Met | I-4, code check (c); DEPLOY §E unchanged except items 18–19 |
| 13 | Family usefulness: switch, headline and Worth knowing above the fold at phone width; the owner confirms from screenshots | **Owner's call**; the fold not asserted by a test | §3 below; R-6 |
| 14 | Handover: each package reviewed at its intensity; Blockers and Importants fixed before merge | Met on the PR record | §8 of this document; PRs #60, #65, #66, #67 |

## 2. Technical acceptance results (the owner's eighteen checks)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Forward Week, Month and Season | Met | Engine units, caps, order and the three horizons' e2e; the quiet, first-run and stale Forward scenes are tested in the engine only (gap R-2) |
| 2 | 90-day horizon coverage | Met | The coverage invariant (7 engine tests, 1 conflict test, a killed mutation). `conflictsOver` passes `coverage: window`, so the conflict engine's own check is satisfied by assertion; every caller loads at least that window (recorded, R-8) |
| 3 | Usual versus notable | Met | A changed occurrence is notable; a conflicted usual occurrence is notable; fortnightly is usual only via the regular-week tests (small gap) |
| 4 | No assumptions about unavailable information | Met | Absence rule and forbidden phrases in the engines; Forward's list is shorter than §5.5 and no rendered-page scan (small gap) |
| 5 | Deterministic conflicts | Met | T19 seeded shuffles, total order, mutations killed |
| 6 | Standing and occurrence identities | Met | T1–T15, T20; two windows, two conflicts; an unchanged occurrence beside a one-off |
| 7 | Changed, skipped, archived and restored | Met | T3–T8 and T14 through the real event services |
| 8 | Per-adult Dismiss and Not useful | Met, one gap | Per user, audited with the kind only, idempotent, gated before any query; **a stale key's refusal has no test** (R-1) |
| 9 | Today and Coming up integration | Met | Today's marks and listing; Milo's page marks Milo's items only; Today's window edge ±1 not tested (small) |
| 10 | Cross-surface response consistency | Met | A response from Forward is gone from Today and Milo's page and from every horizon, for that adult only; wording and facts compared only through keys (small) |
| 11 | Actor-aware privacy and non-interference | Met at data level | Byte-identical model, insights, marks and conflicts on every horizon; **rendered pages not compared** (R-5) |
| 12 | Real-data gate and audited writes | Met | Gate before any read; `{"response":…}` only in the audit; Activity shows the kind to its owner only |
| 13 | Timezone and DST | Met (weak) | Units across both NZ changes (the April case with no items); a standing key across April; a series in another zone giving two keys; no overlap on a DST night and no September standing-key case (R-11) |
| 14 | Accessibility and no-JS | Met (weak) | axe, 44px, keyboard on all horizons; no-JS on Week at phone only; the load bands' text equivalents in the code, not asserted |
| 15 | Responsive layouts | Met (weak) | Four viewports pass axe and horizontal-scroll checks; two columns and above-the-fold not asserted by a test (the screenshots in §3 show them) |
| 16 | Bounded presentation and exact counts | Met, one gap | Caps and "+ N" exact; 435 conflicts bounded; 190-conflict day bounded with 28 forms; **Worth knowing's fold past twelve has no test** (the one mutation that survived) |
| 17 | Performance and query behaviour | Met | Constant query counts in CI; engine time and render time measured in this package (§6) |
| 18 | M1–M5 regression safety | Met | The full suite, §7 |

## 3. Product walkthrough (screenshot review, not a test result)

Scenario: the fixture family on Wednesday 5 May 2027 (NZST), with synthetic records prefixed `ac `: tomorrow's Art club and Dentist overlap for Milo; a weekly Tutoring beside Milo's usual Swimming (a standing overlap); Alex responsible on an overlapping Working bee and Board meeting; a two-day Wellington trip; a garden day, a reunion sixty days out, a project target and a scheduled task; and a private pair of Sam's that overlaps. Default state (no fold opened) at phone, tablet-portrait and desktop, as Sam unless stated; 23 screenshots (§4). What follows is my reading of them, evidence for the owner's judgement rather than a substitute for it.

- **Can I see what is coming up?** Yes. Week opens on "Ten things in the next seven days, besides the usual." and "There are four overlaps.", then one row per day with times, titles and who is recorded; empty days say "Nothing recorded besides the usual" (Saturday, which has Football) or "Nothing recorded". Month reads "12 things in the next 30 days…" with weeks ("This week", "10–16 May", …, "31 May–3 Jun — Nothing recorded besides the usual"); Season reads "14 things in the next 90 days…" with months and a clipped "1–2 Aug — Nothing recorded". Folds ("+ 2", "+ 5", "+ 9") hold a fair amount on first view; the trip is folded on Week's Tomorrow (behind its conflicted pair) and visible as a row on Month and Season.
- **Can I understand our usual rhythm?** The usual › sits closed at the foot of every horizon and opens to each household person's regular week; on Milo's page it is "Usually". Discoverable, quiet, one tap away. A reader coordinating Saturday has to open it to see Football: an accepted design choice (§9).
- **Are meaningful commitments discoverable?** The project target is a visible row on Month ("Tue — Garden project — Project target date") and Season ("25 May"). Sam's birthday and the reunion are visible rows in June and July. The trip is visible on Month and Season, folded on Week's Tomorrow.
- **Can I recognise an actual recorded overlap?** Yes. On Week each conflicted row carries the mark "overlaps ac Dentist 15:30 · Milo" with "Why ›"; the headline counts them; Month and Season list them in Worth knowing ("Milo has ac Art club and ac Dentist at the same time tomorrow, 15:30–16:00."; "Alex is recorded as responsible for both…"). Why opens without JavaScript to "Milo is recorded on both of these, and their times overlap from 15:30 to 16:00." and both commitments with their dates, times and the person's role, then Dismiss and Not useful.
- **Can I dismiss something without losing it when the facts change?** Yes, by design and by test: a response is one adult's and one key's; a material change makes a new key that is eligible again (T4, T9, T13), and a return to the earlier state brings the earlier response back (T5, T6, T8, T14). In the walkthrough, Not useful on the Dentist pair removed both marks for Sam and lowered the count to three; Alex still saw them.
- **Is the language calm and factual?** Yes. "recorded on both", "overlap", "Nothing recorded", "As far as HOME knows."; no "clash", "busy", "free", "in two places" or any instruction. The one Sun accent is on the marks. One phrase reads oddly: the standing sentence's "…overlap regularly, 15:45–16:15; next today." (the contract's own template, §5.6).
- **Does HOME distinguish missing information from genuine absence?** Yes. With no calendar and no records, Forward reads "HOME doesn't know your calendars yet." with "Connect a calendar ›", and Today "HOME is quiet because it doesn't know your calendars yet."; with a calendar and nothing on, a unit reads "Nothing recorded (besides the usual)". On first run the day rows still read "Nothing recorded", which is true but sits a little awkwardly under that headline (§9).
- **Today.** Worth knowing lists three conflict insights above Everyone's day; on a phone Everyone's day starts within the first screen but only just. Today's own marks ("overlaps ac Tutoring 15:45") sit on Milo's line.
- **Milo's page.** Marks on today's and tomorrow's pairs; the later Wednesdays list Swimming and Tutoring with no mark, because a standing overlap is said once at its next pair (ADR 0009 §13). A parent may wonder why 12 May is unmarked (§9).
- **Privacy.** As Alex, "ac Sam private" appears nowhere in the text or HTML of Week, Month or Sam's page; Alex's count is three overlaps to Sam's four.
- **Layout.** Phone is one column; from tablet-portrait Coming up takes the right column and the headline, Worth knowing, The usual and Today › the left. The capture bar floating mid-page in full-page captures is a screenshot artefact of a fixed element.
- **Console.** No page errors; only the development server's CSP notices about its own overlay (dev-only, as in M4 and M5).

## 4. Screenshots and evidence locations

- **Walkthrough screenshots** (never committed; in this session's scratchpad, `walkthrough/`): `today-{phone,tablet-portrait,desktop}.png`, `week-…`, `month-…`, `season-…`, `milo-…` (15, default state); `why-open-phone.png` (Week, no JavaScript, a mark's Why open); `month-why-open-phone.png`; `week-after-not-useful-phone.png`; `week-alex-phone.png`; `month-alex-phone.png`; `firstrun-forward-phone.png`; `firstrun-today-phone.png`. The same scenes are reproducible from `tests/e2e/forward.spec.ts` (`test-results/screenshots/forward-{horizon}-{viewport}.png`, all folds open) and from the walkthrough brief in the session.
- **Tests cited:** `tests/unit/forward/{forward-engine,forward-insights}.test.ts`, `tests/unit/conflicts/{conflicts-engine,conflict-insights,conflicts-performance}.test.ts`, `tests/unit/insights/conflict-marks.test.tsx`, `tests/unit/today/*`, `tests/integration/{forward-engine,forward-screen,conflicts-engine,conflicts-default-people,conflict-insights,worth-knowing}.test.ts`, `tests/e2e/{forward,today-conflicts,today-screen,events,occurrence-changes,synced-events,people,m3-privacy-sweep,m3-device-sweep,smoke}.spec.ts`.
- **Mutation evidence:** ADR 0009 §33–§35 (developer reports) and, independently re-run for this package on an out-of-repo copy, 26 unit-level mutations of which 25 were killed (`M6-ACCEPTANCE-MATRIX.md` §5); the survivor is Worth knowing's fold bound (no test).
- **CI:** PR #67's full regression on b5e84ba (run 38097583214: 218 e2e passed, 17.6 min); main at 6ede099 (run 38105649268).

## 5. Privacy and the gate

- **No real family data is enabled.** `HOME_REAL_DATA` is not `open` anywhere; nothing in this package touches Vercel settings. The gate (`src/lib/env.ts`, `src/domain/common/guards.ts`) refuses every family-domain write in Production until it is exactly `open`, and `respondToInsight` checks it before any read (code check (c); tested with a query counter).
- **All acceptance data is synthetic:** the fixture family and `ac `-, `fw `-, `tc `-prefixed records on fixed synthetic days; the walkthrough's records were archived or deleted afterwards and the fixture restored (live counts unchanged). CI's `check:private-terms` step passed on 6ede099 with no "secret unset" warning.
- **Cross-adult private data is not exposed:** byte-identical results for the other adult at data level (§8.2 rows PR-1…PR-9), the M3 two-adult sweep over `/forward` and `/people/{id}`, and the walkthrough's Alex pages. The rendered-page comparison under the invariant is the one untested form (R-5).
- **No external calendar writes:** `src/integrations` is unchanged since M5; its only network call is a GET (code check (d)).
- **Not useful does not adapt ranking:** the response kind is read only to refuse a repeat write and for the owner's export; no detector, ranking or Kev path reads it (code check (a); test "Not useful changes no rule, ranking or other insight").
- **Audit keeps structural metadata only:** `{ "response": "dismissed" | "not_useful" }` with the response row as subject, private to its owner; no key, title or record text (code check (b); asserted exactly in two integration suites).
- **No schema, migration or runtime dependency** across M6: `package.json`, the lockfile, `src/db/migrations` and `src/db/schema` are unchanged since Package 0 (code check (f)); the journal ends at `0007`.

## 6. Performance

- **Query counts (CI, through the real services):** Forward's read is the agenda read plus one responses query, constant after 20 more events, 3 tasks, a project and a second calendar (`forward-screen.test.ts`); the 90-day conflicts read is 7 queries, constant after 20 more events (`conflict-insights.test.ts`); the Today page adds no query to its read (ADR 0009 §34).
- **Engine time (this package, re-measured):** at 300 synthetic events, the 90-day agenda about 170 ms cold and 58 ms for all three Forward compositions; the conflict engine 24–29 ms at 300 events and 138–181 ms at 1,200; Today's conflicts and insights over eight days about 6 ms.
- **Render time (this package; contract §3.7 and criterion 9):** measured on the production build (`next build` of 6ede099, `next start` on this dev container, a signed session for Sam, twelve warm samples per path, server round trip in ms):

  | Path | Fixture household: median / p90 | With 300 more events over 90 days: median / p90 |
  |---|---|---|
  | `/today` | 20 / 26 | 68 / 74 |
  | `/forward` (Week) | 24 / 36 | 184 / 228 |
  | `/forward?h=month` | 24 / 30 | 157 / 188 |
  | `/forward?h=season` | 30 / 36 | 273 / 327 |
  | `/people/{milo}` | 25 / 27 | 213 / 258 |

  Well under a second on every path, as §3.7 expected. The development server (what the browser specs run against) is several times slower: the same walkthrough measured Season at 3.6 s with the 300 events, which is React's development mode and on-demand compilation, not the product. The 300 extra events are synthetic one-offs spread over the ninety days with Sam, Alex and Milo in turn; they and the session row were removed afterwards.

## 7. Regression

- **Full local verification (`pnpm verify`, this package, on 6ede099 plus these documents):** lint (0 errors, the one pre-existing warning), typecheck, unit **82 files / 1,554 tests**, integration **41 files / 755 tests**, build, boot, csp and the full browser suite **218 passed (21.8 min)**, all green, with one exception: in the integration step `calendar-sync.test.ts › recovery: a person a disconnected household calendar names can be made private once the owner lets them go` timed out at its 5 s limit while the assessor's unit suites and mutation runs were loading the same machine; re-run alone it passes in 4 s (45 tests), as did `people-privacy.test.ts` after the same kind of timeout in Package 4's run. Neither test is touched by M6; both are M3/M4 tests with the default 5 s limit, and neither reproduces on a quiet machine.
- **CI:** PR #67's full regression on b5e84ba, 218 e2e passed; main at 6ede099 after the merge, lint/typecheck/unit/integration, bundle build and secret scan green (the e2e job was still running when the assessor read it). This package's own CI run is on its PR.
- **M1–M5 suites kept:** every earlier spec runs in the full regression; the intentional M6 changes to older specs are recorded in ADR 0009 §34–§35 (one Today spec names the Dismiss form explicitly; Today's footer reads "What’s coming up ›"; the specs that read the old 30-day Forward list now read Week or Month by unit).

## 8. Outstanding defects

No product defect was found. The outstanding items are evidence gaps, each a small targeted test and none a code change:

| # | Gap | Class | Where it would live | What it asserts |
|---|---|---|---|---|
| R-1 | A stale key is refused | B | `tests/integration/conflict-insights.test.ts` | With `now` after the Thursday overlap has ended, `respond(sam, key)` → `not_eligible`, no row, audit unchanged; after T13 moves the Dentist, the old key → `not_eligible` |
| R-2 | Forward's quiet, first-run and stale scenes at render; a failing calendar said, not only "no alarm" | B | `tests/e2e/forward.spec.ts` | First run: the headline and "Connect a calendar ›"; quiet: "Nothing recorded in the next seven days." and each unit's words; stale: the `qualifier` and Worth knowing's `data_health` row |
| R-3 | Not useful on a non-conflict insight (a birthday or a calendar) | B | `tests/e2e/today-screen.spec.ts` or `forward-screen.test.ts` | The form inside that Why posts, hides the insight for that adult only, is audited with the kind |
| R-4 | Worth knowing's fold past twelve | B | `tests/unit/insights/worth-knowing.test.tsx` | 20 insights → two shown, "+ 18 more", fourteen Why blocks, 28 forms, every sentence present (the mutation that survived) |
| R-5 | Rendered pages identical under the privacy invariant | B | `tests/e2e/forward.spec.ts` | Alex's `main` text on Week, Month, Season, Milo's page and Today, folds open, equal before and after Sam's private records |
| R-6 | No-JS on Month and Season and at desktop width; above-the-fold at phone; two columns from 768px | B | `tests/e2e/forward.spec.ts` | Links, "+ N", Why and Dismiss without JavaScript on each horizon; the switch, headline and first Worth knowing row within 812px; Coming up to the right of the header at 768 and 1280 |
| R-7 | The standing and responsible Why text at render; each commitment's date, times and role | B | `tests/unit/insights/conflict-explanation.test.tsx` | "Both repeat, and they overlap at this time each time. The next is …"; "recorded as responsible for both"; "Thursday 15 October, 15:00–16:00 · Milo attending" |
| R-11 | Small engine cases: Forward DST end with items; a standing key across the September change; an overlap on a DST night; the DST-night second standing key; fortnightly usual on Forward; a seeded Forward shuffle; the full §5.5 list in Forward's forbidden-phrase scan and a rendered-page scan; Today's window at +7 and +8; T9's old response matching nothing | B | `forward-engine.test.ts`, `conflicts-engine.test.ts`, `conflict-insights.test.ts` | As the matrix rows P1-4, P1-6, U-3, U-10, U-13, P3-1, T9 state |

Also recorded, not defects: `conflictsOver` passes `coverage: window` to the conflict engine (R-8; every caller loads at least that window); the "+ N" row fold has no context of its own for a screen reader (R-9, could carry an `aria-label` such as "3 more on Thursday 15"); the qualifier appears once, under the headline (R-10, as §4.1 and the §4.2 example show it).

## 9. Accepted limitations and carry-forwards

| Item | Class | Deciding clause | Note |
|---|---|---|---|
| Season shows the earliest three per month, not "significant milestones" | C | §5.3 caps and "never by importance"; chronological rows (ADR §35) | Surfacing "significant" items would rank by importance, which §5.3 forbids; a later milestone is under "+ N" in date order |
| Usual commitments only under The usual on Forward | C | §5.2, §5.3, ADR §15 | The §4.2 Month example drew Swimming in every week of a standing conflict; the engine marks only the next pair as conflicted, so later repeats are usual. The approved §5.3 refinement governs |
| "Camp today." for a multi-day carry-over in the listed headline | C, owner's call | §5.5 templates indicative; ADR §16 copy approved from screenshots | True as stated but reads as starting today; "Camp, until Friday." would be a one-line change if the owner prefers |
| Scheduled tasks before timed items on Week | C | §5.3 Week order, items 6–7 | As the contract says; changing it needs an amendment |
| Later repeats of a standing conflict unmarked on Coming up | C | §5.7.1 "said once, at its next occurrence"; ADR §13 | A parent may wonder why a later Wednesday is unmarked; the M10 trial will say whether it matters |
| Dense conflict disclosures: two in full, twelve more in full, then sentences | C (approved deviation from criterion 3's letter) | ADR §35, owner's correction; tested | Past fourteen marks on one entry an entry is its sentence; a line says responding brings the rest forward |
| Worth knowing's fold beyond twelve without actions | C for the behaviour (ADR §35); **B for its evidence** | §2.2 Package 5 "evidence that cites tests" | R-4 |
| First-run day rows read "Nothing recorded" under "HOME doesn't know your calendars yet." | C | §3.5 (true as stated) | Could omit the unit rows on first run; a presentation nicety for M10 |
| "…overlap regularly, 15:45–16:15; next today." | C | §5.6 standing template | "next: today" or "the next is today" reads better; a copy change for the owner's screenshot review |
| Today's Worth knowing with three conflicts pushes Everyone's day to the foot of the first phone screen | C | M5 criterion 8 still holds (Everyone's day begins on the first screen) | Watch in the M10 trial |
| `conflictsOver` coverage asserted rather than taken from the loaded range | C | ADR §32/§33 | Pass the loaded range if a caller ever reads less than its window |
| Render cost of a pathological horizon | C | §3.7 | See §6 |

Transport (ADR §20), `conflict.away` and "both adults away" (§24–§25), sheets (§23), Kev's Week Ahead (M10) and adaptive ranking (§17) remain deferred as approved.

## 10. Recommended next actions and owner items

1. **Close the evidence gaps R-1…R-7 and R-11** (tests only, no product change), in one small PR, so Package 5 can cite a test for every criterion. Estimated at under a day.
2. **Owner's screenshot review** (criterion 13; contract §2.2 Package 4): the three horizons and Today at phone, tablet and desktop (§4), with the two copy questions in §9 ("Camp today."; "next today.").
3. **Operational acceptance** on real records: DEPLOY.md §E items 18–19, after items 11 and 14–17.
4. **M10 trial inputs:** whether conflicts are worth their marks, the `not_useful` review from each adult's export, later repeats on Coming up, Season's cap, and the first-run rows.

## 11. Acceptance status

**M6 is recommended for acceptance on synthetic data once the evidence gaps in §8 are closed (B).** Nothing in the code breaks the contract; the gaps are tests that are owed, not behaviour, plus the owner's screenshot review and the two copy questions in §9. Operational acceptance on the family's real records is DEPLOY.md §E items 18–19, which wait on the gate and the earlier items. `HOME_REAL_DATA` stays closed; nothing was merged or closed by this package, and M7 does not start until the owner says so.
