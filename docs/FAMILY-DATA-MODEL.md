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
| `created_by` | user id | null for `sync` |
| `created_via` | enum `ui` \| `kev` \| `sync` | `kev` means created by approving a Kev proposal |
| `visibility` | enum `household` \| `private` | default `household` (captures default `private`) |
| `archived_at` | timestamptz null | soft delete; purged after 30 days |
| `origin_capture_id` | uuid null | on records organised from a capture (`event`, `project`, `task`, `note`, `context`; migration `0005`, `ON DELETE SET NULL`) |

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
A connection to an external calendar provider. Provider-agnostic.

Built in **M4** with the ICS adapter and credential encryption, together with CalendarSource (ADR 0005). Until then `event.calendar_source_id` has no foreign key.

| Field | Notes |
|---|---|
| `provider` | `ics` (V0.1) \| `google` \| `microsoft` \| `caldav` (later) |
| `owner_user_id` | whose connection it is |
| `credentials_encrypted` | ICS: the secret URL. Later: OAuth tokens. Never sent to client or LLM |
| `status`, `last_error` | |

### CalendarSource
One calendar within a connection (for ICS, exactly one per connection).

| Field | Notes |
|---|---|
| `connection_id` | |
| `external_calendar_id` | provider's id (ICS: the URL hash) |
| `name` | "Parent A – work", "Family calendar" |
| `default_person_ids` | whose events these usually are |
| `default_kind` | e.g. `work` |
| `visibility` | a work calendar might be `household`; a personal one `private` |
| `sync_cursor` | provider sync token where supported |
| `last_synced_at`, `last_sync_status` | freshness |

### Event
Anything that happens at a time.

| Field | Notes |
|---|---|
| `title`, `description`, `location` | description/location from sync are untrusted text |
| `starts_at`, `ends_at`, `time_zone` | or `start_date`/`end_date` when `all_day` |
| `all_day` | bool |
| `rrule`, `exdates` | recurrence |
| `kind` | `appointment` \| `activity` \| `work` \| `school` \| `social` \| `travel` \| `birthday` \| `deadline` \| `other` |
| `domain` | `family` \| `home` \| `us` \| `admin` \| null |
| `source` | `manual` \| `synced` |
| `calendar_source_id`, `external_uid`, `external_etag` | for synced events; provider-neutral |

Implementation (migration `0004`, M2 Package 3a): a timed event has `starts_at`, `ends_at` and `time_zone` and no dates; an all-day event has `start_date` and an **exclusive** `end_date` (RFC 5545) and no instants; both enforced by `CHECK`. `rrule` and `exdates` (`text[]`) are stored as given; nothing parses them in M2. `source = 'synced'` requires `calendar_source_id` and `external_uid`; `calendar_source_id` has no foreign key until M4 (ADR 0005, D-M2-3). Indexes on `starts_at` and `start_date` serve range reads.

### EventPerson (annotation)
Who is involved and how. Works for manual and synced events.

| Field | Notes |
|---|---|
| `event_id` (or `external_uid` for synced series), `person_id` | |
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
