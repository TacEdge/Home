import { CreditLink } from '@/app/_insights/weather/credit';
import type { CitedRecord } from '@/domain/citations/service';
import type { KevContentV2 } from '@/domain/kev-bookkeeping/schema';
import { asOfTime } from '@/domain/engines/weather';
import { isoDateInZone, longDate, softWhen } from '@/lib/dates';
import { LIMIT_TEXT } from '@/kev/answer/language';
import { ItemRow } from '@/ui/list';
import { keepMessageAction } from './actions';
import {
  BASED_ON,
  BASED_ON_START,
  basedOnLabel,
  dayHeading,
  GONE_MANY,
  GONE_ONE,
  KEV,
  KEVS_VIEW,
  STILL_ANSWERING,
} from './copy';
import { Kept, KeepForm } from './keep-form';
import type { KevView, Turn, UserView } from './turns';

// The conversation, as stored (M8 contract §11.2, §11.3): a list per day,
// under a heading for the day; the adult's words on the right, plain; Kev's
// answer on the left, without a bubble or an avatar: the lead in Kev's type
// (BRAND.md §04, Bricolage Grotesque 500, 22px), then the facts HOME
// rendered, then Kev's view under its quiet label in muted ink, then the
// records it cited as rows linking to their pages, then the code's own
// sentences, then "What's this based on?". Every stored or recorded string
// is a React text node: a title with markup in it stays text (S15), and no
// link is ever made from text, only from a cited record HOME resolved again
// as the reader, now, to one of its own pages.

export type CalendarLine = { id: string; name: string; lastSyncedAt: Date | null };

export type RenderContext = {
  timeZone: string;
  now: Date;
  cited: ReadonlyMap<string, CitedRecord>;
  kept: ReadonlySet<string>;
  calendars: readonly CalendarLine[];
};

export function Conversation({
  days,
  today,
  ctx,
}: {
  days: { day: string; turns: Turn[] }[];
  today: string;
  ctx: RenderContext;
}) {
  const last = days.at(-1)?.turns.at(-1);
  return (
    <>
      {days.map(({ day, turns }) => (
        <section key={day} aria-labelledby={`kev-day-${day}`} className="mt-6">
          <h2
            id={`kev-day-${day}`}
            className="text-muted flex items-center gap-3 font-mono text-[11.5px] font-normal tracking-[0.14em] uppercase before:h-px before:flex-1 before:bg-[var(--line)] after:h-px after:flex-1 after:bg-[var(--line)]"
          >
            {dayHeading(day, today)}
          </h2>
          <ol className="mt-2">
            {turns.map((t) => (
              <li
                key={(t.user?.id ?? '') + (t.kev?.id ?? '')}
                id={t === last ? 'latest' : undefined}
                className="py-4"
                data-testid="kev-turn"
              >
                {t.user ? (
                  <UserMessage user={t.user} turn={t} kept={ctx.kept.has(t.user.id)} />
                ) : null}
                {t.kev ? <KevMessage kev={t.kev} ctx={ctx} /> : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function UserMessage({ user, turn, kept }: { user: UserView; turn: Turn; kept: boolean }) {
  return (
    <div data-testid="kev-you">
      <p className="text-ink ml-auto max-w-[85%] text-right break-words whitespace-pre-wrap">
        <span className="sr-only">You: </span>
        {user.text}
      </p>
      {turn.answering ? (
        <p className="text-muted mt-3 text-[15px]" data-testid="kev-still">
          {STILL_ANSWERING}
        </p>
      ) : kept ? (
        <Kept />
      ) : turn.keepable ? (
        <KeepForm action={keepMessageAction} messageId={user.id} />
      ) : null}
    </div>
  );
}

const hrefOf = (r: CitedRecord): string | null => {
  switch (r.type) {
    case 'event':
      return `/events/${r.id}`;
    case 'task':
      return `/tasks/${r.id}`;
    case 'project':
      return `/home/projects/${r.id}`;
    case 'person':
      return `/people/${r.id}`;
    case 'calendar':
      return `/settings/calendars/${r.id}`;
    case 'context':
      return '/settings/knows';
    case 'note':
      if (!r.subject) return null;
      return r.subject.type === 'project'
        ? `/home/projects/${r.subject.id}`
        : r.subject.type === 'person'
          ? `/people/${r.subject.id}`
          : `/events/${r.subject.id}`;
  }
};

const DETAIL: Record<CitedRecord['type'], string> = {
  event: 'Event',
  task: 'Task',
  project: 'Project',
  person: 'Person',
  note: 'Note',
  context: 'What Kev knows',
  calendar: 'Calendar',
};

/** A cited ref as a row, if HOME can still open it for the reader; `gone` if it was a record it can't. */
function citedRow(
  ref: { type: string; id: string; at?: string },
  ctx: RenderContext,
): { key: string; title: string; href: string; detail: string } | 'gone' | null {
  if (!['event', 'task', 'project', 'person', 'note', 'context', 'calendar'].includes(ref.type))
    return null; // conflicts, insights, gaps and forecast days are facts, not pages
  const r = ctx.cited.get(`${ref.type}:${ref.id}`);
  if (!r) return 'gone';
  const href = hrefOf(r);
  if (!href) return 'gone';
  const day = r.type === 'event' && ref.at ? isoDateInZone(new Date(ref.at), ctx.timeZone) : null;
  return {
    key: `${ref.type}:${ref.id}:${ref.at ?? ''}`,
    title: r.title ?? DETAIL[r.type],
    href,
    detail: day ? longDate(day) : DETAIL[r.type],
  };
}

function KevMessage({ kev, ctx }: { kev: KevView; ctx: RenderContext }) {
  if (kev.kind === 'v1')
    return (
      <div className="mt-4" data-testid="kev-answer">
        <p className="text-ink break-words whitespace-pre-wrap">
          <span className="sr-only">{KEV}: </span>
          {kev.text}
        </p>
      </div>
    );
  const c = kev.content;
  const facts = c.blocks.filter((b) => b.kind === 'fact');
  const views = c.blocks.filter((b) => b.kind === 'view');
  const rows: { key: string; title: string; href: string; detail: string }[] = [];
  let gone = 0;
  const seen = new Set<string>();
  for (const ref of c.cites) {
    const key = `${ref.type}:${ref.id}:${ref.at ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = citedRow(ref, ctx);
    if (row === 'gone') gone += 1;
    else if (row) rows.push(row);
  }
  return (
    <article className="mt-4" aria-label={`${KEV}’s answer`} data-testid="kev-answer">
      <p
        className="font-display text-ink text-[22px] leading-[1.25] font-medium break-words"
        data-testid="kev-say"
      >
        {c.say}
      </p>
      {facts.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {facts.map((b, i) => (
            <p key={i} className="text-ink break-words" data-testid="kev-fact">
              {b.text}
            </p>
          ))}
        </div>
      ) : null}
      {views.map((b, i) => (
        <div key={i} className="mt-3" data-testid="kev-view">
          <p className="text-muted font-mono text-[11.5px] tracking-[0.14em] uppercase">
            {KEVS_VIEW}
          </p>
          <p className="text-ink-2 break-words">{b.text}</p>
        </div>
      ))}
      {rows.length > 0 ? (
        <ul className="border-line mt-3 border-b" aria-label="What this answer cites">
          {rows.map((r) => (
            <ItemRow key={r.key} title={r.title} href={r.href} detail={r.detail} />
          ))}
        </ul>
      ) : null}
      {gone > 0 ? (
        <p className="text-muted mt-2 text-[15px]" data-testid="kev-gone">
          {gone === 1 ? GONE_ONE : GONE_MANY(gone)}
        </p>
      ) : null}
      <Limits content={c} answeredAt={kev.createdAt} timeZone={ctx.timeZone} />
      <BasedOn content={c} ctx={ctx} answeredAt={kev.createdAt} />
    </article>
  );
}

/** The code's sentences for what the answer cites (§8.4), in a fixed order. */
function Limits({
  content,
  answeredAt,
  timeZone,
}: {
  content: KevContentV2;
  answeredAt: Date;
  timeZone: string;
}) {
  const limits = new Set(content.limits);
  const sentences = (['calendar_stale', 'coverage_unknown', 'gap_limit'] as const).filter((l) =>
    limits.has(l),
  );
  const forecastAt =
    limits.has('forecast_credit') && content.forecastAt ? new Date(content.forecastAt) : null;
  if (sentences.length === 0 && !forecastAt) return null;
  return (
    <div className="mt-2" data-testid="kev-limits">
      {sentences.map((l) => (
        <p key={l} className="text-ink-2 text-[15px]">
          {LIMIT_TEXT[l]}
        </p>
      ))}
      {forecastAt ? (
        <p
          data-testid="kev-forecast-credit"
          className="text-muted flex flex-wrap items-baseline gap-x-1.5 text-[13px]"
        >
          <span>Forecast as of {asOfTime(forecastAt, answeredAt, timeZone)}</span>
          <span aria-hidden="true">·</span>
          <CreditLink />
        </p>
      ) : null}
    </div>
  );
}

/** "What's this based on?" (§11.2; U6): plain labels, the calendars and the forecast's time. */
function BasedOn({
  content,
  ctx,
  answeredAt,
}: {
  content: KevContentV2;
  ctx: RenderContext;
  answeredAt: Date;
}) {
  const labels = [BASED_ON_START];
  for (const t of content.trace) {
    if (!t.ok) continue;
    const label = basedOnLabel(t.tool, t.args);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return (
    <details className="mt-1" data-testid="kev-based-on">
      <summary className="text-ink-2 inline-flex min-h-11 cursor-pointer items-center text-[15px] underline-offset-4 hover:underline">
        {BASED_ON}
      </summary>
      <ul className="text-ink-2 mb-2 text-[15px]">
        {labels.map((l) => (
          <li key={l} className="py-0.5">
            {l}
          </li>
        ))}
        {ctx.calendars.map((c) => (
          <li key={c.id} className="py-0.5">
            {c.name}
            {c.lastSyncedAt
              ? `, updated ${softWhen(c.lastSyncedAt, ctx.now, ctx.timeZone)}`
              : ', not yet updated'}
          </li>
        ))}
        {content.forecastAt ? (
          <li className="py-0.5">
            The forecast as of {asOfTime(new Date(content.forecastAt), answeredAt, ctx.timeZone)}
          </li>
        ) : null}
      </ul>
    </details>
  );
}
