import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads DATABASE_URL from the process environment. Scripts pass it
// with `node --env-file` (see package.json); CI and Vercel set it directly.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
