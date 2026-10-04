// Where an action returns to, when a page binds its own address into it.
// The value travels through the form (bound by the server-rendered page,
// readable in the browser), so it is treated as input: only a local path
// on this site is followed, parsed rather than pattern-matched, and
// anything else goes to the fallback.

const BASE = 'http://home.invalid';

/** A same-origin path (with its query) from `to`, or `fallback`. */
export function localPath(to: string | undefined, fallback: string): string {
  if (!to || to.length > 2048) return fallback;
  if (!to.startsWith('/') || to.startsWith('//')) return fallback;
  // Backslashes, whitespace and control characters never belong in a path we wrote.
  if (/[\\\s\u0000-\u001f\u007f]/.test(to)) return fallback;
  let url: URL;
  try {
    url = new URL(to, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.username || url.password) return fallback;
  return `${url.pathname}${url.search}`;
}
