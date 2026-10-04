import { Page } from '@/ui/page';
import { createPersonAction } from '../actions';
import { PersonForm } from '../person-form';

export default function NewPersonPage() {
  return (
    <Page title="Add someone" intro="A person in the family, or around it.">
      <PersonForm action={createPersonAction} submitLabel="Add them" />
    </Page>
  );
}
