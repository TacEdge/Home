// A person is a dot before a name, never an avatar (docs/BRAND.md §03). The
// dot is decorative: the name beside it always carries the meaning.

export type PersonColour = 'moss' | 'sky' | 'sun-soft' | 'plum' | 'sage' | 'mist';

const fills: Record<PersonColour, string> = {
  moss: 'bg-ink-2',
  sky: 'bg-sky',
  'sun-soft': 'bg-accent-soft',
  plum: 'bg-plum',
  sage: 'bg-ok',
  mist: 'bg-muted-mark',
};

export function PersonDot({ colour }: { colour: PersonColour | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${fills[colour ?? 'mist']}`}
    />
  );
}

/** A person's dot and name, the way people are shown everywhere. */
export function PersonName({ name, colour }: { name: string; colour?: PersonColour | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PersonDot colour={colour} />
      {name}
    </span>
  );
}
