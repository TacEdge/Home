import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import { createProjectAction } from '../../actions';
import { ProjectForm } from '../../project-form';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  await requireActor();
  return (
    <Page title="Start a project" intro="Something around the house, big or small.">
      <ProjectForm action={createProjectAction} submitLabel="Add it" />
    </Page>
  );
}
