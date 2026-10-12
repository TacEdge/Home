// The Open-Meteo credit (M7 contract §4.7, ADR 0011 §20; CC BY 4.0 asks for a
// link next to the data): a real link, small and muted, in the same tab,
// with no referrer so HOME's address is never sent. Its target is 44px tall
// and its accessible name says where it goes. It is placed only where
// forecast words are (Today's sentence, or the opening that cites the
// forecast when there is no sentence; Forward Week's credit line; the Why of
// either) and nowhere else. A plain link: no script, no widget, no CSP change.

import { FORECAST_CREDIT_URL } from '@/domain/engines/weather';

export function CreditLink({ className = '' }: { className?: string }) {
  return (
    <a
      href={FORECAST_CREDIT_URL}
      rel="noreferrer"
      aria-label="Forecast data: Open-Meteo"
      data-testid="credit-link"
      className={`text-muted inline-flex min-h-11 items-center text-[13px] underline underline-offset-4 ${className}`}
    >
      Open-Meteo
    </a>
  );
}
