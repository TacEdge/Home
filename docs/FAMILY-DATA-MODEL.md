# HOME — Family Data Model

Status: **Proposed.** V0.1 entities are specified; later entities are sketched to show the model can grow without restructuring.

## 1. Modelling principles

1. **Few generic entities, tagged by domain.** An `Event` is an event whether it is a swimming lesson, a WOF appointment or an anniversary dinner. A `Task` is a task whether it belongs to the garage project or life admin. Domains are *views*, not tables.
2. **People are first-class.** Almost everything relates to one or more people. That is what makes cross-domain reasoning possible ("what's competing for Mike's Saturday?").
3. **Every record knows who made it, how, and who can see it.** `created_by`, `created_via` (`ui` | `kev` | `sync`), `visibility`.
4. **External data is mirrored, not owned.** Synced calendar events are stored with their source and external ID, refreshed from source, and never edited in place in HOME (V0.1). HOME can add *annotations* (people, responsibility) on top.
5. **Kev's memory is data, not magic.** Anything Kev "knows" beyond the structured records is a `Fact` the family can see and edit.
6. **Time is explicit.** Instants stored as UTC `timestamptz` plus an IANA zone; all-day items as `date`; recurrence as RFC 5545 RRULE strings expanded in code.

## 2. Common fields

Every user-facing table has:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `created_at`, `updated_at` | timestamptz | |
| `created_by` | user id | null for `sync` |
| `created_via` | enum `ui` \| `kev` \| `sync` | |
| `visibility` | enum `household` \| `private` | default `household` |
| `archived_at` | timestamptz null | soft delete; purged after 30 days |

## 3. V0.1 entities

### Person
A member of the family. Not necessarily a user.

| Field | Notes |
|---|---|
| `name`, `short_name` | "Courtney", "Court" |
| `kind` | `adult` \| `child` |
| `birthday` | date, optional |
| `colour` | soft UI colour |
| `notes` | short free text (e.g. "Year 3 at …") |

### User
An authenticated login. Adults only in V0.1.

| Field | Notes |
|---|---|
| `email` | must be on the allowlist |
| `person_id` | the Person this user is |
| `preferences` | JSON (e.g. Week Ahead day) |

### CalendarSource
A read-only external calendar feed.

| Field | Notes |
|---|---|
| `name` | "Mike – work", "Family Google calendar" |
| `ics_url_encrypted` | secret; never sent to client or LLM |
| `default_person_ids` | whose events these usually are |
| `default_kind` | e.g. `work` |
| `visibility` | a work calendar might be `household`; a personal one `private` |
| `last_synced_at`, `last_sync_status` | freshness |

### Event
Anything that happens at a time.

| Field | Notes |
|---|---|
| `title`, `description`, `location` | description/location from sync are untrusted text |
| `starts_at`, `ends_at`, `time_zone` | or `start_date`/`end_date` when `all_day` |
| `all_day` | bool |
| `rrule`, `exdates` | recurrence (manual events and synced) |
| `kind` | `appointment` \| `activity` \| `work` \| `school` \| `social` \| `travel` \| `birthday` \| `deadline` \| `other` |
| `domain` | `family` \| `home` \| `us` \| `admin` \| null |
| `source` | `manual` \| `ics` |
| `source_id`, `external_uid` | for synced events |

### EventPerson (annotation)
Who is involved and how. Works for both manual and synced events.

| Field | Notes |
|---|---|
| `event_id`, `person_id` | |
| `role` | `attending` \| `responsible` (e.g. doing drop-off/pickup) |

This is what lets Kev answer *"who's doing pickup on Thursday?"* and detect *"nobody is responsible for Tuesday's pickup"*.

### Task
Something that needs doing, optionally at a time or within a project.

| Field | Notes |
|---|---|
| `title`, `notes` | |
| `status` | `open` \| `done` \| `dropped` |
| `project_id` | optional |
| `domain` | `home` \| `family` \| `admin` \| `us` \| null |
| `assignee_person_id` | optional |
| `due_date` | optional hard deadline |
| `estimate_minutes` | optional; enables "when could I get this done?" |
| `needs` | JSON set: `dry_weather`, `daylight`, `two_people`, `shops_open` (small fixed vocabulary) |
| `scheduled_for` | optional planned window (start/end) once agreed |
| `completed_at` | |

### Project
A body of work with a goal. V0.1: home projects only.

| Field | Notes |
|---|---|
| `title` | "Exterior painting" |
| `domain` | `home` in V0.1 |
| `status` | `idea` \| `active` \| `paused` \| `done` |
| `summary` | one or two lines of intent |
| `target_date` | optional |

A project's detail is its tasks + notes (+ photos from V0.2).

### Note
Free text attached to something, or to nothing.

| Field | Notes |
|---|---|
| `body` | markdown |
| `subject_type`, `subject_id` | `project` \| `person` \| `event` \| null |

Measurements, paint colours, decisions made, supplier names — in V0.1 these all live as notes on a project. We add structure only when repeated use shows it is needed.

### Fact ("What Kev knows")
Durable context Kev can use that isn't naturally an event, task or note.

| Field | Notes |
|---|---|
| `statement` | "Charlie's swimming is Tuesdays after school at the aquatic centre." |
| `about_person_id` | optional |
| `source` | who told Kev, when (conversation id) |
| `status` | `proposed` \| `active` \| `retired` |
| `visibility` | `private` facts only ever appear in their author's Kev context |

Rules:
- Kev may **propose** facts; they become `active` only on approval.
- Facts are about stable context and preferences — never about emotions, health, behaviour or relationship dynamics.
- All facts are listed in Settings → *What Kev knows*, editable and deletable.

### Conversation / Message
Kev chat history. Owned by one user. Retained 90 days (configurable). Not used as memory.

### Proposal
A change Kev wants to make, awaiting human approval.

| Field | Notes |
|---|---|
| `conversation_id`, `requested_by_user_id` | |
| `action` | e.g. `task.create`, `task.update`, `event.create`, `project.create`, `note.create`, `fact.create`, `task.schedule` |
| `payload` | JSON validated by the action's Zod schema |
| `summary` | human-readable ("Add *Fix garage light* to *Garage*, 1 hour, Saturday morning") |
| `status` | `pending` \| `approved` \| `rejected` \| `expired` \| `failed` |
| `decided_by`, `decided_at`, `result_ref` | |

### AuditLog
Append-only record of writes and Kev tool calls. See SYSTEM-ARCHITECTURE §5.8.

### WeatherCache, SyncState
Operational tables: cached forecast (location, fetched_at, hourly JSON), per-source sync state.

## 4. Relationships (V0.1)

```
User ─1:1─ Person ─┬─< EventPerson >─ Event >─ CalendarSource
                   ├─< Task (assignee) >─ Project
                   ├─< Fact (about)
                   └─< Note (subject)
Project ─< Task
Project ─< Note
User ─< Conversation ─< Message
Conversation ─< Proposal
```

## 5. Derived views (computed, not stored)

| View | Built by | Used for |
|---|---|---|
| **Day agenda** | `agenda` engine: expanded events + due/scheduled tasks + birthdays, per person | Today |
| **Horizon** | `agenda` over 7/30/90 days + deadlines + birthdays + project target dates | Forward |
| **Conflicts** | `conflicts` engine over the horizon | Today, Forward, Week Ahead |
| **Free windows** | `windows` engine: people × calendar × daylight × weather × duration | "When could I get this done?", date-night finder |
| **Week Ahead** | Kev over horizon + conflicts + open tasks + projects + facts | Weekly briefing |

## 6. Later entities (sketch — not built in V0.1)

| Entity | Domain | Notes |
|---|---|---|
| `Attachment` | Home, Admin | Photos/files in private object storage; linked to project/asset/note. **V0.2.** |
| `Idea` | Family, Us, Home | Things we'd like to do/try/buy; `status` idea → planned → done; links to a resulting Event. Covers date ideas, restaurants, experiences, "things one of us mentioned". |
| `Place` | Family, Us | Restaurants, venues, walks; used by Ideas. |
| `Milestone` / `Memory` | Family | Positive moments; photos; never evaluative. |
| `Asset` | Admin, Home | Vehicle, appliance, house systems: make, model, purchase date, warranty end. |
| `Policy` / `Subscription` | Admin | Provider, renewal date, cost, auto-renew. Sensitive numbers encrypted at field level. |
| `MaintenanceSchedule` | Admin, Home | Recurring rule attached to an Asset (e.g. WOF, gutter clean) generating Tasks/Events. |
| `Decision` | Home, Family | A choice to be made, options, deadline, outcome. |
| `ProjectCost` / `Material` | Home | Only if notes prove insufficient. |

The core entities above do not need to change for any of these to be added.
