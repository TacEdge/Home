# ADR 0011 — M7 Weather and Free Windows: scope, architecture and decisions

Status: **Accepted** (owner, 2026-10-11). The owner approved decisions D1–D19 as recommended, with five amendments (§41; contract §12.4). This takes effect when PR #70 (Package 0) merges. The contract is `docs/m7/M7-BUILD-CONTRACT.md`. Decisions marked "Approved — owner decision D*n* (2026-10-11)" are listed, with the options weighed, in contract §12.2.

- **Implementation:** Package 0 merged (PR #70). Package 1a merged (PR #71; `0008_weather_forecast` run in Production and Preview). Package 1b merged (PR #72). Package 2 merged (PR #75; §44). Package 3, openings, is in review (§45). Nothing else is built (see "Implementation" below).

## Context

M6 is technically accepted on synthetic data (`docs/m6/M6-ACCEPTANCE.md`; Packages 0–5 merged, PRs #59, #60, #65–#69). The milestones before it are still waiting on owner steps in DEPLOY.md §E:

| Milestone | Waits on |
|---|---|
| M6 operational acceptance (real family use) | Items 18–19 |
| M5 operational acceptance | Items 16–17 |
| M4 operational acceptance | Items 12–15 |
| M3 owner acceptance (the restore rehearsal) | Items 7–8 |
| M1 acceptance | Items 1–6 |

The Production real-data gate is closed (ADR 0006 §2).

The ROADMAP M7 row commits M7 to: *"Open-Meteo adapter; `windows` engine (people × calendar × daylight × weather × duration); `free_window`, `weather_effect`, `alignment` insights."* Earlier decisions moved more into it:

- **The Today weather line** (ADR 0008 §20; M5 contract: "Deferred to M7").
- **"Weather, free windows, `alignment`, availability"** (ADR 0009 §3; M6 contract §1.3).

**What earlier milestones built, and what M7 must reconcile with:**

- **The four layers and the absence rule** (ADR 0008 §5, §6; ADR 0009 §5, §7). Layer 3, "uncertain or inferred meaning", is never shown, and its examples include "Alex is free from 2:30" and availability. "Empty calendar space is never presented as free time" (ADR 0009 §7). "No free time from empty space: no 'free', 'clear', 'nothing on so…'" (M6 contract §1.3).
- **Forbidden-phrase tests** in four suites reject `free`, `available`, `out`, `clear`, `quiet`, `needs`, `should` and `probably`, among others (M5 contract §8.1, M6 contract §5.5).
- **The architecture's own examples fail those tests.** SYSTEM-ARCHITECTURE §2.6 gives "Saturday morning's clear — enough for the fence." (`free_window`), "Rain Sunday afternoon; the painting's better Saturday." (`weather_effect`) and "You're both free Thursday evening." (`alignment`).
- **Engines see only what the reader can see** (CLAUDE.md rule 1; M6 contract §3.4). The non-interference invariant requires that records only the other adult can see leave the reader's outputs identical. So a window computed for Alex cannot see Sam's private events, and any computation across both adults' records would let a private event's timing be inferred from a window's absence.
- **No network on render, no background jobs** (M6 contract §3.7; ROADMAP "Not yet"). Calendars refresh on use: the page renders from the database and asks for a refresh after it has rendered.
- **The code has nothing for weather yet.** There is no weather table, no home location, no `WeatherProvider`, and `safe-fetch` admits only Google Calendar's secret address. Task `estimate_minutes` and `needs` (`dry_weather`, `daylight`, `two_people`, `shops_open`) already exist (migration `0004`) and are editable.

**Weather provider research** (2026-10-11; contract §6) found Open-Meteo's free API fits a private household app, needs no key, carries CC BY 4.0 attribution, limits requests per IP (a risk on Vercel's shared egress), and gives no DST-aware local time: its `timezone` parameter applies one fixed offset to the whole response.

## Decisions

### Scope

1. **M7 is Weather and Open Windows, computed without Kev.** It lets a parent:
   - read the forecast **in words** next to what is recorded, on Today and on Forward's Week;
   - see where **nothing is recorded** for the household, stated as exactly that, with its evidence and its limits;
   - see a small number of **openings**: a stretch with nothing recorded that meets written criteria, sometimes with a dry forecast, sometimes matched to a waiting task the family recorded with an estimate and a need for dry weather or daylight.

   Every statement is deterministic, traceable to records, a forecast or a computed sunrise, and complete without Kev. Nothing in M7 calls an LLM.

2. **M7 builds:**
   - a HOME-defined `WeatherProvider`, one Open-Meteo adapter and a fake provider (§10–§12);
   - a household forecast cache, in one new table, refreshed on use (§14–§15);
   - a daylight engine, computed locally (§18);
   - a gap engine and its coverage classification (§22–§28);
   - one insight family, `open_window` (§29–§35);
   - Today's weather sentence, and Forward Week's day phrases and openings (§37).

3. **M7 does not build** the following:

   | Item | Why, or where it goes |
   |---|---|
   | Availability: "free", "available", "everyone can", "nothing on so…" | §5–§7. M7 states only what is recorded. |
   | `alignment` ("both adults free") | §36. Approved — owner decision D17 (2026-10-11). |
   | A separate `weather_effect` insight | §36: folded into task openings. Approved — owner decision D18 (2026-10-11). |
   | Severe-weather warnings | §21. Approved — owner decision D7 (2026-10-11). |
   | Travel time, transport buffers, location reasoning | ADR 0009 §20; no record supports them |
   | Weather deciding suitability ("a good day for…", "best") | §31: weather is a sentence, or a filter the family recorded on a task |
   | Kev tools (`find_free_windows`, `get_weather`), Kev phrasing or recommendations | M8. The engines are shaped so M8 can call them. |
   | Writing to calendars, creating or scheduling tasks, proposals | M9 and later; no write path is added |
   | Learning from responses, adaptive ranking, implicit preferences | ADR 0009 §17 |
   | Weather or openings on Forward's Month and Season, or on a person's Coming up | §34. Approved — owner decision D16 (2026-10-11). |
   | Planning-hours settings, a settings screen, `user.preferences` | §22: a code constant in M7 |
   | Push notifications, background jobs, stored insights | ROADMAP "Not yet" |
   | Real household data, or the real home location, anywhere but Production after the gate opens | §13, §40 |

4. **One new table, nothing else in the schema.** `weather_forecast` (§14) arrives in its own migration-only package (1a), merged and run in Production before the code that uses it (MIGRATIONS.md). No column is added to an existing table: task `estimate_minutes` and `needs` already exist. No new runtime dependency: daylight is a short, tested function (§18).

### What M7 may say

5. **The four layers hold unchanged** (ADR 0008 §5). A gap is a layer-2 interpretation: a written rule, applied by code to the records the reader can see, carrying those records. It says **"nothing is recorded"**, for a named scope and span. It is never layer 3: M7 never says or implies that anyone is free, available, able to do something, or should.

   **Vocabulary.**
   - **Gap** (engine term, never shown): a stretch inside planning hours where no recorded commitment touches the chosen scope (§22).
   - **Opening** (the `open_window` insight; shown as a sentence, never by that name): a gap that meets the written criteria in §29–§30.
   - SYSTEM-ARCHITECTURE's `windows` engine and `free_window` insight become the gap engine and `open_window`. The architecture is annotated, not rewritten.

6. **Absence still proves nothing** (ADR 0008 §6; ADR 0009 §7). M7 states absence only as absence, with its scope ("for the household"), its span, its evidence (the commitments either side, the calendars and their freshness) and its limit. Every opening's Why ends with the same fixed sentence: "This is only what HOME has recorded that you can see. It isn't a check of anyone's plans."

   **A known limit, stated, not hidden.** A gap is computed from the reader's records. The other adult's private events are invisible to the reader, so a gap Alex sees may contain a private commitment of Sam's (§28). That is why M7 never claims availability.

7. **Forbidden phrases: nothing is relaxed.** The M5 list (M5 contract §8.1) and M6's additions (M6 contract §5.5) apply unchanged to every M7 template and rendered string, and their existing tests keep passing. M7 adds its own list (contract §5.8), including:
   - "free", "available", "nothing on", "everyone can", "you could", "a good time", "good for", "best", "ideal", "perfect", "nice", "fine", "mild", "chance to", "opportunity", "room for", "fits", "suitable", "recommend";
   - "out of date" is not used, because `out` is already forbidden: a stale forecast "hasn't updated since …".

   The example sentences in SYSTEM-ARCHITECTURE §2.6, `docs/concepts/TODAY.md` ("Saturday morning looks clear and dry — enough for the back fence.", "Good morning for the back fence, if you're keen.") and BRAND.md's voice table ("Saturday, 9 till 12, looks best.") are **superseded** for M7. They would fail the existing tests, and M7 does not change those tests to admit them. Kev's recommendations, if any, are M8's decision and are labelled as Kev's.

8. **Traceability.** Every weather sentence, day phrase and opening carries its `rule`, from a closed, documented list (contract §5), and its `facts`: record ids, dates and instants only, never text. Two fact kinds are added: `forecast` (the instants it covers and the fetch time) and `daylight` (the home date). Each shows its facts in place without JavaScript.

### Architecture

9. **Four pure engines, one agenda.**
   - **`src/domain/engines/daylight.ts`:** sunrise and sunset for a point and a home date (§18).
   - **`src/domain/engines/weather.ts`:** forecast hours to bands, phrases and sentences (§17).
   - **`src/domain/engines/gaps.ts`:** gaps and coverage for a scope over a range of home dates (§22–§28).
   - **The `open_window` family** in `src/domain/engines/insights/`, composing gaps, daylight, the forecast and the reader's tasks (§29–§35).

   They take records, the agenda's output, the forecast hours, `now` and the home zone. They do no I/O, never read the clock, use stable sorts with explicit tie-breaks, and import no `db`, `app`, `kev`, `ui` or `integrations`. The shared agenda read (`readAgendaInputs`, `loadAgenda`) stays the only place items are placed and expanded: the gap engine reads the agenda the page already loaded and never expands recurrence itself.

10. **The weather boundary mirrors the calendar boundary** (CLAUDE.md rule 13; ADR 0007 §42).
    - **Interface in the domain:** `src/domain/weather/provider.ts` defines `WeatherProvider`, its normalised `ForecastHour` and its error codes. No provider's shape leaks past it.
    - **Adapter:** `src/integrations/weather/open-meteo.ts`, which knows nothing about the database and logs nothing. A fake provider for tests.
    - **Composition root:** `src/integrations/weather/entry.ts`, the one place the domain's refresh meets the real provider. It becomes the second named app→integrations exception in `eslint.config.mjs`, pinned by `tests/unit/layer-exceptions.test.ts`.
    - **Service:** `src/domain/weather/` reads the cache as an actor and refreshes it.
    - **Route:** `POST /weather/refresh`, shaped like `/calendars/refresh`: same origin only, signed in, returns only `{ changed }`, `no-store`.

    **Options considered** (contract §3.1): (A) a forecast table refreshed on use, **chosen**; (B) no table, with an in-memory or framework fetch cache, rejected because serverless instances share nothing, so it would fetch on render and its output would depend on which instance answered; (C) a fetch during render, rejected by M6 §3.7.

### Weather

11. **Provider: Open-Meteo's free API, one adapter, no live fallback.** Approved — owner decision D1 (2026-10-11).
    - It is free for a private, non-commercial household app, with no key and no account. HOME's volume is under 1% of the free allowance.
    - The free limit is per IP, and Vercel's egress is shared, so occasional `429`s are expected. They are absorbed by the cache (§15).
    - **Named contingency,** decided by the owner on evidence if refusals recur: a MET Norway Locationforecast adapter (free; identified by User-Agent, not IP), or Open-Meteo's paid Standard tier (a key, a 99.9% target).
    - A second live provider is not built now. It would double the mapping, and it uses the same ECMWF model, so it adds availability but not skill.
    - **Licensing** (amended at approval, §41). The free API is used under Open-Meteo's non-commercial terms, for this private household's HOME only. Any commercial deployment of HOME would need:
      - appropriate commercial provider licensing (a paid Open-Meteo plan, at a price still unconfirmed, or another provider's commercial terms);
      - a credential and `safe-fetch` policy review, because the paid service uses a key and a different host;
      - a separate architecture decision, since CLAUDE.md rule 16 keeps HOME to this household.

12. **The request and its normalisation.**
    - **One GET** to `https://api.open-meteo.com/v1/forecast` with:
      - `latitude` and `longitude` (two decimal places, §13) and, when configured, `elevation`;
      - `hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m`;
      - `forecast_days=8`;
      - `timeformat=unixtime`.
    - **Never `timezone=`.** Open-Meteo applies one fixed offset to the whole response and ignores DST changes inside it. HOME stores UTC instants and converts to `Pacific/Auckland` in its own engines, tested across both changes.
    - **No `weather_code` and no daily fields in M7.** Each stored field has a consumer; sunrise and sunset come from §18.
    - **Normalisation:** each stored hour is `[start, start + 1h)` in UTC. Values the provider reports for the preceding hour (precipitation, its probability, gusts) are taken from the row stamped at the hour's end; instantaneous values (temperature, wind) from the row at its start. The adapter's contract test pins this mapping. A response that is malformed, non-monotonic, inconsistent in length or out of range is `bad_response`, and the stored forecast is unchanged.
    - **External content is data** (CLAUDE.md rule 7). The adapter parses numbers through a schema with bounds and never stores provider text.

13. **The home location lives in private environment configuration.** Approved — owner decision D2 (2026-10-11).
    - `HOME_LAT` and `HOME_LON`, and optionally `HOME_ELEVATION`, read only by `src/lib/env.ts`.
    - **Rounded at the boundary:** coordinates to two decimal places (about 0.7 km at New Zealand latitudes), elevation to 10 m. The exact values are never held anywhere else in the code.
    - **Never** in the repository, the database, exports, audit metadata, logs, the client or tests. `lat`, `lon`, `latitude`, `longitude`, `elevation` and `coordinates` join the logger's redacted keys, and no request URL is ever logged.
    - **Absent or invalid:** weather is simply absent: no request, no sentence, no error. HOME logs one boot line, `[home] weather location: set | absent | invalid`, never the value.
    - **The location key** (amended at approval, §41). `HOME_WEATHER_LOCATION_KEY` is a dedicated server-side secret (at least 32 random bytes, base64), read only by `src/lib/env.ts`. It keys the location fingerprint (§14) and does nothing else:
      - never in the database, the repository, logs or the client;
      - never shared with another purpose: a value equal to `HOME_CREDENTIALS_KEY` or `HOME_FINGERPRINT_KEY` is refused as invalid;
      - a keyed hash is required because a plain hash of two-decimal coordinates could be reversed by enumerating them.
    - **Location set, key absent or invalid:** weather is treated as unconfigured: no request, no forecast read, no words. The boot line reads `[home] weather location: set, key missing`, never a value. Daylight (§18), which needs no request, still comes from the configured location.
    - **A rotated key** makes every stored fingerprint mismatch, which behaves exactly as a location change (§15). No key is ever stored, so rotation needs no data step.
    - **Never logged:** the location, the canonical string, the key or any fingerprint input. The fingerprint itself is not logged either.
    - **Tests, docs and Preview** use a public synthetic point (Wellington's Civic Square, `-41.29`, `174.78`), never the home's. The owner approved this point on 2026-10-11 as the synthetic test and Preview point. A test that needs a second location uses another public synthetic point (Christchurch's Cathedral Square, `-43.53`, `172.64`). Preview has its own Preview-only key.
    - **Production:** the home location is real household data, so it and the location key are both set only after the real-data gate opens (DEPLOY.md §E, new items in Package 5, §40). Until then both stay unset and `HOME_REAL_DATA` stays closed.

14. **The forecast cache: one household-level table, `weather_forecast`.** Approved — owner decision D3 (2026-10-11).
    - **Columns:** id; `provider` (`open_meteo`, `CHECK`, unique); `fetched_at` and `hours` (normalised `ForecastHour` rows, `jsonb`) for the latest good forecast; `location_fingerprint` for the location those hours are for; `first_hour` and `last_hour`; `last_attempt_at` and `last_attempt_status` for the latest attempt; `created_at` and `updated_at`.
    - **The location fingerprint** (amended at approval, §41). `location_fingerprint` is the lower-case hex HMAC-SHA256, keyed by `HOME_WEATHER_LOCATION_KEY` (§13), of the canonical string `home-weather-location:v1|{provider}|{lat}|{lon}|{elevation}`:
      - `provider` is `open_meteo`; `lat` and `lon` are the rounded values with exactly two decimals (`-41.29`); `elevation` is the rounded value in metres, or `none` when unset;
      - every input that changes the request (provider, coordinates, elevation) is in it, and the version prefix lets the format change safely;
      - the column is text, 64 hex characters (`CHECK` on the format), and may be null only while `hours` is null (`CHECK`).
    - **No coordinate, elevation, location or user column.** The row holds no coordinates, only a keyed fingerprint that cannot be reversed without the key. A changed location is recognised on the next read, and no other place's forecast is ever shown (§15). Package 1a's schema test asserts the exact column list.
    - **No `created_by` or `visibility`.** It is not a user-facing record and holds nothing either adult recorded: a forecast for the household, read by both adults through a service that requires an actor. FAMILY-DATA-MODEL records the exception.
    - **Retention:** at most one row per provider. A success replaces the hours and sets the fingerprint. A failure leaves them, unless the last success is more than 24 hours old, when the hours are cleared. After a location change, the first attempt clears the old forecast whatever its outcome (§15).
    - **Export:** excluded, with its reason, in the export specification: it is derived, non-personal and fetched again on use. `export-completeness` holds.
    - **Grants:** `home_app` reads and writes it through the default privileges of `0002_app_role`. It is not append-only.

15. **Refresh on use, and freshness.**
    - **Rendering never fetches.** Today and Forward read the cache, render, and only then, when the location is set and a refresh is due, ask `/weather/refresh` once. The page never waits. Without JavaScript, the cached forecast is shown with its time.
    - **At most one request per 60 minutes:** measured from the last *attempt*, so failures never hammer the provider. The one exception is a location change, which makes a refresh due at once (below). After a `429`, the next attempt waits 3 hours. One refresh at a time, by an advisory lock (`home:weather_forecast`); a second caller answers `busy` and writes nothing.
    - **A failure keeps the last good forecast.** Only the attempt columns change, and the failure is audited (§16). The exceptions are the 24-hour retention rule (§14) and the first attempt after a location change (below).
    - **The forecast is for one location** (amended at approval, §41).
      - **On read,** the service computes the configured fingerprint (§14) and compares it with the row's. A mismatch, or a row with hours and a different or absent fingerprint, means **no forecast**: no words, no stale line, no dry-weather matching, exactly as "none yet". Daylight is unchanged, because it comes from configuration, not the row. Another location's hours are never presented.
      - **A mismatch makes a refresh due at once,** overriding the 60-minute interval, while the row still carries another location's fingerprint. The 3-hour wait after a `rate_limited` attempt still applies, as a courtesy to the provider; while it runs, no forecast is shown. Once an attempt has cleared the fingerprint (below), the normal interval governs the retries, so a failing provider is never called on every visit.
      - **The first attempt after a mismatch,** whatever its outcome, clears the old forecast. On success it stores the new hours and the new fingerprint. On failure the hours and the fingerprint are null (as are `fetched_at`, `first_hour` and `last_hour`, which described the old forecast), and the attempt is recorded.
      - **A rotated key** is a mismatch for every row, and behaves the same way.
    - **Execution: request-bound only** (amended at approval, §41).
      - The client POSTs `/weather/refresh` after render. All the work runs inside that request and finishes before the response. No background job, `after()`, `waitUntil()`, cron or queue. Rendering never calls the provider.
      - **Duration:** the route sets `export const maxDuration = 30` (seconds), within every Vercel plan's limit. The provider fetch is capped at 10 seconds by `safe-fetch`, and the database work by a `statement_timeout` of 5 seconds, set locally in the transaction.
      - **Sequence:**
        1. the gate (`assertFamilyWritesOpen`), then the actor (`assertCanWrite`), then the configuration (a location and a valid key, else `not_configured`), before any query;
        2. outside any transaction, read the row and decide: not due is `not_due`, with no request and no write;
        3. open **one** transaction: `SET LOCAL statement_timeout = '5s'`, `SET LOCAL idle_in_transaction_session_timeout = '25s'`, then `pg_try_advisory_xact_lock` on `home:weather_forecast`; not acquired is `busy`, with nothing written; re-check that the refresh is due, inside the lock;
        4. the provider fetch, inside that transaction (the M4 calendar-sync pattern: the lock must cover the fetch, or concurrent visits would each call the provider);
        5. write the row and the one audit row, and commit;
        6. respond `{ changed }`.
      - **Lock scope:** a transaction-level advisory lock, released at commit or rollback. It holds one pooled connection for at most the fetch (10 seconds) plus bounded writes.
      - **An interrupted request.** Every write happens after the fetch, inside the one transaction, so there is never partial state. If the function is stopped or the client disconnects before commit, nothing is committed: Postgres rolls the transaction back when the connection closes, and if the instance is merely frozen with the connection open, `idle_in_transaction_session_timeout` (25 seconds) ends the session, which rolls back and releases the lock. HOME does not rely on the request's abort signal to roll anything back. In every case nothing is recorded, `last_attempt_at` is unchanged, and the next visit retries under the normal rules; a provider answer that was lost costs one extra request at most.
      - **Unchanged:** the 60-minute interval from the last attempt, 3 hours after `rate_limited`, single-flight, the last good forecast kept on failure, and the 3-, 12- and 24-hour freshness and retention rules.
    - **Freshness, from `fetched_at`** (Approved — owner decision D6, 2026-10-11):

      | Age | Called | Behaviour |
      |---|---|---|
      | Under 3 hours | Fresh | Words shown; the time is in the Why, and on Forward's credit line |
      | 3 to 12 hours | Older | Words shown with their time in the sentence: "As of yesterday 21:00, …" |
      | Over 12 hours | Unusable | No forecast words anywhere. No dry-weather task is matched. Today says, in place of its weather sentence, "The forecast hasn't updated since {when}." |
      | None yet, or for another location | — | No forecast words and no stale line; the refresh is asked for after render |

16. **The refresh is gated and audited.** Approved — owner decision D4 (2026-10-11).
    - **Gated:** the refresh is a write of household data (it reveals the home location to the provider), so it starts with `assertFamilyWritesOpen()` and `assertCanWrite`, before any query or request. In Production with the gate closed, it is refused even if a location is set. Kev cannot refresh.
    - **Audited:** each attempt that reaches the provider writes one `weather.refresh` row, with structural metadata only (`{ status, hours }`): no coordinates, URL, response or values.
    - **Visible only to the adult whose visit triggered it** (`visible_to_user_id`), because a household-visible row would tell one adult when the other opened HOME.
    - **Structured codes only** (amended at approval, §41). The adapter and the service map every outcome to a closed set: `unreachable`, `rate_limited`, `timeout`, `too_large`, `bad_response`, `busy`, `not_due`, `real_data_closed` and `not_configured`.
      - Raw errors, including fetch and undici errors whose messages or causes can carry the URL, are caught at the adapter boundary and never rethrown, logged, stored, audited or returned. An error the adapter cannot otherwise map is `unreachable`.
      - An unexpected error elsewhere in the service is a generic failure: its transaction rolls back, nothing is recorded, no message propagates, and its log line carries the fixed code `unexpected`, which is never stored.
      - **Never logged or returned:** raw or rounded coordinates, elevation, the provider request URL, any query string, the location key or canonical string, headers and response bodies.
      - The route returns only `{ changed: boolean }`, or the existing refusal shapes of `/calendars/refresh` (signed out, cross-origin, gate closed), which carry no detail. Audit metadata stays `{ status, hours }`. A failure logs one event, `weather_refresh_failed`, with its code only.

17. **Uncertainty: bands, thresholds and horizon.** Approved — owner decisions D5 and D6 (2026-10-11).
    - **Bands over a span of hours** (code constants):

      | Band | When |
      |---|---|
      | **Rain likely** | Any hour with a probability of 60% or more, or 1.0 mm or more |
      | **Looks dry** | Otherwise, if every hour has a probability of 20% or less and under 0.2 mm |
      | **Showers possible** | Otherwise |
      | *(no band)* | Any hour in the span missing its probability or amount: no words |

      **Windy** is said when any hour's gusts reach 50 km/h. Temperature appears in the Why only.
    - **Horizon:** fetched for 8 days; shown for 7 (today to today + 6), nothing beyond.
      - **Today and tomorrow:** part-of-day words (morning 06:00–12:00, afternoon 12:00–18:00, evening 18:00–21:00) on Today, and span-level words in openings.
      - **Days 2 to 6:** one day-level band over that day's planning hours. No hour-precise timing is said more than two days out, because the hourly values beyond about four days are interpolated and skill falls through the week (contract §6.4).
      - A day whose planning hours the forecast does not fully cover has no words.
    - **"Likely"** is allowed only inside the band phrase "rain likely", which a threshold defines. "Probably" stays forbidden.

18. **Daylight is computed locally**, in `src/domain/engines/daylight.ts`, from the NOAA solar-position equations (Meeus), for the rounded home point and each home date in `Pacific/Auckland`. It is accurate to about a minute at New Zealand latitudes, needs no network and no dependency, and avoids the provider's fixed-offset and grid-cell errors.
    - **Where it is used,** sunrise is rounded up and sunset down to the quarter hour, so a statement never claims daylight HOME has not computed.
    - **Without a location**, there is no daylight: openings are bounded by planning hours alone, and no task needing daylight is matched.

19. **`safe-fetch` gains a second, separate policy.** This re-opens the calendar boundary review (M6 contract §2.3) for this one change, at high intensity.
    - **`openMeteoPolicy`:** approves exactly `https` `api.open-meteo.com` `/v1/forecast`, public addresses only; a frozen object like `googleCalendarPolicy`.
    - **Per-policy request:** headers come from the policy (`accept: application/json`, `user-agent: HOME-weather/1`), never a cookie, credential or HOME header. Limits: 10 seconds, 512 KiB, no redirects.
    - **A `429` gets its own code, `rate_limited`.** Everything else is unchanged, and the calendar policy and its tests are untouched.
    - **Nothing raw crosses the adapter** (amended at approval, §41). The adapter turns every `safe-fetch` refusal and every thrown error into one of §16's codes. No error object, message, cause or URL leaves it.
    - **CSP is unchanged:** the fetch is server-side.

20. **Attribution** (CC BY 4.0: "a link next to any location Open-Meteo data are displayed"). Approved — owner decision D8 (2026-10-11).
    - **One credit per page that shows forecast words,** beside them:
      - **Today:** a small muted "Open-Meteo" link directly after the weather sentence, or, when there is no sentence, after the first opening that cites the forecast;
      - **Forward Week:** beside the Coming up label, with the forecast's time: "Forecast as of 06:55 · Open-Meteo".
    - **An opening's Why** that cites the forecast repeats the link.
    - Links use `rel="noreferrer"`, so HOME's address is never sent. BRAND.md gains a line for it (Package 4).

21. **No severe-weather warnings in M7.** Approved — owner decision D7 (2026-10-11). If wanted later, MetService's public CAP feed is the official source. Its terms require that warning text is not altered, so HOME would show it verbatim, credited, and never paraphrased by Kev. That would be its own decision and package.

### Gaps

22. **A gap** is a maximal stretch, inside **planning hours** on a home date, where no recorded commitment in the chosen scope (§23) overlaps. Approved — owner decision D9 (2026-10-11).
    - **Planning hours:** 08:00–20:00 home time, a code constant. No settings screen, no schema.
    - **On today,** a gap's displayed start is clipped to `now`. Its identity is not (§27).
    - Gaps are computed per request, from the agenda the page already loaded, and stored nowhere.

23. **What blocks a gap.** A commitment blocks the stretch it overlaps, `[start, end)`, clipped to planning hours.
    - **A person's scope:** the timed occurrences that person is on (attending or responsible, as the agenda shows: own annotations, else the calendar's usual people, or a changed occurrence's series people); all-day events they are on (their whole planning day, every day the event covers); and scheduled tasks assigned to them.
    - **The household's scope:** the union of every visible household person's scope, plus occurrences and scheduled tasks with no household person on them.
    - **A timed event with no household person** (nobody recorded, or only people outside the household) blocks the household scope: it is recorded for the household, and HOME does not guess whose it is. It does not block a person's scope, but a person's gap that overlaps one names it in its Why. Approved — owner decision D11 (2026-10-11).
    - **An all-day event with no household person** (a public holiday, a birthday recorded as an event) does not block. It is named in the day's Why. Approved — owner decision D12 (2026-10-11).
    - **Never block:** birthdays from people's records; project target dates; tasks due; tasks with no scheduled window; zero-length occurrences; skipped occurrences.
    - **Kind is never read.** School and work series block like any other recorded commitment; HOME neither invents nor exempts routine.
    - **No buffers:** no travel time, no transport, no spacing around commitments.

24. **Time.**
    - **Recurrence** comes only from the agenda's occurrences. A skipped occurrence is absent; a changed one blocks at its changed time.
    - **Overnight and multi-day** timed occurrences block each home day they cover, as the agenda places them.
    - **Instants are compared in UTC; stretches are named in home wall time.** Both Pacific/Auckland changes happen at 02:00–03:00, outside planning hours, so a planning day is twelve hours on every date. Tests prove boundaries on both change days, including an occurrence that spans the change.
    - **An event kept in another zone** blocks the home-time stretch its instants cover.

25. **Coverage: what HOME can vouch for.** Approved — owner decision D13 (2026-10-11). For the reader, from the calendars they can see (the M5 health rules, ADR 0008 §18):

    | Coverage | When | Gaps |
    |---|---|---|
    | `unknown` | The reader has no live calendar | None, on any surface (first run) |
    | `partial` | A visible live calendar has failed, is more than 24 hours since its last success, or has never succeeded | Offered, and every statement is qualified ", as far as HOME knows"; the Why names the calendars |
    | `recorded` | Every visible live calendar is healthy | Offered |

    Like Forward and conflicts, the engine is given the agenda's coverage range and refuses a range it does not cover.

26. **Lengths.** The engine returns gaps of 60 minutes or more (a floor in its interface, for M8's later use). Openings need two hours or more. Approved — owner decision D10 (2026-10-11).

27. **Identity and determinism.**
    - **A gap's key:** `gap:{scope}:{date}:{HHMM}-{HHMM}`, where scope is `household` or a person id, and the times are the stretch's home wall-clock bounds before clipping to `now`. Built from ids and times only.
    - **On today,** the key keeps the unclipped stretch (from planning start, or the end of the last commitment before it), so a gap's identity does not change minute by minute. Its displayed start and its remaining length use `now`.
    - **Same input and `now`, same output,** sorted by date, start and key: a total order.

28. **Privacy.** Gaps are derived only from what the reader can see.
    - **The reader's own private events block the reader's view;** the other adult's are invisible.
    - **Non-interference:** adding records only the other adult can see leaves the reader's gaps, coverage, openings, keys, Today, Forward and rendered pages byte-identical. A private event of Sam's cannot shrink, split or remove a gap of Alex's.
    - **Never across adults:** no computation reads both adults' records to produce what either sees, and no system actor computes gaps.

### Openings

29. **Two families, weekends only.** Approved — owner decision D14 (2026-10-11).
    - **A candidate** is a household gap, intersected with daylight (when known) and planning hours, of two hours or more, on Saturday or Sunday, within today to today + 6, on a day whose coverage is `recorded` or `partial`.
    - **A plain opening** says that nothing is recorded, with the forecast as an extra sentence when it is usable.
    - **A task opening** matches the candidate to a waiting task (§30).
    - **Per day, at most one opening:** a task opening if any task matches, otherwise a plain one, on the longest qualifying candidate (the earliest on a tie).
    - **Weekends only,** because on an under-recorded weekday (no work calendar) "nothing recorded" would appear almost every day, and that is the noise ADR 0008 §6 warns against. Seven days always hold exactly two weekend days.

30. **Task openings.** A task matches when it is open, not scheduled, visible to the reader, has `estimate_minutes`, and has `needs` that are non-empty and only `dry_weather` and `daylight`. A task in a `paused` or `done` project is not matched.
    - **The candidate** must be at least as long as the estimate.
    - **`daylight`:** daylight must be known (the candidate is then within it).
    - **`dry_weather`:** the forecast must be usable (§15), and "looks dry" over the candidate on today and tomorrow, or over the whole day's planning hours on days 2–6.
    - **`two_people` or `shops_open`:** never matched in M7; HOME has no rule for either.
    - **Several matching tasks:** the opening names the first by due date (none last), then title, then id, and its Why lists the rest. That is a written order of recorded fields, not a judgement of importance.
    - **The assignee is not read.** A task opening is about the household's recorded time, not a person's.

31. **Weather never decides suitability.** On a plain opening the forecast adds one sentence, whatever its band, including "rain likely". Weather never creates, ranks or removes a plain opening. On a task opening, dry weather is a filter the family recorded on the task.

32. **Wording** (templates in contract §5.6; final copy approved from screenshots in Package 4):
    - **Plain:** "Nothing is recorded for the household on Sunday, 08:00–19:30. The forecast for Sunday as of 06:55 has showers possible."
    - **Task:** "Paint the back fence is recorded as about three hours, in dry weather and daylight. Nothing is recorded for the household on Saturday, 10:00–19:30, and the forecast for Saturday as of 06:55 looks dry."
    - Never "free", "a good time", "you could", "best" or any word in §7's lists.

33. **Identity and lifecycle.**
    - **Key:** `open_window:household:{date}:{HHMM}-{HHMM}`, with `:task:{taskId}` for a task opening. The times are the candidate's bounds before clipping to `now`. No forecast value, fetch time or text is in a key. The longest key is 84 characters, within `insightKey`'s 200.
    - **A forecast change** rewrites a plain opening's sentence and keeps its key, with any response on it.
    - **A task opening** exists only while its task matches. When the forecast turns wet, its key is no longer derived and the day's plain opening (a different key) takes its place. When it turns dry again, the task opening and any response to it return.
    - **A change to the stretch's bounds** (a commitment added, moved or removed, a calendar refresh with new times, a different daylight edge) is a new key, eligible again. Anything else keeps the key.
    - **Current** while its end is after `now` and its remaining length is still two hours or more. Keys carry the opening's date, not the viewing date, so midnight changes nothing.

34. **Where openings appear, how many, in what order.** Approved — owner decisions D15 and D16 (2026-10-11).

    | Surface | Openings | Shown |
    |---|---|---|
    | **Today** | Today's and tomorrow's | At most one: the earliest without a response |
    | **Forward, Week** | Today to today + 6 | At most two (always enough for one weekend) |
    | **Forward, Month and Season** | None | — |
    | **A person's Coming up** | None | — |

    - **Ranking:** `open_window` ranks after every existing family (`data_health`, `conflict`, `preparation`, `busy_day`), then chronologically, then by key. An opening never displaces anything M5 or M6 lists.
    - **Shown:** Today shows three in all and Forward two, as now. Openings past their family's cap are neither listed nor counted in "+ N more"; the next appears when the first is dismissed or passes.
    - **Marks:** ○, never the Sun accent.

35. **Responses reuse `insight_response`.** Dismiss and Not useful work on openings exactly as on other insights: per adult, audited with the kind only, gated, idempotent, and changing no rule or ranking.
    - **`respondToInsight`** adds `open_window` to the Today and Forward listed sets. It re-derives the reader's openings from its existing 90-day agenda read, plus one read of the forecast cache, and accepts an opening key that is current and derivable on the named surface (ignoring the cap). Everything else is refused as `not_eligible`, as now. A person's page refuses it.
    - **No new table, column or response value.**

36. **`alignment` and `weather_effect`.**
    - **`alignment` is deferred** (Approved — owner decision D17, 2026-10-11). "Both adults have nothing recorded" is unknowable to either adult: each sees only their own private events, so the statement would be wrong for one of them, and computing it from both would leak. A later design would need the owner to decide whether private events may contribute an anonymous "something recorded" block, and that is a privacy decision of its own.
    - **`weather_effect` is folded into task openings** (Approved — owner decision D18, 2026-10-11). Its two cases were "a task needing dry weather" (now the task opening, which appears and disappears with the forecast) and "an outdoor event" (no record says an event is outdoors; HOME would have to guess from titles). "The painting's better Saturday" is a recommendation, which M7 does not make.

### Experience

37. **Today, Forward and their states** (contract §4):
    - **Today:** one weather sentence after the headline (and its late sentence), in ink, never the accent: "Looks dry until midday, then showers possible." It covers the rest of today, or tomorrow in the evening state. Its Why gives the forecast time, the hours, the low and high temperature and the credit. At most one opening in Worth knowing. M5's headline rules are unchanged.
    - **Forward Week:** each day's row ends with a day phrase of at most four words ("Looks dry", "Showers possible, windy"). Openings in Worth knowing.
    - **States:**

      | State | Today | Forward Week |
      |---|---|---|
      | No location | No sentence, no credit | No phrases, no credit |
      | Location, no forecast yet (or one for another location) | No sentence; refresh after render | No phrases |
      | Older forecast | Sentence with its time | Phrases; credit line with its time |
      | Unusable forecast | "The forecast hasn't updated since {when}." | No phrases |
      | First run (no calendar) | Sentence if there is a forecast; no openings | Phrases if there is a forecast; no openings |
      | No JavaScript | Cached forecast with its time; every Why is `<details>`; Dismiss and Not useful are forms | The same |

### Performance

38. **One more query, no network.**
    - Today and Forward each add one query, the forecast row, to their existing reads. `respondToInsight` adds the same one. Query counts stay constant in the number of records, and tests prove it.
    - The gap engine is linear in the occurrences of the days it covers, after a sort. Daylight is a few arithmetic steps a day.
    - No LLM and no network on render. Engine and render times are measured in Package 5 on the seeded scenarios and a synthetic 300-event household.

### Process

39. **Packages:** seven, numbered 0, 1a, 1b, 2, 3, 4 and 5 (contract §2). Approved — owner decision D19 (2026-10-11).
    - **0:** this ADR and the contract.
    - **1a:** the `weather_forecast` migration, alone (migration-first).
    - **1b:** weather: provider interface, adapter, fake, `safe-fetch` policy, cache service, refresh route and client, env, logger redaction, the weather and daylight engines. No screen.
    - **2:** the gap engine and coverage.
    - **3:** openings: the `open_window` family, wording, keys, listing caps and responses. Domain only.
    - **4:** the screens: Today's sentence, Forward Week's phrases and openings, credit, states, no-JS, devices.
    - **5:** acceptance.

    Each package follows ADR 0010's tiers (contract §2.3). Package 1b's application code merges only after 1a has run in Production and Preview. Review is high for 1a, 1b, 2, 3 and 5, and medium for 4. Package 1a cannot start until the owner merges Package 0 and says to start.

40. **Production.** M7 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed.
    - It adds one migration (Package 1a) and **two Production settings**, the home location and its location key (§13), the first since M4's keys.
    - The location and the key are set in Production only after the gate opens, and the refresh is refused while the gate is closed.
    - Package 5 adds DEPLOY.md §E items and the environment table's rows for `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` and `HOME_WEATHER_LOCATION_KEY` (contract §10.2).

41. **Amendments at approval (2026-10-11).** The owner approved D1–D19 as recommended, with five amendments, written into the decisions above and into the contract (§12.4 lists the sections):
    1. **Location identity.** D3 becomes "A, with a keyed location fingerprint": a `location_fingerprint` column, keyed by a new secret, `HOME_WEATHER_LOCATION_KEY`. A changed location shows no forecast until the next successful refresh, never another place's forecast (§13, §14, §15).
    2. **Refresh execution.** Request-bound only, with a bounded duration, one transaction holding the lock across the fetch, and stated guarantees for an interrupted request (§15).
    3. **Error handling.** A closed set of codes; raw errors never cross the adapter; nothing location-bearing is logged, stored, audited or returned (§16, §19).
    4. **Unassigned events.** The contract uses §23's definition of a timed event with no household person, unchanged here; no new visibility rule is needed (contract §5.4).
    5. **Licensing.** The free API is used under Open-Meteo's non-commercial terms, for this household only; a commercial deployment would need its own licensing, review and decision (§11).

    The owner also approved Wellington's Civic Square as the synthetic test and Preview point (§13). Nothing else changed: no new table beyond `weather_forecast`, no new runtime dependency and no new insight rule.

## Implementation

### Package 1a: the forecast table (merged, PR #71)

42. **`weather_forecast`, migration `0008_weather_forecast` (migration only).** Built exactly as §14 and contract §3.9 describe; FAMILY-DATA-MODEL has the as-built entry. No decision changed.
    - **Columns:** `id` (uuid, `gen_random_uuid()`); `provider` (text, not null); `fetched_at`, `first_hour`, `last_hour`, `last_attempt_at` (timestamptz, nullable); `hours` (`jsonb`, nullable; its row shape is Package 1b's); `location_fingerprint` and `last_attempt_status` (text, nullable); `created_at`, `updated_at` (timestamptz, not null, `now()`). Nothing else: no coordinate, elevation, location, user, creator or visibility column.
    - **Constraints**, text plus `CHECK` as for every closed set in the schema (`src/db/schema/common.ts`), never a Postgres enum: `weather_forecast_provider_check` (`open_meteo`); `weather_forecast_last_attempt_status_check` (the six codes, or null); `weather_forecast_location_fingerprint_check` (`^[0-9a-f]{64}$`, or null); `weather_forecast_location_hours_check` (the fingerprint is null only while `hours` is null); `weather_forecast_provider_unique` (a `UNIQUE` constraint, the only index besides the primary key). No foreign key, trigger, seed or backfill; no existing table, type, grant or function changes.
    - **Grants:** none in the migration. `home_app` has `SELECT`, `INSERT`, `UPDATE` and `DELETE` through `0002_app_role`'s default privileges, and no `TRUNCATE`; `tests/integration/app-role.test.ts` proves it.
    - **Export:** excluded in `src/domain/export/spec.ts` with the reason "derived, non-personal forecast cache; fetched again on use".
    - **Activity:** not registered in `src/trust/audit-subjects.ts`, which registers tables with a visibility column or an owner; this table has neither (`tests/unit/audit-subjects.test.ts`).
    - **Migration-first:** no application code uses the table. `0008` runs in Production (**Migrate production database**, owner-approved) and in Preview (**Migrate preview database**) before Package 1b merges, and 1b's description links the run.

### Package 1b: weather provider, cache and refresh (merged, PR #72)

43. **Built as §10–§19 and contract §5.1–§5.3 describe; no decision changed.** No screen, schema, migration, gap engine, opening, Kev change, dependency or Production setting.
    - **Provider contract.** `src/domain/weather/provider.ts`: `WeatherProvider.fetchForecast(point)` returns `ForecastHour[]` (UTC `[start, start + 1h)`, five nullable numbers) or throws `WeatherProviderError` with one of `unreachable`, `rate_limited`, `timeout`, `too_large`, `bad_response`. The stored row shape (`weather_forecast.hours`) is a strict Zod schema of those hours with `start` as an ISO instant on the hour; the service checks hours are bounded and consecutive before it writes, whatever the provider. `first_hour` and `last_hour` are the first and last hours' starts; the read reports the span as `[first, last + 1h)`.
    - **Adapter.** `src/integrations/weather/open-meteo.ts` builds exactly §5.1's request (`latitude`, `longitude`, optional `elevation`, `hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m`, `forecast_days=8`, `timeformat=unixtime`; nothing else) and fetches it only through `openMeteoPolicy`. Hour `t` takes temperature and wind from row `t`, and precipitation, its probability and gusts from row `t + 1h`, so 192 rows make 191 hours. A non-JSON, non-monotonic, gapped, off-the-hour, length-mismatched or out-of-range answer is `bad_response`. Only the five arrays and `time` are read; the location the provider echoes is never read or kept. Every error leaves as a fresh `WeatherProviderError` (no message beyond the code, no cause): safe-fetch's `timeout`, `too_large`, `rate_limited` and `bad_response` keep their names; every other refusal (another destination, a private address, a redirect, a 4xx, a 5xx) and any other thrown value is `unreachable`.
    - **`openMeteoPolicy`** in `src/integrations/net/safe-fetch.ts`: frozen; exactly `https://api.open-meteo.com/v1/forecast` on the default port, no user, password or fragment; public addresses only; headers `accept: application/json` and `user-agent: HOME-weather/1` and nothing else; 10 seconds, 512 KiB, no redirects; a `429` is `rate_limited`. `FetchPolicy` gained optional per-policy `headers`, `limits` and `rateLimited`; `googleCalendarPolicy` sets none, so the calendar's requests and answers are unchanged and its suite passes unmodified. `SafeFetchErrorCode` gained `rate_limited`; the ics adapter maps it to `unreachable` for totality (its test's table gained that line).
    - **Configuration.** `weatherConfig()` in `src/lib/env.ts` is the only reader of `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` and `HOME_WEATHER_LOCATION_KEY`. They are not on the parsed `env`, and a bad value never stops boot. Plain decimals only; latitude within ±90, longitude within ±180, elevation −500 to 9,000 m; rounded at once (coordinates to two decimals with no negative zero, elevation to the nearest 10 m), and only the rounded, frozen point leaves the module. Neither coordinate set is `absent`; one without the other, or any bad value, is `invalid`. The key must be canonical standard base64 of at least 32 bytes, not one repeated byte, and not equal to `HOME_CREDENTIALS_KEY`, `HOME_CREDENTIALS_KEY_PREVIOUS`, `HOME_FINGERPRINT_KEY`, `BETTER_AUTH_SECRET` or `AUDIT_HASH_SECRET`; otherwise the status is `set, key missing` (the point is kept for daylight; no fingerprint, no request, no read). The key's bytes never leave `env.ts`. Boot line: `[home] weather location: set | absent | invalid | set, key missing`. `HOME_TEST_WEATHER=fake` (a dry synthetic week through the real normaliser) is refused by `parseEnv` on any Vercel deployment or under `NODE_ENV=production`, and again by the composition root.
    - **Fingerprint v1.** Lower-case hex HMAC-SHA256, keyed by the key's decoded bytes, of `home-weather-location:v1|open_meteo|{lat}|{lon}|{elevation|none}` with the coordinates to exactly two decimals. Test vectors (key: the 32 ASCII bytes `home-test-weather-location-key32`, test-only), computed independently with `openssl dgst -sha256 -mac HMAC`: Wellington, no elevation, `5d5a6025…c4e179d`; Wellington, 20 m, `e33d0374…21457b88`; Christchurch, no elevation, `efa14013…78b34bfa` (in full in `tests/fixtures/weather.ts`).
    - **Cache and refresh.** `src/domain/weather/service.ts`. `readForecast(actor)`: a person only; unconfigured returns `{ configured: false }` with no query; otherwise one query, never the network: `none` when there is no row, its fingerprint is not the configured one (or absent) or it has no fetch time; `unusable` (with its fetch time, for the stale line) when it is this location's but over 12 hours old or its hours were cleared; else `fresh` or `older` with the hours, their span, `fetchedAt`, the last attempt and `refreshDue`. `refreshForecast(actor, provider)` follows §15's sequence exactly: the gate, then `assertCanWrite` (refusing Kev, a hand-made sync actor and the system), then the configuration (`not_configured`), before any query; the row read and `not_due` outside any transaction; then one transaction (via `auditedWrite`): `SET LOCAL statement_timeout = '5s'`, `SET LOCAL idle_in_transaction_session_timeout = '25s'`, `pg_try_advisory_xact_lock(hashtextextended('home:weather_forecast', 0))` (`busy`), the row read and due check again, the fetch, then one upsert and one audit row, and commit. Due rules (`src/domain/weather/rules.ts`): no attempt, or 60 minutes since the last; never within 3 hours of `rate_limited`; at once when the row carries a different fingerprint. A success writes the hours, the fingerprint, `fetched_at` (the attempt time) and the attempt; the first attempt after a mismatch that fails clears the hours, fingerprint, fetch time and span; a failure when the last success is over 24 hours old clears the hours and span and keeps `fetched_at` and the fingerprint; any other failure writes the attempt only. The audit row is `weather.refresh` `{ status, hours }`, private to the triggering adult. `changed` is true for a success and for a retention clear, false otherwise (a cleared mismatched forecast was never shown).
    - **Error codes and logs.** The outcome is `ok`, a provider code, `busy`, `not_due` or `not_configured`; the gate and actor refusals are `NotPermittedError` (`real_data_closed`, `kev_cannot_write`, `sync_actor`, `not_a_user`). A provider failure logs `weather_refresh_failed` `{ code }` at warn after commit; anything unforeseen rolls the transaction back, logs `weather_refresh_failed` `{ code: 'unexpected' }` at error and throws `WeatherUnexpectedError` (fixed message, no cause). The logger redacts `lat`, `lon`, `latitude`, `longitude`, `elevation` and `coordinates`, and scrubs any Open-Meteo request URL or coordinate query parameter from strings.
    - **Route and client.** `POST /weather/refresh` (`src/app/(home)/weather/refresh/route.ts`): `maxDuration = 30`, no `after()` or `waitUntil()`; same origin (403), signed in (401), `no-store`; returns only `{ changed }`; a refusal is `{ changed: false }`, an unforeseen failure `500 { changed: false }`. `src/app/_weather/refresh-weather.tsx` (`RefreshWeather`) posts once after render and re-reads the page when changed. It is mounted nowhere: Package 4 places it on Today and Forward Week when the page's read says `refreshDue`.
    - **Composition root.** `src/integrations/weather/entry.ts` exports only `refreshWeatherNow(actor)` and `testWeatherMode()`; `eslint.config.mjs`'s exception list now names it beside the calendar's, pinned by `tests/unit/layer-exceptions.test.ts`, which also proves nothing under `src/app` reaches a provider, the adapter or the endpoint except the route through the entry.
    - **Engines.** `src/domain/engines/weather.ts`: §5.2's constants, bands, windy, freshness, `todaySentence`, `tomorrowSentence`, `dayPhrase`, `staleSentence`, each with its rule and `forecast` fact; Today's sentence also carries each part's band, highest chance, rain and strongest gust and the low and high for its Why. `PLANNING_FROM` and `PLANNING_TO` live here for now; Package 2's gap engine shares them. `src/domain/engines/daylight.ts`: NOAA/Meeus at 0.833°, refined twice at the event time, rounded inward to the quarter hour (on UTC, which is home quarter hours because New Zealand's offsets are whole hours). Neither is used by a screen yet.
    - **Connection safety.** `src/db/create.ts` adds a no-op `'error'` listener to each pooled client, so a session the server ends while it is checked out (the idle-in-transaction timeout of an interrupted refresh) fails its query and rolls back instead of raising an unhandled event that would end the process; the pool discards the client on release.
    - **Test evidence.** Unit: `tests/unit/weather/` (env and fingerprint vectors, policy, adapter contract, engines and DST, daylight table, due rules, route and client, boot line, log redaction); `tests/unit/layer-exceptions.test.ts`. Integration as `home_app`: `tests/integration/weather.test.ts` (W2–W4, W7–W13, W18, W20–W23, P4, P5, P8, single flight across two adults and two tabs, the read's one query, performance). Mutation proof, each restored: serving another location's hours, an unkeyed fallback, skipping the 429 backoff, skipping the gate, logging coordinates, dropping a redacted key, a write committed outside the transaction before the fetch, and a widened host each failed named tests.
    - **Caveats.**
      - The daylight reference table was computed with PyEphem 4.2.1 under NOAA's convention, because NOAA's calculator could not be reached from the build container. It agrees with the contract's 17 October and 21 June figures.
      - `idle_in_transaction_session_timeout` was proven by a real 25-second wait against local Postgres 16; Neon's pooler behaviour is Package 5's to observe in Preview.
      - Preview has no location or key yet: DEPLOY.md §E items 20–22 are Package 5's.
      - `HOME_ELEVATION`'s range (−500 to 9,000 m) and treating a lone coordinate as `invalid` are this package's choices; the contract is silent.
    - **Owner decisions at review (2026-10-12):**
      - **"Windy at times." on tomorrow's sentence is an approved wording interpretation.** Contract §5.2 states it for `weather.today` only; `weather.tomorrow` adds it under the same rule (§17: windy is said when any hour's gusts reach 50 km/h). Package 4's screenshot approval still covers the final copy.
      - **A lone `HOME_LAT` or `HOME_LON` is `invalid`, not `absent`.** Both fail closed in the same way: no request, no read, no forecast words, no error; only the boot-line word differs from W12's literal wording.
      - **Migration-first evidence:** `0008` ran in Preview (https://github.com/TacEdge/Home/actions/runs/38185992836) and Production (https://github.com/TacEdge/Home/actions/runs/38125452393) before this package merged.
    - **Follow-ups recorded, outside this package:** issue #73 (the refresh route logs no structured line for an error raised outside the service) and issue #74 (no `pool.on('error')` for idle pooled connections; pre-existing). The `src/db/create.ts` comment was corrected here: inside Next.js an unhandled client error is logged raw by the framework rather than exiting the process.

### Package 2: the gap engine and coverage (merged, PR #75)

44. **Built as §22–§28 and contract §5.4–§5.5 describe; no decision changed.** No insight family, opening, wording, screen, Today or Forward change, `insight_response` write, schema, migration, provider change, Kev change or dependency.
    - **Engine.** `src/domain/engines/gaps.ts`, pure (no db, network, clock, LLM or write; `now` injected): `gaps({ now, timeZone, range, agendaRange, days, people, tasks, calendars, scopes })` returns `{ coverage, gaps }`. `days` is the shared agenda's output, so for events recurrence, skips, changed occurrences, overnight placement and other zones come from the agenda alone; `people` are the reader's visible people with `inHousehold`; `tasks` are the reader's scheduled tasks, each with its full recorded window and `assigneePersonId` (`{ id, assigneePersonId, scheduledStartsAt, scheduledEndsAt }`); `calendars` are the reader's (archived ones ignored). A scope is `household` or the id of a person the reader can see (any other is refused, `GapScopeError`); several scopes may be asked at once and a repeated one is one scope. Rules `gap.household` and `gap.person`; `GAP_FLOOR_MINUTES = 60`; the two-hour opening minimum is Package 3's and is not applied here.
    - **Planning hours** moved from `weather.ts` to `src/domain/engines/planning.ts` (`PLANNING_FROM`, `PLANNING_TO`), which both engines import, so a stretch and the forecast words for it always mean the same hours. Bounds are computed per date through the IANA zone (`instantFromWallClock`), never by adding 24 hours: the planning day is 12 hours on both Pacific/Auckland change days.
    - **Blocking**, exactly §23. Overlap is `[start, end)` on UTC instants; each commitment is clipped to the date's planning hours and the clipped intervals are sorted once (start, end, reference) and swept once, merging touching and overlapping ones. A person's scope: the timed occurrences the agenda shows them on (attending or responsible), every all-day event they are on (the whole planning day), and scheduled tasks assigned to them. The household: everything on a visible household person's scope, plus every timed occurrence and scheduled task with no household person on it (nobody, or only people outside the household, D11). Never: an all-day event with no household person (D12), birthdays, project targets, tasks due, tasks with no window, zero-length occurrences, skipped occurrences. Kind is never read.
    - **Scheduled tasks come from their records, not the agenda's placement.** The shared agenda places a scheduled task only on the home date its window starts (as Today and Forward show it), so a window that began before the range's first day (overnight Saturday 22:00 to Sunday 10:00 read from Sunday; Friday 18:00 to Sunday 12:00 read from Saturday) never reached the engine: a false "nothing recorded" stretch, and a key for the same date that changed across midnight. The engine no longer reads the agenda's `task_scheduled` items. `scheduledTasks` (in the engine module, pure) selects, from the same authorised task records the actor-aware agenda read already loaded (`AgendaInputs.records.tasks`, `listTasks(actor, { status: 'open' })`, so visibility and archive are the read's), exactly the tasks the agenda treats as scheduled: status `open` with both window ends; a unit test proves the selection equals the agenda's placed set. Each task's real window is intersected with every requested date's planning hours in the per-date loop, from the home date it starts to the home date before it ends (an end at midnight does not reach the next date), clamped to the range, with no fixed lookback; the scope rules are unchanged (an assignee in the household: that person and the household; none, or only someone outside it: the household only); each task counts once, however often it is given. So overnight and multi-day windows block every date they cover, and a date's stretches and keys are the same whichever date the range starts on. No new query: the records were already read for Today's tasks (ADR 0008 §32), and `agenda.ts`, Today and Forward are unchanged.
    - **Today and identity.** The stretch is computed with no reference to `now`; `shown.from` is `max(stretch.from, now)` and a gap whose shown span is under the floor (or over) is not returned, so days before today return nothing and a key holds still as the day goes on (G15). Key `gap:{household|personId}:{YYYY-MM-DD}:{HHMM}-{HHMM}` from the stretch's home wall clock: ids and times only, at most 61 characters with a uuid, within `insightKey`. Order: date, then the stretch's start, then the key, a total order across scopes.
    - **Facts** (structural; no sentence anywhere in this package): `planning` (`08:00`, `20:00`); `range` (the gap's date); the scope's people (`person`, the visible household people for the household); `before` and `after`, the commitment ending where the stretch begins and beginning where it ends (event or task fact), or null at a planning edge, with explicit tie-breaks (after: the first by start, end, reference; before: the one that started last, then the first by reference); `unblocking`, the events named but not blocking: the day's all-day events with no household person, and, for a person, timed events with no household person over the shown span; and every calendar consulted with its health.
    - **Coverage** (`coverageOf`, for the reader, not per day): no unarchived calendar is `coverage.unknown` and no gaps for any scope; any calendar `failed` or `stale` by M5's `unhealthyCalendars`, or `never` (no success recorded), is `coverage.partial`, gaps returned; otherwise `coverage.recorded`. Each calendar fact is `{ kind: 'calendar', id, health, lastSyncedAt }`. Like conflicts and Forward, the engine refuses a range its agenda did not cover (`GapRangeError`, G23).
    - **Composition.** `src/domain/insights/gaps.ts`: `readGaps(actor, now, timeZone, deps, days, scopes?)` is one `readAgendaInputs` read as the signed-in adult (which already reads the reader's calendars), one placement, one engine run; `gapsOver` is the pure part, for a page that has already read its agenda, and passes `scheduledTasks(inputs.records.tasks)`; the default scopes are the household and each visible household person. No query of its own (7 queries, exactly the agenda read's, constant after 20 more events), nothing stored or cached, no system actor.
    - **Privacy evidence.** `tests/integration/gaps.test.ts` as `home_app`, two adults, through the real services: Sam's private event (Saturday 12:00–13:00), private all-day event (Sunday), private scheduled task, private person on a private event and private stale calendar leave Alex's gaps, keys, order, facts and coverage deep- and byte-identical, with none of their ids in Alex's output; the same records split Sam's Saturday, remove Sam's Sunday and make Sam's coverage `partial` (P1 for gaps and coverage). A second P1 case: Sam's private overnight scheduled task (Saturday 24 22:00 to Sunday 25 11:00, assigned to Sam), read from Sunday, leaves Alex's gaps, keys, facts and coverage byte-identical with its id absent, and moves Sam's own Sunday (Sam and household) to 11:00–20:00. G7, G9, G13 and G24 (a synced event with no annotations on a calendar whose usual person is Milo) also run through the real services, and D: an overnight task Saturday 24 22:00 to Sunday 25 10:00 for Milo made with `createTask`, read with the range starting Sunday (the agenda from Sunday does not place it), gives household and Milo 10:00–20:00 with keys and Sunday gaps byte-identical to the read from Saturday, for both adults, and the read's query count still equals the agenda read's.
    - **Test evidence.** Unit `tests/unit/gaps/gaps-engine.test.ts`: G1–G25, each named with its row and its expectation as the matrix writes it; G20 over eight seeds (the conflict engine's mulberry32 and Fisher–Yates) shuffling the agenda's days and items, people, tasks, calendars and scopes, deep and byte equal; the owner's extra edges (60 minutes kept and 59 dropped, touching and overlapping merges, a carry-over into the first day and one past the last, a task window from before the range, fortnightly, a Sydney series across both zones' DST changes, an overnight weekly commitment, archive and restore, keys under moved boundaries and under title, kind, role and people changes, keys as `now` moves); scheduled tasks over their whole window (A: an overnight task Saturday 22:00 to Sunday 10:00 for Milo with the range and agenda Sunday only blocks the household and Milo 08:00–10:00, and unassigned only the household; B: a Friday 18:00 to Sunday 12:00 task for Sam read from Saturday leaves no Saturday gap and Sunday 12:00–20:00; C: Sunday's gaps, keys and stretch bounds byte-identical with the range starting Thursday, Friday, Saturday or Sunday, household and person scopes; a task counted once beside its agenda item; the selection equal to the agenda's placed set); a person's Why naming an unassigned household timed event only when it overlaps the shown span (now Sunday 10:07: 09:00–09:30 not named, 15:00–15:30 named); traceability; the import boundary; and the M5, M6 and M7 forbidden lists over every output. Mutation proof, each restored: the composition reading as the system actor, people read unfiltered (an invisible person included), unassigned events blocking person scopes, the unassigned rule removed, all-day events with a household person ignored, the all-day exception removed, the household filter removed, planning bounds as first date + 24 h, the key from the shown span, a key without its bounds, the stretch clipped to `now`, no calendar as known coverage, never-succeeded as healthy, each of the three tie-breaks removed, the floor on the stretch only, and an end blocking its own minute each failed named tests. For the scheduled-task correction: tasks starting before the range ignored failed A, B, C, the range carry-over edge, D and the second P1 case; the agenda's `task_scheduled` placements restored as the source failed A, B, C, D and the second P1 case; a task's end clipped to its start date failed A, B, C, the carry-over edge, D and the second P1 case; an off-by-one end date failed A, B, C, G12, the carry-over edge, counted-once, D and both P1 cases; naming unassigned events over the whole stretch rather than the shown span failed the shown-span evidence test.
    - **Performance** (`tests/unit/gaps/gaps-performance.test.ts`, dev container, warm medians): over Forward's 90-day agenda of a synthetic 300-event household, five scopes, about 1–2 ms for seven days (87 gaps; 3–6 ms cold) and 16–30 ms for all 90 (1,141 gaps); a dense day of 50 overlapping events about 1 ms. X3's bound (seven days under 10 ms) holds; Package 5 records the final numbers.
    - **Caveats and choices where the contract is silent.**
      - The `range` fact is the gap's own date, not the surface's window, so Today, Forward and `respondToInsight` get identical facts for a key.
      - A person's Why names a no-household-person timed event that overlaps the gap's shown span (not the whole stretch on today), since that is what the Why describes at `now`.
      - Unassigned tasks are not named in a person's Why: §5.4 names occurrences only.
      - Order uses the stretch's start (identity), not the shown start, so the order does not change as `now` moves.
      - Because the engine sees only what the reader can see, an item never carries a person the reader cannot see; the engine still ignores any such id rather than trusting it.

### Package 3: openings (for review with its PR)

45. **Built as §29–§35 and contract §5.6–§5.8 describe; no decision changed.** No component, page or screen change, weather card, Kev change, calendar write, schema, migration, dependency or Production setting. Openings are derived, keyed and respondable, but **not presented**: no opening is listed or counted on any screen until Package 4 (contract §2.1), by the owner-approved flag `OPENINGS_LISTED = false` (below).
    - **Engine.** `src/domain/engines/insights/openings.ts`, pure (no db, network, clock or LLM; `now` injected): `openings({ now, timeZone, window, gaps, forecast, daylight, tasks, projects })`. Every input is injected: the gap engine's household gaps and coverage over the window, the cached forecast with its fetch time (its freshness is checked here, §5.1), daylight per date (none without a location), and the reader's own open tasks and projects from the authorised read. Rules `open_window.plain` and `open_window.task`; constants `OPENING_MIN_MINUTES = 120`, `OPENING_DAYS` (Today 2, Forward Week 7), `OPENINGS_SHOWN` (Today 1, Forward Week 2), `MATCHED_NEEDS` (`dry_weather`, `daylight`) and `OPENING_LIMIT`, the fixed limit sentence.
    - **Candidates.** Saturday and Sunday only, from today to today + 6 and within the surface's window; coverage `unknown` gives none and `partial` qualifies every opening. A candidate is a household gap intersected with daylight when known (the gap is already within planning hours), kept when its shown span (clipped to `now`) is 120 minutes or more. Per day, at most one: the candidates are ordered longest first (on the shown span), then earliest (the candidate's start), then by key; the first candidate any waiting task matches carries a task opening, else the first carries a plain one. Every opening returned is current (its end after `now`, two hours or more still shown).
    - **Task eligibility** (§30), from the recorded fields only: `open`, neither window end set, `estimate_minutes` set, `needs` non-empty and only `dry_weather` and `daylight`, and either in no project or in a project that is in the reader's own project list (visible to the reader and unarchived, as `listProjects` returns it) with a status that is neither `paused` nor `done` (`idea` or `active`). A task whose project is absent from that list (archived, or private to the other adult) or has an unrecognised status is not matched: this is the conservative rule, approved by the owner after review, in place of the first build's "not in a project the reader can see as `paused` or `done`", which let a task in an archived project, or in one the other adult had made private, still match. No fact or data about such a project is emitted: an opening's facts name only the gap's records, daylight, the forecast and the matched tasks, never a project. A match also needs the candidate's shown span to be at least the estimate, daylight known for the day when `daylight` is recorded, and, when `dry_weather` is recorded, a usable forecast whose band is "looks dry" over the candidate's hours (today and tomorrow) or the day's planning hours (days 2–6). The title, notes, domain, project title and assignee are never read for meaning; the title is said as recorded. Matching tasks are ordered by due date (dated first, earliest first), then title (`Intl.Collator('en-NZ')`), then id; the first is named and the rest are listed (`others`, and task facts after the named one).
    - **Weather composition** (§31). The clause is added only when the forecast is usable (not over 12 hours old), the day is within today to today + 6, and every hour it describes is stored and has a band: today and tomorrow, the whole hours the shown span touches (10:00–19:30 is the 10:00 to 19:00 hours); days 2–6, the day's 08:00–20:00. A missing hour, or a missing chance or amount, is no clause and no dry match. Weather never creates or removes a plain opening; a wet forecast removes only a dry-weather task's match, and the day's plain opening (its own key) takes its place.
    - **Templates**, exactly §5.6: "Nothing is recorded for the household {today | tomorrow | on Saturday}, {HH:MM}–{HH:MM}." (on today once the stretch has begun: "…for the rest of today, until {HH:MM}."); "{Task title} is recorded as about {estimate}, in {dry weather and daylight | dry weather | daylight}." followed by the "Nothing is recorded" sentence joined to its weather clause by ", and "; the qualifier ", as far as HOME knows" at the end of the "Nothing is recorded" clause; the clause "the forecast as of {time} {looks dry | has showers possible | has rain likely} then{, and windy}" (today and tomorrow) or "the forecast for {Weekday} as of {time} …{, and windy}" (days 2–6), capitalised as its own sentence on a plain opening; {time} from `asOfTime` ("06:55", or "yesterday 21:00"); {estimate} in whole hours up to ten ("three hours", "one hour"), otherwise minutes ("90 minutes").
    - **Identity** (§33): `open_window:household:{date}:{HHMM}-{HHMM}`, plus `:task:{taskId}`, from the candidate's bounds before clipping to `now` (the daylight-clipped stretch). Ids and times only: no forecast value, fetch time, viewing date or text; at most 84 characters with a uuid. A refreshed forecast keeps a plain key; a moved commitment or daylight edge makes a new one; midnight changes nothing.
    - **Listing** (§34). The insights engine takes openings as it takes conflicts (`InsightsInput.openings`), as the `open_window` kind, ranked after `data_health`, `conflict`, `preparation` and `busy_day`, then by date, start and key (a total order). `openingsShown` caps the family at the listing boundary: the earliest openings without a response are listed (and counted in "+ N more" like any other listed insight); the rest stay in `all`, with their keys, for the responses query, and are neither listed nor counted. `LISTED_BY_DEFAULT` (Today's) now includes `open_window`; Forward Week's listing is `data_health` and `open_window`; Month, Season and a person's page list none.
    - **Presentation deferred to Package 4.** `OPENINGS_LISTED` in `src/domain/insights/today.ts`, `false` in this package. `insightsFor`, which Today, Forward (every horizon) and a person's page all go through, sets the opening cap to zero when it is false (`{ ...derived, openingsShown: 0 }`), before the engine splits shown, rest and "+ N more", so no opening is shown, folded or counted anywhere and every surface's Worth knowing is M6's exactly. Openings are still derived over each surface's window, with their keys, and kept in `all`; the responses query still reads them, so `responded` marks a key an adult has dismissed or found not useful; `respondToInsight` still accepts a response on any opening derivable on the named surface (its eligibility ignores the cap, and the `listed` sets keep `open_window`). The filtering is in the domain, never in the browser. Package 4 flips the one constant.
    - **Composition.** `src/domain/insights/openings.ts`: `readOpeningWeather(actor, now)` is one `readForecast` (one query when weather is configured, none otherwise) plus the rounded point for daylight (a location with no valid key still gives daylight); `openingsOver(inputs, days, now, zone, window, agendaRange, weather)` is pure: `gapsOver` for the household scope, `daylightOver`, and the engine over the same authorised task and project records. `insightsInput` now carries the read it came from (`source`), and `insightsFor` adds the surface's openings (`withOpenings`) when the surface lists `open_window` and has no openings yet: Today over today and tomorrow, Forward Week (`forwardInsights` passes `openingDays: 7`, `openingsShown: 2`) over today to today + 6, the agenda range being the detectors' `through`, which the page's read covers. Neither page nor any component changed, and while `OPENINGS_LISTED` is false no opening reaches a page's listing.
    - **Responses** (§35). `respondToInsight` keeps M6's order. Step 3 re-derives the reader's openings over Forward Week's window from its one 90-day agenda read plus one `readOpeningWeather`; an opening key is accepted when the opening is derivable on the named surface ignoring the cap (Today: today and tomorrow; Forward: today to today + 6) and current; from a person's page, for a crafted key or for one no longer derived, it is `not_eligible`. The gate and the actor come first; audited with the response kind only; no new table, column or response value.
    - **Facts and Why data** (§4.5). `Fact` gains `planning`, `forecast` (`from`, `to`, `fetchedAt`) and `daylight` (`date`) kinds. An opening's facts: the gap's (planning, its date, the household people the reader can see, the commitments either side, the events named but not blocking, each calendar with its health and last success), the `daylight` fact when daylight bounds either end, the `forecast` fact when cited, and the matched tasks. The `Opening` on each insight also carries the stretch and shown span, the gap's key and commitments, which edge bounds each end (`commitment`, `planning` or `daylight`), the day's daylight with sunrise and sunset, the coverage and qualification, the cited forecast (span, fetch time, freshness, band, windy, highest chance, rain and strongest gust), the named task and the others with their estimate and needs, and the limit sentence. Rendering it is Package 4's.
    - **Privacy evidence.** `tests/integration/openings.test.ts` as `home_app`, two adults, through the real services: Sam's private event (Saturday 12:00–13:00), private all-day event (Sunday), private waiting task with an estimate, `dry_weather` and an earlier due date, and private stale calendar leave Alex's openings, keys, order, facts, data and qualification deep- and byte-identical, with none of their ids or titles present; the same records change Sam's own (Saturday's opening moves to 13:00–19:30 and names the private task, the fence listed; no Sunday opening; every sentence qualified) (P3). Alex's Dismiss and Not useful change nothing of Sam's, byte for byte (P2).
    - **Test evidence.** Unit `tests/unit/openings/openings-engine.test.ts` (fixture `tests/unit/openings/fixture.ts`: §8.6's records, the synthetic point, F0, F1 and F2): O1–O22 and O24–O26, each named with its row and its expectation as the matrix writes it; the weekday boundary; 120 kept and 119 dropped on the shown span; an estimate one minute over; unknown and partial coverage; fresh, older (yesterday 21:00) and unusable forecasts; a missing hour inside and outside the candidate, and a forecast ending before the day; a daylight-only task; daylight on both DST change Sundays and in winter; the longest-candidate and tie rules; title never read for a requirement; the assignee not read; every row of §5.7's table; caps at 0–3 and on Today, Forward, Month, Season and a person's page; ranking; eight shuffled seeds, deep and byte equal; traceability; the import boundary; and §5.8's lists over every template at every band, age, coverage, day and task shape. Project eligibility, O12a–O12g: a project missing from the reader's list, `paused`, `done` or with an unknown status gives no task opening (the plain one instead) and no trace of it in the output; a visible `idea` or `active` project matches; a task with no project matches; another matching task is named instead and the ineligible one is in neither `others` nor the facts. Integration: O1–O3, O7, O18–O21 and O23 through the real services, read from the composition's output (every opening derived, with its key and text) and the recorded responses (`responded`); a test that, with openings derived for both adults on Saturday and four stale calendars listed, Today's and Forward Week's shown, rest and "+ N more" equal M6's (the same read with M6's listings) and hold no opening; P2, P3; project eligibility through the real services as two adults (a project paused then archived by Sam: its task is not matched for Alex; Alex's private task in Sam's household project, which Sam makes private and done: Alex's opening names the fence instead and carries nothing of the project or the task; a visible active project matches); the gate before any query; and the query counts.
    - **Mutation proof**, each restored: the forecast in the key failed 49 tests (O6, O7, the lifecycle rows, the key test, among them); the key from the date only 53 (O8, the moved-commitment and DST rows); unfiltered tasks reaching another adult's opening failed P3; a weekday opening 31 (O9, the weekend test); an expired forecast used for matching O13 and O14; a requirement inferred from a title ("paint") the title test, O12 and the lifecycle row; a missing hour treated as dry the two missing-hour tests; the cap removed six (O18 in the unit and integration suites, both cap tests, the ranking test and the Not useful integration test); `open_window` ranked before `busy_day` the ranking test. After review: `OPENINGS_LISTED` set to `true` failed six integration tests (the M6-listing test, O1–O3, O18, both response tests and O7); the flag applied after the counts (openings dropped from shown and rest but counted in "+ N more") failed the M6-listing test only; the first build's project rule restored failed O12a, O12c and O12g (missing) in the unit suite and both new project integration tests (the archived project's task, and Alex's task in the project made private, were named again).
    - **Performance** (dev container, warm medians): over Forward's 90-day agenda of a synthetic 300-event household with 100 waiting tasks, openings over Forward Week about 2–3 ms (6–7 ms cold); `respondToInsight`'s pure 90-day read (placement, conflicts, openings) about 200–230 ms, of which M6's placement and conflicts are about 190 ms. Queries as `home_app`: Today, Forward Week and `respondToInsight` each 8 with weather configured against 7 with it unconfigured, and unchanged after 20 more events, 20 more tasks and a second calendar.
    - **Changes to earlier suites.** None because of listing: with `OPENINGS_LISTED` false, `tests/e2e/forward.spec.ts` and `tests/e2e/today.spec.ts` are back to main's expectations (the quiet Week's Worth knowing is empty; a quiet Today has no second-level heading), and every M5 and M6 suite passes with its pre-Package-3 expectations. Three unit suites change for other reasons: `tests/unit/today/insights-engine.test.ts` (the rule-to-sentence map gains the two `open_window` rules, and the every-rule check excludes them, since its household never passes openings in), `tests/unit/today/explainability.test.ts` (the documented-rules check also reads this contract) and `tests/unit/people-gate-ux.test.tsx` (its `@/lib/env` mock gains `weatherConfig`, which Today's insights read calls). The e2e suites are run by CI's browser regression (no Playwright here).
    - **Caveats and choices where the contract is silent.**
      - "Longest" is measured on the shown span, as the minimum is; "earliest" is the candidate's start.
      - On a task opening the qualifier ends the "Nothing is recorded" clause, before ", and the forecast …" (O16 says the clause carries it).
      - Today's openings window is today and tomorrow in the evening state too; the contract names no evening rule for openings.
      - Forward's Month and Season, and a person's page, read no forecast, since they list no openings: their query counts are M6's.
      - "{estimate}" says "one hour" for 60 minutes and "1 minute" for one.
      - A response from Forward is accepted for an opening derivable on Forward Week whatever horizon the adult is on, as M6 accepts Forward responses (the surface is `forward`, not a horizon).
      - `respondToInsight` reads the forecast row once for every key, not only for an opening's: the eligibility read is one read for every family.
      - `hoursCovering` (Package 1b) checks a span by counting the stored hours inside it, so it assumes the cached hours are consecutive and unique, as the cache writes them.

### Package 4: the screens (for review with its PR)

46. **Weather and openings are on Today and Forward Week; no decision changed, and the copy is as §4.3 of the contract wrote it.** No provider, schema, migration, dependency, Kev change, calendar write or Production setting. `OPENINGS_LISTED` is **flipped to `true`** (`src/domain/insights/today.ts`), so openings are listed on Today (one, the earliest without a response, after every other family) and Forward Week (two, after `data_health`), and on no other surface; identity, ranking, caps, eligibility and `respondToInsight` are Package 3's, unchanged.
    - **One forecast read per page.** Each page reads the cache once, as the adult (`readForecast`), and hands the same read to its words and to its openings (`ReaderInsightsInput.forecast`, `forwardInsights(…, forecast)`; `openingWeatherFrom` is the pure half of `readOpeningWeather`). The query count is Package 3's, constant in what is recorded. Month, Season and a person's page read no forecast, so their output is byte-identical with or without weather. The compositions are now `src/app/(home)/today/compose.ts` and `…/forward/compose.ts` (the pages render them), so the integration tests compose and render exactly what a page does; `loadAgenda` takes optional `deps` for that.
    - **Today.** After the headline and its late sentence and before "What this is based on ›" (also on first run): `weather.today` (day and first-run states), `weather.tomorrow` (evening state), or `weather.stale` for a forecast over 12 hours old, in body type and ink, with the small muted credit link after the sentence (none after the stale line: no forecast words are shown) and a native `<details>` "Why" on the same line as the sentence and the link (a `flex flex-wrap items-baseline gap-x-3` row, the `<details>` a flex item with `open:basis-full`, as Worth knowing does, so a long sentence wraps and the link and Why wrap with it, and an opened Why takes the full width below): "From the forecast as of {time}.", each part ("Morning, 07:00–12:00: looks dry. Chance of rain up to 5%, no rain, gusts up to 30 km/h."), the temperatures ("Around 14°C." when the rounded low and high are equal, otherwise "Between 11°C and 17°C."; always °C; the provider's values can carry decimals, so they are rounded with `Math.round` for display and the rounded integers are compared) and the credit link. Nothing when there is no location, key or forecast.
    - **Forward Week.** A day phrase at the end of each day's heading line (right-aligned, muted); on a day with nothing recorded it follows "Nothing recorded besides the usual" on the same line. The credit line "Forecast as of {time} · Open-Meteo" sits beside the Coming up label with its own Why (the span each phrase describes, the thresholds from the engine's constants, the credit). No phrase or credit without usable words.
    - **Credit (D8).** `CreditLink`: a real `<a>` to `https://open-meteo.com/` (the URL is `FORECAST_CREDIT_URL` in the weather engine, so `src/app` never names the provider's host), `rel="noreferrer"`, same tab, 44px tall, accessible name "Forecast data: Open-Meteo". Placed only in Today's sentence block, the credit line, a Why that cites the forecast, and (when the page has neither a sentence nor phrases) after the first listed opening that cites the forecast. A Why's link is inside a closed `<details>`, so exactly one is visible per page. The CSP is unchanged (an outbound link needs no directive).
    - **Opening Why** (`src/app/_insights/opening-explanation.tsx`), from the engine's `Opening` and the reader's own lookups only: "Nothing is recorded for anyone in the household from {the end of Football (10:00) | the start of planning hours (08:00) | the start of daylight (08:15; sunrise 08:04)} to {the start of …(…) | the end of planning hours | the end of daylight (19:30; sunset 19:43)}.", the commitments either side as the usual rows, "Household: …" (the people the reader can see, in People's order), recorded events that did not count, each calendar and when it last updated, "Forecast as of {time}, for {span}: {band}. (the engine's `asOfTime`: "06:55", or "yesterday 21:00" for an older forecast; `FactLookup` now carries `now` for it) Chance of rain up to N%, N mm of rain, gusts up to N km/h." with the credit link on the next line, the task as recorded (estimate, needs, a link to its page) and the other matching tasks, then the fixed limit sentence and the existing Not useful form. A fact that no longer resolves is left out.
    - **Refresh (§5.1).** `RefreshWeather` is mounted on Today and on Forward Week only, only when the server render found the forecast configured, the refresh due and the gate open; it posts once after render, never during render, no browser request goes to Open-Meteo, and without JavaScript nothing is asked. Nothing about the location reaches the markup (asserted by string).
    - **Where the pieces live.** The new presentational pieces are under `src/app/_insights/` (`weather/`, `opening-explanation.tsx`) so the existing classifier rule for `_insights` covers them; `src/app/_weather/` keeps the refresh client only.
    - **Browser server.** The weather specs run on a third dev server (port 3335, `.next-weather`) with the synthetic point, a test-only location key and the fake provider, so every other spec sees HOME without weather. `playwright.config.ts`, `tsconfig*.json` and `scripts/verify-local.mts` (cache clearing) change for it, which makes the PR critical in the classifier. The forecast is written straight into `weather_forecast`; the spec answers the refresh itself.
    - **Privacy evidence.** `tests/integration/weather-screens.test.ts` (two adults, rendered Today and Forward Week): Sam's private Saturday event, Sunday all-day event, dry-weather task and stale calendar change Sam's pages and leave Alex's byte-identical (P1, P3); a dismissal is Alex's alone and survives a refreshed forecast; the browser spec repeats the byte comparison on the rendered page.
    - **Test evidence.** Integration `weather-screens.test.ts` (W15, W19, X1, X2, X6, X7, X9, X12, P1, P3, the forbidden lists over rendered text, no location data in the markup); unit `tests/unit/weather/weather-screens.test.tsx` (every sentence shape, the older prefix, stale line, phrases, credit link and line, the opening Why in each shape, source boundaries); browser `tests/e2e/weather.spec.ts` (four viewports, JavaScript on and off, W19, X4–X7, X12, O18, O23, identity, first-screen check). `openings.test.ts` and `forward.spec.ts` change only where an opening is now listed.
    - **Mutation proof**, each restored: credit link omitted (unit and integration fail); openings cap removed (3 `openings.test.ts` tests); an opening listed on Month (X12 and the query-count test); the network reached at render (11 integration tests and, after the static check was widened, the source test); a sentence for an unusable forecast, by widening the usable age (X7, two tests); a task opening from a title match (5 Package 3 engine tests); the readers sharing Sam's events (the P1 test); Dismiss not scoped per adult (4 integration tests).
    - **Performance** (dev container, warm medians, a synthetic 300-event household over Forward's 90-day read): composing Today about 35 ms and Forward Week about 80 ms, rendering each about 40 ms, the forecast adding one indexed single-row query.
    - **Choices where the contract is silent.** The stale line carries no credit; a day with entries shows its phrase on the heading line and an empty day on the "Nothing recorded…" line (not one line with the label); the credit line's Why sits right-aligned under the label row; Why times say "fetched {date}, {time}" in an opening's Why and "as of {time}" in the sentence's and the credit line's; Today's Why gives each part's own hours (from `now` for the first); an opening's "Before" and "After" rows are shown only when that end is a commitment; Sky is not used.
    - **Presentation corrections (owner-approved, after review).** Temperatures read "Around 14°C." or "Between 11°C and 17°C." (not "Between 14° and 14°."); every place that dates the forecast says "Forecast as of {time}" (the Today sentence's Why, an opening's Why, the credit line's Why), never "fetched" and no plain-text "(Open-Meteo)" in the opening's Why (the credit link follows it); Today's "Why ›" sits on the sentence's line. Evidence: unit tests of the temperature helper (equal, different, equal after rounding) and the three wordings (fresh and older forecast), and a browser test on Today at the phone width, 375px and 320px that the Why summary shares the sentence's line, is 44px tall, opens to a full-width body below, with no horizontal scroll; screenshots (`weather-today-dry-phone`, `weather-today-dry-why-open-phone`) are regenerated by the spec and never committed.
    - **Known limitations.** The forecast's low and high are over the parts described, so a flat synthetic forecast reads "Around 14°C."; the browser specs depend on the fixture family's records (Football, Swimming, Paint the back fence) and archive other specs' calendars for their duration.

## Consequences

- **ROADMAP.** The M7 row records Package 0's approval, this ADR and the narrowing (§36, §3). The M6 row shows M6 accepted.
- **SYSTEM-ARCHITECTURE §2.2, §2.4 and §2.6.** Annotated, not rewritten:
  - `windows` is built as the gap engine;
  - `free_window` becomes `open_window`;
  - `alignment` is deferred, and `weather_effect` is folded into task openings;
  - the weather cache is a table refreshed on use, and the §2.6 examples are superseded.
- **FAMILY-DATA-MODEL.** The WeatherCache entry is annotated as `weather_forecast` (§14), with a keyed location fingerprint and no coordinate or location column. Package 1a writes the full entry.
- **KEV-AGENT-MODEL.** `find_free_windows` and `get_weather` stay M8's. They will call these engines, and their results keep M7's "nothing recorded" language, never availability.
- **Concepts and BRAND.** In Package 4:
  - `docs/concepts/TODAY.md` gains its "As built" annotation (M5's and M7's);
  - `docs/concepts/FORWARD.md` gains M7's weather line;
  - BRAND.md gains the credit link and supersedes its "looks best" example for M7.
- **DEPLOY.md.** Package 5 adds the §E items and the environment variables, including `HOME_WEATHER_LOCATION_KEY` (§40).
- **CLAUDE.md.** The status line records M6's acceptance and M7's Package 0, approved by the owner. Rule 5's "free windows" are the gap engine. No rule changes.
