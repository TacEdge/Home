import type { ProjectStatus } from '@/domain/projects/schema';

// Words for home projects.

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Under way',
  idea: 'An idea',
  paused: 'Paused',
  done: 'Done',
};

export const projectStatusLabel = (s: string) => PROJECT_STATUS_LABEL[s as ProjectStatus] ?? s;

/** The groups on Home, in order; done is folded away (M3 contract §3.5). */
export const PROJECT_GROUPS: { status: ProjectStatus; label: string }[] = [
  { status: 'active', label: 'Under way' },
  { status: 'idea', label: 'Ideas' },
  { status: 'paused', label: 'Paused' },
];
