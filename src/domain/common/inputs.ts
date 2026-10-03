import { z } from 'zod';
import { DOMAINS, VISIBILITY } from '@/db/schema/common';
import { isValidIsoDate, isValidTimeZone } from '@/lib/dates';

// Input building blocks shared by every entity's Zod schemas (one schema per
// input, shared by forms, services and Kev tools). Limits per M2 contract
// §4.1: titles 200, names 100, long text 10,000 characters.

/** Trimmed text with a maximum length. */
export const text = (max: number) => z.string().trim().max(max);

/** Required, non-blank, trimmed text. */
export const requiredText = (max: number) => text(max).min(1);

/** Long free text (notes, bodies): kept as written apart from trailing space, never blank. */
export const longText = z
  .string()
  .max(10_000)
  .transform((s) => s.trimEnd())
  .refine((s) => s.trim().length > 0, 'must not be blank');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(isValidIsoDate, 'must be a real calendar date');

/** An instant with an explicit offset or Z, stored as UTC. Never a naive local time. */
export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

export const timeZone = z.string().refine(isValidTimeZone, 'must be an IANA time zone name');

export const recordId = z.string().uuid();
export const visibility = z.enum(VISIBILITY);
export const domain = z.enum(DOMAINS);

/** True when both values are Dates (a failed `instant` leaves the raw input in place). */
export const isDates = (a: unknown, b: unknown): boolean => a instanceof Date && b instanceof Date;
