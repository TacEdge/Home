# ADR 0010 — Risk-based CI verification (Phase 1)

Status: **Proposed**, 2026-10-10. This is an infrastructure change, separate from M6. The owner approved the design before it was built; this ADR is accepted when its PR merges.

## Context

Every pull request ran the whole browser suite (about 17.5 minutes), and the browser job started only after the checks job. That made 20–23 minutes per run.

- **Measured:** ten successful runs, 9–10 October 2026. The M6 Package 0 PR changed only Markdown and still took 21 minutes.
- **Where the time goes:** the device sweep (25%), `today-screen` (13%) and the shell, privacy and occurrence specs (7% each) took most of the browser time. Measured from one full local run with per-spec timings: 201 tests, 21.1 minutes, no retries.
- **Why it can't simply run faster:** the suite runs one worker against one shared database, on two development servers. That is deliberate: production builds refuse the test clock and the test mail transport.

## Decisions

1. **One classifier, four tiers.** `scripts/ci-select.mts` is the single source of truth for how much verification a change needs. CI uses it, and so does `pnpm verify:focused`, which now imports it in place of its own map.

   | Tier | What | Browser tests |
   |---|---|---|
   | **Low** | `docs/` and Markdown, unit tests, integration test files | None |
   | **Medium** | established screens (`src/app/(home)/<area>/`, `_calendar`, `_notes`, `_profile`), the Forward engine (no shared code imports it yet), a changed browser spec that still exists | The specs of every screen that uses the change (§8), plus the smoke suite |
   | **High** | domain services (where privacy is enforced), the agenda and recurrence engines and the engines they or a domain service import (Today, day facts, insights, profile, staleness), the shared agenda loader, the form helpers (`_forms`) and the capture bar (`_capture`), integrations, `src/lib`, shared UI and the app shell, Kev, a browser spec the change deletes or renames, **and any path no rule names** | Full regression |
   | **Critical** | `src/trust`, sign-in and API routes, the proxy, Next config, environment controls, the database, schema and migrations, `.github/`, `scripts/`, dependencies and the toolchain config, the test harness and fixtures, milestone acceptance documents and DEPLOY.md | Full regression |

   - **How a path is tiered:** every rule that matches a path applies, and the path takes the highest tier among them.
   - **How a change is tiered:** the change takes the highest tier of its paths.
   - **Changed specs:** a changed spec runs itself.
   - **Everywhere:** lint, typecheck, unit, integration, build, the private-terms scan, the bundle build and the secret scan still run on every change. Only the browser suite is scoped.

2. **Fail closed.** These all mean full regression or a failed job, never a green untested one:
   - **A path no rule names** is high.
   - **An empty diff** is high.
   - **A classifier error** (an unreadable event, a base that is not a commit, a missing output file, a rule naming a spec that does not exist) exits non-zero, so the job fails.
   - **A deleted or renamed spec** (the diff lists the old path, and `--no-renames` lists a rename as a deletion) is high: full regression, with the reason in the job summary. It cannot run itself and what it covered is unknown, and it must never make a pull request permanently red.
   - **No recognisable mode** written by the classifier: a guard step fails the job.
   - **High and critical changes** always get full regression. Only low changes get no browser tests.

3. **Labels only raise.** `ci:full` forces full regression. No label lowers a tier; the tier comes only from the diff.
   - **Re-running:** the workflow runs on `labeled` and `unlabeled`, so adding the label re-runs CI.

4. **Always full:**
   - pushes to `main`;
   - the nightly scheduled run on `main` (14:23 UTC, about 03:23 in Auckland);
   - manual runs (`workflow_dispatch`);
   - pull requests touching milestone acceptance documents or DEPLOY.md (critical).

5. **The smoke suite.** `tests/e2e/smoke.spec.ts` runs with every medium change. It has four tests, about 15 seconds of test time:
   - signing in (signed out goes to sign-in, then lands on Today);
   - Today and Forward, and the switch between them;
   - the places reached from the shell;
   - the two-adult boundary: Alex's private event is on Alex's Forward, absent from Sam's Today and Forward, and a 404 when Sam asks for it directly.

   It depends only on the global setup's seeded household, inserts and puts away its own records, and does not repeat the device or privacy sweeps.

6. **Required checks are unchanged and always report.** The four check names stay exactly as they were:
   - `Secret scan (gitleaks)`;
   - `Lint, typecheck, unit and integration tests`;
   - `Vercel bundle build`;
   - `End-to-end (Playwright)`.

   No job has a job-level `if`, because GitHub counts a skipped required job as passing. No workflow-level path filter is used, so a required check can never go missing. The browser job no longer waits for the checks job. Its first step classifies the change and writes the tier, the mode and every path's reason to the job summary. A low-risk run is an explicit, logged success step, not a skipped job.

   `tests/unit/workflows.test.ts` pins all of this: the names, no job-level `if`, no `needs` on the browser job, the guard step, the specs passed through an environment variable and never interpolated into a command, the triggers, and one Playwright worker.

7. **No new parallelism.** Playwright still runs one worker against the job's own database.

8. **Shared code is high; screen rules cover every screen that uses them** (added after the PR's focused review).
   - **Shared code is high:** the form helpers (`_forms`, used by nearly every screen and by the shell's capture bar), the capture bar (`_capture`, in the shell on every page), and every engine the shared agenda, its loader or a domain service imports (Today, day facts, insights, profile, staleness). No subset of specs covers them.
   - **Screen rules name every dependent screen's specs:** events screens bring People, the regular week, To sort and Today; To sort brings Today; projects, tasks and people bring To sort and Today; calendar code (refresh on use) brings Today, Forward and a person's page; notes bring events, projects and people. A rule's specs cover its own screens and, transitively, every screen that imports them, so some medium changes select more specs than the file itself needs: over-selecting is the accepted cost.
   - **Checked against the code on every run:** `tests/unit/ci-import-coverage.test.ts` reads every local import under `src/` and, for each medium file, follows its importers transitively. It fails if any importer is high or critical code (the file must be high too), or if an importer's specs are not all in the file's selection. It fails closed: an import it cannot resolve, an `import()` of a computed path or a `require()` fails the test. Mutation tests prove that removing a cross-screen spec, putting the form helpers back to medium, dropping a calendar dependent, or following only direct imports each fail it.

## Branch protection (evidence)

- **Protection rules:** this session's token cannot read them; `branches/main/protection` returns 403.
- **What GitHub reports:** the readable branch endpoint says `main` is **not protected** (`protected: false`, no required status checks), and the repository has no rulesets.
- **Consequence:** until the owner enables protection (DEPLOY.md §A.4.1, unchanged), nothing stops a merge with red or missing checks.

## Expected effect

| Change | Before | After (Phase 1) |
|---|---|---|
| Low (docs, tests) | about 21 min | about 4 min (the checks job) |
| Medium (one screen) | about 21 min | about 5–8 min (mapped specs and the smoke suite, plus setup) |
| High or critical | about 21 min | about 18 min (full, no longer waiting for the checks job) |

## Known limitations

- **A medium change can break a screen its mapped specs don't cover.** That is caught by the full run on `main` after merge, or the nightly run, and fixed forward. This is the accepted trade.
- **The map is path-based, but checked against the import graph** (§8). The check sees static imports only: a dependency through something other than an import (a route a page links to, a shared database row, a URL a test visits) is not a code dependency, and only the smoke suite and full runs on `main` and nightly catch a break there. Type-only imports count as dependencies, which over-selects a little.
- **Rules are per folder,** so a folder's specs are the union of what any file in it needs. New paths fail closed to high until a rule names them; a new medium rule that misses a dependent fails the coverage test in the checks job.
- **A scheduled run's failure notifies only the person who last edited the schedule,** as GitHub does by default.
- **Services still start on low runs.** The browser job starts the Postgres service even when no browser test runs (about 16 seconds): services cannot be conditional.

## Local stale-cache 404s (diagnosis)

During this PR's verification, three local runs (two of a larger subset including the device sweep and the smoke suite, and one of the targeted calendar set) failed together. The calendar edit and reconnect routes answered "Nothing here" (404) for calendars that existed. Other runs of the same sets passed, and no CI run has shown it.

- **Cause:** stale development-server caches in `.next` and `.next-narrow`. Those runs were plain `playwright test` invocations started straight after `pnpm verify`, which had left a production build and earlier development caches there. It is the failure already recorded in ADR 0007 §48 and LOCAL-DEV.md: stale compiled routes answer 404 for routes that exist, for the life of the server.
- **Ruled out:** fixtures, database reset sequencing, test order and session reuse. Each run resets the database and feeds, servers are never reused (`reuseExistingServer: false`), every test signs in afresh, and the same spec order both passed and failed.
- **Confirmed:** after clearing both caches, the targeted calendar set passed (30 tests).
- **Not a CI risk:** CI starts from a clean checkout every run, and `pnpm verify` and `pnpm verify:focused` clear both caches first. No calendar escalation is needed.
- **Locally:** clear `.next` and `.next-narrow` before a plain `pnpm test:e2e` or `playwright test` run.

## Phase 2 (proposed, not built)

- **Shard full regression** across three jobs, each with its own Postgres service. That is real isolation, not shared-database parallelism.
- **Keep the required name:** an aggregating job named `End-to-end (Playwright)` that fails if any shard failed, was cancelled or was skipped.
- **Expected effect:** full regression in about 8–9 minutes. The single 5-minute device-sweep file sets the floor.
- **Prerequisite:** every spec proved independent of every other.
