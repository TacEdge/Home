import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { oneOf } from './common';

// The forecast cache (FAMILY-DATA-MODEL §3, weather_forecast; M7 contract
// §3.9, ADR 0011 §14; migration 0008, M7 Package 1a). One household-level row
// per provider: the latest good forecast and the latest attempt. It is not a
// user-facing record (no created_by, no visibility) and holds no coordinate,
// elevation or location: only a keyed fingerprint of the location the hours
// are for, computed by the forecast service (Package 1b). Not append-only.

export const WEATHER_PROVIDERS = ['open_meteo'] as const;
export type WeatherProviderKind = (typeof WEATHER_PROVIDERS)[number];

/** The latest attempt's outcome, in the closed codes of M7 contract §5.1. */
export const WEATHER_ATTEMPT_STATUSES = [
  'ok',
  'unreachable',
  'rate_limited',
  'timeout',
  'too_large',
  'bad_response',
] as const;
export type WeatherAttemptStatus = (typeof WEATHER_ATTEMPT_STATUSES)[number];

export const weatherForecast = pgTable(
  'weather_forecast',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    // The latest successful fetch and its normalised ForecastHour rows (the
    // row shape is fixed by Package 1b's schema, not by SQL).
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    hours: jsonb('hours'),
    // Lower-case hex HMAC-SHA256 of the location the hours are for (ADR 0011
    // §14); never a coordinate.
    locationFingerprint: text('location_fingerprint'),
    firstHour: timestamp('first_hour', { withTimezone: true }),
    lastHour: timestamp('last_hour', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastAttemptStatus: text('last_attempt_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('weather_forecast_provider_check', oneOf(t.provider, WEATHER_PROVIDERS)),
    check(
      'weather_forecast_last_attempt_status_check',
      oneOf(t.lastAttemptStatus, WEATHER_ATTEMPT_STATUSES),
    ),
    check(
      'weather_forecast_location_fingerprint_check',
      sql`${t.locationFingerprint} is null or ${t.locationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    // Hours are always for a known location: the fingerprint may be null
    // only while there are no hours.
    check(
      'weather_forecast_location_hours_check',
      sql`${t.locationFingerprint} is not null or ${t.hours} is null`,
    ),
    // One row per provider.
    unique('weather_forecast_provider_unique').on(t.provider),
  ],
);
