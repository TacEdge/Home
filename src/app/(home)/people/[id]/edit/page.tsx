import { notFound } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { getPerson } from '@/domain/people/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import { updatePersonAction } from '../../actions';
import { PersonForm } from '../../person-form';

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const person = await getPerson(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const action = updatePersonAction.bind(null, person.id);
  return (
    <Page title={`Edit ${person.name}`}>
      <PersonForm action={action} person={person} submitLabel="Save" />
    </Page>
  );
}
