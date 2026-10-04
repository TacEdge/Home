import Link from 'next/link';
import { listPeople } from '@/domain/people/service';
import { realDataGateOpen } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { Headline, Quiet } from '@/ui/page';

// Placeholder until Package 9 (the factual Today) and M5 (the Today body).
// One quiet line already lives here: the link prompt when the signed-in
// adult hasn't yet said which person they are (M3 contract §3.2), and only
// while linking is possible: never while the Production real-data gate is
// closed, when it would lead only to a refusal (ADR 0006 §31).
export default async function TodayPage() {
  const actor = await requireActor();
  const people = realDataGateOpen() ? await listPeople(actor) : null;
  const linked = people === null || people.some((p) => p.userId === actor.userId);
  return (
    <>
      <Headline>Today will live here.</Headline>
      <Quiet>Nothing to show yet.</Quiet>
      {linked ? null : (
        <p className="mt-6">
          <Link href="/settings/you" className="text-ink-2 underline underline-offset-4">
            Which one is you? ›
          </Link>
        </p>
      )}
    </>
  );
}
