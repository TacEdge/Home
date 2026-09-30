// Small presentational pieces shared by the shell and the calm error pages.
// No data access, no side effects.

export function Headline({ children }: { children: React.ReactNode }) {
  return <h1 className="font-serif text-[27px] leading-tight font-normal">{children}</h1>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted mt-6 mb-2 text-[12px] tracking-[0.1em] uppercase">{children}</div>
  );
}

export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-2">{children}</p>;
}

export function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[720px] px-5 py-8">{children}</main>;
}
