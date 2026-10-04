'use client';

import { Button } from '@/ui/button';
import { CalmPage, Headline, Quiet } from '@/ui/calm';

// Calm, generic. Never shows internals. The digest is a short reference the
// person can quote; the real error is logged server-side by Next.js.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <CalmPage>
      <Headline>Something went wrong.</Headline>
      <Quiet>Try again in a moment.</Quiet>
      <p className="mt-4">
        <Button type="button" variant="quiet" onClick={reset}>
          Try again
        </Button>
      </p>
      {error.digest ? (
        <p className="text-muted mt-6 text-[13px]">Reference {error.digest}</p>
      ) : null}
    </CalmPage>
  );
}
