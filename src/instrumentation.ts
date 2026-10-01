// Runs once when the Next.js server starts (not at build). The checks here
// make a misconfigured deployment fail at boot, visibly in the runtime logs,
// instead of on its first request (M1.1 contract §2.6, §1.7). Only the Node
// runtime applies: HOME has no edge code.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { parseEnv } = await import('@/lib/env');
  // Throws EnvError naming the bad variables (never their values).
  const env = parseEnv(process.env);
  const [{ getDb }, { assertRuntimeRole }] = await Promise.all([
    import('@/db/client'),
    import('@/db/role-check'),
  ]);
  // The owner credential must never run the app (contract §1.7).
  await assertRuntimeRole(getDb(), env.VERCEL_ENV);
}
