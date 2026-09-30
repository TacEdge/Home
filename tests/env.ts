// Test-only environment. No secrets: values are deliberately fake and only ever
// point at the local test database. Applied by tests/setup.ts before any
// src module is imported.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://home:home@localhost:5432/home_test';

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  BETTER_AUTH_SECRET: 'test-secret-'.repeat(4),
  BETTER_AUTH_URL: 'http://localhost:3000',
  HOME_ALLOWED_EMAILS: 'sam@example.test,alex@example.test',
  HOME_MAIL_TRANSPORT: 'test',
  AUDIT_HASH_SECRET: 'test-audit-hash-'.repeat(3),
  HOME_TIMEZONE: 'Pacific/Auckland',
};
