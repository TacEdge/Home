import 'server-only';
import { isIPv4, isIPv6 } from 'node:net';

// The client IP used for rate limiting (M1.1 contract §2.2). HOME reads only
// the header its deployment platform sets, never a chain it would have to
// trust blindly.
//
// On Vercel that header is `x-real-ip`: Vercel's request-headers reference
// (https://vercel.com/docs/headers/request-headers) describes it as "the
// public IP address of the client that made the request", set at Vercel's
// edge, so an inbound value from the client is replaced rather than passed
// through. Elsewhere (local development, tests) the header is simply absent.
// Recorded in ADR 0003.
//
// Anything missing, multi-valued or malformed is `null`, and callers fall
// back to one shared `unknown` bucket: failing closed means an attacker who
// strips or garbles the header shares one small budget with everyone else in
// that state, not an unlimited one.
export const CLIENT_IP_HEADER = 'x-real-ip';

/** A single valid IPv4 address, or an IPv6 address collapsed to its /64. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get(CLIENT_IP_HEADER);
  if (raw === null) return null;
  const value = raw.trim();
  if (value === '' || value.includes(',') || /\s/.test(value) || value.includes('%')) return null;
  if (isIPv4(value)) return value;
  if (isIPv6(value)) {
    const groups = expandIPv6(value);
    if (!groups) return null;
    // IPv4-mapped (::ffff:a.b.c.d): treat as the IPv4 client it is.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const [hi, lo] = [groups[6] ?? 0, groups[7] ?? 0];
      return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
    return `${groups
      .slice(0, 4)
      .map((g) => g.toString(16))
      .join(':')}::/64`;
  }
  return null;
}

/** Eight 16-bit groups, or null if the address cannot be expanded. */
function expandIPv6(address: string): number[] | null {
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        // Embedded dotted-quad, only valid as the last two groups.
        if (!isIPv4(piece)) return null;
        const [a, b, c, d] = piece.split('.').map(Number) as [number, number, number, number];
        out.push((a << 8) | b, (c << 8) | d);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = toGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}
