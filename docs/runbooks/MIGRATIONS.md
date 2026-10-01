# Runbook — Database migrations

Drizzle Kit, forward-only, expand-then-contract (ADR 0003 §3). Deploy and migrate are **not atomic**: the app may run one version ahead of or behind the schema for a few minutes, so every migration must be safe against the previous and the next app version.

## Making a change

1. Edit the schema under `src/db/schema/` (new tables need an entry in `docs/FAMILY-DATA-MODEL.md`).
2. `DATABASE_URL=<local> pnpm db:generate` — review the generated SQL in `src/db/migrations/NNNN_*.sql`. Hand-written SQL (triggers, functions) goes in the same file after a `--> statement-breakpoint`.
3. `pnpm db:migrate` locally; `pnpm test:integration` (migrates `home_test` from empty, so the whole chain is exercised).
4. Commit the SQL **and** `src/db/migrations/meta/` together. Never edit a migration that has reached `main`.

## Rules

- **Expand first**: add columns as nullable or with defaults; add new tables; backfill. Only drop or tighten (**contract**) in a later release, once no deployed code uses the old shape.
- No destructive change without a tested restore (see DEPLOY.md, backups).
- `audit_log` rows are never updated or deleted; the trigger will refuse.

## Applying to production

Automatic: a push to `main` that touches `src/db/migrations/**` runs `.github/workflows/migrate.yml`, which waits for a reviewer in the `production` GitHub environment, then runs `drizzle-kit migrate` with `DATABASE_URL_MIGRATE` (Neon **direct** connection, not the pooled one). Manual: *Actions → Migrate production database → Run workflow*.

Order on a release that changes the schema: merge → migration workflow (approve) → Vercel deploy completes. Because of expand-then-contract either order is safe, but approving the migration promptly keeps the window short.

## Previews

Preview deployments point at the Neon `dev` branch. Apply migrations there with `DATABASE_URL=<dev direct url> pnpm exec drizzle-kit migrate` from a trusted machine, or reset the branch from `main` in Neon when it drifts.
