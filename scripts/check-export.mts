// node scripts/check-export.mts <file> — validates a HOME export against
// the current version of the format (src/domain/export/spec.ts) for the DEPLOY.md §E
// export check. Prints only the format, version and counts per record type:
// never any record content, since the file may hold real household data.

import { readFileSync } from 'node:fs';
import { exportSchema } from '../src/domain/export/spec.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-export.mts <export.json>');
  process.exit(2);
}
let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  console.error('check-export: not readable JSON');
  process.exit(1);
}
const result = exportSchema.safeParse(parsed);
if (!result.success) {
  // Paths and issue codes only, never values.
  for (const i of result.error.issues.slice(0, 20))
    console.error(`check-export: ${i.code} at ${i.path.map(String).join('.') || '(root)'}`);
  process.exit(1);
}
const e = result.data;
console.log(
  `check-export: valid ${e.format} v${e.version}, sensitive included: ${e.includesSensitive}`,
);
for (const [type, rows] of Object.entries(e.records)) console.log(`  ${type}: ${rows.length}`);
