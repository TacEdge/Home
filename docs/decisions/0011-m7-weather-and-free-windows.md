# ADR 0011 — M7 Weather and Free Windows: scope, architecture and decisions

Status: **Proposed**, 2026-10-11 (Package 0, awaiting owner approval). The contract is `docs/m7/M7-BUILD-CONTRACT.md`. Decisions marked "Proposed — owner decision D*n*" are listed, with their options, in contract §12.2. This ADR is accepted, as amended by those decisions, when the owner merges Package 0.

- **Implementation:** nothing built. Package 1a (the forecast table, migration only) starts only after Package 0 merges and the owner says to start.

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
   | `alignment` ("both adults free") | §36. Proposed — owner decision D17. |
   | A separate `weather_effect` insight | §36: folded into task openings. Proposed — owner decision D18. |
   | Severe-weather warnings | §21. Proposed — owner decision D7. |
   | Travel time, transport buffers, location reasoning | ADR 0009 §20; no record supports them |
   | Weather deciding suitability ("a good day for…", "best") | §31: weather is a sentence, or a filter the family recorded on a task |
   | Kev tools (`find_free_windows`, `get_weather`), Kev phrasing or recommendations | M8. The engines are shaped so M8 can call them. |
   | Writing to calendars, creating or scheduling tasks, proposals | M9 and later; no write path is added |
   | Learning from responses, adaptive ranking, implicit preferences | ADR 0009 §17 |
   | Weather or openings on Forward's Month and Season, or on a person's Coming up | §34. Proposed — owner decision D16. |
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

11. **Provider: Open-Meteo's free API, one adapter, no live fallback.** Proposed — owner decision D1.
    - It is free for a private, non-commercial household app, with no key and no account. HOME's volume is under 1% of the free allowance.
    - The free limit is per IP, and Vercel's egress is shared, so occasional `429`s are expected. They are absorbed by the cache (§15).
    - **Named contingency,** decided by the owner on evidence if refusals recur: a MET Norway Locationforecast adapter (free; identified by User-Agent, not IP), or Open-Meteo's paid Standard tier (a key, a 99.9% target).
    - A second live provider is not built now. It would double the mapping, and it uses the same ECMWF model, so it adds availability but not skill.

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

13. **The home location lives in private environment configuration.** Proposed — owner decision D2.
    - `HOME_LAT` and `HOME_LON`, and optionally `HOME_ELEVATION`, read only by `src/lib/env.ts`.
    - **Rounded at the boundary:** coordinates to two decimal places (about 0.7 km at New Zealand latitudes), elevation to 10 m. The exact values are never held anywhere else in the code.
    - **Never** in the repository, the database, exports, audit metadata, logs, the client or tests. `lat`, `lon`, `latitude`, `longitude`, `elevation` and `coordinates` join the logger's redacted keys, and no request URL is ever logged.
    - **Absent or invalid:** weather is simply absent: no request, no sentence, no error. HOME logs one boot line, `[home] weather location: set | absent | invalid`, never the value.
    - **Tests, docs and Preview** use a public synthetic point (Wellington's Civic Square, `-41.29`, `174.78`), never the home's. The owner confirms in Package 0 that this point is not within a few kilometres of home; if it is, another public point replaces it before Package 1b, so the rounded home location can never coincide with a value in the repository.
    - **Production:** the home location is real household data, so it is set only after the real-data gate opens (DEPLOY.md §E, new items in Package 5, §40).

14. **The forecast cache: one household-level table, `weather_forecast`.** Proposed — owner decision D3.
    - **Columns:** id; `provider` (`open_meteo`, `CHECK`, unique); `fetched_at` and `hours` (normalised `ForecastHour` rows, `jsonb`) for the latest good forecast; `first_hour` and `last_hour`; `last_attempt_at` and `last_attempt_status` for the latest attempt; `created_at` and `updated_at`.
    - **No location column.** The row holds no coordinates, so a changed location replaces the forecast at the next refresh (within 60 minutes), as DEPLOY.md will say.
    - **No `created_by` or `visibility`.** It is not a user-facing record and holds nothing either adult recorded: a forecast for the household, read by both adults through a service that requires an actor. FAMILY-DATA-MODEL records the exception.
    - **Retention:** at most one row per provider. A success replaces the hours. A failure leaves them, unless the last success is more than 24 hours old, when the hours are cleared.
    - **Export:** excluded, with its reason, in the export specification: it is derived, non-personal and fetched again on use. `export-completeness` holds.
    - **Grants:** `home_app` reads and writes it through the default privileges of `0002_app_role`. It is not append-only.

15. **Refresh on use, and freshness.**
    - **Rendering never fetches.** Today and Forward read the cache, render, and only then, when the location is set and the last attempt is 60 minutes old or more, ask `/weather/refresh` once. The page never waits. Without JavaScript, the cached forecast is shown with its time.
    - **At most one request per 60 minutes:** measured from the last *attempt*, so failures never hammer the provider. After a `429`, the next attempt waits 3 hours. One refresh at a time, by an advisory lock (`home:weather_forecast`); a second caller answers `busy` and writes nothing.
    - **A failure keeps the last good forecast.** Only the attempt columns change, and the failure is audited (§16).
    - **Freshness, from `fetched_at`** (Proposed — owner decision D6):

      | Age | Called | Behaviour |
      |---|---|---|
      | Under 3 hours | Fresh | Words shown; the time is in the Why, and on Forward's credit line |
      | 3 to 12 hours | Older | Words shown with their time in the sentence: "As of yesterday 21:00, …" |
      | Over 12 hours | Unusable | No forecast words anywhere. No dry-weather task is matched. Today says, in place of its weather sentence, "The forecast hasn't updated since {when}." |
      | None yet | — | No forecast words and no stale line; the refresh is asked for after render |

16. **The refresh is gated and audited.** Proposed — owner decision D4.
    - **Gated:** the refresh is a write of household data (it reveals the home location to the provider), so it starts with `assertFamilyWritesOpen()` and `assertCanWrite`, before any query or request. In Production with the gate closed, it is refused even if a location is set. Kev cannot refresh.
    - **Audited:** each attempt that reaches the provider writes one `weather.refresh` row, with structural metadata only (`{ status, hours }`): no coordinates, URL, response or values.
    - **Visible only to the adult whose visit triggered it** (`visible_to_user_id`), because a household-visible row would tell one adult when the other opened HOME.

17. **Uncertainty: bands, thresholds and horizon.** Proposed — owner decisions D5 and D6.
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
    - **CSP is unchanged:** the fetch is server-side.

20. **Attribution** (CC BY 4.0: "a link next to any location Open-Meteo data are displayed"). Proposed — owner decision D8.
    - **One credit per page that shows forecast words,** beside them:
      - **Today:** a small muted "Open-Meteo" link directly after the weather sentence, or, when there is no sentence, after the first opening that cites the forecast;
      - **Forward Week:** beside the Coming up label, with the forecast's time: "Forecast as of 06:55 · Open-Meteo".
    - **An opening's Why** that cites the forecast repeats the link.
    - Links use `rel="noreferrer"`, so HOME's address is never sent. BRAND.md gains a line for it (Package 4).

21. **No severe-weather warnings in M7.** Proposed — owner decision D7. If wanted later, MetService's public CAP feed is the official source. Its terms require that warning text is not altered, so HOME would show it verbatim, credited, and never paraphrased by Kev. That would be its own decision and package.

### Gaps

22. **A gap** is a maximal stretch, inside **planning hours** on a home date, where no recorded commitment in the chosen scope (§23) overlaps. Proposed — owner decision D9.
    - **Planning hours:** 08:00–20:00 home time, a code constant. No settings screen, no schema.
    - **On today,** a gap's displayed start is clipped to `now`. Its identity is not (§27).
    - Gaps are computed per request, from the agenda the page already loaded, and stored nowhere.

23. **What blocks a gap.** A commitment blocks the stretch it overlaps, `[start, end)`, clipped to planning hours.
    - **A person's scope:** the timed occurrences that person is on (attending or responsible, as the agenda shows: own annotations, else the calendar's usual people, or a changed occurrence's series people); all-day events they are on (their whole planning day, every day the event covers); and scheduled tasks assigned to them.
    - **The household's scope:** the union of every visible household person's scope, plus occurrences and scheduled tasks with no household person on them.
    - **A timed event with no household person** (nobody recorded, or only people outside the household) blocks the household scope: it is recorded for the household, and HOME does not guess whose it is. It does not block a person's scope, but a person's gap that overlaps one names it in its Why. Proposed — owner decision D11.
    - **An all-day event with no household person** (a public holiday, a birthday recorded as an event) does not block. It is named in the day's Why. Proposed — owner decision D12.
    - **Never block:** birthdays from people's records; project target dates; tasks due; tasks with no scheduled window; zero-length occurrences; skipped occurrences.
    - **Kind is never read.** School and work series block like any other recorded commitment; HOME neither invents nor exempts routine.
    - **No buffers:** no travel time, no transport, no spacing around commitments.

24. **Time.**
    - **Recurrence** comes only from the agenda's occurrences. A skipped occurrence is absent; a changed one blocks at its changed time.
    - **Overnight and multi-day** timed occurrences block each home day they cover, as the agenda places them.
    - **Instants are compared in UTC; stretches are named in home wall time.** Both Pacific/Auckland changes happen at 02:00–03:00, outside planning hours, so a planning day is twelve hours on every date. Tests prove boundaries on both change days, including an occurrence that spans the change.
    - **An event kept in another zone** blocks the home-time stretch its instants cover.

25. **Coverage: what HOME can vouch for.** Proposed — owner decision D13. For the reader, from the calendars they can see (the M5 health rules, ADR 0008 §18):

    | Coverage | When | Gaps |
    |---|---|---|
    | `unknown` | The reader has no live calendar | None, on any surface (first run) |
    | `partial` | A visible live calendar has failed, is more than 24 hours since its last success, or has never succeeded | Offered, and every statement is qualified ", as far as HOME knows"; the Why names the calendars |
    | `recorded` | Every visible live calendar is healthy | Offered |

    Like Forward and conflicts, the engine is given the agenda's coverage range and refuses a range it does not cover.

26. **Lengths.** The engine returns gaps of 60 minutes or more (a floor in its interface, for M8's later use). Openings need two hours or more. Proposed — owner decision D10.

27. **Identity and determinism.**
    - **A gap's key:** `gap:{scope}:{date}:{HHMM}-{HHMM}`, where scope is `household` or a person id, and the times are the stretch's home wall-clock bounds before clipping to `now`. Built from ids and times only.
    - **On today,** the key keeps the unclipped stretch (from planning start, or the end of the last commitment before it), so a gap's identity does not change minute by minute. Its displayed start and its remaining length use `now`.
    - **Same input and `now`, same output,** sorted by date, start and key: a total order.

28. **Privacy.** Gaps are derived only from what the reader can see.
    - **The reader's own private events block the reader's view;** the other adult's are invisible.
    - **Non-interference:** adding records only the other adult can see leaves the reader's gaps, coverage, openings, keys, Today, Forward and rendered pages byte-identical. A private event of Sam's cannot shrink, split or remove a gap of Alex's.
    - **Never across adults:** no computation reads both adults' records to produce what either sees, and no system actor computes gaps.

### Openings

29. **Two families, weekends only.** Proposed — owner decision D14.
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

34. **Where openings appear, how many, in what order.** Proposed — owner decisions D15 and D16.

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
    - **`alignment` is deferred** (Proposed — owner decision D17). "Both adults have nothing recorded" is unknowable to either adult: each sees only their own private events, so the statement would be wrong for one of them, and computing it from both would leak. A later design would need the owner to decide whether private events may contribute an anonymous "something recorded" block, and that is a privacy decision of its own.
    - **`weather_effect` is folded into task openings** (Proposed — owner decision D18). Its two cases were "a task needing dry weather" (now the task opening, which appears and disappears with the forecast) and "an outdoor event" (no record says an event is outdoors; HOME would have to guess from titles). "The painting's better Saturday" is a recommendation, which M7 does not make.

### Experience

37. **Today, Forward and their states** (contract §4):
    - **Today:** one weather sentence after the headline (and its late sentence), in ink, never the accent: "Looks dry until midday, then showers possible." It covers the rest of today, or tomorrow in the evening state. Its Why gives the forecast time, the hours, the low and high temperature and the credit. At most one opening in Worth knowing. M5's headline rules are unchanged.
    - **Forward Week:** each day's row ends with a day phrase of at most four words ("Looks dry", "Showers possible, windy"). Openings in Worth knowing.
    - **States:**

      | State | Today | Forward Week |
      |---|---|---|
      | No location | No sentence, no credit | No phrases, no credit |
      | Location, no forecast yet | No sentence; refresh after render | No phrases |
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

39. **Packages:** seven, numbered 0, 1a, 1b, 2, 3, 4 and 5 (contract §2). Proposed — owner decision D19.
    - **0:** this ADR and the contract.
    - **1a:** the `weather_forecast` migration, alone (migration-first).
    - **1b:** weather: provider interface, adapter, fake, `safe-fetch` policy, cache service, refresh route and client, env, logger redaction, the weather and daylight engines. No screen.
    - **2:** the gap engine and coverage.
    - **3:** openings: the `open_window` family, wording, keys, listing caps and responses. Domain only.
    - **4:** the screens: Today's sentence, Forward Week's phrases and openings, credit, states, no-JS, devices.
    - **5:** acceptance.

    Each package follows ADR 0010's tiers (contract §2.3). Package 1b's application code merges only after 1a has run in Production and Preview. Review is high for 1a, 1b, 2, 3 and 5, and medium for 4. Package 1a cannot start until the owner merges Package 0 and says to start.

40. **Production.** M7 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed.
    - It adds one migration (Package 1a) and **one Production setting**, the home location, the first since M4's keys.
    - The location is set in Production only after the gate opens, and the refresh is refused while the gate is closed.
    - Package 5 adds DEPLOY.md §E items and the environment table's rows for `HOME_LAT`, `HOME_LON` and `HOME_ELEVATION` (contract §10.2).

## Consequences

- **ROADMAP.** The M7 row records Package 0 and this ADR; once the owner decides, it records the narrowing (§36, §3). The M6 row shows M6 accepted.
- **SYSTEM-ARCHITECTURE §2.2, §2.4 and §2.6.** Annotated, not rewritten:
  - `windows` is built as the gap engine;
  - `free_window` becomes `open_window`;
  - `alignment` is deferred, and `weather_effect` is folded into task openings;
  - the weather cache is a table refreshed on use, and the §2.6 examples are superseded.
- **FAMILY-DATA-MODEL.** The WeatherCache entry is annotated as `weather_forecast` (§14), with no location column. Package 1a writes the full entry.
- **KEV-AGENT-MODEL.** `find_free_windows` and `get_weather` stay M8's. They will call these engines, and their results keep M7's "nothing recorded" language, never availability.
- **Concepts and BRAND.** In Package 4:
  - `docs/concepts/TODAY.md` gains its "As built" annotation (M5's and M7's);
  - `docs/concepts/FORWARD.md` gains M7's weather line;
  - BRAND.md gains the credit link and supersedes its "looks best" example for M7.
- **DEPLOY.md.** Package 5 adds the §E items and the environment variables (§40).
- **CLAUDE.md.** The status line records M6's acceptance and M7's Package 0. Rule 5's "free windows" are the gap engine. No rule changes.
