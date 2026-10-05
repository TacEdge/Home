'use client';

import './globals.css';

// Rendered only if the root layout itself fails, so it carries its own <html>
// and its own stylesheet. Classes only, never style attributes: the CSP's
// style-src refuses inline style attributes (src/lib/csp.ts).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-NZ">
      <body className="bg-paper text-ink p-8">
        <h1 className="font-display text-[27px] font-normal">Something went wrong.</h1>
        <p>Try again in a moment.</p>
        <p>
          <button type="button" onClick={reset} className="min-h-11 underline underline-offset-4">
            Try again
          </button>
        </p>
        {error.digest ? <p className="text-muted text-[13px]">Reference {error.digest}</p> : null}
      </body>
    </html>
  );
}
