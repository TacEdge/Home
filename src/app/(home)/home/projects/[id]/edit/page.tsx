import { notFound } from 'next/navigation';
import { NotFoundError } from '@/domain/common/errors';
import { getProject } from '@/domain/projects/service';
import { requireActor } from '@/trust/session';
import { Page } from '@/ui/page';
import { updateProjectAction } from '../../../actions';
import { ProjectForm } from '../../../project-form';

export const dynamic = 'force-dynamic';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const project = await getProject(actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Page title={`Edit ${project.title}`}>
      <ProjectForm
        action={updateProjectAction.bind(null, project.id)}
        project={project}
        submitLabel="Save"
      />
    </Page>
  );
}
