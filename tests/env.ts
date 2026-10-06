// Test-only environment. No secrets: values are deliberately fake and only ever
// point at the local test database. Applied by tests/setup.ts before any
// src module is imported.
//
// Two credentials, the same role model as production (contract §1.7):
//   TEST_DATABASE_URL      migration/admin credential — used only by global
//                          setup (reset + migrate) and fixture setup.
//   TEST_APP_DATABASE_URL  runtime/app credential (home_app) — what every piece
//                          of application code under test connects with.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://home:home@localhost:5432/home_test';

export const TEST_APP_DATABASE_URL =
  process.env.TEST_APP_DATABASE_URL ?? 'postgres://home_app:home_app@localhost:5432/home_test';

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_APP_DATABASE_URL,
  BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
  BETTER_AUTH_URL: 'http://localhost:3000',
  HOME_ALLOWED_EMAILS: 'sam@example.test,alex@example.test',
  HOME_MAIL_TRANSPORT: 'test',
  AUDIT_HASH_SECRET: 'test-audit-hash-'.repeat(3),
  HOME_TIMEZONE: 'Pacific/Auckland',
  // A synthetic credential key for tests only: 32 fixed bytes, base64. Never
  // used anywhere else; real environments generate their own (DEPLOY.md).
  HOME_CREDENTIALS_KEY: Buffer.from('home-test-credentials-key-32byte').toString('base64'),
  HOME_FINGERPRINT_KEY: Buffer.from('home-test-fingerprint-key-32byte').toString('base64'),
};
