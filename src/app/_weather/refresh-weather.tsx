'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

// Weather refresh on use (M7 contract §5.1, ADR 0011 §15): a page whose
// server render found a refresh due asks once, after it has rendered, then
// re-reads itself if anything changed. The page never waits, nothing polls,
// and without JavaScript nothing is asked (the cached forecast stands).
// Built in Package 1b; Package 4 places it on Today and Forward Week.

export const WEATHER_REFRESH_PATH = '/weather/refresh';

/** The one request, and what to do with its answer. Exported for its test. */
export async function askWeatherRefresh(
  post: (path: string, init: RequestInit) => Promise<Response>,
  onChanged: () => void,
): Promise<void> {
  try {
    const r = await post(WEATHER_REFRESH_PATH, { method: 'POST', credentials: 'same-origin' });
    const body = (r.ok ? await r.json() : null) as { changed?: boolean } | null;
    if (body?.changed === true) onChanged();
  } catch {
    // A failed request changes nothing on the page.
  }
}

export function RefreshWeather() {
  const router = useRouter();
  // One request per mount, even where development runs effects twice: a
  // second would only find the first holding the lock ("busy").
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void askWeatherRefresh(
      (path, init) => fetch(path, init),
      () => router.refresh(),
    );
  }, [router]);
  return null;
}
