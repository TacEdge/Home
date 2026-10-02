# Runbook — Database migrations

Drizzle Kit, forward-only, expand-then-contract (ADR 0003 §3). Deploy and migrate are **not atomic**: Vercel deploys `main` on merge, while the production migration waits for an owner's approval. Two rules cover the two directions:

- **Expand-then-contract** keeps the app already deployed working on the *newer* schema: migrations are additive.
- **Migration-first** (ADR 0005 §16) keeps *new* code from running on the *older* schema: code that needs new schema merges only after that schema is live in production.

Migrations always run with the **migration/admin credential** (`DATABASE_URL_MIGRATE`): the privileged database role used only for migrations and database administration. The application's own **runtime/app credential** (`DATABASE_URL`, role `home_app`) cannot create or alter anything, by design (M1.1 contract §1.7).

## Making a change

1. Edit the schema under `src/db/schema/` (new tables need an entry in `docs/FAMILY-DATA-MODEL.md`).
2. `pnpm db:generate` — review the generated SQL in `src/db/migrations/NNNN_*.sql`. Hand-written SQL (triggers, functions, grants) goes in the same file after a `--> statement-breakpoint`, or in a `drizzle-kit generate --custom` migration.
3. `pnpm db:migrate` locally (uses `DATABASE_URL_MIGRATE` from `.env.local`); `pnpm test:integration` (migrates `home_test` from empty as the admin role and then runs the suite as `home_app`, so the whole chain and the grants are exercised).
4. Commit the SQL **and** `src/db/migrations/meta/` together. Never edit a migration that has reached `main`.

## Migration-first: schema before the code that needs it

1. A migration that introduces schema required by new application code lands in a **migration-only PR**.
2. That PR contains **no application code that requires the new schema**: only the migration, its Drizzle schema definitions, migration and privilege tests, and code that works on both the old and the new schema. Adding a column to an *existing* table's Drizzle definition changes every query that selects or returns all of that table's columns, so those queries must name their columns first.
3. After review and green CI, the owner merges it to `main`.
4. The production migration runs only through **Migrate production database**, approved by the owner (below).
5. **Only after that run succeeds** may the application PR that depends on the schema merge. Its description links the successful run. Dispatch **Migrate preview database** too, so the application PR's preview on `home-dev` has the schema.
6. `recordAudit` returns only the columns its caller needs (`id` unless another field is explicitly required), so sign-in and auditing never depend on a future additive `audit_log` column.
7. CI's **previous-schema compatibility check** runs the PR's code (at least the sign-in gate, session, auth and audit integration suites and boot validation, as `home_app`) against a database built from the base branch's migrations only. It fails a PR whose application code needs schema that `main` does not yet have.

A change with no schema dependency is one ordinary PR. Nothing here relaxes the rules below.

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

Order for a schema-dependent change (migration-first, above):

1. Merge the **migration-only PR**. Vercel redeploys; the app does not use the new schema yet, so nothing changes.
2. Approve **Migrate production database**; confirm the run succeeded.
3. Merge the **application PR** that uses the schema. Vercel deploys code that now finds its schema already in place.

Never merge an application PR that needs schema whose production migration has not yet succeeded. A migration PR's own deploy is safe in either order by expand-then-contract.

## Previews and the `home-dev` project

Preview deployments use the **`home-dev` Neon project**, a completely separate project from production, with its own runtime/app and migration/admin credentials. It is **never** derived from, reset from, or branched from production: once real household data exists, nothing may copy it into the database that unreviewed branches run against.

Apply migrations there with the **Migrate preview database** workflow (`.github/workflows/migrate-preview.yml`): *Actions → Migrate preview database → Run workflow* on `main`. It is dispatch-only (previews do not auto-migrate on merge), runs only from `main`, and uses the `preview` GitHub environment, whose `DATABASE_URL_MIGRATE` secret is the `home-dev` project's own migration/admin credential (direct connection). It never has access to the `production` environment or its secret; that is a different workflow (`migrate.yml`). No local machine is needed.

Run it whenever a migration has merged and a preview needs the new schema.

**Rebuilding `home-dev`** when it drifts or needs a clean slate:

1. In the Neon console for `home-dev`, SQL Editor, as the owner role: `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`
2. Dispatch **Migrate preview database** from `main`.
3. Fixtures: none. Users are created on first sign-in from the preview allowlist. M2's fixture seed runs against local and CI databases only and refuses any other host (ADR 0005); seeding `home-dev` is a later decision, and would load the synthetic fixture family only, never real data.
