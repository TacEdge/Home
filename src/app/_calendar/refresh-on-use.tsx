'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

// Refresh on use (M4 contract §3.3, ADR 0007 §12, §41): a page that showed
// a calendar older than fifteen minutes asks, once, after it has rendered,
// for the stale calendars to be refreshed, then re-reads itself if anything
// changed. The page never waits for it, and nothing polls. Rendering itself
// writes nothing; the route does the writing, as the signed-in person.

export function RefreshOnUse() {
  const router = useRouter();
  // One request per mount, even where development runs effects twice: a
  // second request would only find the first one holding the calendar's
  // lock ("busy") and report no change, losing the first one's answer.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    fetch('/calendars/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { changed?: boolean } | null) => {
        if (body?.changed) router.refresh();
      })
      .catch(() => undefined);
  }, [router]);
  return null;
}
