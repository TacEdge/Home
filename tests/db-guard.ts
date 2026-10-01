// The only databases the test harness may touch (M1.1 contract §1.6, I4).
// Every destructive or test entry point calls this before opening a
// connection, so a stray DATABASE_URL in a shell can never point the suite at
// a real database. Errors name the reason and never echo credentials.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

export class NotATestDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing to use this database for tests: ${reason}.`);
    this.name = 'NotATestDatabaseError';
  }
}

/** Throws unless `url` points at a local host and a database named `*_test`. */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) throw new NotATestDatabaseError('no database URL was given');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NotATestDatabaseError('the URL could not be parsed');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new NotATestDatabaseError('the URL is not a postgres:// URL');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new NotATestDatabaseError('the host is not a local test host');
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new NotATestDatabaseError('the database name does not end in _test');
  }
  return url;
}
