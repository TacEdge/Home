import Link from 'next/link';
import { listCaptures } from '@/domain/captures/service';
import { listPeople } from '@/domain/people/service';
import { realDataGateOpen } from '@/lib/env';
import { requireActor } from '@/trust/session';
import { toSortLine } from '../sort/copy';
import { Headline, Quiet } from '@/ui/page';

// Placeholder until Package 9 (the factual Today) and M5 (the Today body).
// One quiet line already lives here: the link prompt when the signed-in
// adult hasn't yet said which person they are (M3 contract §3.2), and only
// while linking is possible: never while the Production real-data gate is
// closed, when it would lead only to a refusal (ADR 0006 §31). And, in
// words, how many things wait in To sort, only when some do (§3.2).

export default async function TodayPage() {
  const actor = await requireActor();
  const [people, captures] = await Promise.all([
    realDataGateOpen() ? listPeople(actor) : Promise.resolve(null),
    listCaptures(actor),
  ]);
  const linked = people === null || people.some((p) => p.userId === actor.userId);
  const toSort = toSortLine(
    captures.filter((c) => c.status === 'new' || c.status === 'proposed').length,
  );
  return (
    <>
      <Headline>Today will live here.</Headline>
      <Quiet>Nothing to show yet.</Quiet>
      {toSort ? (
        <p className="mt-6">
          <Link href="/sort" className="text-ink-2 underline underline-offset-4">
            {toSort} ›
          </Link>
        </p>
      ) : null}
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
