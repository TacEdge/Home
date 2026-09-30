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
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
        },
      },
    ],
  },
});
