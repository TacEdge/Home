import { requestNow } from '@/app/_agenda/now';
import { kevSwitchedOn } from '@/app/_kev/status';
import { NZD_PER_USD } from '@/domain/kev-bookkeeping/constants';
import { getOwnQuestionsThisMonth, getSpendStatus } from '@/domain/kev-bookkeeping/service';
import { isoDateInZone } from '@/lib/dates';
import { env } from '@/lib/env';
import { ERROR_TEXT } from '@/kev/answer/language';
import { aboutNzdWhole } from '@/trust/usage';
import { requireActor } from '@/trust/session';
import { Label, Page } from '@/ui/page';
import {
  ABOUT,
  ABOUT_LABEL,
  monthLine,
  ownLine,
  pausedLine,
  RECORDED_NOTE,
  SIMPLER,
  USAGE_INTRO,
  USAGE_TITLE,
  ZERO_CAP,
} from './copy';

export const dynamic = 'force-dynamic';

// Settings › Usage (M8 contract §11.2; D19; owner decision 2026-10-15, I5):
// the household's month as HOME has recorded it, read through the one
// aggregate an adult may read (getSpendStatus: the cap, the recorded usage
// and the threshold state from that recorded total), the adult's own count
// of questions, and the about-Kev paragraph. Reservations, open or
// unreconciled, late settlements, tiers and attempts are the system's
// (getSpendReport) and are never read here.
export default async function UsagePage() {
  const actor = await requireActor();
  if (!kevSwitchedOn())
    return (
      <Page title={USAGE_TITLE}>
        <p className="text-ink-2 mt-3">{ERROR_TEXT.off}</p>
      </Page>
    );
  const [spend, questions, now] = await Promise.all([
    getSpendStatus(actor),
    getOwnQuestionsThisMonth(actor),
    requestNow(),
  ]);
  const today = isoDateInZone(now, env.HOME_TIMEZONE);
  const about = aboutNzdWhole(spend.recordedUsdMicros, NZD_PER_USD);
  const cap = aboutNzdWhole(spend.capUsdMicros, NZD_PER_USD);
  return (
    <Page title={USAGE_TITLE} intro={USAGE_INTRO}>
      <div className="mt-4 space-y-2" data-testid="usage">
        <p className="text-ink text-[17px]" data-testid="usage-month">
          {monthLine(about, cap)}
        </p>
        {spend.state === 'paused' ? (
          <p className="text-ink" data-testid="usage-paused">
            {spend.capUsdMicros === 0n ? ZERO_CAP : pausedLine(today)}
          </p>
        ) : spend.state === 'deep_withdrawn' ? (
          <p className="text-ink" data-testid="usage-simpler">
            {SIMPLER}
          </p>
        ) : null}
        <p className="text-ink-2" data-testid="usage-own">
          {ownLine(questions)}
        </p>
        <p className="text-muted text-[15px]">{RECORDED_NOTE}</p>
      </div>
      <Label>{ABOUT_LABEL}</Label>
      <div className="text-ink-2 space-y-3" data-testid="usage-about">
        {ABOUT.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </Page>
  );
}
