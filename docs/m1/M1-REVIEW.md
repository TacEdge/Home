# M1 adversarial review

> Saved verbatim from the Opus review of 2026-10-01, with one change: the partner's real name quoted in finding I1 is replaced by `[real partner name]`, so that saving the review does not reintroduce it (D18).

**Recommendation: B.** Fix the two blockers, then re-review before infrastructure setup.

The foundation is sound: the boundaries hold and the auth design is right. What I found are gaps in the details, not a wrong approach.

I read every production file, both migrations, both workflows and the runbooks. I checked the security-relevant Better Auth behaviour in its source rather than its docs. I confirmed the two blockers empirically: a temporary probe test for B1, since deleted, and a simulated Vercel upload for B2. The working tree is clean and I changed nothing.

## Blockers — fix before connecting any infrastructure

### B1. Anyone on the internet can write unlimited permanent rows by requesting links for non-household addresses

- **Files:** `src/trust/auth.ts:122-131`, `src/app/sign-in/actions.ts`
- **Problem:** Better Auth saves a pending sign-in token, with the email in plain text, *before* it calls `sendMagicLink`. Our allowlist check and rate limits both live inside `sendMagicLink`, and the non-household branch returns *before* any limit runs. On top of that, the sign-in form submits via a server action, which bypasses Better Auth's own IP-based limit entirely.
- **Verified:** 20 such requests from one IP produced 20 token rows (each storing the address in plain text) and 20 audit rows, with no limit applied.
- **Consequence:** A trivial script against the public sign-in form can fill the database (Neon's free tier is 0.5 GB). The flood lands in the one table the design makes impossible to clean up, and buries real events on the Activity page. It also breaks two promises:
  - "The address itself is never stored": outside addresses sit in the `verification` table in plain text.
  - Contract §5.1's per-IP rate limit, which doesn't exist for this path.
- **Fix:**
  - Check the allowlist and rate limits *before* Better Auth runs.
  - In the server action: apply a per-IP limit to every request, then check the allowlist, and only call `signInMagicLink` for household addresses.
  - For the HTTP endpoint: add a Better Auth `hooks.before` on `/sign-in/magic-link` that does the same, short-circuiting with `{status:true}`.
  - Cap refused-attempt audit entries (e.g. one per IP per window, with a count) so the audit log can't be flooded.
- **Test:** An integration test of 20 outside-address requests from one IP, through both the server-side API and the HTTP handler. Assert 0 new token rows, at most N audit rows, and that a household address on another IP still gets its link.

### B2. The first Vercel deployment will fail to build

- **Files:** `.vercelignore`, `playwright.config.ts`, `tsconfig.json`
- **Problem:** `.vercelignore` strips `tests/`, but `playwright.config.ts` is uploaded and imports `./tests/env`. `next build` type-checks the whole project.
- **Verified:** In a simulated Vercel upload, the build fails with `Cannot find module './tests/env'`.
- **Fix:** Exclude `tests`, `playwright.config.ts` and `vitest.config.mts` from `tsconfig.json`. Add a `tsconfig.test.json` that includes them, and use it for `pnpm typecheck`.
- **Test:** A CI step that builds from a copy of the repo filtered by `.vercelignore`. That would have caught this.

## Important — fix before real family data enters HOME

### I1. The partner's real name is in the repository (breaks D18)

- **Problem:** `docs/HOME-VISION.md:30` still quotes "[real partner name]", and that text is also in history (`e0a9e6b`, `83d0449`). Separately, the owner's email is the author on the five merge commits GitHub made.
- **Consequence:** CI fails on `main` the moment `HOME_PRIVATE_TERMS` is set.
- **Fix:**
  - Replace the name with a fixture name.
  - Decide whether to rewrite history. It's a private repo, so accepting it is reasonable.
  - Turn on GitHub's "keep my email address private" for future web and API commits.
- **Test:** The private-terms scan with the secret set.

### I2. The runbook tells you to copy production data into the preview database

- **Problem:** `docs/runbooks/MIGRATIONS.md:26` says to "reset the branch from `main` in Neon when it drifts".
- **Consequence:** Once real data exists, that copies the family's data into the database every preview deployment uses. Previews run code from any branch, including unreviewed agent branches, with the test allowlist.
- **Fix:**
  - Never derive `dev` from `main` after real data exists. Rebuild it from migrations plus fixtures instead.
  - Add a startup check that preview refuses a production database host.
- **Test:** A runbook check, plus a unit test of the host guard.

### I3. The production migration workflow can be dispatched from any branch

- **Files:** `.github/workflows/migrate.yml`, `docs/runbooks/DEPLOY.md` §A.4
- **Problem:** `workflow_dispatch` runs from any branch with production database credentials after one approval click. The Claude GitHub App has write access, so agent branches qualify. The workflow's actions are also pinned to version tags, not commit SHAs, in the job that handles the production credential.
- **Fix:**
  - Restrict the `production` environment's deployment branches to `main`.
  - Add `if: github.ref == 'refs/heads/main'` to the job.
  - Pin the actions to commit SHAs.
- **Test:** During setup, a dispatch from a non-`main` branch is refused.

### I4. The test harness can be pointed at a real database

- **Files:** `tests/integration/global-setup.ts`, `tests/setup.ts`
- **Problem:**
  - The global setup runs `drop schema public cascade` on `TEST_DATABASE_URL` with no guard. `scripts/db-reset-test.mjs` has one; this file doesn't.
  - `tests/setup.ts` uses `??=`, so an exported `DATABASE_URL` wins and the auth tests write through it.
- **Consequence:** Catastrophic data loss from one wrong shell variable. The risk grows once real credentials exist on dev machines.
- **Fix:** Add the same localhost/`_test` guard. In `tests/setup.ts`, force `DATABASE_URL` to the test URL and assert it is one.
- **Test:** Running with a non-test URL is refused.

### I5. The append-only audit guarantee only protects against app bugs, not leaked credentials

- **Problem:** The app connects as the table owner (the runbook uses Neon's default role for both the app and migrations). Anyone with `DATABASE_URL` can run `ALTER TABLE audit_log DISABLE TRIGGER` and rewrite history.
- **Fix:** Use a separate runtime role with only the data access it needs, and `INSERT`/`SELECT` only on `audit_log`. Migrations keep running as the owner.
- **Test:** As the app role, disabling the trigger and updating a row both fail.
- **Note:** This goes beyond the contract, which settled on the trigger alone. You may reasonably downgrade it.

## Minor — doesn't block M1

1. **Sessions don't roll; contract decision M1-D3 is unmet, in the safer direction.** Better Auth skips session refresh during Server Component rendering (confirmed in its Next.js integration source). The app only reads sessions there, so everyone is signed out 30 days after sign-in regardless of use. Either refresh through a route handler or server action, or amend D3. Test: a session older than a day gets its expiry and cookie extended.
2. **The every-request allowlist check doesn't cover `/api/auth/*`.** A removed person's cookie keeps working on Better Auth's own endpoints (`get-session`, `update-user`) until they load a page. No household data is exposed in M1, but this must close before M2 adds any route handlers.
3. **Response timing can reveal household membership.** The household path does extra database writes and a Postmark round-trip before responding. B1's fix should send mail without awaiting it, so both paths take similar time.
4. **Our IP parsing takes the leftmost `X-Forwarded-For` value.** That can be spoofed anywhere except Vercel; Better Auth's own parser is stricter. Use theirs, or `x-real-ip`.
5. **The rate limiter checks then increments in two steps**, so concurrent requests can overrun it slightly. Use a single upsert that returns the count.
6. **Anyone can exhaust a parent's per-email link budget** (5 per 15 minutes) from many IPs, locking them out of sign-in temporarily. Accept it and document it.
7. **Better Auth log messages are passed through unredacted.** Some of them interpolate URLs.
8. **Production cookie flags are never tested.** E2E runs in dev mode, so the `Secure` flag and the `__Secure-` prefix are unverified. Add an in-process production-config test that checks the `Set-Cookie` header.
9. **Environment validation is lazy.** A misconfigured deployment reports success and then fails on every request; DEPLOY.md's "check the deployment log for env errors" doesn't hold. Validate in `src/instrumentation.ts` at server start.
10. **The private-terms scan skips silently when the secret is unset**, and only scans current files, not commit messages or history.
11. **The runbook should say to turn off Postmark link and open tracking.** Otherwise Postmark rewrites the sign-in link through its own redirect.
12. Small items:
    - The Activity page hardcodes the time zone instead of `HOME_TIMEZONE`.
    - Audit pagination keyed on time alone can skip rows with identical timestamps.
    - The actions in `ci.yml` are pinned to version tags rather than commit SHAs.

## Areas reviewed and found sound

- **Magic links:**
  - Single-use: Better Auth consumes each token atomically (confirmed in source), and the e2e reuse test proves it.
  - Tokens are stored hashed and expire after 15 minutes.
  - Callback URLs on the HTTP path are validated against trusted origins (`originCheckMiddleware`), so there's no open redirect.
- **CSRF:** Next.js checks the Origin header on server actions, and Better Auth applies its form-CSRF and origin checks to its own endpoints.
- **Revocation is immediate:** session cookie caching is off by default.
  - Layer 2: the user-creation hook works.
  - Layer 3: page-level revocation is proven end to end.
- **Audit log:** the trigger blocks UPDATE, DELETE and TRUNCATE, and tests prove it.
- **Data, config and logging:**
  - The visibility filter is correct, with no way for one person's private rows to reach the other.
  - Environment-variable validation logic is right.
  - The logger's redaction is correct, with tests.
- **Client/server boundary:**
  - Client bundles are clean. I scanned for env names, secrets, database URLs and server libraries, and found none.
  - There are no `NEXT_PUBLIC_*` variables, and every sensitive module is marked server-only.
  - Layer boundaries are enforced by lint.
- **Headers and errors:**
  - Security headers are present.
  - Error pages are generic.
- **CI hygiene:**
  - CI has read-only permissions and uses `pull_request`, not `pull_request_target`.
  - The lockfile is frozen.
  - pnpm 10 blocks dependency install scripts.
- **Migrations:** correct and idempotent, with adequate keys and indexes for M1.
- **Scope is clean:**
  - No `src/domain`, `src/kev` or `src/integrations`, no Anthropic SDK, no domain tables.
  - No prototype code in `src/`.

If you want to hand this to Fable as a fix contract, I can save it as `docs/m1/M1-REVIEW.md`.
