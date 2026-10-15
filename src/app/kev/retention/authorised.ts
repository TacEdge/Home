import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether a request's Authorization header is exactly `Bearer <secret>`,
 * compared in constant time: both sides are hashed first, so neither the
 * secret's length nor where a guess first differs changes the time taken
 * (M8 contract §7.2, §15.1 "the retention route").
 */
export function authorised(header: string | null, secret: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
