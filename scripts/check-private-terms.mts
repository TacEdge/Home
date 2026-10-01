// Fails if any private term appears in tracked files. The terms come from the
// HOME_PRIVATE_TERMS secret (comma-separated, matched case-insensitively) so
// the list itself never enters the repository. Skips cleanly when unset.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const raw = process.env.HOME_PRIVATE_TERMS ?? '';
const terms = raw
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter((t) => t.length >= 3);

if (terms.length === 0) {
  console.log('check-private-terms: HOME_PRIVATE_TERMS not set; skipping.');
  process.exit(0);
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !f.startsWith('pnpm-lock') && !/\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(f));

let hits = 0;
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8').toLowerCase();
  } catch {
    continue;
  }
  for (const term of terms) {
    if (text.includes(term)) {
      // Report the file and which term index matched — never the term itself.
      console.error(`private term #${terms.indexOf(term) + 1} found in ${file}`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`check-private-terms: ${hits} hit(s). Remove private information before merging.`);
  process.exit(1);
}
console.log(`check-private-terms: clean (${files.length} files, ${terms.length} terms).`);
