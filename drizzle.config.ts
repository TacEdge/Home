import { defineConfig } from 'drizzle-kit';

// drizzle-kit connects with the migration/admin credential, DATABASE_URL_MIGRATE
// (the privileged role used only for migrations and database administration).
// It falls back to DATABASE_URL for a one-off `pnpm db:generate`, which needs
// no connection. Scripts pass the environment with `node --env-file` (see
// package.json); the migration workflow sets it from a GitHub secret. The
// application's own DATABASE_URL is the runtime/app credential and cannot
// run migrations (M1.1 contract §1.7).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
