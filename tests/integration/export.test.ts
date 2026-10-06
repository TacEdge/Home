import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotPermittedError } from '@/domain/common/errors';
import { exportFor } from '@/domain/export/service';
import { EXPORT_TYPES, exportSchema, type ExportType, type HomeExport } from '@/domain/export/spec';
import { env } from '@/lib/env';
import { systemActor, type UserActor } from '@/trust/actor';
import { listAudit } from '@/trust/audit';
import { CANARY_MARK } from '../fixtures/family';
import {
  ARCHIVED_MARK,
  SENSITIVE_MARK,
  seedFixtureFamily,
  type SeedManifest,
} from '../fixtures/seed';
import { adminDb, testDb } from './db';
import { clearDomainRows } from './fixtures';

// The export (ADR 0006 §6, M3 contract §7.1), over the seeded synthetic
// family with each adult's private canaries, archived canaries and
// sensitive context.

const { db, close } = testDb();
const admin = adminDb();
const deps = { db };
let seed: Required<SeedManifest>;
type Adult = 'sam' | 'alex';
const OTHER: Record<Adult, Adult> = { sam: 'alex', alex: 'sam' };
const ADULTS: Adult[] = ['sam', 'alex'];
const actor = (a: Adult, via: 'ui' | 'kev' = 'ui'): UserActor => ({ ...seed.actors[a], via });
const text = (e: HomeExport) => JSON.stringify(e);
const ids = (e: HomeExport, t: ExportType) => e.records[t].map((r) => r.id);

beforeAll(async () => {
  await clearDomainRows(db);
  const s = await seedFixtureFamily(db);
  if (s.status !== 'seeded') throw new Error('the export suite needs a fresh seed');
  seed = s as Required<SeedManifest>;
});
afterAll(async () => {
  await clearDomainRows(db);
  await close();
  await admin.close();
});

describe.each(ADULTS)('%s’s default export', (a) => {
  let e: HomeExport;
  beforeAll(async () => {
    e = await exportFor(actor(a), {}, deps);
  });

  it('is a valid file of the current version', () => {
    expect(exportSchema.parse(JSON.parse(text(e)))).toBeTruthy();
    expect(e.format).toBe('home-export');
    expect(e.version).toBe(2);
    expect(e.timeZone).toBe(env.HOME_TIMEZONE);
    expect(e.includesSensitive).toBe(false);
    expect(Object.keys(e.records)).toEqual(Object.keys(EXPORT_TYPES));
  });

  it('names the adult’s own linked person', () => {
    const self = e.records.people.find((p) => p.userId === seed.actors[a].userId);
    expect(e.exportedBy.personId).toBe(self?.id ?? null);
    expect(e.exportedBy.personId).not.toBeNull();
  });

  it('carries every one of the adult’s own private canaries, with their ids', () => {
    const c = seed.canaries[a];
    expect(ids(e, 'people')).toContain(c.person);
    expect(ids(e, 'events')).toContain(c.event);
    expect(ids(e, 'projects')).toContain(c.project);
    expect(ids(e, 'tasks')).toContain(c.task);
    expect(ids(e, 'notes')).toContain(c.note);
    expect(ids(e, 'context')).toContain(c.context);
    expect(ids(e, 'captures')).toContain(c.capture);
    expect(ids(e, 'proposals')).toContain(c.proposal);
    expect(ids(e, 'conversations')).toContain(c.conversation);
    expect(ids(e, 'messages')).toContain(c.userMessage);
    expect(e.records.insightResponses.map((r) => r.insightKey)).toContain(c.insightKey);
    expect(e.records.eventPeople.some((r) => r.eventId === c.event)).toBe(true);
    expect(text(e)).toContain(`${CANARY_MARK[a]}capture: remember the surprise`);
  });

  it('never carries the other adult’s private records or their runs', () => {
    expect(text(e)).not.toContain(CANARY_MARK[OTHER[a]]);
    const other = seed.canaries[OTHER[a]];
    for (const id of Object.values(other)) expect(text(e)).not.toContain(id);
    for (const r of e.records.kevUsage) expect(r.userId).toBe(seed.actors[a].userId);
    for (const r of e.records.insightResponses) expect(r.userId).toBe(seed.actors[a].userId);
    for (const r of e.records.conversations) expect(r.userId).toBe(seed.actors[a].userId);
  });

  it('leaves sensitive context out', () => {
    expect(text(e)).not.toContain(SENSITIVE_MARK);
    expect(ids(e, 'context')).not.toContain(seed.sensitive.household);
    expect(ids(e, 'context')).not.toContain(seed.sensitive.private);
    expect(e.records.context.every((r) => r.sensitivity === 'normal')).toBe(true);
  });

  it('includes archived records, marked by archivedAt', () => {
    for (const [type, id] of Object.entries(seed.archived)) {
      const t = (
        {
          person: 'people',
          event: 'events',
          project: 'projects',
          task: 'tasks',
          note: 'notes',
          context: 'context',
          capture: 'captures',
          conversation: 'conversations',
        } as Record<string, ExportType>
      )[type]!;
      const row = e.records[t].find((r) => r.id === id);
      if (type === 'capture' || type === 'conversation') {
        // Owner-only: only Sam (who made them) has them.
        expect(Boolean(row), `${type} for ${a}`).toBe(a === 'sam');
        if (!row) continue;
      }
      expect(row, type).toBeTruthy();
      expect(row!.archivedAt, type).toEqual(expect.any(String));
    }
    expect(text(e)).toContain(ARCHIVED_MARK);
  });

  it('is in stable order: each type by its sort column, then id', () => {
    for (const t of Object.keys(EXPORT_TYPES) as ExportType[]) {
      const key = EXPORT_TYPES[t].sortBy;
      const rows = e.records[t].map((r) => [String(r[key] ?? ''), String(r.id)] as const);
      const sorted = [...rows].sort((x, y) =>
        x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1,
      );
      expect(rows, t).toEqual(sorted);
    }
  });

  it('includes the adult’s Activity exactly as Activity shows it', async () => {
    const shown: string[] = [];
    let before;
    for (;;) {
      const page = await listAudit(actor(a), { limit: 200, before }, deps);
      shown.push(...page.rows.map((r) => r.id));
      if (!page.next) break;
      before = page.next;
    }
    // The download's own row is written after Activity is read.
    const exported = new Set(ids(e, 'activity'));
    expect(shown.filter((id) => !exported.has(id)).length).toBeLessThanOrEqual(1);
    for (const id of exported) expect(shown).toContain(id);
  });
});

describe('sensitive items, on explicit request', () => {
  it('household sensitive context for either adult; private sensitive only for its owner', async () => {
    const sam = await exportFor(actor('sam'), { includeSensitive: true }, deps);
    const alex = await exportFor(actor('alex'), { includeSensitive: true }, deps);
    expect(sam.includesSensitive).toBe(true);
    expect(ids(sam, 'context')).toContain(seed.sensitive.household);
    expect(ids(sam, 'context')).not.toContain(seed.sensitive.private); // Alex's own
    expect(ids(alex, 'context')).toEqual(
      expect.arrayContaining([seed.sensitive.household, seed.sensitive.private]),
    );
  });

  it('each sensitive record returned is audited as a sensitive read, privately', async () => {
    const before = await admin.db.execute(
      sql`select count(*)::int as n from audit_log where event = 'context.sensitive_read' and actor_user_id = ${seed.actors.alex.userId}`,
    );
    await exportFor(actor('alex'), { includeSensitive: true }, deps);
    const after = await admin.db.execute(
      sql`select count(*)::int as n from audit_log where event = 'context.sensitive_read' and actor_user_id = ${seed.actors.alex.userId}`,
    );
    expect(Number(after.rows[0]?.n) - Number(before.rows[0]?.n)).toBe(2);
  });

  it('Kev and the system can never export', async () => {
    for (const who of [actor('sam', 'kev'), systemActor as unknown as UserActor]) {
      await expect(exportFor(who, {}, deps)).rejects.toBeInstanceOf(NotPermittedError);
      await expect(exportFor(who, { includeSensitive: true }, deps)).rejects.toBeInstanceOf(
        NotPermittedError,
      );
    }
  });
});

describe('the export.download audit row', () => {
  it('is private to the adult, with counts and the sensitive flag only', async () => {
    const e = await exportFor(actor('sam'), { includeSensitive: true }, deps);
    const rows = await admin.db.execute(
      sql`select visibility, visible_to_user_id, meta, summary from audit_log where event = 'export.download' and actor_user_id = ${seed.actors.sam.userId} order by at desc, id desc limit 1`,
    );
    const row = rows.rows[0] as {
      visibility: string;
      visible_to_user_id: string;
      meta: Record<string, unknown>;
      summary: string | null;
    };
    expect(row.visibility).toBe('private');
    expect(row.visible_to_user_id).toBe(seed.actors.sam.userId);
    expect(row.summary).toBeNull();
    const counts = Object.fromEntries(Object.entries(e.records).map(([t, r]) => [t, r.length]));
    expect(row.meta).toEqual({ ...counts, sensitive: true });

    const samSees = (await listAudit(actor('sam'), { limit: 50 }, deps)).rows.map((r) => r.event);
    const alexSees = (await listAudit(actor('alex'), { limit: 200 }, deps)).rows;
    expect(samSees).toContain('export.download');
    expect(
      alexSees.filter(
        (r) => r.event === 'export.download' && r.actorUserId === seed.actors.sam.userId,
      ),
    ).toEqual([]);
  });

  it('works while the Production real-data gate is closed (it is a read)', async () => {
    void env.HOME_TIMEZONE;
    const saved = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = 'production';
    delete process.env.HOME_REAL_DATA;
    try {
      const e = await exportFor(actor('alex'), {}, deps);
      expect(e.records.people.length).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved;
    }
  });
});

describe('scripts/check-export.mts (DEPLOY.md §E item 9)', () => {
  it('accepts a real export and prints counts, never content', async () => {
    const e = await exportFor(actor('sam'), {}, deps);
    const file = join(mkdtempSync(join(tmpdir(), 'home-export-')), 'export.json');
    writeFileSync(file, JSON.stringify(e));
    const r = spawnSync('node', ['scripts/check-export.mts', file], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('valid home-export v2');
    expect(r.stdout).toContain(`people: ${e.records.people.length}`);
    expect(r.stdout + r.stderr).not.toContain(CANARY_MARK.sam);
  });
});
