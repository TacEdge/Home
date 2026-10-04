'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/button';
import { Label, Quiet } from '@/ui/page';
import { revealSensitiveAction } from './actions';
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
              {state.items.map((it) => (
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
