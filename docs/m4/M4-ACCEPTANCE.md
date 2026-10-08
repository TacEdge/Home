# M4 — Calendar Integration: acceptance check

Checked against `M4-BUILD-CONTRACT.md` §10 on 2026-10-08 (Package 9), on `main` at the Package 8b merge (94f52f8) plus this package. Each criterion was checked against the code and the tests that run in CI, not against earlier PR summaries. Synthetic data only: the fixture family, synthetic Google-shaped feeds and seeded synthetic calendars. No real calendar, address or family data was used anywhere.

**Verdict: M4 is technically accepted on synthetic data. It is not yet operationally accepted.** Every technical criterion is met (§1), no Blocker or Important finding is open (§6), and the whole suite is green locally and in CI. Operational acceptance on real calendars needs owner steps in Production and Preview that this environment cannot and must not take: DEPLOY.md §E items 12–15, which in turn wait on M1's items 1–6, M3's restore rehearsal (items 7–8) and the real-data gate (items 9–11). `HOME_REAL_DATA` stays closed.

## 1. Criteria (contract §10)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Packages merged with CI green; the migration ran in Production and Preview before the code that needed it | Met | Packages 0–8b: #41–#51, each merged by the owner with CI green; Package 9 is this PR. Migration `0007` merged alone (#45) and ran in Production and Preview before #46 (contract status). No migration since: the journal still ends at `0007_calendar_schema`. |
| 2 | Function: both adults connect a synthetic Google-shaped calendar, see status and freshness, rename it, change whose it is, who can see it and its usual kind, refresh, disconnect, reconnect; people and notes on synced events; a repeating manual event changed for one occurrence and put back | Met | `tests/e2e/calendars.spec.ts` (15: connect, refresh, freshness in words, settings, duplicates, the other adult's view, ownership words, disconnect/edit/reconnect, no-JS); `synced-events.spec.ts` (10: people and notes from the event page, usual people, refresh on use); `occurrence-changes.spec.ts` (15: change, change again, move, back to the series, bring back, put-away states, no-JS). |
| 3 | Sync correctness across every §8.4 scenario: stored equals feed, no duplicates in a source, ids kept so annotations and notes survive, a failed refresh changes nothing | Met | `tests/integration/calendar-sync.test.ts` (42, numbered after §8.4: add, change, move, cancel, remove and return, recreate with a new UID, overrides and orphans, partial and malformed feeds, failure, concurrency, disconnect and reconnect, duplicates, key rotation); `tests/unit/calendar/*` (the provider contract suite, the ICS adapter, the mirror, `rrule` reference, time zones, UID bytes). |
| 4 | Engines: Today, Forward and Coming up agree for manual and synced; recurrence covers overrides, feed exdates, floating times, Windows zones, both NZ DST transitions; the regular week derived, not stored | Met | `tests/integration/synced-agenda.test.ts` (11, including both NZ DST changes and a zone landing on another home date); `tests/unit/recurrence*.test.ts`, `calendar/recurrence-feed.test.ts`, `calendar/time-zones.test.ts`; `tests/unit/occurrence-changes.test.ts` (40); the regular week in `tests/unit/regular-week.test.ts` and `tests/integration/regular-week.test.ts`, which also proves nothing is written to `event_person`. |
| 5 | Privacy: no other-adult private calendar, source or synced event on any screen, in Activity or the export; a household calendar visible to both and editable by its owner only; sensitive context untouched | Met | §2 below. |
| 6 | Credentials: the address never in a response, client data, log, audit row, Activity, export or error; encrypted with a row-bound key and destroyed on disconnect; only the approved Google host accepted | Met | §3 below. |
| 7 | Untrusted content: plain, bounded, escaped; an injected script never runs under the nonce CSP | Met | `tests/unit/calendar/text.test.ts`; `tests/e2e/csp.spec.ts` (hostile calendar-style text shown as words; injected inline script, handler and `javascript:` link refused); `scripts/check-csp.mts` against the production build in CI. |
| 8 | Failure recovery: every §3.8 status leaves HOME usable with last-known events and reads calmly | Met | `calendar-sync.test.ts` (failures keep last-known events); `calendars.spec.ts` (failure in household words, partial refresh, unreadable stored address); `synced-events.spec.ts` (a failed refresh keeps the events, no alarm); `tests/unit/calendar-status-copy.test.ts`. |
| 9 | Audit: every write audited; one structural row per refresh, counts only | Met | `calendar-sync.test.ts` (audit: one structural row per refresh, nothing provider-written or secret); `tests/integration/occurrence-changes.test.ts` (occurrence changes structural, canary-checked); the M3 sweep's "no audit row carries written words". |
| 10 | Gate: in Production every connect and sync write refused while closed; no real calendar connected anywhere | Met | `tests/integration/calendar-privacy.test.ts` (the gate refuses connect, reconnect, change, disconnect and refresh; nothing written); `tests/integration/privacy.test.ts` (every exported write, including both occurrence services, refused for seven non-`open` values). No calendar key or calendar exists in Production (DEPLOY.md §E). |
| 11 | Accessibility and devices: no serious or critical violations on new screens; 44px targets; keyboard; four viewports, no horizontal scroll | Met | §4 below. |
| 12 | Scope: no calendar write, background job, cross-source deduplication, attendee import, M5–M8 feature, or runtime dependency beyond `node-ical` | Met | Runtime dependencies added in M4: `node-ical` 0.27.3 only (`rrule` 2.8.1 predates it, M3). No write path to any provider; refresh is on use only; attendees and organisers are never parsed into HOME's shape (`tests/unit/calendar/provider-contract.test.ts`). |
| 13 | Data: synthetic only in the repository, tests, screenshots and PR text | Met | Fixture family and synthetic feeds only; gitleaks and the private-terms scan on every PR. Screenshots go to `test-results/` and are never committed. The Preview test calendar is an owner step (§7). |
| 14 | Handover: adversarial audit completed and blocking findings fixed | Met, pending the owner | Each package had a focused independent review; every Blocker and Important finding was fixed before its merge (ADR 0007 §32, §42, §46 and the reviews of #47–#51). This package's integration review is §5. Acceptance itself is the owner's. |

## 2. Privacy

Two adults, each with private and household records, read through the domain services as themselves.

- **Calendars and their events.** A private calendar and its events are its owner's alone: not on the other adult's Settings › Calendars, Today, Forward, a profile's Coming up or Usually, not by address (every calendar and event page answers "Nothing here."), not in Activity and not in the export (`calendar-privacy.test.ts`, `synced-agenda.test.ts`, `synced-events.spec.ts`, `regular-week.test.ts`, `m3-privacy-sweep.spec.ts`, which fetches every calendar page and every event page each adult can reach and checks the whole HTML).
- **Household calendars.** Both adults see the calendar, its name and freshness and its events, and either may refresh it; only the owner manages it (`calendar-sync.test.ts`, `calendars.spec.ts`: the other adult gets no controls and every manage path is refused).
- **Connection metadata** (status, error code, fingerprint, key id) is the owner's alone (`calendar-privacy.test.ts`).
- **Usual people.** A calendar's usual people are derived at read time and never written as annotations; an event's own annotations replace them; only people the reader can see are named; a household calendar cannot name a private person (`synced-agenda.test.ts`, `calendar-sync.test.ts`, `event-who.test.ts`).
- **One-off changes** share their series' owner and visibility, archived ones too, and move with it; the other adult reaches nothing of a private series, its change form, its changed time or its people page (`occurrence-changes.test.ts`, `occurrence-changes.spec.ts`).
- **Activity** shows nothing about the other adult's private calendar or either adult's connection (`calendar-privacy.test.ts`; the M3 sweep compares every row id shown with the audit rows about the other adult's private records).
- **Sensitive context** is untouched by M4: no calendar code reads it, and the M3 sweep's sensitive markers never appear.

## 3. Credentials and the security boundaries

These were reviewed in their own packages and are not re-audited here; the evidence that they are still active on `main`:

| Boundary | Still active because |
|---|---|
| Nonce CSP (§17) | `tests/unit/csp.test.ts`; `csp.spec.ts` (a fresh nonce per response, nothing broad, no violation in ordinary use); `scripts/check-csp.mts` against the production build in CI. |
| Safe outbound fetch (§20) | `tests/unit/safe-fetch.test.ts` (Google host only, no redirects off it, private and reserved addresses refused, size and time bounds). |
| Credential encryption (§18) | `tests/unit/credentials.test.ts` (AES-256-GCM, row-bound associated data, key ids, rotation with the previous key). The credential is destroyed on disconnect (`calendar-sync.test.ts`). |
| Key separation (§34) | A fingerprint key equal to either credentials key is refused as invalid; rotating the credentials key never changes fingerprints (`calendar-sync.test.ts`, `credentials.test.ts`). |
| Where the credential may be named | `tests/unit/calendar-credential-access.test.ts`: only `src/domain/calendar/`, the schema, the export spec and the credential module name `calendar_connection`'s secret columns. |
| No secret in any output | `calendars.spec.ts` (the address is asked for once and never shown again; it is in no audit row and not in the export); `calendar-privacy.test.ts` (refusals are fixed codes, never the address); `export-completeness.test.ts` (`calendar_connection` excluded; `SECRET_COLUMNS` never exported by any record type); `calendar-refresh.spec.ts` (the refresh route returns no calendar content, never cached). Logs: the logger scrubs credential words and values (§21, §31). |
| Server-side authority | Every screen reads through the services with `requireActor()`; no file under `src/app` or `src/ui` imports the database; the occurrence identity bound into a form is re-proved by the service (§48). |
| Real-data gate | First step of `auditedWrite`; criteria 10 above. |

Export version 2 validates for each adult and excludes credentials and fingerprints (`m3-privacy-sweep.spec.ts`, `export.test.ts`).

## 4. Accessibility and devices

At 375×812, 768×1024, 1024×768 and 1280×800:

- **Every M3 and M4 screen** (`m3-device-sweep.spec.ts`): Today and Forward with synced rows, a synced event and its people page, every Settings › Calendars page (connected and disconnected, new, edit, reconnect) and every M3 screen. Each has no serious or critical axe violation (WCAG 2.0–2.2 A/AA), no horizontal scroll, and every control at least 44×44px; every event row on Today and Forward is at least 44px tall.
- **The occurrence screens** (`occurrence-changes.spec.ts`): a series with a changed time, the Change this one form, a changed time's page and its form again. The same three checks; the first Change this one link is reached by keyboard and in view; and, added here, **a refused save focuses the field in view and not under the capture bar or the header**.
- **Refusal focus elsewhere and reduced motion** (`m3-device-sweep.spec.ts`): focus after a refusal at each viewport, unobscured; no transition or animation over 0.01ms with `prefers-reduced-motion: reduce`.
- **Keyboard only** (`m3-device-sweep.spec.ts`): skip link, capture, add a task, done and undo, the ⌂ menu.

No failure in this package's run.

## 5. Cross-package integration review (Package 9)

Concentrated on the joins between packages, reusing each package's evidence.

| Invariant | Result |
|---|---|
| Provider-owned fields of a synced event stay read-only | Met: every manual service refuses `synced_event`; the event page offers no edit, skip, archive or change for a synced event (`events.test.ts`, `synced-events.spec.ts`). |
| Manual occurrence editing cannot touch a synced series | Met: `changeEventOccurrence` and `returnOccurrenceToSeries` refuse `synced_event`; the change route sends a synced series back to its page; nothing is written (`occurrence-changes.test.ts`, `occurrence-changes.spec.ts`). |
| Calendar defaults never become `EventPerson` rows | Met (`calendar-sync.test.ts`, `regular-week.test.ts`). |
| Explicit annotations replace defaults; an annotation for someone no longer listed shows nobody | Met (`event-who.test.ts`, `synced-agenda.test.ts`, `occurrence-changes.test.ts`). |
| Override suppression during a partial sync | Met: suppression is by identity, not the series' exdates (`synced-agenda.test.ts`, `synced-events.spec.ts`). |
| Privacy follows actor-aware domain reads | Met (§2). |
| Archived and disconnected records consistent | Met: disconnect archives events and keeps people and notes; reconnect restores the same rows; an archived series hides its one-off changes and restoring brings them back (`calendar-sync.test.ts`, `synced-events.spec.ts`, `occurrence-changes.spec.ts`). |
| A failed refresh keeps last-known data | Met (criterion 8). |
| No secret reaches the client | Met (§3). |
| The real-data gate | Met (criterion 10). |
| Normal, skipped and changed never overlap | Met: all three ways in are guarded by the service (`occurrence-changes.test.ts`); the screens never offer both (`occurrence-changes.spec.ts`). |

**Package 8b minors** (from the review of #51):

| | Finding | Outcome |
|---|---|---|
| m-1 | A put-away change the rule no longer reaches said the usual time "happens as usual" and offered a Bring back that is always refused | **Fixed.** It reads `No longer part of …`, links to the series and offers no Bring back (`putAwayStatus`, ADR 0007 §48). Unit and e2e tests. |
| m-2 | A put-away change whose time is now skipped said it "happens as usual" | **Fixed.** It says the time is skipped and to put it back first; no Bring back. Unit and e2e tests. |
| m-3 | Two archived changes of one time listed twice | **Fixed.** One per time, the most recently put away; none for a time with a live change. Unit test. |
| m-4 | Documentation called the bound occurrence identity server-bound | **Fixed.** ADR 0007 §47 is corrected and §48 records that bound arguments are encoded, not encrypted; the service is the guard. Comments in the action and the route say the same. |
| m-5 | A changed time's people page reachable by address while its series is archived | **Fixed.** It now sends the person to the change's page, read-only. |
| m-6a | The occurrence form's audit row lists all five fields | **Left.** Field names only, never content; listing only the changed ones needs the form to know the occurrence's stored values. Not an acceptance defect. |
| m-6b | A series in another zone is listed in its own zone's date and time but ordered by home date | **Left.** Pre-existing presentation shared with Package 6; rare for manual series here. Carried forward to M5's Today work, which owns agenda presentation. |

## 6. Outstanding defects and carry-forwards

- **Blocker:** none. **Important:** none.
- **Carried forward, not blocking:**
  - **Performance** (ADR 0007 §44): the agenda loader reads each event's annotations with one query per event, the stale-calendar check reads calendars a second time, and a synced event's page reads the household's events to find its series' overrides. Fine at a household's scale; batch them when M5's Today grows the loader.
  - **A dev-only hydration warning** ("a tree hydrated but some attributes … didn't match") appears in the browser console on some pages in the dev server, across M3 and M4 screens. It is not a CSP or accessibility failure (`csp.spec.ts` asserts no hydration complaint in ordinary navigation, and passes). Worth tracing when the shell next changes.
  - **Parallel browser workers** need per-worker databases (§9).
  - m-6a and m-6b above.
  - From M3 and still open: overnight events sit on their start date (ADR 0006 §59); `check-export.mts` needs Node 22.18 or later.

## 7. Operational readiness

| | Status |
|---|---|
| **A. Technical acceptance on synthetic data** | **Complete** (this document). |
| **B. Operational acceptance on real calendars** | **Not started, by design.** It needs the real-data gate open, which needs M1's acceptance (DEPLOY.md §E items 1–6), M3's restore rehearsal (items 7–8), the export check and logging review (items 9–10) and the gate itself (item 11), then M4's own items 12–15. None is recorded as passed. |

Nothing in this package touched Production: no gate change, no calendar connected, no credential or key set, no migration run.

## 8. Owner actions

In DEPLOY.md §E order, recording each with its date and evidence there (counts and yes/no only):

1. **M1 acceptance**, items 1–6: Postmark live sending, each parent's magic-link sign-in, the §C smoke checks, the live rate limit, and Neon's ≥ 7-day restore window on `home`.
2. **M3's restore rehearsal**, items 7–8, as `docs/m3/M3-ACCEPTANCE.md` §6 describes; then accept M3.
3. **Calendar keys** (item 12): generate `HOME_CREDENTIALS_KEY` and `HOME_FINGERPRINT_KEY` separately for Production and Preview (four different values), set them in Vercel, redeploy, and confirm both boot lines read `ready`. This may be done before the gate opens; it connects nothing.
4. **The Preview test calendar** (item 13): a throwaway Google account with synthetic events only; connect its secret address in Preview, refresh, check Today and Forward, disconnect and reconnect, and check Preview's logs show no part of the address.
5. **The export check and logging review** (items 9–10), then **open the gate** (item 11): `HOME_REAL_DATA=open` in Vercel **Production only**.
6. **The first real calendar** (item 14): an adult connects their own Google calendar's secret address in Production and checks it as listed; then **the calendar logging review** (item 15).
7. **Accept M4**, once items 12–15 are recorded.

Never paste a secret calendar address or a key into chat, an issue, a PR, a commit, a log or a screenshot. If an address may have been exposed, reset it in Google Calendar and connect again.

## 9. Verification performance

Measured on this cloud container (one local Postgres, one Playwright worker), `pnpm verify` on `main` before this package and on this package's branch after it:

TIMINGS

**What was done** (ADR 0007 §48):

- **`pnpm verify:focused`** for routine work: lint, typecheck, the unit and integration tests vitest reaches from the changed files, and the browser specs those paths map to (`scripts/verify-focused.mts`, tested by `tests/unit/verify-focused.test.ts`). It narrows; the full `pnpm verify` stays required before a PR and whenever a change touches visibility, authority, the gate, migrations, the CSP, the shell or shared UI (LOCAL-DEV.md). CI is unchanged and runs everything.
- **Session reuse in the browser suite**: `signInAsFixtureAdult` reuses each adult's session within the worker while the server still accepts it, and falls back to the real magic-link flow (a test that signs out is followed by a real sign-in). Tests of sign-in itself use the real flow every time.
- **Reliability**: `pnpm verify` and `pnpm verify:focused` clear the dev servers' stale caches first (they broke the typecheck and answered 404 for real routes twice during Packages 8a and 8b), and the Playwright config uses the container's provided Chromium when no path is set (the run that started with no browser at all). Date-dependent assertions met in Packages 7 and 8b were fixed at the time (#49's follow-up in #51); the calendar audit-order assertion that could fail when two rows share a timestamp has not recurred in any run since Package 7 and is left as reported on #49.

**Investigated and not done:**

- **Parallel workers.** Every spec shares one database, the fixture family, the rate-limit table, archived flags and the audit log the privacy sweep reads end to end. Two workers would race on all of them, so results would not be deterministic. The prerequisite is a database (and seed) per worker, plus the two dev servers per worker or one shared server keyed by database, which is a harness refactor. Recorded as the next improvement.
- **Running the browser suite against a production build** would avoid the dev server compiling each route on first visit, but production refuses the test mail transport and non-https URLs by design (LOCAL-DEV.md). A test-only production mode would need its own decision.

## 10. Acceptance status

- **Technical acceptance (synthetic data): complete.** Criteria 1–13 are met and 14 is met pending the owner.
- **Operational acceptance (real calendars): outstanding.** It waits on DEPLOY.md §E items 1–15, all owner steps.
- **M4 is therefore not fully accepted.** Accept it once items 12–15 are recorded. Do not start M5 before the owner says so.
