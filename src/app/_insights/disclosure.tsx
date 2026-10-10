// A quiet disclosure that works without JavaScript (a native <details>): the
// summary is an underlined line with a tappable height, the focus ring comes
// from the global :focus-visible rule, and nothing animates.

export function Disclosure({
  label,
  children,
  className = '',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={`group ${className}`}>
      <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer list-none items-center underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        {label}
        <span aria-hidden="true" className="ml-1 group-open:rotate-90">
          ›
        </span>
      </summary>
      {children}
    </details>
  );
}
