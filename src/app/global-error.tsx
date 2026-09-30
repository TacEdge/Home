'use client';

// Rendered only if the root layout itself fails, so it carries its own <html>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-NZ">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#f7f3ec' }}>
        <h1 style={{ fontWeight: 400, fontSize: 27 }}>Something went wrong.</h1>
        <p>Try again in a moment.</p>
        <p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </p>
        {error.digest ? (
          <p style={{ fontSize: 13, opacity: 0.6 }}>Reference {error.digest}</p>
        ) : null}
      </body>
    </html>
  );
}
