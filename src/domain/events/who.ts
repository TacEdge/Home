import type { AgendaPersonRef } from '../engines/agenda';

// Who an event is for (M4 contract §3.2, ADR 0007 §14): its own annotations
// when it has any; otherwise, for a synced event, its calendar's default
// people, derived here at read time and never written as annotations. Only
// people the reader can see are named either way: the caller passes the ids
// the people service returned for them, and anything else is left out.

export type EffectivePeople = {
  people: AgendaPersonRef[];
  /** True when the people shown are the calendar's usual ones, not the event's own. */
  derived: boolean;
};

export function effectivePeople(
  annotations: readonly AgendaPersonRef[],
  defaults: readonly string[] | undefined,
  visiblePersonIds: ReadonlySet<string>,
): EffectivePeople {
  // Whether the event has people of its own is decided before anyone is
  // left out for display: an event whose only annotation names someone the
  // reader no longer lists (archived, say) shows nobody, never its
  // calendar's usual people in their place.
  const own = annotations.filter((a) => visiblePersonIds.has(a.personId));
  if (annotations.length > 0 || !defaults) return { people: own, derived: false };
  const seen = new Set<string>();
  const people: AgendaPersonRef[] = [];
  for (const id of defaults) {
    if (!visiblePersonIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    people.push({ personId: id, role: 'attending' });
  }
  return { people, derived: people.length > 0 };
}
