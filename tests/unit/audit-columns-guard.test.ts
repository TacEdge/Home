import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compatSuites } from '../../scripts/check-previous-schema.mts';

// M2 contract §2.1 rules 2 and 6: every query on audit_log names its
// columns. Under migration-first, a migration PR can add a column to the
// Drizzle definition before production has run the migration; any query
// that covers "all columns" then names a column the database lacks and fails
// on the sign-in path. Drizzle's insert lists every defined column, so it
// counts too. This guard holds for application code and for the suites the
// previous-schema check runs.

type Finding = { rule: string; excerpt: string };

/** Statements on audit_log that would depend on every column the definition has. */
export function implicitAuditColumns(source: string): Finding[] {
  const findings: Finding[] = [];
  const statements = source.split(';');
  for (const st of statements) {
    const onAudit =
      /\.(from|insert|update|delete)\(\s*auditLog\s*\)/.test(st) || /query\.auditLog/.test(st);
    const excerpt = st.trim().slice(0, 120);
    if (onAudit && /\.select\(\s*\)/.test(st))
      findings.push({ rule: 'select() with no columns', excerpt });
    if (onAudit && /\.returning\(\s*\)/.test(st))
      findings.push({ rule: 'returning() with no columns', excerpt });
    if (/\.insert\(\s*auditLog\s*\)/.test(st))
      findings.push({ rule: 'Drizzle insert lists every column', excerpt });
    if (/query\.auditLog/.test(st))
      findings.push({ rule: 'relational query selects every column', excerpt });
    if (/select\s+\*\s+from\s+(public\.)?"?audit_log"?/i.test(st))
      findings.push({ rule: 'select * from audit_log', excerpt });
    if (/into\s+(public\.)?"?audit_log"?[\s\S]*returning\s+\*/i.test(st))
      findings.push({ rule: 'returning * on audit_log', excerpt });
    if (/insert\s+into\s+(public\.)?"?audit_log"?\s+(values|select)\b/i.test(st))
      findings.push({ rule: 'insert into audit_log without a column list', excerpt });
  }
  return findings;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('the audit_log column guard', () => {
  it.each([
    ['db.select().from(auditLog).where(x)', 'select() with no columns'],
    ['db.insert(auditLog).values(v).returning()', 'returning() with no columns'],
    ['db.insert(auditLog).values(v)', 'Drizzle insert lists every column'],
    ['db.query.auditLog.findMany()', 'relational query selects every column'],
    ['sql`select * from audit_log`', 'select * from audit_log'],
    ['sql`insert into audit_log (event) values (1) returning *`', 'returning * on audit_log'],
    ['sql`insert into audit_log values (1)`', 'insert into audit_log without a column list'],
  ])('catches %s', (code, rule) => {
    expect(implicitAuditColumns(code).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    'db.select(auditRowColumns).from(auditLog).where(x)',
    'db.select({ id: auditLog.id }).from(auditLog)',
    'sql`insert into audit_log (actor_via, event) values (${a}, ${b}) returning id`',
    'db.update(auditLog).set({ summary: x }).where(y)',
    'db.select().from(person)',
    'db.insert(person).values(v).returning()',
  ])('allows %s', (code) => {
    expect(implicitAuditColumns(code)).toEqual([]);
  });

  it('finds nothing in application code', () => {
    const files = walk('src').filter(
      (f) => /\.(ts|tsx)$/.test(f) && !f.includes('/db/migrations/'),
    );
    const found = files.flatMap((f) =>
      implicitAuditColumns(readFileSync(f, 'utf8')).map((x) => `${f}: ${x.rule}`),
    );
    expect(found).toEqual([]);
  });

  it('finds nothing in the suites the previous-schema check runs', () => {
    const files = compatSuites(readdirSync('tests/integration'));
    expect(files.length).toBeGreaterThan(3);
    const found = files.flatMap((f) =>
      implicitAuditColumns(readFileSync(f, 'utf8')).map((x) => `${f}: ${x.rule}`),
    );
    expect(found).toEqual([]);
  });
});
