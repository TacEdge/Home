'use client';

import { useActionState } from 'react';
import { ActionForm } from '@/app/_forms/action-form';
import { Button } from '@/ui/button';
import { Label, Quiet } from '@/ui/page';
import { restoreContextAction, revealSensitiveAction } from './actions';
import { KnownItem } from './known-item';
import { revealIdle } from './reveal-state';

// "Show sensitive items" (M3 contract §3.9): a press, a request, and the
// items in this response only. Nothing is kept: leave the page and they are
// gone, and no other screen ever has them. Each press is audited by the
// service as a sensitive read.

export function SensitiveReveal({
  subjectNames,
  timeZone,
}: {
  subjectNames: Record<string, string>;
  timeZone: string;
}) {
  const [state, dispatch] = useActionState(revealSensitiveAction, revealIdle);
  return (
    <>
      <Label>Sensitive items</Label>
      {state.status === 'shown' ? (
        <>
          <Quiet>
            Shown for now, because you asked. They are left out of everything automatic, and they
            are not kept on this page: leave it and they are hidden again.
          </Quiet>
          {state.items.length === 0 ? (
            <p className="text-ink-2 mt-2">None.</p>
          ) : (
            <ul className="border-line mt-2 border-b">
              {state.items
                .filter((it) => !it.archivedAt)
                .map((it) => (
                  <KnownItem
                    key={it.id}
                    item={{ ...it, createdAt: new Date(it.createdAt), sensitivity: 'sensitive' }}
                    staleLine={null}
                    timeZone={timeZone}
                    subjectName={
                      it.subjectType === 'household'
                        ? 'Everyone at home'
                        : (subjectNames[`${it.subjectType}:${it.subjectId}`] ?? undefined)
                    }
                  />
                ))}
            </ul>
          )}
          {state.items.some((it) => it.archivedAt) ? (
            <>
              <Label as="h3">Sensitive items put away</Label>
              <Quiet>Archived, and kept as they were. Only here can they come back.</Quiet>
              <ul className="border-line mt-2 border-b">
                {state.items
                  .filter((it) => it.archivedAt)
                  .map((it) => (
                    <li
                      key={it.id}
                      className="border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t py-3"
                    >
                      <span className="text-ink-2 min-w-0 flex-1 break-words whitespace-pre-wrap">
                        {it.content}
                      </span>
                      <ActionForm action={restoreContextAction}>
                        <input type="hidden" name="id" value={it.id} />
                        <Button variant="quiet" ariaLabel={`Restore: ${it.content.slice(0, 40)}`}>
                          Restore
                        </Button>
                      </ActionForm>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <form action={dispatch}>
          <input type="hidden" name="show" value="sensitive" />
          <Quiet>
            Sensitive items are kept out of everything automatic and out of this list until you ask.
            Each showing is recorded.
          </Quiet>
          {state.status === 'error' ? (
            <p role="alert" className="text-ink mt-2 flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="bg-accent inline-block h-2 w-2 shrink-0 rounded-full"
              />
              {state.message}
            </p>
          ) : null}
          <div className="mt-3">
            <Button variant="quiet">Show sensitive items</Button>
          </div>
        </form>
      )}
    </>
  );
}
