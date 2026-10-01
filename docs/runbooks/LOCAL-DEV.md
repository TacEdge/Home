# Runbook — Local development

## Requirements

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10`)
- Docker (for Postgres), or a local Postgres 16 with databases `home` and `home_test` owned by role `home`/`home`
- Chromium for Playwright (`pnpm exec playwright install chromium` once)

## First run

```sh
pnpm install
docker compose up -d                      # Postgres on :5432 with home + home_test
cp .env.example .env.local                # fill in values; never commit this file
#   BETTER_AUTH_SECRET and AUDIT_HASH_SECRET: `openssl rand -base64 48`
#   HOME_ALLOWED_EMAILS: the household's addresses (or the fixture ones for a sandbox)
#   HOME_MAIL_TRANSPORT=test              # magic links are written to a mailbox file
pnpm db:migrate                           # applies src/db/migrations to DATABASE_URL
pnpm dev                                  # http://localhost:3000
```

With `HOME_MAIL_TRANSPORT=test`, sign-in links are appended to `<tmpdir>/home-test-mailbox.jsonl` (macOS: `$TMPDIR/home-test-mailbox.jsonl`; Linux: `/tmp/...`). Open the link from there.

## Everyday commands

| Command | What |
|---|---|
| `pnpm lint` / `pnpm format` | ESLint + Prettier (check / write) |
| `pnpm typecheck` | TypeScript, strict |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against `home_test` (reset and migrated from empty each run) |
| `pnpm test:e2e` | Playwright; starts two dev servers on :3333 and :3334 |
| `pnpm build` / `pnpm start` | Production build and serve (needs a production-valid env: `provider` mail, https URL) |
| `pnpm db:generate` | Generate a migration from schema changes (see MIGRATIONS.md) |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` from `.env.local` |
| `pnpm db:studio` | Drizzle Studio against the local database |
| `pnpm db:reset:test` | Drop and re-migrate `home_test` |
| `pnpm check:private-terms` | Scan tracked files for terms in `HOME_PRIVATE_TERMS` |

Set `PLAYWRIGHT_CHROMIUM_PATH` to use a specific Chromium binary for e2e; `TEST_DATABASE_URL` to point tests at another Postgres.

## Notes

- `next dev` runs with `NODE_ENV=development`; `next start` forces `production`, which refuses the `test` mail transport and non-https URLs by design. E2E therefore runs on the dev server.
- Environment is validated at startup by `src/lib/env.ts`; a missing or invalid variable fails fast naming the variable.
- `/prototype` is reference only. It is not linted, built, tested or deployed.
