import Link from 'next/link';
import { PersonName, type PersonColour } from './person-dot';

// Lists sit on hairline rules, never in boxes (docs/BRAND.md §05). An item
// row is time · title · who (docs/concepts/README.md, shared building blocks).

export function List({
  children,
  label,
}: {
  children: React.ReactNode;
  /** Accessible name when the list has no visible heading next to it. */
  label?: string;
}) {
  return (
    <ul aria-label={label} className="border-line border-b">
      {children}
    </ul>
  );
}

export function ItemRow({
  title,
  href,
  time,
  detail,
  who,
  needsYou,
  after,
}: {
  title: React.ReactNode;
  href?: string;
  /** A time or date, set in mono. */
  time?: string;
  /** One quiet line under the title. */
  detail?: React.ReactNode;
  who?: { name: string; colour?: PersonColour | null }[];
  /** The one Sun mark: a person needs to decide something here. */
  needsYou?: boolean;
  /** Anything said about the item, under the row and outside its link (M6: conflict marks). */
  after?: React.ReactNode;
}) {
  const body = (
    <>
      {time ? (
        <span className="text-muted w-[4.5rem] shrink-0 font-mono text-[14px] tabular-nums">
          {time}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block break-words">
          {needsYou ? (
            <>
              <span
                aria-hidden="true"
                className="bg-accent mr-2 inline-block h-2 w-2 rounded-full align-middle"
              />
              <span className="sr-only">Needs you: </span>
            </>
          ) : null}
          {title}
        </span>
        {detail || who?.length ? (
          <span className="text-ink-2 mt-0.5 flex flex-wrap gap-x-3 text-[15px]">
            {detail ? <span>{detail}</span> : null}
            {who?.map((p) => (
              <PersonName key={p.name} name={p.name} colour={p.colour} />
            ))}
          </span>
        ) : null}
      </span>
      {href ? (
        <span aria-hidden="true" className="text-muted shrink-0">
          ›
        </span>
      ) : null}
    </>
  );
  const row = 'flex min-h-11 items-baseline gap-3 py-3';
  return (
    <li className="border-line border-t">
      {href ? (
        <Link href={href} className={`${row} hover:bg-paper-2 -mx-2 rounded-home-sm px-2`}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
      {after}
    </li>
  );
}
