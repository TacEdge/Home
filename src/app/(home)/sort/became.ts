import 'server-only';
import type { Capture } from '@/domain/captures/service';
import { getContext } from '@/domain/context/service';
import { getEvent } from '@/domain/events/service';
import { getNote } from '@/domain/notes/service';
import { getProject } from '@/domain/projects/service';
import { getTask } from '@/domain/tasks/service';
import type { UserActor } from '@/trust/actor';
import { ORGANISE_KINDS } from './copy';

// What a capture became, read back as the signed-in adult so each record's
// own visibility applies: a title and where it lives. Something since
// archived or no longer visible is left out rather than guessed at.

export type Became = { key: string; noun: string; title: string; href?: string };

const nounOf = (type: string) =>
  ORGANISE_KINDS.find((k) => k.action === `${type}.create`)?.noun ?? type;

const subjectHref = (type: string, id: string | null) =>
  !id
    ? undefined
    : type === 'person'
      ? `/people/${id}`
      : type === 'project'
        ? `/home/projects/${id}`
        : type === 'event'
          ? `/events/${id}`
          : undefined;

export async function becameOf(actor: UserActor, c: Capture): Promise<Became[]> {
  const read = async (r: { type: string; id: string }): Promise<Became | null> => {
    const base = { key: `${r.type}:${r.id}`, noun: nounOf(r.type) };
    switch (r.type) {
      case 'task': {
        const t = await getTask(actor, r.id);
        return { ...base, title: t.title, href: `/tasks/${t.id}` };
      }
      case 'event': {
        const e = await getEvent(actor, r.id);
        return { ...base, title: e.title, href: `/events/${e.id}` };
      }
      case 'project': {
        const p = await getProject(actor, r.id);
        return { ...base, title: p.title, href: `/home/projects/${p.id}` };
      }
      case 'note': {
        const n = await getNote(actor, r.id);
        return { ...base, title: n.body, href: subjectHref(n.subjectType ?? '', n.subjectId) };
      }
      case 'context': {
        const x = await getContext(actor, r.id);
        return { ...base, title: x.content, href: subjectHref(x.subjectType, x.subjectId) };
      }
      default:
        return null;
    }
  };
  const all = await Promise.all(c.organisedInto.map((r) => read(r).catch(() => null)));
  return all.filter((b): b is Became => b !== null);
}
