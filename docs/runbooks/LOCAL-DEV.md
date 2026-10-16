# Runbook — Local development

## Requirements

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10`)
- Docker (for Postgres), or a local Postgres 16 with:
  - databases `home` and `home_test` owned by role `home` (password `home`) — the local **migration/admin credential**
  - role `home_app` (password `home_app`, `LOGIN NOINHERIT`, no `CREATEDB`/`CREATEROLE`) — the local **runtime/app credential**; `scripts/init-app-role.sql` creates it
- Chromium for Playwright (`pnpm exec playwright install chromium` once)

Local development uses the same two-credential model as production (M1.1 contract §1.7): the app and every test of it connect as `home_app`; only migrations and test setup connect as the owner. `docker compose up` creates both.

## First run

```sh
pnpm install
docker compose up -d                      # Postgres on :5432 with home + home_test and the home_app role
cp .env.example .env.local                # fill in values; never commit this file
#   DATABASE_URL          runtime/app credential  (postgres://home_app:home_app@localhost:5432/home)
#   DATABASE_URL_MIGRATE  migration/admin credential (postgres://home:home@localhost:5432/home)
#   BETTER_AUTH_SECRET and AUDIT_HASH_SECRET: `openssl rand -base64 48`
#   HOME_CREDENTIALS_KEY (calendars, optional): `openssl rand -base64 32`
#   HOME_FINGERPRINT_KEY (calendars, optional): another `openssl rand -base64 32`, never the credentials key
#   HOME_LAT=-41.29 and HOME_LON=174.78 (weather, optional): the synthetic public point only, never a real home
#   HOME_WEATHER_LOCATION_KEY (weather, optional): its own `openssl rand -base64 32`, never equal to another key
#   HOME_TEST_WEATHER=fake (weather, optional): a synthetic forecast instead of calling Open-Meteo
#   HOME_KEV=on and HOME_TEST_KEV=scripted (Kev, optional): the scripted provider; no key, nothing leaves the machine
#   HOME_KEV_MONTHLY_CAP_NZD (Kev, optional): whole NZ dollars 0–300; unset means 100
#   HOME_KEV_PROVIDER_KEY: never set locally; no key exists until the owner's §E items (ANTHROPIC_API_KEY is never read)
#   CRON_SECRET (Kev, optional): the retention route's secret, 16–512 printable characters; unset, the route answers 404
#   HOME_ALLOWED_EMAILS: the household's addresses (or the fixture ones for a sandbox)
#   HOME_MAIL_TRANSPORT=test              # magic links are written to a mailbox file
pnpm db:migrate                           # applies src/db/migrations with DATABASE_URL_MIGRATE
pnpm dev                                  # http://localhost:3000
```

With `HOME_MAIL_TRANSPORT=test`, sign-in links are appended to `<tmpdir>/home-test-mailbox.jsonl` (macOS: `$TMPDIR/home-test-mailbox.jsonl`; Linux: `/tmp/...`). Open the link from there.

**Weather (M7).** With `HOME_LAT`, `HOME_LON` and `HOME_WEATHER_LOCATION_KEY` set, the boot line reads `[home] weather location: set` (otherwise `absent`, `invalid` or `set, key missing`; never a value). Use only the synthetic Wellington point (`-41.29`, `174.78`); a test that moves the location uses Christchurch's (`-43.53`, `172.64`). Generate the key with `openssl rand -base64 32`; HOME refuses a key shorter than 32 bytes or equal to `HOME_CREDENTIALS_KEY`, `HOME_FINGERPRINT_KEY` or another secret, and then treats weather as unconfigured. With `HOME_TEST_WEATHER=fake` a refresh stores a dry synthetic week and nothing reaches Open-Meteo; without it, a refresh (`POST /weather/refresh`, which Today and Forward Week ask for after render when the forecast is due) calls the real provider, so leave the location unset unless you mean to. `HOME_TEST_WEATHER` is refused on Vercel and under `NODE_ENV=production`. No test reaches the network: the suites set these variables themselves and use the fake provider.

**Kev (M8).** The boot line reads `[home] kev: off` (the default), `scripted`, `no key`, `on` or `off (gate closed)`, never the key. Locally and in CI Kev runs only with `HOME_KEV=on` and `HOME_TEST_KEV=scripted`: the scripted provider, deterministic and offline. `HOME_TEST_KEV` is refused on Vercel and under `NODE_ENV=production`. `HOME_KEV_MONTHLY_CAP_NZD` takes a whole number of NZ dollars from 0 to 300 (0 pauses Kev; `abc`, `301` or `12.5` stop the boot). `HOME_KEV_PROVIDER_KEY` is read only by `kevConfig()` in `src/lib/env.ts` and handed to the provider adapter; it is never set locally or in CI, and no test calls the provider: the adapter's tests use a local stub through `createProviderFetchForTests`, which refuses to exist anywhere deployed. **Kev's screen (Package 4).** `/kev` and its turn route, `POST /kev/turn`, run `kev.handle()` (`src/kev/orchestrator.ts`); with `HOME_KEV=on` and `HOME_TEST_KEV=scripted` a small scripted model (`src/kev/evals/local.ts`) answers the screen's suggestions ("What's happening today?", "What have we got this weekend?", "Help me think through our weekend.", "What tasks have I still got outstanding?", "What's on tomorrow?", "Remember …", "Add …") from the turn's own reads of whatever HOME holds, and HOME's checker checks every answer as it would a model's; anything else gets HOME's fixed "not sure". In that mode only, a request header `x-home-test-kev` asks for a failure state: `down`, `timeout`, `refusal`, `invalid` (the safe fallback, via "Give me a moment…") or `slow`. The e2e main and weather servers run Kev this way (the weather server with a NZ$20 cap, for Usage's states); the narrow server keeps Kev off. Kev's browser specs are `tests/e2e/kev.spec.ts` and `kev-weather.spec.ts`; screenshots for review come from `tests/e2e/kev-screenshots.spec.ts`, which runs only with `KEV_SHOTS=1`. The preflight token count (`POST /v1/messages/count_tokens`) is on HOME's provider allow-list and every model call is counted first; the tests stub it too. **The retention route** (`POST` or `GET /kev/retention`) deletes messages older than 90 days, for every adult, only with `Authorization: Bearer $CRON_SECRET`; without the header or with a wrong one it answers 401, and with `CRON_SECRET` unset (or not 16–512 printable characters) 404, doing nothing. No schedule calls it (`vercel.json` has no `crons` entry until the owner's G18 decision); to run it by hand locally: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/kev/retention`.

If you already had a Docker volume from before M1.1, create the role once: `docker compose exec postgres psql -U home -d home -f /docker-entrypoint-initdb.d/20-init-app-role.sql`, then `pnpm db:migrate` again so migration `0002_app_role`'s grants apply.

## Everyday commands

| Command | What |
|---|---|
| `pnpm lint` / `pnpm format` | ESLint + Prettier (check / write) |
| `pnpm typecheck` | TypeScript, strict, including tests and scripts (`tsconfig.test.json`) |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against `home_test`: reset and migrated from empty as the owner, then run as `home_app` |
| `pnpm test:e2e` | Playwright; resets `home_test`, seeds the synthetic fixture family into it, and starts three dev servers on :3333, :3334 and :3335, connected as `home_app` (the third, for the weather specs only, has the synthetic home point, a test-only location key and `HOME_TEST_WEATHER=fake`). Screen specs sign in as a fixture adult (`tests/e2e/fixture-adults.ts`) and run the accessibility baseline (`tests/e2e/a11y.ts`). Calendar specs serve synthetic feeds from a temp directory named by `HOME_TEST_CALENDAR_FEEDS` (`tests/e2e/calendar-feeds.ts`); the variable is for local and CI only and is refused on Vercel and under `NODE_ENV=production`. Never set it in a deployed environment |
| `pnpm build` / `pnpm start` | Production build and serve (needs a production-valid env: `provider` mail, https URL) |
| `node scripts/vercel-bundle-check.mjs` | Builds what Vercel would upload (tracked files minus `.vercelignore`) in a temp dir — what the `Vercel bundle build` CI job runs |
| `node scripts/check-boot-validation.mjs <db url>` | After `pnpm build`: proves a misconfigured server fails at boot |
| `pnpm db:generate` | Generate a migration from schema changes (see MIGRATIONS.md) |
| `pnpm db:migrate` | Apply migrations with `DATABASE_URL_MIGRATE` from `.env.local` |
| `pnpm db:studio` | Drizzle Studio against the local database (admin credential) |
| `pnpm db:reset:test` | Drop and re-migrate `home_test` |
| `pnpm db:seed:fixtures` | Load the synthetic fixture family into your **local** database (`DATABASE_URL` from `.env.local`, after `pnpm db:migrate`), through the domain services. Refuses anything that is not a local Postgres, any Vercel environment and `NODE_ENV=production`, before connecting, and never prints the URL (`scripts/seed-guard.mts`). Running it again does nothing. Never run against `home-dev` or production (ADR 0005, D-M2-5). |
| `pnpm verify` | The whole local verification (not routine: see *Verification policy* below), one step at a time: lint, typecheck, unit, integration, build, boot validation, the production CSP check and e2e (`--skip e2e,csp` to leave steps out). Every step's full output is kept in `verify-logs/<step>.log` (gitignored); a failed step prints its failing tests and the end of its output, with the log's path, so a failure can be diagnosed afterwards rather than from a summary line. Never run two suites against `home_test` at once. |
| `pnpm verify:focused` | For routine work: lint, typecheck, then the unit and integration tests vitest reaches through the import graph of what changed since `origin/main` (`--base <ref>` to compare elsewhere; uncommitted work included), then the browser specs the shared risk classifier selects (`scripts/ci-select.mts`, ADR 0010: the specs mapped to a medium change plus the smoke suite; `--e2e people,events` to choose, `--no-e2e` to skip). Same logs as `pnpm verify`. It narrows; it never replaces. It **fails at once** for a high or critical change, including any path no rule names (fail closed), naming each path and its reason: no focused selection proves those, and CI's full regression does. For such a change, run the changed files' own tests directly (`pnpm exec vitest run <files>`). `node scripts/ci-select.mts <path>…` prints the tier and selection CI would make for those paths. |
| `pnpm check:private-terms` | Scan tracked files for terms in `HOME_PRIVATE_TERMS` |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a specific Chromium binary for e2e; where the environment provides one at `/opt/pw-browsers/chromium` (cloud sessions) it is used without asking. `pnpm verify` and `pnpm verify:focused` first clear the dev servers’ caches (`.next`, `.next-narrow`, `.next-weather`): stale ones from an earlier or aborted run break the typecheck with old route types and answer 404 for routes that exist. A plain `pnpm test:e2e` does not clear them; remove both directories by hand if a run fails that way. `TEST_DATABASE_URL` (owner) and `TEST_APP_DATABASE_URL` (`home_app`) point tests at another Postgres; both must be a local host and a database named `*_test`, or the test harness refuses to run (`tests/db-guard.ts`). Tests never inherit `DATABASE_URL` from your shell.

## Verification policy

Verify by risk, not by habit. Local runs and GitHub CI have different jobs.

- **Routine local development** uses focused tests: `pnpm verify:focused`, or the changed files' own tests (`pnpm exec vitest run <files>`), with `pnpm lint` and `pnpm typecheck`.
- **Before a PR:** lint, typecheck, the focused tests for what changed, `pnpm build` where relevant, the Kev evals when Kev changed, and `node scripts/ci-select.mts <changed paths>` for the risk tier. CI owns the full regression whenever the risk classifier requires it.
- **Do not routinely duplicate** full local verification and GitHub CI.
- **A full local suite** (`pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm check:previous-schema`) needs a documented reason, such as reproducing a specific CI failure, and runs under a 20-minute diagnostic timeout: `timeout 20m pnpm verify`. A run that times out is **INCOMPLETE, never PASS**.
- **Before interrupting an existing run,** inspect its process and progress (`ps`, its `verify-logs/<step>.log`).
- **Unmapped or high-risk changes escalate** conservatively: the classifier fails closed, so a path no rule names is high and gets the full regression in CI.
- **Never weaken required CI or branch protection** to gain speed.

## CI (ADR 0010)

CI scopes the browser suite by the risk tier of the pull request; every other job runs in full on every change.

- **Tiers:**
  - **Low** (docs, Markdown, unit and integration tests): no browser tests.
  - **Medium** (established screens, the Forward engine, a changed spec that still exists): the specs of every screen that uses the change plus `tests/e2e/smoke.spec.ts`. Shared code (`_forms`, `_capture`, engines the agenda or a domain service imports) and a deleted or renamed spec are high.
  - **High** (domain services, agenda and recurrence, the shared agenda loader, integrations, shared UI and the shell, and anything unmapped) and **critical** (trust, auth, the database and migrations, CI, scripts, dependencies, the test harness, environment controls, acceptance documents and DEPLOY.md): full regression.
- **How the tier is decided:** the highest-risk path wins, and a path no rule names is high.
- **Full regression always:** on pushes to `main`, the nightly run, manual runs (*Actions → CI → Run workflow*) and any PR labelled `ci:full`. No label lowers a tier.
- **Where to see it:** the `End-to-end (Playwright)` job summary shows the tier, the selection and every changed path's reason.
- **Adding a screen or engine:** add its rule (and specs) to `scripts/ci-select.mts`. Until then it is high and runs everything. `tests/unit/ci-import-coverage.test.ts` then checks the rule against the code's imports: a medium rule must name the specs of every screen that imports it, and must not be imported by high-tier code.

## Notes

- `next dev` runs with `NODE_ENV=development`; `next start` forces `production`, which refuses the `test` mail transport and non-https URLs by design. E2E therefore runs on the dev server.
- Environment is validated at server start by `src/instrumentation.ts` (and lazily by `src/lib/env.ts`); a missing or invalid variable fails fast naming the variable, never its value.
- The sign-in form is the only way to request a link; `/api/auth/*` serves nothing but the magic-link verify endpoint.
- The M0 experience prototype was deleted in M6 Package 1 (ADR 0009 §32). The tag `m0.6-prototype` keeps it: `git checkout m0.6-prototype -- prototype` restores a local copy for reference, never to be committed.
