// Runs once when the Next.js server starts (not at build). The checks here
// make a misconfigured deployment fail at boot, visibly, instead of on its
// first request. Only the Node runtime applies: HOME has no edge code.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ env }, { getDb }, { assertRuntimeRole }] = await Promise.all([
    import('@/lib/env'),
    import('@/db/client'),
    import('@/db/role-check'),
  ]);
  // The owner credential must never run the app (contract §1.7).
  await assertRuntimeRole(getDb(), env.VERCEL_ENV);
}
