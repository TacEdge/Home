// Proves that a misconfigured deployment fails at boot (M1.1 contract §2.6).
// Runs `next start` twice against the already-built app: once with a complete
// environment (the control: /sign-in must answer 200), once with a required
// variable missing (the server must exit non-zero or never answer a request
// successfully). Needs `pnpm build` first and a reachable database for the
// control case, given as the first argument or DATABASE_URL.
import { spawn } from 'node:child_process';

const dbUrl = process.argv[2] ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('check-boot-validation: pass the database URL as the first argument.');
  process.exit(2);
}

const complete = {
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: dbUrl,
  BETTER_AUTH_SECRET: 'boot-check-secret-'.repeat(3),
  BETTER_AUTH_URL: 'https://home.example.test',
  HOME_ALLOWED_EMAILS: 'sam@example.test',
  HOME_MAIL_TRANSPORT: 'provider',
  MAIL_API_KEY: 'boot-check-not-a-real-key',
  MAIL_FROM: 'home@auth.example.test',
  AUDIT_HASH_SECRET: 'boot-check-audit-'.repeat(3),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts the server; resolves with the first HTTP status seen, or the exit code. */
async function boot(env, port, timeoutMs) {
  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  let exitCode = null;
  child.on('exit', (code) => (exitCode = code ?? 1));
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (exitCode !== null) return { exit: exitCode, output };
      try {
        const res = await fetch(`http://127.0.0.1:${port}/sign-in`, { redirect: 'manual' });
        return { status: res.status, output };
      } catch {
        await sleep(300);
      }
    }
    return { timeout: true, output };
  } finally {
    child.kill('SIGTERM');
    await sleep(200);
    child.kill('SIGKILL');
  }
}

const control = await boot(complete, 3123, 30_000);
if (control.status !== 200) {
  console.error('check-boot-validation: the control server did not answer 200:', control);
  process.exit(1);
}
console.log('check-boot-validation: control boots and answers 200.');

const incomplete = { ...complete };
delete incomplete.BETTER_AUTH_SECRET;
const broken = await boot(incomplete, 3124, 15_000);
const refused = broken.exit !== undefined ? broken.exit !== 0 : broken.status !== 200;
if (!refused) {
  console.error(
    'check-boot-validation: a server missing BETTER_AUTH_SECRET served a request:',
    broken,
  );
  process.exit(1);
}
if (!/BETTER_AUTH_SECRET/.test(broken.output)) {
  console.error(
    'check-boot-validation: the boot failure did not name the missing variable:',
    broken,
  );
  process.exit(1);
}
console.log(
  `check-boot-validation: a misconfigured server refuses to serve (${broken.exit !== undefined ? `exit ${broken.exit}` : broken.timeout ? 'no response' : `status ${broken.status}`}) and names the variable.`,
);
