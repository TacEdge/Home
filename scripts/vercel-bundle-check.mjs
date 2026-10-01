// Proves that what Vercel uploads actually builds (M1.1 contract §1.2, B2).
//
// Vercel uploads the repository minus the paths in .vercelignore, so a file
// that survives the upload but imports an ignored one breaks the deployment
// while `pnpm build` in a full checkout stays green. This script rebuilds that
// filtered upload in a temporary directory and runs a real install and build
// there. It is plain Node with no dependencies, so it can run before install.
//
// Only the plain path and prefix patterns HOME uses are supported; anything
// resembling a glob or negation fails loudly rather than silently diverging
// from Vercel's behaviour.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const keep = process.argv.includes('--keep');
const root = process.cwd();

function parseIgnore(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/[*?[\]{}!\\]/.test(line)) {
      throw new Error(
        `.vercelignore pattern "${line}" is not a plain path; extend this script before using it.`,
      );
    }
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
    const pattern = line.replace(/^\//, '').replace(/\/$/, '');
    rules.push({ pattern, anchored });
  }
  return rules;
}

// .vercelignore follows .gitignore rules for the subset we accept: a pattern
// with no slash matches a file or directory of that name at any depth; a
// pattern with a slash is anchored at the repository root.
function ignored(file, rules) {
  const segments = file.split('/');
  return rules.some(({ pattern, anchored }) =>
    anchored ? file === pattern || file.startsWith(pattern + '/') : segments.includes(pattern),
  );
}

const rules = parseIgnore(readFileSync(join(root, '.vercelignore'), 'utf8'));
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const upload = tracked.filter((f) => !ignored(f, rules));

const dir = mkdtempSync(join(tmpdir(), 'home-vercel-bundle-'));
console.log(`vercel-bundle-check: ${upload.length} of ${tracked.length} tracked files → ${dir}`);
for (const file of upload) {
  mkdirSync(join(dir, dirname(file)), { recursive: true });
  copyFileSync(join(root, file), join(dir, file));
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CI: '1' },
  });
  if (r.status !== 0) {
    console.error(`vercel-bundle-check: "${cmd} ${args.join(' ')}" failed in the filtered upload.`);
    if (!keep) rmSync(dir, { recursive: true, force: true });
    process.exit(r.status ?? 1);
  }
};

run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['build']);
if (!keep) rmSync(dir, { recursive: true, force: true });
console.log('vercel-bundle-check: the filtered upload builds.');
