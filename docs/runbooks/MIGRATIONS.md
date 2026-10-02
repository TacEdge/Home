# Runbook — Database migrations

Drizzle Kit, forward-only, expand-then-contract (ADR 0003 §3). Deploy and migrate are **not atomic**: the app may run one version ahead of or behind the schema for a few minutes, so every migration must be safe against the previous and the next app version.

Migrations always run with the **migration/admin credential** (`DATABASE_URL_MIGRATE`): the privileged database role used only for migrations and database administration. The application's own **runtime/app credential** (`DATABASE_URL`, role `home_app`) cannot create or alter anything, by design (M1.1 contract §1.7).

## Making a change

1. Edit the schema under `src/db/schema/` (new tables need an entry in `docs/FAMILY-DATA-MODEL.md`).
2. `pnpm db:generate` — review the generated SQL in `src/db/migrations/NNNN_*.sql`. Hand-written SQL (triggers, functions, grants) goes in the same file after a `--> statement-breakpoint`, or in a `drizzle-kit generate --custom` migration.
3. `pnpm db:migrate` locally (uses `DATABASE_URL_MIGRATE` from `.env.local`); `pnpm test:integration` (migrates `home_test` from empty as the admin role and then runs the suite as `home_app`, so the whole chain and the grants are exercised).
4. Commit the SQL **and** `src/db/migrations/meta/` together. Never edit a migration that has reached `main`.

## Rules

- **Expand first**: add columns as nullable or with defaults; add new tables; backfill. Only drop or tighten (**contract**) in a later release, once no deployed code uses the old shape.
- No destructive change without a tested restore (see DEPLOY.md, backups).
- `audit_log` rows are never updated or deleted: `home_app` has no privilege to, and the trigger refuses even the owner.
- **Append-only tables:** migration `0002_app_role` sets default privileges so every new table is readable and writable by `home_app`. A migration that creates an **append-only** table must therefore add, after the `CREATE TABLE`:
  ```sql
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'home_app') THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "<table>" FROM home_app;
    END IF;
  END $$;
  ```
  and an append-only trigger like `audit_log`'s. Add an integration test in `tests/integration/app-role.test.ts` proving the revoke.
- Role-dependent SQL is always guarded by `IF EXISTS (… pg_roles … 'home_app')`, so the same migration works wherever the role has not been created.

## Applying to production

Automatic: a push to `main` that touches `src/db/migrations/**` runs `.github/workflows/migrate.yml`, which only runs from `main`, waits for a reviewer in the `production` GitHub environment, then runs `drizzle-kit migrate` with `DATABASE_URL_MIGRATE` (the `home` project's migration/admin credential, Neon **direct** connection, not the pooled one). Manual: *Actions → Migrate production database → Run workflow* on `main`; a dispatch from any other branch does nothing.

Order on a release that changes the schema: merge → migration workflow (approve) → Vercel deploy completes. Because of expand-then-contract either order is safe, but approving the migration promptly keeps the window short.

## Previews and the `home-dev` project

Preview deployments use the **`home-dev` Neon project**, a completely separate project from production, with its own runtime/app and migration/admin credentials. It is **never** derived from, reset from, or branched from production: once real household data exists, nothing may copy it into the database that unreviewed branches run against.

Apply migrations there with the **Migrate preview database** workflow (`.github/workflows/migrate-preview.yml`): *Actions → Migrate preview database → Run workflow* on `main`. It is dispatch-only (previews do not auto-migrate on merge), runs only from `main`, and uses the `preview` GitHub environment, whose `DATABASE_URL_MIGRATE` secret is the `home-dev` project's own migration/admin credential (direct connection). It never has access to the `production` environment or its secret; that is a different workflow (`migrate.yml`). No local machine is needed.

Run it whenever a migration has merged and a preview needs the new schema.

**Rebuilding `home-dev`** when it drifts or needs a clean slate:

1. In the Neon console for `home-dev`, SQL Editor, as the owner role: `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`
2. Dispatch **Migrate preview database** from `main`.
3. Fixtures: none. Users are created on first sign-in from the preview allowlist. M2's fixture seed runs against local and CI databases only and refuses any other host (ADR 0005); seeding `home-dev` is a later decision, and would load the synthetic fixture family only, never real data.
