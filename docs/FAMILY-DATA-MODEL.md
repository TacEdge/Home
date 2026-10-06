# HOME — Family Data Model

Status: **Approved (rev 3).** V0.1 entities are specified; later entities are sketched to show the model can grow without restructuring.

## 1. Modelling principles

1. **Few generic entities, tagged by domain.** An `Event` is an event whether it is a swimming lesson, a WOF appointment or an anniversary dinner. Domains are *views*, not tables.
2. **People are first-class.** Almost everything relates to one or more people. Each person has a lightweight profile so Kev understands the people behind the calendar.
3. **Capture first, organise second.** Raw input is stored as a `Capture` immediately; structured records are created from it by approved proposals, and remember where they came from.
4. **Every record knows who made it, how, and who can see it.** `created_by`, `created_via` (`ui` | `kev` | `sync`), `visibility`.
5. **External data is mirrored, not owned.** Synced calendar events are stored with their provider, source and external IDs, refreshed from source, and never edited in place in V0.1. HOME adds *annotations* (people, responsibility) on top.
6. **Family knowledge is context, not fact.** What Kev knows beyond structured records is held as `Context`: attributed, dated, confirmable, able to go stale, with sensitivity and visibility.
7. **Time is explicit.** Instants stored as UTC `timestamptz` plus an IANA zone; all-day items as `date`; recurrence as RFC 5545 RRULE strings expanded in code.

## 2. Common fields

Every user-facing table has:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `created_at`, `updated_at` | timestamptz | |
| `created_by` | user id | for `sync`, the calendar connection's owner (ADR 0007 §8), so the normal visibility rule applies to synced records |
| `created_via` | enum `ui` \| `kev` \| `sync` | how the record came to be: `kev` when Kev proposed it (and a person approved), or when Kev captured or proposed it directly; a proposal the person made themselves executes as `ui` (ADR 0005 §43) |
| `visibility` | enum `household` \| `private` | default `household` (captures default `private`) |
| `archived_at` | timestamptz null | soft delete; purged after 30 days |
| `origin_capture_id` | uuid null | on records organised from a capture (`event`, `project`, `task`, `note`, `context`; migration `0005`, `ON DELETE SET NULL`) |

### M2 implementation notes (ADR 0005)

- **User ids are text**: Better Auth's `user.id` is text, so every user reference is a `text` foreign key, `ON DELETE RESTRICT` except `person.user_id` (`SET NULL`) and `conversation.user_id` (`CASCADE`). `kev_usage` and `audit_log` keep plain user ids with no foreign key, so their append-only rows never block or change.
- **Enums are `text` + `CHECK`**, never Postgres enum types, so a value can be added by an additive migration; each list is defined once and shared by the `CHECK`, the Zod schema and the type.
- **All-day events have an exclusive end date** (RFC 5545); a task's scheduled window is two columns, both or neither.
- **`event_person` has no visibility**: an annotation is visible, written and audited as its event.
- **Owner-only tables** (`capture`, `proposal` by a `private` visibility; `conversation`, `message`, `insight_response` by `user_id`) are private to one user in every query and in Activity.
- **Retention readiness** (no purge in M2): `archived_at` (30-day soft-delete purge), `capture.dismissed_at`, `message.created_at` and `conversation.last_message_at` (90 days), and foreign keys chosen so a hard delete never orphans or blocks (provenance `SET NULL`, owned children `CASCADE`).
- **Deferred** (ADR 0005): CalendarConnection/CalendarSource and annotations on synced series to M4; regular-week derivation to recurrence support; `User.preferences` until a feature uses it. M4 brings the calendar tables and regular week back into active scope (ADR 0007).

## 3. V0.1 entities

### Person — lightweight profile
A member of the family (or the wider circle who appears in family life). Not necessarily a user.

| Field | Notes |
|---|---|
| `name`, `short_name` | |
| `role` | `parent` \| `child` \| `other` |
| `relationship` | short free text, e.g. "Grandma (Dad's side)" |
| `in_household` | lives at home? Grandparents may appear in events without being household |
| `date_of_birth` | optional; drives age |
| `stage_note` | optional free text, e.g. "starting school in Feb" (no school year is inferred in V0.1) |
| `colour` | soft UI colour |

The **profile** Kev and the People screen see is mostly *derived*, not stored:

| Profile section | Source |
|---|---|
| Age | `profile` engine from `date_of_birth`; `stage_note` shown as written |
| Regular week (recurring activities) | Recurring `Event`s where the person is attending/responsible |
| Things to know (interests, preferences, practical details) | `Context` records with this person as subject |
| Coming up | Agenda for this person; next birthday |

Implementation (migration `0003`, M2 Package 2a): table `person` with the common fields, text columns with `CHECK` constraints for `role`, `visibility`, `created_via` and `colour` (keys `moss`, `sky`, `sun-soft`, `plum`, `sage`, `mist`), `created_by` → `user.id` `ON DELETE RESTRICT`, and `user_id` → `user.id` unique, `ON DELETE SET NULL`.

Recurring activities are therefore **recurring events**, not a separate table. This is deliberately not a development record: no measurements, assessments, progress or observations.

### User
An authenticated login. Adults only in V0.1.

| Field | Notes |
|---|---|
| `email` | must be on the allowlist |
| `person_id` | the Person this user is |
| `preferences` | JSON (e.g. Week Ahead day) |

Implementation (ADR 0005): the link is `person.user_id` in HOME's own table, so Better Auth's `user` table is never modified. `preferences` is deferred until a feature uses it.

### CalendarConnection
A connection to an external calendar provider, owned by one adult. Provider-agnostic.

Built in **M4**, migration `0007` (M4 Package 4a, ADR 0007 §33). Owner-only: the other adult never reads a connection, so it has no visibility column. The plain calendar address never enters the database.

| Field | Notes |
|---|---|
| `id` | uuid |
| `owner_user_id` | whose connection it is; `NOT NULL`, → `user` `RESTRICT` |
| `provider` | `ics` in M4, accepting only Google Calendar's secret iCal address (ADR 0007 §3). Later, each by explicit decision: other ICS feeds, `google`, `microsoft`, `caldav` (`CHECK`) |
| `credentials_encrypted` | ICS: the secret address, sealed with AES-256-GCM and bound to this row (Package 2's `hc1.<key id>.<iv>.<ciphertext>.<tag>`, ≤ 8192 characters; a `CHECK` refuses any other shape, so a plain address cannot be stored); later: OAuth tokens. Cleared on disconnect. Never sent to the client, logs, audit, export or an LLM |
| `credentials_key_id` | which key sealed it (16 hex), for rotation; cleared with the credential |
| `address_fingerprint` | keyed HMAC of the normalised address (`fp1.…`): recognises the same address (duplicate refusal, reconnect) without storing it in plain text; kept after disconnect; required for `ics`; never exported |
| `status` | `active` (default) \| `disconnected` |
| `last_error_code` | a structural code (`^[a-z][a-z_]{0,39}$`), never provider text |
| `created_at`, `updated_at`, `disconnected_at` | timestamps |

Constraints: an `active` connection has a credential and key id and no `disconnected_at`; a `disconnected` one has neither and a `disconnected_at` (`calendar_connection_state_check`), so disconnecting destroys the credential and keeps the row. One **live** connection per fingerprint (partial unique index `calendar_connection_live_fingerprint_unique`, `WHERE status = 'active'`), whoever made it; a disconnected row never blocks reconnecting. Index on `owner_user_id`. Only the calendar domain module may name the table or its credential columns (`tests/unit/calendar-credential-access.test.ts`).

### CalendarSource
One calendar within a connection (for ICS, exactly one per connection). Holds the HOME-owned settings for that calendar.

Migration `0007` (M4 Package 4a, ADR 0007 §33).

| Field | Notes |
|---|---|
| common fields | `created_by` = the connection's owner (the service sets it); `created_via`; `visibility` (`household` default \| `private`) decides who sees the calendar and its events; `archived_at` set on disconnect |
| `connection_id` | `NOT NULL`, → `calendar_connection` `RESTRICT`; ownership comes through the connection |
| `external_calendar_id` | provider's id for the calendar (ICS: `default`); 1–200 characters, never an address |
| `name` | "Parent A – work", "Family calendar"; 1–200 characters, never an address (`!~ '://'`) |
| `default_kind` | e.g. `work`; becomes the synced events' `kind` (null: `other`) |
| `default_person_ids` | `uuid[]`, default `{}`: whose events these usually are; shown for events without their own annotations, never written as annotations (ADR 0007 §14); checked by the service, as an array cannot carry a foreign key |
| `feed_hash` | the last successful refresh's `feedHash` (`h1:` and 64 hex, ADR 0007 §29) |
| `last_attempt_at`, `last_synced_at` | freshness |
| `last_sync_status` | `ok` \| `partial` \| `unreachable` \| `address_rejected` \| `not_a_calendar` \| `too_large` (M4 contract §3.8) |
| `last_sync_error_code`, `last_skipped_count` | a structural code; a count ≥ 0 |

One source per provider calendar in a connection (unique `(connection_id, external_calendar_id)`); indexes on `created_by` and `(visibility, created_by)` as other visible records. Exported from Package 4b, with its service; excluded until then (the table is empty).

### Event
Anything that happens at a time.

| Field | Notes |
|---|---|
| `title`, `description`, `location` | from sync: untrusted external text, stored as bounded plain text with HTML stripped, never rendered as HTML or treated as instructions (ADR 0007 §9) |
| `starts_at`, `ends_at`, `time_zone` | or `start_date`/`end_date` when `all_day` |
| `all_day` | bool |
| `rrule`, `exdates` | recurrence |
| `kind` | `appointment` \| `activity` \| `work` \| `school` \| `social` \| `travel` \| `birthday` \| `deadline` \| `other` |
| `domain` | `family` \| `home` \| `us` \| `admin` \| null |
| `source` | `manual` \| `synced` |
| `calendar_source_id`, `external_uid`, `external_etag` | for synced events; provider-neutral; `calendar_source_id` → `calendar_source` `RESTRICT` (migration `0007`) |
| `recurrence_parent_id`, `recurrence_original` | an occurrence override: the series (nullable, → `event` `SET NULL`) and the original occurrence it replaces (an ISO date or a UTC instant `YYYY-MM-DDTHH:MM:SSZ`, `CHECK`); used by imported overrides and manual single-occurrence edits (migration `0007`, ADR 0007 §13, §26, §33). A parent only with an original; an original without a parent is an override whose series is not in the feed (an orphan), and the sync may link it later |

Implementation (migration `0004`, M2 Package 3a): a timed event has `starts_at`, `ends_at` and `time_zone` and no dates; an all-day event has `start_date` and an **exclusive** `end_date` (RFC 5545) and no instants; both enforced by `CHECK`. `rrule` and `exdates` (`text[]`) are stored as given; nothing parses them in M2. From M3 the `recurrence` engine reads them: `rrule` is an RFC 5545 rule (HOME writes only its presets, and keeps any other rule as written), and an exdate is a date (skips that local day's occurrence) or an instant (skips the occurrence starting then); ADR 0006 §35–37. `source = 'synced'` requires `calendar_source_id` and `external_uid`; `calendar_source_id` has no foreign key until M4 (ADR 0005, D-M2-3). Indexes on `starts_at` and `start_date` serve range reads.

Synced events (M4, ADR 0007): `created_by` is the calendar connection's owner, `created_via` is `sync`, and `visibility` is the calendar source's, so the normal visibility rule applies; `source = 'synced'` exactly when `created_via = 'sync'` (`event_sync_provenance_check`). Identity is `(calendar_source_id, external_uid, coalesce(recurrence_original, ''))`, a partial unique index `WHERE source = 'synced'` (`event_synced_identity_unique`): a series or single event (no original) is unique too, and identity never depends on the parent link. It holds archived or not, so the same event is the same row across refreshes; missing from a feed it is archived, back it is restored. A manual series has at most one live change per occurrence (`event_manual_override_unique`, `(recurrence_parent_id, recurrence_original) WHERE source = 'manual' AND recurrence_parent_id IS NOT NULL AND archived_at IS NULL`). Nothing calendar-related cascades: a source with events cannot be deleted, and removing a series leaves its overrides as orphans with their people and notes. Provider-owned fields are written only by the sync path; people and notes stay HOME-owned. Attendees and organisers are never imported.

### EventPerson (annotation)
Who is involved and how. Works for manual and synced events.

| Field | Notes |
|---|---|
| `event_id`, `person_id` | synced events keep their row across refreshes (ADR 0007 §13), so an annotation on a synced series or occurrence is an ordinary `event_id` |
| `role` | `attending` \| `responsible` (e.g. doing drop-off/pickup) |

Implementation (`0004`): `event_person` has its own uuid id, a unique `(event_id, person_id, role)`, and cascades with its event and its person. It has no visibility column.

### Task

| Field | Notes |
|---|---|
| `title`, `notes` | |
| `status` | `open` \| `done` \| `dropped` |
| `project_id` | optional |
| `domain` | `home` \| `family` \| `admin` \| `us` \| null |
| `assignee_person_id` | optional |
| `about_person_id` | optional — e.g. a task that concerns a child |
| `due_date` | optional |
| `estimate_minutes` | optional |
| `needs` | JSON set: `dry_weather`, `daylight`, `two_people`, `shops_open` |
| `scheduled_for` | optional agreed window |
| `completed_at` | |

Implementation (`0004`): `needs` is a JSON array drawn only from the four values; `estimate_minutes` is positive; `scheduled_for` is two columns, `scheduled_starts_at` and `scheduled_ends_at`, both or neither. Deleting a task's project or person clears the link (`ON DELETE SET NULL`).

### Project
V0.1: home projects only.

| Field | Notes |
|---|---|
| `title`, `summary` | |
| `domain` | `home` in V0.1 |
| `status` | `idea` \| `active` \| `paused` \| `done` |
| `target_date` | optional |

Implementation (`0004`): `domain` defaults to `home` and accepts the four domains; V0.1 services accept only `home`. `status` defaults to `idea`.

### Note

| Field | Notes |
|---|---|
| `body` | markdown |
| `subject_type`, `subject_id` | `project` \| `person` \| `event` \| null |

Implementation (`0004`): `subject_type` and `subject_id` are both set or both null. The subject has no foreign key; the service validates it.

### Capture — "capture first"
Something a user told HOME, stored verbatim before anyone decides what it is.

| Field | Notes |
|---|---|
| `text` | the user's own words, verbatim (never model-written) |
| `captured_by` | user |
| `channel` | `web` (V0.1); later `voice`, `share`, `email` |
| `message_id` | the conversation message it came from, if any |
| `status` | `new` \| `proposed` \| `organised` \| `dismissed` |
| `organised_into` | JSON list of `{type, id}` records created from it |
| `visibility` | `private` until organised; the organised records get their own visibility |

Flow:
```
user says something ──► Capture(new, private)          ← stored immediately, no LLM needed
                          │
                          ▼ Kev triage (fast tier)
                      Proposal(s) linked to capture ──► Capture(proposed)
                          │ approve                        │ reject / ignore
                          ▼                                ▼
       Task / Event / Project / Note / Context      stays in "To sort"
       (origin_capture_id set) ──► Capture(organised)   (dismiss → purge in 30 days)
```
A capture may organise into several records ("book the WOF and remember the car's due for tyres" → a task and a context record). If nothing fits, it stays a capture — which is fine.

Kev never authors a capture (CLAUDE.md rule 3): a Kev capture names the person's own user message and its text is copied exactly; any `message_id` must be in the capturer's own conversation (ADR 0005 §43).

Implementation (migration `0005`, M2 Package 4a): common fields with `visibility` always `private` (`CHECK`) and `created_by` as `captured_by` (required; never a `sync` record). `text` is stored exactly as given (it must contain a non-space character) and a trigger refuses any change to `text`, `created_by`, `created_at`, `created_via` or `channel` for every role, so organising never rewrites what was said (`message_id` stays writable for Package 5). `channel` is `web`. `message_id` has no foreign key until `message` exists (Package 5). `organised_into` is a JSON array of `{type, id}` (`task`, `event`, `project`, `note`, `context`; uuid ids); `organised` requires `organised_at` and at least one reference; `dismissed_at` is set exactly while `dismissed`, for the 30-day purge.

### Context — "what Kev knows"
Replaces the earlier `Fact`. Family knowledge that isn't naturally an event, task or note, and which can change.

| Field | Notes |
|---|---|
| `subject_type`, `subject_id` | `person` \| `household` \| `project` (later `place`) |
| `content` | "Enjoys dinosaurs at the moment." |
| `category` | `interest` \| `preference` \| `routine` \| `intention` \| `practical` \| `other` |
| `source_type` | `told_kev` \| `manual` \| `capture` |
| `source_user_id`, `source_ref` | who said it; conversation or capture id |
| `created_at` | |
| `last_confirmed_at` | set on creation and whenever someone confirms it's still true |
| `valid_until` | optional, for time-bound context ("this month") |
| `sensitivity` | `normal` \| `sensitive` |
| `visibility` | `household` \| `private` |
| `status` | `proposed` \| `active` \| `retired` |

Staleness is a **heuristic, derived, not stored** — stale context is never expired or deleted: the `staleness` engine treats context as *possibly out of date* when past `valid_until`, or when `last_confirmed_at` is older than a per-category default (initial proposal: interest/preference 12 months, routine 6 months, intention 3 months, practical 12 months). Kev phrases stale context tentatively ("last I heard…") and never states it as current. Settings shows stale items for a quick confirm/retire.

Rules:
- Kev may **propose** `normal` context; it becomes `active` only on approval.
- Kev never proposes `sensitive` context and never infers emotions, health, behaviour, development or relationship dynamics. People may record practical sensitive details themselves (e.g. an allergy).
- Everything is listed in Settings → *What Kev knows*: editable, confirmable, retirable, deletable.

Implementation (`0005`): common fields plus `origin_capture_id` (→ `capture`, `ON DELETE SET NULL`). A `household` subject has no `subject_id`; `person` and `project` subjects must have one (no foreign key; the service validates it). `source_user_id` is required (→ `user`, `RESTRICT`); `source_ref` has no foreign key. `last_confirmed_at` defaults to creation, `sensitivity` to `normal`, `status` to `active` (`proposed` reserved); `retired_at` is set exactly while `retired`.

### Conversation / Message
Kev chat history, owned by one user, retained 90 days, not used as memory.

| Field | Notes |
|---|---|
| `role` | `user` \| `kev` |
| `channel` | `web` (V0.1) |
| `content` | provider-neutral structure: text, citations, tool-call summaries, proposal and capture refs |
| `tier`, `model` | on Kev messages |

Service (M2 Package 5b): conversations and messages are read and written only by their owner; adding a message moves `last_message_at`; message content is validated as version 1 of HOME's provider-neutral format. Writes are a signed-in person's (ADR 0005 §39).

Retention: the 90-day conversation purge (not built in M2) measures from `last_message_at`, falling back to `created_at` for a conversation that has no message (ADR 0005 §43).

Implementation (migration `0006`, M2 Package 5a): `conversation` has `user_id` (→ `user`, `ON DELETE CASCADE`), `created_at`, `updated_at`, `last_message_at` (the 90-day retention clock) and `archived_at`; it is private to its owner by `user_id`, so it has no visibility column. `message` belongs to its conversation (`ON DELETE CASCADE`); `content` is a JSON object carrying a numeric `v` (the application validates each version's schema); a Kev message has `tier` (`fast` \| `deep`) and `model`, a person's has neither (`CHECK`). Deleting a conversation clears `capture.message_id` and `proposal.conversation_id` (`ON DELETE SET NULL`) and never touches a capture's words.

### Proposal
A change Kev wants to make, awaiting approval.

| Field | Notes |
|---|---|
| `conversation_id`, `requested_by_user_id`, `capture_id` (optional) | |
| `action` | `task.create`, `task.update`, `task.schedule`, `event.create`, `event.update`, `event_person.set`, `project.create`, `project.update`, `note.create`, `context.create`, `context.update`, `capture.dismiss` |
| `payload` | JSON validated by the action's Zod schema |
| `summary` | human-readable, speakable |
| `status` | `pending` \| `approved` \| `rejected` \| `expired` \| `failed` |
| `decided_by`, `decided_at`, `decided_channel`, `result_ref` | |

Implementation (`0005`): common fields with `visibility` always `private`; `created_by` must equal `requested_by_user_id`, and `decided_by`, when set, must too (only the requester decides). `capture_id` → `capture` `ON DELETE SET NULL`; `conversation_id` has no foreign key until `conversation` exists (Package 5). `payload` is a JSON object; `summary` is not blank. `expires_at` defaults to 7 days after creation. Each `status` has one shape: `pending`/`expired` undecided, `approved` with decider, time, channel and `result_ref`, `rejected` with decider, time and channel, `failed` with those and a `failure_reason` code.

### AuditLog, KevUsage
- `audit_log` — append-only record of writes and Kev tool calls. Migration `0003` adds `visibility` (default `household`) and `visible_to_user_id`: a write-time snapshot of the affected record's visibility, so Activity never reveals more than the record would (ADR 0005 §9).
- `kev_usage` — per Kev run: tier, model, tokens, cost estimate, escalated flag. Drives the spend cap (NZ$50/month initially) and the Usage view in Settings.

Service (M2 Package 5b): `recordUsage` only inserts, with the provider's cost in whole micro-US-dollars (bigint); `monthToDateCostUsdMicros` totals the household's cost for a calendar month in the home time zone.

Implementation (`0006`): `kev_usage` is append-only: `home_app` has only `SELECT` and `INSERT`, and a trigger refuses update, delete and truncate for every role, as for `audit_log`. It holds no content. Cost is the provider's cost in micro-US-dollars (`cost_usd_micros`, bigint); there is no NZD column or conversion in M2 (the NZ$ spend cap is M8's). `user_id` and `conversation_id` are plain values with no foreign key, so deleting a user or conversation never blocks on or rewrites the log. Token counts and cost are non-negative.

### WeatherCache
Cached forecast (location, fetched_at, hourly JSON).

### InsightResponse
The only persisted part of insights. Insights themselves are derived on read (see SYSTEM-ARCHITECTURE §2.6).

| Field | Notes |
|---|---|
| `user_id` | responses are per user |
| `insight_key` | deterministic key: kind + subjects + date |
| `response` | `dismissed` \| `not_useful` |
| `responded_at` | |

A dismissed insight doesn't reappear for that user. `not_useful` also feeds detector tuning (by us, deliberately) — never automatic inference.

Service (M2 Package 5b): `respond` upserts the actor's own response; `respondedKeys` returns only the actor's own. Keys are deterministic (letters, digits, `: _ . -`), never free text.

Implementation (`0006`): `insight_response` has a uuid id, `user_id` (→ `user`, `RESTRICT`), `insight_key`, `response` (`CHECK`) and `responded_at`; unique `(user_id, insight_key)`, so a response is upserted. Private to that user by `user_id`.

## 4. Relationships (V0.1)

```
User ─1:1─ Person ─┬─< EventPerson >─ Event >─ CalendarSource >─ CalendarConnection
                   ├─< Task (assignee / about) >─ Project
                   ├─< Context (subject)
                   └─< Note (subject)
Project ─< Task, Note, Context
User ─< Conversation ─< Message
User ─< Capture ─< Proposal ──► (Task | Event | Project | Note | Context).origin_capture_id
```

## 5. Derived views (computed, not stored)

| View | Built by | Used for |
|---|---|---|
| Day agenda | `agenda` | Today |
| Horizon | `agenda` over 7/30/90 days | Forward |
| Conflicts | `conflicts` | Today, Forward, Week Ahead |
| Free windows | `windows` | "When could I get this done?", date-night finder |
| Person profile | `profile` + recurring events + context + agenda | People screen, Kev context |
| Staleness | `staleness` | Kev phrasing, Settings review |
| Insights | `insights` detectors over all engines, minus dismissed | Today "Worth knowing", Forward, Kev |
| Week Ahead | Kev over all of the above | Weekly briefing |

## 6. Later entities (sketch — not built in V0.1)

| Entity | Domain | Notes |
|---|---|---|
| `Attachment` | Home, Admin | Photos/files in private object storage. **V0.2.** |
| `Idea` | Family, Us, Home | Things to do/try/buy; status idea → planned → done. Until it exists, ideas live as captures or `intention` context. |
| `Place` | Family, Us | Restaurants, venues, walks. |
| `Memory` | Family | Positive moments, photos; never evaluative. |
| `Asset` | Admin, Home | Vehicles, appliances, house systems. |
| `Policy` / `Subscription` | Admin | Renewals, cost; sensitive fields encrypted. |
| `MaintenanceSchedule` | Admin, Home | Recurring rule on an Asset generating tasks/events. |
| `Decision` | Home, Family | A choice to be made, options, deadline, outcome. |

None of these require changes to the V0.1 entities; captures can organise into them once they exist.
