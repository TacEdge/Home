import type { Context } from '@/domain/context/service';
import { stalenessOf } from '@/domain/context/service';
import type { Staleness } from '@/domain/engines/staleness';
import type { IsoDate } from '@/lib/dates';

// What Kev knows, arranged for reading (M3 contract §3.9): grouped by
// subject (the household, then each person, then each project), possibly
// out-of-date items first within a group, then newest first; retired items
// kept apart. Pure: the caller read the rows as the signed-in adult.

export type KnownItem = { row: Context; staleness: Staleness };
export type KnownGroup = {
  key: string;
  subject: { type: 'household' } | { type: 'person' | 'project'; id: string };
  title: string;
  href?: string;
  active: KnownItem[];
  retired: Context[];
};

export function groupContext(
  rows: Context[],
  named: { people: { id: string; name: string }[]; projects: { id: string; title: string }[] },
  today: IsoDate,
  timeZone: string,
): KnownGroup[] {
  const groups = new Map<string, KnownGroup>();
  const group = (row: Context): KnownGroup | null => {
    const key =
      row.subjectType === 'household' ? 'household' : `${row.subjectType}:${row.subjectId}`;
    const existing = groups.get(key);
    if (existing) return existing;
    let g: KnownGroup;
    if (row.subjectType === 'household') {
      g = {
        key,
        subject: { type: 'household' },
        title: 'Everyone at home',
        active: [],
        retired: [],
      };
    } else if (row.subjectType === 'person') {
      const p = named.people.find((x) => x.id === row.subjectId);
      if (!p) return null; // a subject the adult cannot see now: the row is not theirs to read about
      g = {
        key,
        subject: { type: 'person', id: p.id },
        title: p.name,
        href: `/people/${p.id}`,
        active: [],
        retired: [],
      };
    } else {
      const p = named.projects.find((x) => x.id === row.subjectId);
      if (!p) return null;
      g = {
        key,
        subject: { type: 'project', id: p.id },
        title: p.title,
        href: `/home/projects/${p.id}`,
        active: [],
        retired: [],
      };
    }
    groups.set(key, g);
    return g;
  };
  for (const row of rows) {
    const g = group(row);
    if (!g) continue;
    if (row.status === 'retired') g.retired.push(row);
    else g.active.push({ row, staleness: stalenessOf(row, today, timeZone) });
  }
  const byNewest = (a: Context, b: Context) =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);
  for (const g of groups.values()) {
    g.active.sort(
      (a, b) =>
        Number(b.staleness.possiblyStale) - Number(a.staleness.possiblyStale) ||
        byNewest(a.row, b.row),
    );
    g.retired.sort(byNewest);
  }
  const order = (g: KnownGroup) =>
    g.subject.type === 'household' ? 0 : g.subject.type === 'person' ? 1 : 2;
  return [...groups.values()].sort(
    (a, b) => order(a) - order(b) || a.title.localeCompare(b.title) || (a.key < b.key ? -1 : 1),
  );
}
