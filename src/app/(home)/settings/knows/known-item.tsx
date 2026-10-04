import { ActionForm } from '@/app/_forms/action-form';
import { ConfirmAction } from '@/app/_forms/confirm-action';
import { isoDateInZone, longDate } from '@/lib/dates';
import { Button } from '@/ui/button';
import {
  archiveContextAction,
  confirmContextAction,
  reinstateContextAction,
  retireContextAction,
  updateContextAction,
} from './actions';
import { ContextForm } from './context-form';
import { categoryLabel } from './copy';

// One thing Kev knows, as a row: the words, a quiet line (kind · noted
// when · just me · sensitive), the gentle "still true?" line when the
// staleness engine says so, and what can be done with it: Confirm and
// Retire (active) or Reinstate (retired), Change (in place), Archive.
// Server-rendered; the forms inside are the usual client pieces.

export type KnownRowData = {
  id: string;
  content: string;
  category: string;
  status: string;
  visibility: string;
  sensitivity?: string;
  validUntil: string | null;
  createdAt: Date;
};

export function KnownItem({
  item,
  staleLine,
  timeZone,
  subjectName,
}: {
  item: KnownRowData;
  staleLine: string | null;
  timeZone: string;
  /** Said on the row when the list is not grouped by subject (the sensitive reveal). */
  subjectName?: string;
}) {
  const retired = item.status === 'retired';
  const meta = [
    subjectName ? `about ${subjectName}` : null,
    categoryLabel(item.category),
    `noted ${longDate(isoDateInZone(item.createdAt, timeZone), 'short')}`,
    item.validUntil ? `until ${longDate(item.validUntil, 'short')}` : null,
    item.visibility === 'private' ? 'just me' : null,
    item.sensitivity === 'sensitive' ? 'sensitive' : null,
    retired ? 'no longer true' : null,
  ].filter(Boolean);
  const hidden = { id: item.id };
  return (
    <li className="border-line border-t py-3">
      <p className={`whitespace-pre-wrap ${retired ? 'text-ink-2' : ''}`}>{item.content}</p>
      <p className="text-muted mt-1 text-[14px]">{meta.join(' · ')}</p>
      {staleLine ? <p className="text-ink-2 mt-1">{staleLine}</p> : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-5">
        {retired ? (
          <ActionForm action={reinstateContextAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button variant="quiet">Reinstate</Button>
          </ActionForm>
        ) : (
          <>
            <ActionForm action={confirmContextAction}>
              <input type="hidden" name="id" value={item.id} />
              <Button variant="quiet" ariaLabel={`Still true: ${item.content.slice(0, 40)}`}>
                Still true
              </Button>
            </ActionForm>
            <ActionForm action={retireContextAction}>
              <input type="hidden" name="id" value={item.id} />
              <Button variant="quiet" ariaLabel={`No longer true: ${item.content.slice(0, 40)}`}>
                No longer true
              </Button>
            </ActionForm>
          </>
        )}
        <details className="group">
          <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center underline-offset-4 hover:underline">
            Change
          </summary>
          <div className="pb-2">
            <ContextForm
              action={updateContextAction.bind(null, item.id)}
              idPrefix={`known-${item.id}`}
              current={{
                content: item.content,
                category: item.category,
                validUntil: item.validUntil ?? '',
                visibility: item.visibility,
              }}
              submitLabel="Save"
            />
            <ConfirmAction
              action={archiveContextAction}
              hidden={hidden}
              label="Archive"
              question="Put this away? Nothing is deleted; you can bring it back from Archived."
              confirmLabel="Archive"
            />
          </div>
        </details>
      </div>
    </li>
  );
}
