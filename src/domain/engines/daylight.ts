import { parseIsoDate, type IsoDate } from '@/lib/dates';

// Daylight (M7 contract §5.3, ADR 0011 §18): sunrise and sunset for a point
// and a home date, from the NOAA solar-position equations (Meeus,
// "Astronomical Algorithms"), with the standard 0.833° for refraction and
// the sun's radius. Pure: no I/O, no clock, no dependency. Accurate to about
// a minute at New Zealand latitudes; the committed reference table in
// tests/unit/weather/daylight.test.ts holds it to that.

/** The sun's centre this far below the horizon is sunrise or sunset (NOAA). */
export const SUN_ALTITUDE_DEG = -0.833;
/** Daylight is rounded inward to this many minutes where it is used. */
export const DAYLIGHT_ROUNDING_MINUTES = 15;

export type Daylight = {
  date: IsoDate;
  /** Computed sunrise and sunset, to the second. */
  sunrise: Date;
  sunset: Date;
  /** Rounded inward: sunrise up, sunset down, to the quarter hour. */
  from: Date;
  to: Date;
};

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const MINUTE_MS = 60_000;

/** Julian centuries since J2000.0 for an instant. */
const julianCentury = (ms: number) => (ms / 86_400_000 + 2440587.5 - 2451545) / 36525;

/** The equation of time (minutes) and the sun's declination (degrees) at an instant (NOAA/Meeus). */
function solar(ms: number): { eqTime: number; declination: number } {
  const t = julianCentury(ms);
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(l0)) -
        2 * e * Math.sin(rad(m)) +
        4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
        0.5 * y * y * Math.sin(4 * rad(l0)) -
        1.25 * e * e * Math.sin(2 * rad(m)),
    );
  return { eqTime, declination };
}

/** The hour angle (degrees) at which the sun's centre is at SUN_ALTITUDE_DEG, or null if it never is. */
function hourAngle(lat: number, declination: number): number | null {
  const cosH =
    (Math.sin(rad(SUN_ALTITUDE_DEG)) - Math.sin(rad(lat)) * Math.sin(rad(declination))) /
    (Math.cos(rad(lat)) * Math.cos(rad(declination)));
  if (cosH < -1 || cosH > 1) return null;
  return deg(Math.acos(cosH));
}

/**
 * One event (sunrise −1, sunset +1) on the solar day whose noon falls on
 * the UTC calendar day `dayStartMs` begins, refined twice at its own time.
 */
function event(dayStartMs: number, lat: number, lon: number, sign: -1 | 1): number | null {
  let at = dayStartMs + (720 - 4 * lon) * MINUTE_MS;
  for (let i = 0; i < 3; i++) {
    const { eqTime, declination } = solar(at);
    const h = hourAngle(lat, declination);
    if (h === null) return null;
    at = dayStartMs + (720 - 4 * lon - eqTime + sign * 4 * h) * MINUTE_MS;
  }
  return at;
}

/**
 * Sunrise and sunset for a point and a local date (the date whose local noon
 * is near UTC midnight-to-midnight of that date at the point's longitude:
 * true for New Zealand and any zone near its solar time). Null in polar
 * day or night.
 */
export function sunTimes(
  date: IsoDate,
  point: { lat: number; lon: number },
): { sunrise: Date; sunset: Date } | null {
  const d = parseIsoDate(date);
  const dayStart = Date.UTC(d.year, d.month - 1, d.day);
  const sunrise = event(dayStart, point.lat, point.lon, -1);
  const sunset = event(dayStart, point.lat, point.lon, 1);
  if (sunrise === null || sunset === null) return null;
  return { sunrise: new Date(Math.round(sunrise)), sunset: new Date(Math.round(sunset)) };
}

const QUARTER_MS = DAYLIGHT_ROUNDING_MINUTES * MINUTE_MS;

/**
 * Inward to the quarter hour (contract §5.3): sunrise up (06:29 → 06:30,
 * 07:46 → 08:00), sunset down (19:43 → 19:30), so a statement never claims
 * daylight HOME has not computed. Every offset New Zealand uses is a whole
 * number of quarter hours, so a quarter hour of UTC is a quarter hour of
 * home wall time, on DST change days too.
 */
export function roundInward(sunrise: Date, sunset: Date): { from: Date; to: Date } {
  return {
    from: new Date(Math.ceil(sunrise.getTime() / QUARTER_MS) * QUARTER_MS),
    to: new Date(Math.floor(sunset.getTime() / QUARTER_MS) * QUARTER_MS),
  };
}

/** Daylight for a home date at the rounded home point; none without a location (contract §5.3). */
export function daylightFor(
  date: IsoDate,
  point: { lat: number; lon: number } | null,
): Daylight | null {
  if (!point) return null;
  const times = sunTimes(date, point);
  if (!times) return null;
  return { date, ...times, ...roundInward(times.sunrise, times.sunset) };
}
