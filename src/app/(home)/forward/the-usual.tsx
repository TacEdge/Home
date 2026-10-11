import { Disclosure } from '@/app/_insights/disclosure';
import type { FactLookup } from '@/app/_insights/facts';
import { RegularWeekDays } from '@/app/_profile/regular-week';
import type { ForwardModel } from '@/domain/engines/forward';
import { PersonName, type PersonColour } from '@/ui/person-dot';

// The usual (M6 contract §4.1 item 5, §5.2): each household person's regular
// week, folded away under one line, from the profile engine's own entries.
// Absent when no one has one. Presentation only.

export function TheUsual({ usual, lookup }: { usual: ForwardModel['usual']; lookup: FactLookup }) {
  if (usual.length === 0) return null;
  return (
    <section aria-label="The usual" className="mt-6">
      <Disclosure label="The usual">
        {usual.map((w) => (
          <div key={w.personId}>
            <h3 className="mt-4 text-[15px] font-medium">
              <PersonName
                name={w.name}
                colour={(lookup.people.get(w.personId)?.colour ?? null) as PersonColour | null}
              />
            </h3>
            <RegularWeekDays entries={w.entries} />
          </div>
        ))}
      </Disclosure>
    </section>
  );
}
