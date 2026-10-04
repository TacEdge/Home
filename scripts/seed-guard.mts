// Where the fixture seed may write (M2 contract §7, D-M2-5): a database on
// this machine, never a hosted one. Preview (home-dev) and production are
// both Neon and both run under Vercel, so each is refused on more than one
// ground. Plain TypeScript with no imports, so the Node launcher and the
// tests share it. A refusal names its reason and never the URL, host,
// user, password or database.

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'] as const;

export type SeedRefusal =
  | 'no_database_url'
  | 'unparseable_url'
  | 'not_postgres'
  | 'host_override'
  | 'vercel_environment'
  | 'production_node_env'
  | 'neon_host'
  | 'not_local_host';

export class SeedRefusedError extends Error {
  readonly reason: SeedRefusal;
  constructor(reason: SeedRefusal) {
    super(`Refusing to seed fixtures: ${reason}. The seed runs only against a local database.`);
    this.name = 'SeedRefusedError';
    this.reason = reason;
  }
}

/** Throws SeedRefusedError unless `url` is a local Postgres and the environment is not hosted. */
export function assertSeedTarget(
  url: string | undefined,
  env: Record<string, string | undefined>,
): void {
  // The environment first: on Vercel (preview or production) nothing is seeded, whatever the URL.
  if (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== '')
    throw new SeedRefusedError('vercel_environment');
  if (env.VERCEL !== undefined && env.VERCEL !== '')
    throw new SeedRefusedError('vercel_environment');
  if (env.NODE_ENV === 'production') throw new SeedRefusedError('production_node_env');
  if (!url) throw new SeedRefusedError('no_database_url');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SeedRefusedError('unparseable_url');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new SeedRefusedError('not_postgres');
  // The driver lets a `host` (or libpq's `hostaddr`) query parameter override
  // the URL's host, so `localhost?host=<remote>` would connect elsewhere.
  // Refuse any such override, whatever its letter case.
  if (hasHostOverride(parsed)) throw new SeedRefusedError('host_override');
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('neon.tech') || host.includes('.neon.'))
    throw new SeedRefusedError('neon_host');
  if (!(LOCAL_HOSTS as readonly string[]).includes(host))
    throw new SeedRefusedError('not_local_host');
}

/** True if the URL's query would override the host the driver connects to. */
export function hasHostOverride(url: URL): boolean {
  return [...url.searchParams.keys()].some((k) =>
    ['host', 'hostaddr'].includes(k.trim().toLowerCase()),
  );
}
