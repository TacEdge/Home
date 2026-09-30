// Runs in every Vitest worker before test files. Sets a fake, complete
// environment so src/lib/env parses, pointed at the local test database.
import { testEnv } from './env';

for (const [k, v] of Object.entries(testEnv)) {
  process.env[k] ??= v;
}
