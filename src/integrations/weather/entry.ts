import 'server-only';
import { refreshForecast } from '@/domain/weather/service';
import type { WeatherProvider } from '@/domain/weather/provider';
import { testWeatherEnv } from '@/lib/env';
import { syntheticWeatherProvider } from './fake';
import { openMeteoProvider } from './open-meteo';

// The weather composition root (ADR 0011 §10; ADR 0007 §42's pattern): the
// one place the domain's forecast refresh meets the real provider. The
// domain never imports an integration, and app code never sees a provider:
// app may import this module and no other in integrations/weather
// (eslint.config.mjs's second exception, held by
// tests/unit/layer-exceptions.test.ts). Server-only. What crosses it is
// structural: the refresh outcome, HOME's refusals (NotPermittedError) and
// WeatherUnexpectedError, none of which carries a message from below.

/**
 * Whether HOME_TEST_WEATHER asks for the synthetic provider. Refuses every
 * deployed environment, whatever is set (like HOME_TEST_CALENDAR_FEEDS);
 * parseEnv refuses it at boot too.
 */
export function testWeatherMode(env = testWeatherEnv()): boolean {
  if (!env.HOME_TEST_WEATHER) return false;
  if (env.VERCEL_ENV || env.VERCEL || env.NODE_ENV === 'production')
    throw new Error('HOME_TEST_WEATHER is for local and CI runs only');
  if (env.HOME_TEST_WEATHER !== 'fake') throw new Error('HOME_TEST_WEATHER must be fake');
  return true;
}

let provider: WeatherProvider | null = null;
const real = () =>
  (provider ??= testWeatherMode() ? syntheticWeatherProvider() : openMeteoProvider());

type Actor = Parameters<typeof refreshForecast>[0];

/** Refresh-on-use: refresh the household's forecast if it is due (POST /weather/refresh). */
export function refreshWeatherNow(actor: Actor) {
  return refreshForecast(actor, real());
}
