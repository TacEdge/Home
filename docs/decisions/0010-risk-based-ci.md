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
   | **Medium** | established screens (`src/app/(home)/<area>/`, `_capture`, `_calendar`, `_forms`, `_notes`, `_profile`), pure engines other than agenda and recurrence, a changed browser spec | The specs mapped to the change, plus the smoke suite |
   | **High** | domain services (where privacy is enforced), the agenda and recurrence engines, the shared agenda loader, integrations, `src/lib`, shared UI and the app shell, Kev, **and any path no rule names** | Full regression |
   | **Critical** | `src/trust`, sign-in and API routes, the proxy, Next config, environment controls, the database, schema and migrations, `.github/`, `scripts/`, dependencies and the toolchain config, the test harness and fixtures, milestone acceptance documents and DEPLOY.md | Full regression |

   - **How a path is tiered:** every rule that matches a path applies, and the path takes the highest tier among them.
   - **How a change is tiered:** the change takes the highest tier of its paths.
   - **Changed specs:** a changed spec runs itself.
   - **Everywhere:** lint, typecheck, unit, integration, build, the private-terms scan, the bundle build and the secret scan still run on every change. Only the browser suite is scoped.

2. **Fail closed.** These all mean full regression or a failed job, never a green untested one:
   - **A path no rule names** is high.
   - **An empty diff** is high.
   - **A classifier error** (an unreadable event, a base that is not a commit, a missing output file, a spec that does not exist) exits non-zero, so the job fails.
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
- **The map is path-based, not import-graph-based.** A screen that imports a medium engine is covered only if the engine's rule names its specs. New paths fail closed to high until a rule names them.
- **A scheduled run's failure notifies only the person who last edited the schedule,** as GitHub does by default.
- **Services still start on low runs.** The browser job starts the Postgres service even when no browser test runs (about 16 seconds): services cannot be conditional.

## Phase 2 (proposed, not built)

- **Shard full regression** across three jobs, each with its own Postgres service. That is real isolation, not shared-database parallelism.
- **Keep the required name:** an aggregating job named `End-to-end (Playwright)` that fails if any shard failed, was cancelled or was skipped.
- **Expected effect:** full regression in about 8–9 minutes. The single 5-minute device-sweep file sets the floor.
- **Prerequisite:** every spec proved independent of every other.
