'use client';

import { Headline, Page, Quiet } from '@/ui/calm';

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
    <Page>
      <Headline>Something went wrong.</Headline>
      <Quiet>Try again in a moment.</Quiet>
      <p className="mt-4">
        <button type="button" onClick={reset} className="text-accent">
          Try again
        </button>
      </p>
      {error.digest ? (
        <p className="text-muted mt-6 text-[13px]">Reference {error.digest}</p>
      ) : null}
    </Page>
  );
}
