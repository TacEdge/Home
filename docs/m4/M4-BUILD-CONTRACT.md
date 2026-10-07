# M4 — Calendar Integration: Build Contract

Status: **Approved** by the owner, 2026-10-05 (the M4 readiness plan and decisions 1–6, recorded in ADR 0007). This contract is Package 0; it changes no code. Progress: Packages 0–5 merged; migration `0007` ran in Production and Preview; Package 6 (synced events across the screens, ADR 0007 §44) is in review.
Implementers: per package (§2.3). Reviewer: Opus reviews every package before the owner merges it.

M4 brings the family's calendars into HOME. At the end of M4 an adult can connect a Google calendar by its secret iCal address, see its events on Today, Forward, a profile's *Coming up* and each event's page beside the events entered by hand, say who is going and who is responsible for a synced event, see how fresh each calendar is, refresh it, and disconnect it. A person's profile shows their regular week. A repeating manual event can be changed for one occurrence. **HOME never writes to a calendar, nothing runs in the background, and nothing here is intelligence:** no conflicts, insights, weather, free windows or Kev.

Authoritative references: `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md`, `docs/BRAND.md`, `docs/SYSTEM-ARCHITECTURE.md` §2.4 and §5, `docs/FAMILY-DATA-MODEL.md`, `docs/decisions/0001–0007`, `docs/m3/M3-BUILD-CONTRACT.md` (whose rules continue), `docs/runbooks/`. Where this contract narrows or defers part of those documents, ADR 0007 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1–M3

- **M3's code is complete** (Packages 0–10, PRs #30–#40). M3's owner acceptance is open: the restore rehearsal (DEPLOY.md §E items 7–8) is not yet recorded. **M1 is deployed but not accepted** (§E items 1–6). Neither blocks M4 *development*: M4 is built and tested on synthetic data in local and Preview, exactly as M3 was (ADR 0006 §1, ADR 0007 §1).
- **The Production real-data gate stays closed.** Connecting a calendar and every sync write are family-domain writes, so in Production they are refused while `HOME_REAL_DATA` is not exactly `open` (ADR 0006 §2). **No real family calendar is connected anywhere until the gate permits it**, and never in Preview (§6.3).
- Every M1–M3 guarantee stays in force and M4 changes none of them: the sign-in gate and allowlist, the runtime/app role, boot guards, headers (strengthened by Package 1, never weakened), visibility and sensitivity in the domain query layer, Kev refusal, the real-data gate, structural audit with P-1, export completeness, migration-first, synthetic data only.
- M4 extends M3's `recurrence` and `agenda` engines and the `profile` engine; it does not replace them. Today, Forward and *Coming up* keep using the one agenda loader (ADR 0006 §43).

---

## 1. Scope

### 1.1 Build

| Area | What |
|---|---|
| **Rendering boundary** | A nonce-based script Content-Security-Policy, required before the first untrusted external content (ADR 0003 §9). |
| **Secrets** | Application-level encryption of calendar credentials; a keyed fingerprint to recognise the same address; a safe outbound fetch limited to the approved host (§4). |
| **Provider layer** | `CalendarProvider` (provider-neutral), the `ics` adapter, a fake provider for tests, and a provider contract test suite every future provider must pass (§3.1). |
| **Schema** | `calendar_connection`, `calendar_source`, the foreign key from `event`, synced-event identity, and the occurrence-override columns shared by imports and manual single-occurrence edits (§7). Migration-first. |
| **Sync** | Lazy refresh on use: identity-preserving upserts, archive on removal, restore on return, overrides and cancellations, freshness and failure states, one audit row per refresh (§3.3). |
| **Screens** | Settings › Calendars; synced events on Today, Forward, *Coming up* and the event page; annotations and notes on synced events; the regular-week line on a profile; "Change this one" on a repeating manual event (§5). |
| **Engines** | `recurrence` gains overrides, feed exdates, floating times and Windows zone names; `profile` gains the regular week (§3.5, §3.6). |
| **Tests** | Synthetic ICS fixtures, the provider contract suite, sync scenario tests, privacy and gate coverage for every new write, the M3 sweeps extended to the new screens (§8). |

### 1.2 Do not build

- **No external calendar writes** of any kind, and no write capability on `CalendarProvider` (V0.5 at the earliest, behind proposals).
- **No real calendar** in any environment until the gate permits it; none ever in Preview (§6.3).
- **No provider other than Google's secret iCal address in Production.** The adapter is provider-neutral and tests use synthetic feeds of any shape, but iCloud, Outlook and every other real feed need an explicit later decision (ADR 0007 §3).
- **No authenticated provider APIs** (Google Calendar API, Microsoft Graph, CalDAV): V0.2.
- **No background jobs, cron, queues, service workers or push notifications.** Refresh happens on use only.
- **No cross-source deduplication or fingerprinting of events** (ADR 0007 §6).
- **No import of attendees or organisers** (ADR 0007 §7).
- **No M5–M10 work:** no meaning headline, per-person day, getting-there, insights (including `data_health`), conflicts, coordination, Week Ahead, weather, free windows, Kev orchestration, tools or context assembly. A stale calendar is shown as a factual freshness line on Settings › Calendars and the event page, not as an insight.
- **No purge.** Archived mirrored events wait for the later retention mechanism (ADR 0006 §8).
- **No change to Today's or Forward's structure** beyond the synced events the shared loader now returns.
- **No new runtime dependency except `node-ical`** (approved stack, CLAUDE.md), justified in Package 3's PR. Encryption uses Node's built-in `crypto`; fetching uses the platform `fetch`.
- No real household data anywhere in the repository, tests, screenshots, PR text or logs.

---

## 2. Implementation order

### 2.1 Packages are acceptance boundaries

Each package is an acceptance boundary, not a one-PR limit: it may be split into smaller PRs when its size warrants it, without changing its approved architecture or scope. Every PR stops when CI is green and is merged by the owner. Schema-dependent work is migration-first (`docs/runbooks/MIGRATIONS.md`): a migration-only PR merges and runs in Production and Preview before any application PR that needs it.

### 2.2 Packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| **0** | Contract and doc truth | This contract, ADR 0007, corrected FAMILY-DATA-MODEL, SYSTEM-ARCHITECTURE, ROADMAP, CLAUDE.md, README, DEPLOY status. Docs only. | — |
| **1** | Nonce-based script CSP | Per-request nonce, `script-src 'nonce-…' 'strict-dynamic'`, no `unsafe-inline` or `unsafe-eval` for scripts in Production; every page still renders and hydrates; tests prove an injected inline script does not run. No calendar code. | 0 |
| **2** | Credentials and safe fetch | `src/trust/credentials.ts` (AES-256-GCM seal/open, key id, row binding, keyed address fingerprint); `HOME_CREDENTIALS_KEY` in `env.ts` and the DEPLOY env table; the outbound fetch guard (§4.3). Pure and unit-tested; no schema, no provider code. | 0 |
| **3** | Provider layer | `CalendarProvider`, the `ics` adapter (parse, normalise, sanitise), the fake provider, the synthetic ICS corpus, the provider contract suite, and the `recurrence` engine extension (§3.5). Adds `node-ical`. No database. | 0 |
| **4a** | **Migration only** | `calendar_connection`, `calendar_source`, `event.calendar_source_id` foreign key, synced-event identity index, occurrence-override columns (§7). The owner runs it in Production and Preview before 4b merges. | 0 |
| **4b** | Calendar and sync services | Connection and source services, the sync service (§3.3), the sync actor (§3.4), refresh-on-use route, gate coverage, privacy suite and `audit-subjects` registration, export completeness, Activity labels. | 2, 3, 4a run |
| **5** | Settings › Calendars | Connect, list with freshness and status, a calendar's page (name, whose, who can see, usual kind), Refresh now, Disconnect with confirmation (§5.1). | 4b |
| **6** | Synced events across screens | Synced events on Today, Forward, *Coming up*; the event page's source and freshness line, read-only details, people and notes on synced events, "Repeats (as in your calendar)"; refresh-on-use from the shell (§5.2). | 4b |
| **7** | Regular week | `profile` engine regular-week derivation and the profile line (§3.6). | 4b |
| **8a** | Single-occurrence edits: engine and service | Manual occurrence overrides on the shared override model (§3.7). | 4a run, 3 |
| **8b** | Single-occurrence edits: screens | "Change this one" and "Back to the series" on a repeating manual event (§5.3). | 8a |
| **9** | Acceptance and audit | M3 sweeps extended to M4 (two-adult privacy, device, export), sync failure drills, adversarial audit, `docs/m4/M4-ACCEPTANCE.md`, DEPLOY.md additions. | all |

Order: 0 → (1, 2, 3 in parallel) → 4a → owner runs the migration → 4b → (5, 6) → 7 → 8a → 8b → 9.

### 2.3 Implementer by package

| Opus | Fable |
|---|---|
| 0, 1, 2, 3, 4a, 4b, 7, 8a, 9 (contract, security boundary, secrets, parsing and time correctness, schema, privacy, sync, engines, audit) | 5, 6, 8b (screens on settled services and M3's patterns) |

Opus reviews every Fable PR before the owner merges it.

---

## 3. Architecture

### 3.1 Provider layer (`src/integrations/calendar/`)

```ts
interface CalendarProvider {
  kind: 'ics';                                    // later: 'google' | 'microsoft' | 'caldav'
  listCalendars(conn): Promise<ExternalCalendar[]>; // ICS: exactly one
  fetchEvents(conn, cal, range): Promise<{
    events: ExternalEvent[];   // normalised; see below
    skipped: number;           // VEVENTs that could not be read
    feedHash: string;          // hash of the whole feed, to skip unchanged refreshes
  }>;
  // No write capability in M4.
}
```

- `ExternalEvent` is HOME's own shape: `uid`, `recurrenceId` (the original occurrence, a date or an instant), `status` (`confirmed` | `tentative` | `cancelled`), a timed start, end and IANA zone *or* an all-day date range with an exclusive end, `rrule`, `exdates`, and sanitised `title`, `description`, `location`. No attendees, organiser, alarms, attachments, URLs or raw provider properties. No provider type leaks past the adapter (CLAUDE.md rule 13).
- The `ics` adapter accepts a credential (the address), fetches it through the guard (§4.3), parses it with `node-ical`, and normalises. It knows nothing about the database.
- A **fake provider** returns scripted feeds for tests. The **provider contract suite** (§8.2) runs against both, and any future provider must pass it.
- Integrations import only `domain` types and `lib` (CLAUDE.md layer rules).

### 3.2 Records

- **`calendar_connection`**: a connection to one provider, owned by one adult; the encrypted credential; status. Owner-only, like a conversation: the other adult never reads it.
- **`calendar_source`**: one calendar within a connection (ICS: exactly one). Carries the HOME-owned settings: `name`, `visibility` (`household` | `private`), `default_kind`, `default_person_ids`, and freshness. Its `created_by` is the connection's owner.
- **Synced `event`**: `source = 'synced'`, `calendar_source_id`, `external_uid`, the occurrence identity (§3.3), `external_etag` (a hash of the normalised event, to skip unchanged rows). **`created_by` is the connection's owner and `created_via` is `sync`; `visibility` is the source's.** The normal visibility predicate then works unchanged: a private calendar's events are seen by its owner only, a household calendar's by both adults. There is no parallel privacy system for calendar events (ADR 0007 §8).
- **What HOME owns on a synced event:** who is going and who is responsible (`event_person`), notes on the event (`note` with an event subject), and the source-level settings above. **What the provider owns:** title, description, location, times and zone, all-day, recurrence, exdates, status. Synced events stay read-only in every service (ADR 0005 §25); only the sync path writes provider-owned fields.
- **Default people** of a source are applied when the agenda shows who an event is for, only where the event has no annotations of its own; they are never written as `event_person` rows. A source's default people must be visible to everyone who can see the source (the existing reference rule).

### 3.3 Sync

- **Trigger: refresh on use.** Page rendering never writes. The shell asks a same-origin, `no-store` route handler to refresh, without blocking the page, when a source the signed-in adult can see is older than **15 minutes**; when anything changed the page refreshes itself. **Refresh now** on Settings › Calendars is a plain form that works without JavaScript. There are no background jobs.
- **Who may trigger:** any signed-in adult may cause a household source to refresh; a private source is refreshed only by its owner's use. Either way the writes are the owner's (§3.4).
- **One refresh at a time per source:** a transaction-scoped advisory lock; a second request returns at once and leaves the first to finish.
- **Atomic:** a source's refresh is one transaction. A fetch or parse failure changes no event and records the failure; last-known events stay.
- **Unchanged feed:** when `feedHash` matches the last successful one, only freshness moves.
- **Window:** events with any occurrence from **30 days before today to 400 days after** (the agenda engine's limit) in the home zone. A series is kept whole when any occurrence falls in the window.
- **Identity:** an event is `(calendar_source_id, external_uid, occurrence)`, where *occurrence* is empty for a series or a single event and the original occurrence (a date or a UTC instant, normalised) for an override. A unique index enforces it. The same identity across refreshes is the same row, updated in place, so its id, people and notes survive.
- **Changes:** an event whose `external_etag` changed is updated in place. A moved or retimed event keeps its row.
- **Disappearance:** an event missing from a successful feed is **archived** by the sync (synced events cannot be archived by a person). If the same identity returns, the row is **restored** and updated, with its annotations and notes.
- **Recreated with a new UID:** a new row. HOME does not guess that two UIDs are the same event.
- **Overrides:** a moved or changed occurrence (`RECURRENCE-ID`) is its own row pointing at its series (§7), and its original occurrence is added to the series' exdates as an instant (timed) or a date (all-day), which the engine already honours (ADR 0006 §37). A **cancelled** occurrence becomes an exdate only.
- **Cancelled events** (`STATUS:CANCELLED` without `RECURRENCE-ID`) are treated as removed.
- **Kind and domain:** the event's `kind` is the source's `default_kind` (else `other`); `domain` is left empty.
- **Partial reads:** a VEVENT the adapter cannot read is skipped and counted; the rest of the feed applies. A feed that cannot be read at all is a failure (§3.8).
- **Limits** (initial values, tuned and recorded in Package 3 and 4b): fetch timeout 10 s; feed size 5 MB; 5,000 VEVENTs.

### 3.4 The sync actor

- Sync writes run as the source's owner: a `UserActor` for the owner's user with `via: 'sync'`, minted **only** by the sync service (as the proposal executor's token is), never from a request. `created_via` is `sync`.
- Every sync write goes through `auditedWrite`, so the real-data gate (first), structural audit and the Kev refusal apply as everywhere else. A person's UI writes to provider-owned fields of a synced event stay refused (`synced_event`).
- Another adult's visit that triggers a household refresh never acts as themselves on the owner's records: the actor is the owner's sync actor, and the audit row says so.

### 3.5 Recurrence and time

- The `recurrence` engine (ADR 0006 §35–39) gains, without changing its manual behaviour:
  - **feed exdates** as dates or instants, with their own `TZID`;
  - **overrides** (§3.3, §3.7);
  - **floating times** (no zone): read in the calendar's declared zone (`X-WR-TIMEZONE`) when it is a valid IANA zone, else `HOME_TIMEZONE`;
  - **Windows zone names** (Outlook-style `TZID`s) mapped to IANA zones by a fixed table; an unknown zone falls back as a floating time and is counted;
  - **RRULEs outside HOME's presets**: expanded as they are, shown read-only as "Repeats (as in your calendar)"; a rule that cannot be parsed yields its first occurrence only, never a guess.
- Timed events keep their own IANA zone; DST follows the engine's rules (wall clock kept, spring-forward gap moves forward, autumn overlap takes the first instance). All-day events stay dates with an exclusive end; a missing all-day end is one day; a missing timed end uses `DURATION`, else the start.
- Days are always placed in `HOME_TIMEZONE`, which may differ from the event's zone (unchanged agenda rule, ADR 0006 §38).

### 3.6 Regular week (`profile`)

- A pure derivation from the events a person attends or is responsible for (manual and synced, as the reader can see them): weekly and fortnightly series active in the coming weeks, shown on the profile as one quiet line ("Usually: Wednesday swimming 15:30, Saturday football 09:00"). Computed on read; nothing is stored; no inference about the person (CLAUDE.md rule 11). Not a per-person day, not getting-there (M5).

### 3.7 Manual single-occurrence edits

- A repeating **manual** event can be changed for one occurrence: its title, time, place, details or people. The change is an **override** row on the same model as an imported override (§7): it points at its series and records the original occurrence; the series gains the matching exdate in the same transaction. **Back to the series** archives the override and removes the exdate.
- **Skip this one** (ADR 0006 §42) is unchanged. Whole-series edits keep each override whose original occurrence the new rule still reaches; an override the rule no longer reaches is archived with the series' change and shown under the series as no longer part of it. Package 8a records the exact rules in ADR 0007.
- Synced events are never edited this way (they are read-only).

### 3.8 Failure and offline behaviour

Each source has one status, shown in words, and HOME stays usable with last-known events in every case:

| Status | Cause | Copy (indicative) |
|---|---|---|
| `ok` | The last refresh succeeded. | "Updated 12 min ago." |
| `unreachable` | Timeout, network or server error. | "Couldn't reach Google just now. Showing what HOME had at 9:40." |
| `address_rejected` | 401, 403 or 404, e.g. the secret address was reset in Google. | "That address no longer works. If you reset it in Google, connect it again." |
| `not_a_calendar` | The feed could not be parsed. | "That address didn't return a calendar." |
| `too_large` | Over the size or event limit. | "That calendar is too large to bring in." |
| `partial` | Some events were skipped. | "Updated; 3 events couldn't be read." |

No error ever shows the address, the provider's text or a stack. A failed refresh is retried on the next use after the 15-minute threshold, never in a loop.

---

## 4. Security boundaries

### 4.1 Credentials

- The secret address is a bearer credential. It is stored only as **AES-256-GCM** ciphertext (`credentials_encrypted`), with a fresh random IV, the key id, and the connection id and owner id as associated data so a ciphertext cannot be moved to another row. Node's built-in `crypto` only.
- The key is `HOME_CREDENTIALS_KEY` (32 random bytes, base64), **different in every environment**, set by the owner, never committed (CLAUDE.md rule 10). An optional previous key allows rotation; a re-encryption step is documented in DEPLOY.md by Package 2. If the key is missing, connecting and refreshing are refused calmly and the rest of HOME runs; it never fails boot.
- A **keyed fingerprint** of the normalised address (HMAC-SHA-256 under `HOME_FINGERPRINT_KEY`, separate stable key material never rotated with `HOME_CREDENTIALS_KEY`; ADR 0007 §34) lets HOME recognise the exact same address without storing it in plain text (§4.4).
- The address, its ciphertext and its fingerprint never reach the client (not in HTML, client props or form state), logs, audit rows, Activity, exports, error copy or any LLM context. After connecting, HOME shows only the calendar's name and "Google Calendar".
- **Disconnect destroys the credential at once** (ciphertext cleared in the same transaction that marks the connection disconnected).

### 4.2 Allowed hosts (ADR 0007 §3)

- **Production and Preview accept only Google Calendar's secret iCal address:** `https://calendar.google.com/calendar/ical/…/private-…/basic.ics` (a `webcal://` form is rewritten to `https://`). Every other host or shape is refused with calm copy before any request is made.
- Tests reach synthetic feeds by injecting a fetcher or the fake provider; there is **no environment variable that widens the allowlist** in any deployed environment.

### 4.3 Safe outbound fetch

- HTTPS only; the approved host only; redirects followed only to the same approved host over HTTPS, at most a few; the resolved address must not be private, loopback, link-local or a metadata address; timeout and size cap enforced while streaming; no cookies or credentials sent other than the address itself; a fixed, neutral `User-Agent`.
- Errors map to the statuses in §3.8 and are logged as a code only (never the URL, host path, response body or headers).

### 4.4 Duplicates (ADR 0007 §6)

- Connecting an address whose fingerprint matches a **live** connection is refused ("That calendar is already connected in HOME."), whoever connected it.
- Connecting an address whose fingerprint matches **one of your own disconnected** connections reconnects it: a new credential is sealed, the source returns, and its archived mirrored events are restored by identity on the next refresh, so annotations and notes survive (ADR 0007 §5).
- Otherwise each source keeps its own identity. Events from distinct sources are never merged, even when UIDs match.

### 4.5 Untrusted content (ADR 0007 §9)

- Imported title, description, location and any other provider text are **untrusted external data**. The adapter strips HTML to plain text, decodes entities, removes control characters, and bounds length (title 200, location 500, description 10,000 characters, the existing event limits).
- React's escaping and the nonce-based CSP (Package 1) form the rendering boundary. Synced text is never rendered as HTML, never auto-linked, and never used to build a URL.
- External calendar content is never treated as instructions by any part of HOME. When Kev arrives (M8), calendar text must reach it labelled as untrusted context (CLAUDE.md rule 7).

### 4.6 Audit (ADR 0007 §4)

- `calendar.connect`, `calendar.disconnect`, `calendar.reconnect` (about the connection); `calendar_source.create`, `.update`, `.archive`, `.restore` (about the calendar): one structural row each (provider, which settings changed, counts; never names typed by a person, never the address). Names as built in Package 4b (ADR 0007 §37).
- **One `calendar.sync` row per refresh** on the source, with counts only: `added`, `changed`, `archived`, `restored`, `skipped`, and the status. No per-event rows, no provider text, no credential.
- P-1 holds: a source's rows follow the source's visibility (registered in `audit-subjects.ts`); a connection's rows are its owner's only. Activity reads them in words ("Calendar refreshed: 3 added, 1 changed").

---

## 5. Screens

### 5.1 Settings › Calendars (Package 5)

- `/settings/calendars`: each calendar the adult can see, with its name, whose it is, who can see it, and its status line (§3.8). **Connect a Google calendar**: where to find the secret address in Google (in words), the address field (`type=url`, never echoed back), a name, whose calendar it is, who can see it (with the private choice explained), and its usual kind. Settings lists You · Calendars · What Kev knows · Archived · Activity · Export.
- `/settings/calendars/[id]`: the same settings, editable by the owner; **Refresh now**; **Disconnect** with an inline confirmation that says what happens ("Its events leave HOME's screens. People and notes you added are kept, and come back if you connect the same address again."). The other adult sees a household calendar's name, owner and freshness, with Refresh now, and nothing else.
- In Production while the gate is closed, connecting reads "HOME isn't open for family data yet." (the existing copy).

### 5.2 Synced events (Package 6)

- Today, Forward and *Coming up* show synced events through the shared loader, in agenda order, with the source's default people where the event has none of its own. No new section, mark or insight.
- An event's page shows "From Sam's work calendar · updated 12 min ago", its details as plain text, how it repeats ("Repeats (as in your calendar)" for a rule outside the presets), who is going and responsible (editable), and its notes (editable). No Edit, Skip this one or Archive (the existing synced read-only behaviour, ADR 0006 §42).
- Archived does not list mirrored events: they return only through sync. They are in the export, marked archived.

### 5.3 Change this one (Package 8b)

- On a repeating manual event's page, each upcoming occurrence offers **Change this one** (a form for that occurrence) beside **Skip this one**; a changed occurrence shows "Changed from the usual" with **Back to the series**. Works without JavaScript; refusals focus as in M3.

### 5.4 UI rules

M3's rules carry over unchanged (M3 contract §4): server components, server actions through domain services with `requireActor()`, core forms without JavaScript, calm error copy for every code, tokens only, nothing red, 44×44px targets, WCAG 2.2 AA, the four viewports.

---

## 6. Environments and data

### 6.1 Local and CI

Synthetic ICS fixtures and the fake provider only (§8.1). No network access to any calendar host in tests.

### 6.2 Preview (ADR 0007 §2)

A **dedicated throwaway Google account** owned by the owner holds a calendar of **synthetic events only**. Its secret address is a **Preview-only credential**: entered through Preview's Settings › Calendars, encrypted with Preview's own key, never committed, never put in an issue, PR, log or screenshot. Any real family or personal calendar is forbidden in Preview.

### 6.3 Production

While `HOME_REAL_DATA` is closed, every connect and sync write is refused by the gate. Real calendars are connected only after the gate opens (DEPLOY.md §E item 11) and M4 is accepted; until then Production holds no calendar credential. `HOME_CREDENTIALS_KEY` may be set in Production beforehand (Package 2's DEPLOY steps).

---

## 7. Schema (Package 4a, migration only)

Additive only, under the existing migration rules (`MIGRATIONS.md`): new tables, nullable columns, constraints that existing rows already satisfy. Exact names and types are fixed in Package 4a (migration `0007`) and recorded in FAMILY-DATA-MODEL and ADR 0007 §33, which also record where 4a refined this section.

- **`calendar_connection`**: `id`; `owner_user_id` (→ `user`); `provider` (`ics`); `credentials_encrypted` (nullable: cleared on disconnect); `credentials_key_id`; `address_fingerprint` (indexed; the duplicate rule in §4.4 is enforced by the service and a partial unique index over live connections); `status` (`active` | `disconnected`); `last_error_code`; `created_at`, `updated_at`, `disconnected_at`. No visibility column: owner-only.
- **`calendar_source`**: common fields (`created_by` = the owner, `created_via`, `visibility`, `archived_at`); `connection_id` (→ `calendar_connection`); `external_calendar_id`; `name`; `default_kind`; `default_person_ids` (uuid array, validated by the service); `feed_hash`; `last_attempt_at`, `last_synced_at`, `last_sync_status`, `last_sync_error_code`, `last_skipped_count`.
- **`event`**: a foreign key on `calendar_source_id` (→ `calendar_source`); `recurrence_parent_id` (→ `event`, nullable) and `recurrence_original` (nullable text: an ISO date or UTC instant), a parent only with an original, and an original allowed without a parent for an override whose series is not in the feed (ADR 0007 §26); a unique index over synced identity `(calendar_source_id, external_uid, coalesce(recurrence_original, ''))` where `source = 'synced'`.
- Every new column is either exported or listed as deliberately excluded in `src/domain/export/spec.ts` (the completeness guard): the credential, its key id and the fingerprint are excluded; the rest is exported. Every new table with visibility or an owner is registered in `audit-subjects.ts`.

---

## 8. Testing requirements

### 8.1 Fixtures

A synthetic ICS corpus in `tests/fixtures/calendars/`, shaped like Google's feed (and, for adapter robustness only, Outlook- and iCloud-shaped feeds): timed and all-day events, multi-day all-day, DST weekends in both directions, weekly, fortnightly, monthly and custom rules, `UNTIL` and `COUNT`, `EXDATE` with and without `TZID`, `RECURRENCE-ID` overrides (moved, retimed, cancelled), `STATUS:CANCELLED`, floating times, Windows zone names, unknown zones, HTML descriptions with scripts and links, oversized feeds, malformed VEVENTs. Every name, place and word is synthetic.

### 8.2 Provider contract suite

Runs against the `ics` adapter and the fake provider, and must pass for any future provider: normalised shape; no attendee or organiser; sanitised, bounded text; zones and all-day dates; overrides and cancellations; deterministic `feedHash`; failures mapped to the §3.8 statuses.

### 8.3 Unit

Credential seal/open (wrong key, wrong row, tampering, rotation); fingerprint stability across `webcal`/`https` and normalisation; the host policy and the fetch guard (private addresses, redirects, size, timeout); recurrence extension cases; the regular-week derivation; the CSP header and nonce.

### 8.4 Integration (as `home_app`)

Sync scenarios with the fake provider, each a sequence of feeds: add; move; retime; change one occurrence; cancel one occurrence; delete; return; recreate with a new UID; disconnect then reconnect the same address (annotations and notes survive); a household and a private source for each adult (visibility); an unchanged feed; a failed fetch leaves events untouched; concurrent refreshes; the gate refusing every new write function in Production; Kev and the system refused; audit rows structural, one per refresh, never carrying text or the address; export completeness.

### 8.5 End to end (Playwright, seeded fixture family, synthetic feeds)

Settings › Calendars connect, status, Refresh now, disconnect; synced events on Today, Forward, *Coming up* and their pages; people and notes on a synced event; Change this one; the M3 two-adult privacy sweep and device sweep extended to every new route; an injected-script fixture that never runs; the address never present in any response.

### 8.6 Unchanged

`pnpm lint`, `pnpm typecheck`, unit, integration, e2e, previous-schema check, bundle check, gitleaks and the private-terms scan: green on every PR.

---

## 9. Documentation

- ADR 0007 records decisions and each package's implementation clarifications, numbered as ADR 0006 did.
- FAMILY-DATA-MODEL: CalendarConnection, CalendarSource, synced Event ownership, overrides (Package 0 now; exact columns in 4a).
- DEPLOY.md: `HOME_CREDENTIALS_KEY` (Package 2), the Preview test calendar (Package 5), M4 rows in §E before any real calendar (Package 9).
- `docs/m4/M4-ACCEPTANCE.md` (Package 9). ROADMAP, CLAUDE.md and README status at each milestone change.

---

## 10. Acceptance criteria

M4 is accepted by the owner when:

1. **Packages:** every package merged by the owner with CI green; the migration ran in Production and Preview before the code that needs it merged.
2. **Function:** both fixture adults can connect a synthetic Google-shaped calendar, see its status and freshness, rename it and change whose it is, who can see it and its usual kind, refresh it, disconnect it and reconnect it; people and notes on synced events work; a repeating manual event can be changed for one occurrence and put back.
3. **Sync correctness:** across every §8.4 scenario the stored events equal the feed, nothing is duplicated within a source, rows keep their ids so annotations and notes survive moves, removals and returns, and a failed refresh changes nothing.
4. **Engines:** Today, Forward and *Coming up* agree with the agenda engine for manual and synced events; recurrence tests cover overrides, feed exdates, floating times, Windows zones and both NZ DST transitions; the regular week is derived, not stored.
5. **Privacy:** the two-adult sweep finds no other-adult private calendar, source or synced event on any screen, in Activity or in the export; a household calendar is visible to both and editable only by its owner; sensitive context is untouched by M4.
6. **Credentials:** the address never appears in any response, client data, log line, audit row, Activity, export or error; it is encrypted with a row-bound key and destroyed on disconnect; only the approved Google host is accepted in deployed environments.
7. **Untrusted content:** imported text is plain, bounded and escaped; an injected script never runs under the nonce CSP.
8. **Failure recovery:** every §3.8 status leaves HOME usable with last-known events and reads calmly.
9. **Audit:** every write is audited; one structural row per refresh, with counts only.
10. **Gate:** in Production every connect and sync write is refused while the gate is closed; no real calendar is connected anywhere.
11. **Accessibility and devices:** no serious or critical violations on the new screens; 44×44px targets; keyboard operation; the four viewports with no horizontal scroll.
12. **Scope:** no calendar write, background job, cross-source deduplication, attendee import, M5–M8 feature or extra runtime dependency beyond `node-ical`.
13. **Data:** synthetic data only in the repository, tests, screenshots and PR text; the Preview calendar holds synthetic events only.
14. **Handover:** Opus adversarial audit completed and its blocking findings fixed before the owner's acceptance.

---

## 11. Risks

| Risk | Handling |
|---|---|
| Google's secret iCal feed can lag behind the calendar itself, so HOME may be behind even right after a refresh. | Measured with the Preview calendar in Package 5; freshness is shown honestly; if the lag is unacceptable, the authenticated Google adapter (V0.2) is the remedy, with no domain change. |
| A large real feed strains the time a request may take. | The window, size and event limits; unchanged feeds skip parsing; limits recorded in Package 3 and 4b. |
| Fetching an address a person supplies is an attack surface. | The host allowlist and fetch guard (§4.2–4.3), unit-tested; no widening in deployed environments. |
| The secret address leaks. | Encryption, row binding, no echo, the canary-address test (§8.5). |
| The nonce CSP breaks rendering or hydration. | Package 1 alone, with the full e2e suite before any calendar code. |
| Calendars go stale when nobody opens HOME. | Accepted (no background jobs); freshness shown. |
| M4 cannot be proven on real calendars before the gate opens. | Synthetic corpus plus the throwaway Google account in Preview. |
| Imported recurrence the engine misreads. | Provider contract suite and scenario tests; unknown rules shown read-only, never guessed. |
