// Page structure inside the HOME shell (M3 contract §4.2). Presentational
// only: no data access, no side effects. Type roles follow docs/BRAND.md §04.

/** The one headline of a screen: display face, never bold. */
export function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-display text-[27px] leading-[1.18] font-normal tracking-[-0.015em] md:text-[34px]">
      {children}
    </h1>
  );
}

/** A section label: small mono capitals in Mist (text). A heading, for structure. */
export function Label({
  children,
  as: Tag = 'h2',
  id,
}: {
  children: React.ReactNode;
  as?: 'h2' | 'h3' | 'div';
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className="text-muted mt-8 mb-2 font-mono text-[11.5px] font-normal tracking-[0.14em] uppercase"
    >
      {children}
    </Tag>
  );
}

/** Secondary body text. */
export function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-2">{children}</p>;
}

/**
 * A screen inside the shell: the headline, an optional line of meaning under
 * it, then the content. The shell owns <main>; a Page is its content.
 */
export function Page({
  title,
  intro,
  children,
}: {
  title: React.ReactNode;
  intro?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <header className="mb-2">
        <Headline>{title}</Headline>
        {intro ? (
          <div className="mt-2">{typeof intro === 'string' ? <Quiet>{intro}</Quiet> : intro}</div>
        ) : null}
      </header>
      {children}
    </>
  );
}

/** Nothing to show, said calmly: an empty screen should look intentional. */
export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="py-8">
      <p className="font-display text-ink-2 text-[20px] leading-[1.3]">{title}</p>
      {children ? <div className="text-ink-2 mt-2">{children}</div> : null}
    </div>
  );
}
