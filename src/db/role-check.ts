import 'server-only';
import { sql } from 'drizzle-orm';
import type { Db } from './create';

// The application must run as the runtime/app credential (home_app), never
// as the migration/admin credential that owns the tables (M1.1 contract
// §1.7). If the owner credential ever reaches a deployment, the app refuses to
// start rather than running with the power to rewrite the audit log.

export class RuntimeRoleError extends Error {
  constructor() {
    super(
      'The database role HOME is connected as owns audit_log. ' +
        'DATABASE_URL must be the runtime/app credential, never the migration/admin credential.',
    );
    this.name = 'RuntimeRoleError';
  }
}

/** True if `current_user` owns `public.<table>`. */
export async function connectedRoleOwnsTable(db: Db, table: string): Promise<boolean> {
  const r = await db.execute(
    sql`select exists(
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = ${table}
            and pg_get_userbyid(c.relowner) = current_user
        ) as owns`,
  );
  return r.rows[0]?.owns === true;
}

/**
 * On Vercel (`vercelEnv` set: production or preview), throws if the connected
 * role owns the audit table. Elsewhere it is a no-op: local development and
 * tests choose their own credentials.
 */
export async function assertRuntimeRole(db: Db, vercelEnv: string | undefined): Promise<void> {
  if (!vercelEnv) return;
  if (await connectedRoleOwnsTable(db, 'audit_log')) throw new RuntimeRoleError();
}
