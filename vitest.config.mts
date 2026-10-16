import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));
const serverOnlyStub = fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url));

// Unit tests are pure Node. Integration tests (added in M1 step 5) run against a
// real Postgres and live under tests/integration.
export default defineConfig({
  resolve: {
    alias: {
      '@': src,
      // `server-only` throws outside Next's server bundle; in tests it is inert.
      'server-only': serverOnlyStub,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          setupFiles: ['tests/setup.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
        },
      },
      {
        // `pnpm db:seed:fixtures` only (scripts/seed-fixtures.mts): never part
        // of a test run, and refuses to start without the launcher's flag.
        extends: true,
        test: {
          name: 'seed',
          include: ['tests/seed/seed.run.ts'],
          environment: 'node',
          // Deliberately without tests/setup.ts, which points DATABASE_URL at
          // the test database: the seed writes to the developer's own local
          // database, after its guard.
        },
      },
      {
        // The Kev live verification runner and the G16 script only
        // (scripts/kev-live/run.mts, g16-pooled.mts): never part of a test
        // run, and each refuses to start without its launcher's flag. No
        // tests/setup.ts: they use their own guarded database.
        extends: true,
        test: {
          name: 'kev-live',
          include: ['scripts/kev-live/*.live.ts'],
          environment: 'node',
          testTimeout: 60 * 60_000,
        },
      },
    ],
  },
});
