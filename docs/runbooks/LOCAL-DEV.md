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
#   HOME_ALLOWED_EMAILS: the household's addresses (or the fixture ones for a sandbox)
#   HOME_MAIL_TRANSPORT=test              # magic links are written to a mailbox file
pnpm db:migrate                           # applies src/db/migrations with DATABASE_URL_MIGRATE
pnpm dev                                  # http://localhost:3000
```

With `HOME_MAIL_TRANSPORT=test`, sign-in links are appended to `<tmpdir>/home-test-mailbox.jsonl` (macOS: `$TMPDIR/home-test-mailbox.jsonl`; Linux: `/tmp/...`). Open the link from there.

If you already had a Docker volume from before M1.1, create the role once: `docker compose exec postgres psql -U home -d home -f /docker-entrypoint-initdb.d/20-init-app-role.sql`, then `pnpm db:migrate` again so migration `0002_app_role`'s grants apply.

## Everyday commands

| Command | What |
|---|---|
| `pnpm lint` / `pnpm format` | ESLint + Prettier (check / write) |
| `pnpm typecheck` | TypeScript, strict, including tests and scripts (`tsconfig.test.json`) |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against `home_test`: reset and migrated from empty as the owner, then run as `home_app` |
| `pnpm test:e2e` | Playwright; starts two dev servers on :3333 and :3334, connected as `home_app` |
| `pnpm build` / `pnpm start` | Production build and serve (needs a production-valid env: `provider` mail, https URL) |
| `node scripts/vercel-bundle-check.mjs` | Builds what Vercel would upload (tracked files minus `.vercelignore`) in a temp dir — what the `Vercel bundle build` CI job runs |
| `node scripts/check-boot-validation.mjs <db url>` | After `pnpm build`: proves a misconfigured server fails at boot |
| `pnpm db:generate` | Generate a migration from schema changes (see MIGRATIONS.md) |
| `pnpm db:migrate` | Apply migrations with `DATABASE_URL_MIGRATE` from `.env.local` |
| `pnpm db:studio` | Drizzle Studio against the local database (admin credential) |
| `pnpm db:reset:test` | Drop and re-migrate `home_test` |
| `pnpm check:private-terms` | Scan tracked files for terms in `HOME_PRIVATE_TERMS` |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a specific Chromium binary for e2e. `TEST_DATABASE_URL` (owner) and `TEST_APP_DATABASE_URL` (`home_app`) point tests at another Postgres; both must be a local host and a database named `*_test`, or the test harness refuses to run (`tests/db-guard.ts`). Tests never inherit `DATABASE_URL` from your shell.

## Notes

- `next dev` runs with `NODE_ENV=development`; `next start` forces `production`, which refuses the `test` mail transport and non-https URLs by design. E2E therefore runs on the dev server.
- Environment is validated at server start by `src/instrumentation.ts` (and lazily by `src/lib/env.ts`); a missing or invalid variable fails fast naming the variable, never its value.
- The sign-in form is the only way to request a link; `/api/auth/*` serves nothing but the magic-link verify endpoint.
- `/prototype` is reference only. It is not linted, built, tested or deployed.
