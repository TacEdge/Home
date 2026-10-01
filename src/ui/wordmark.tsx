// The HOME wordmark (docs/BRAND.md §01–02). Four letters in the display face;
// the O is the mark: an orb with a thin line of ground through its lower
// third. The orb is the Sun by day and the Moon in dark mode (--orb), and the
// ground line is cut in the page colour so it reads on any surface.
//
// Accessible name is always "HOME"; the drawing is decorative.

const sizes = {
  sm: 'text-[26px]',
  md: 'text-[44px]',
  lg: 'text-[72px]',
} as const;

export function Wordmark({
  size = 'sm',
  as: Tag = 'span',
}: {
  size?: keyof typeof sizes;
  as?: 'span' | 'h1';
}) {
  return (
    <Tag
      aria-label="HOME"
      className={`font-display text-ink inline-flex items-baseline leading-none font-medium tracking-[-0.035em] ${sizes[size]}`}
    >
      H<Orb />
      ME
    </Tag>
  );
}

function Orb() {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className="mx-[0.03em] inline-block h-[0.78em] w-[0.78em] translate-y-[0.02em] self-baseline"
    >
      <circle cx="50" cy="50" r="46" fill="var(--orb)" />
      <rect x="-4" y="58" width="108" height="5" fill="var(--paper)" />
    </svg>
  );
}
