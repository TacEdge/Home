import Link from 'next/link';
import { listPeople } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { ItemRow, List } from '@/ui/list';
import { EmptyState, Label, Page } from '@/ui/page';
import type { PersonColour } from '@/ui/person-dot';
import { PersonName } from '@/ui/person-dot';
import { roleLabel } from './copy';

// People (M3 contract §3.4): household people first, then others; a dot
// and a name; "you" beside the actor's own linked person.
export default async function PeoplePage() {
  const actor = await requireActor();
  const people = await listPeople(actor);
  const home = people.filter((p) => p.inHousehold);
  const others = people.filter((p) => !p.inHousehold);

  const row = (p: (typeof people)[number]) => (
    <ItemRow
      key={p.id}
      href={`/people/${p.id}`}
      title={
        <>
          <PersonName name={p.name} colour={p.colour as PersonColour | null} />
          {p.userId === actor.userId ? <span className="text-muted"> · you</span> : null}
        </>
      }
      detail={p.relationship ?? roleLabel(p.role)}
    />
  );

  return (
    <Page title="People">
      {people.length === 0 ? (
        <EmptyState title="Nobody here yet.">
          <Link href="/people/new" className="underline underline-offset-4">
            Add someone
          </Link>
        </EmptyState>
      ) : (
        <>
          {home.length > 0 ? (
            <>
              <Label>At home</Label>
              <List>{home.map(row)}</List>
            </>
          ) : null}
          {others.length > 0 ? (
            <>
              <Label>Family and friends</Label>
              <List>{others.map(row)}</List>
            </>
          ) : null}
          <p className="mt-8">
            <Link href="/people/new" className="text-ink-2 underline underline-offset-4">
              Add someone
            </Link>
          </p>
        </>
      )}
    </Page>
  );
}
