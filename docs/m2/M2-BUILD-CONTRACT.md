# M2 — Knowledge Core: Build Contract

Status: **Approved** (merged in #16). Scope decisions D-M2-1…8 and contract rules P-1…P-6 (P-1 as refined by the owner) approved on 2026-10-02 (ADR 0005). Amended 2026-10-02 by **migration-first deployment** (§2.1, ADR 0005 §16).
Implementer: Fable 5.1. Reviewer at completion: Opus (code + architecture review before M3).

M2 builds HOME's family data layer: the schema, the domain services that every screen and every Kev tool will go through, the `profile` and `staleness` engines, the synthetic fixture family, and the tests that prove private and sensitive records never leak. **M2 has no screens, no Kev and no integrations.** At the end of M2 production has the new, empty tables and behaves exactly as it does today.

Authoritative references: `CLAUDE.md`, `docs/FAMILY-DATA-MODEL.md`, `docs/SYSTEM-ARCHITECTURE.md`, `docs/KEV-AGENT-MODEL.md`, `docs/decisions/0001–0005`, `docs/runbooks/MIGRATIONS.md`. Where this contract narrows or defers part of those documents, ADR 0005 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1

M1 is deployed to production but **not accepted**. The outstanding M1 acceptance items are listed in `docs/runbooks/DEPLOY.md` §E. M2 may proceed in parallel because it needs no signed-in production user and introduces no real data (D-M2-1). M2 must not:

- change any M1 security control: the sign-in gate, the single public auth endpoint, the allowlist layers, fixed sessions, the runtime/app role, the boot guards, headers, CI or workflow boundaries;
- change credentials, Vercel, Neon, Postmark or GitHub settings;
- start any M3 work. **M3 real-user and real-data work is gated on M1 production acceptance and on the `home` project having the Neon recovery capability required by M1-D5.**

---

## 1. Scope

### 1.1 Build

| Area | What |
|---|---|
| **Domain foundation** | `src/domain/common/`: shared column helpers, shared enum constants, domain errors, the transaction-plus-audit write helper. |
| **Trust extensions** | Sensitivity predicate in `src/trust/visibility.ts`. Structural, content-free audit whose visibility follows the affected record (§3.2, P-1). |
| **Schema + migrations** | `person`, `event`, `event_person`, `project`, `task`, `note`, `capture`, `context`, `proposal`, `conversation`, `message`, `kev_usage`, `insight_response`. Forward-only and additive (§4). |
| **Domain services** | One service per entity under `src/domain/<entity>/`, each with its Zod input schemas (§5). |
| **Proposal approval** | Create, approve, reject and expire proposals; approval executes through the domain services (§5.7). No Kev code. |
| **Engines** | `src/domain/engines/profile.ts` (age, next birthday) and `src/domain/engines/staleness.ts` (§6). |
| **Fixture family** | The synthetic household from `docs/concepts/README.md` as domain data in `tests/fixtures/`, and a seed script for local and CI databases only (§7). |
| **Tests** | Unit tests for engines and schemas; integration tests for every service, run as `home_app`; a cross-entity privacy suite (§8). |
| **Docs** | `FAMILY-DATA-MODEL.md` implementation notes, ADR 0005 amendments, runbook updates, status lines (§9). |

### 1.2 Do not build

- **No UI:** no new pages, components, server actions or route handlers. The existing shell is untouched.
- **No Kev:** no `src/kev/`, no LLM SDK, no prompts, no tools, no evals. Conversation, Message and KevUsage get schema and minimal services only.
- **No integrations:** no `src/integrations/`, no calendar or weather code.
- **No CalendarConnection or CalendarSource tables** (D-M2-3, moved to M4).
- **No recurrence handling:** no RRULE parsing or expansion, no `agenda`, `conflicts`, `windows` or `insights` engines, no regular-week derivation (D-M2-4).
- **No full-text search** (Kev's `search` tool arrives with Kev).
- **No purge execution:** no jobs, cron or scripts that delete data (D-M2-6). The schema must support them (§4.4).
- **No backups or export** (M3).
- **No seeding of `home-dev` or production** (D-M2-5). No new workflow.
- **No change to Better Auth-owned tables** (`user`, `session`, `account`, `verification`, `rate_limit`) (D-M2-2).
- **No new runtime dependency.** If one seems necessary, stop and ask.
- **No real household data** anywhere: code, docs, tests, fixtures, seeds, commit messages, PR text (D-M2-8).
- No multi-household structures. No `household_id`.

---

## 2. Implementation order

### 2.1 Migration-first deployment (ADR 0005 §16)

Vercel deploys `main` as soon as a PR merges, while the production migration waits for owner approval. Expand-then-contract keeps the *previously deployed* app safe against a *newer* schema; nothing keeps *new* app code safe against the *older* schema it meets in that window. So, for every schema-dependent change:

1. A migration that introduces schema required by new application code lands in a **migration-only PR** first.
2. That PR contains **no application code that requires the new schema**. It may contain the migration, its Drizzle schema definitions, migration and privilege tests, and code that works on both the old and the new schema. A new column in an *existing* table's Drizzle definition is itself schema-dependent code if any query selects or returns every column of that table, or inserts into it through Drizzle (which lists every defined column): such queries must name their columns first, or the column definition waits for the application PR. The previous-schema check (rule 7) catches any that remain.
3. After review and green CI, the owner merges the migration PR to `main`.
4. The production migration stays **explicitly owner-approved** through the protected **Migrate production database** workflow.
5. **Only after the production migration has succeeded** may application code that depends on that schema merge. The application PR's description links the successful workflow run. To review that PR's Vercel preview against `home-dev`, dispatch **Migrate preview database** first.
6. **`recordAudit` returns only the columns its caller needs**, `id` unless another field is explicitly required, so sign-in and auditing never depend on future additive `audit_log` columns.
7. **CI runs a previous-schema compatibility check**: the PR's application code against a database migrated only to the base branch's migrations, enough to catch code that would break while production is still on `main`'s prior schema (§4.3).
8. Each M2 work package therefore uses **separate migration and application PRs** wherever the code depends on new schema. A package with no schema dependency stays one PR.
9. None of this relaxes the additive-only, expand-first migration rules (§4.3).

### 2.2 Work packages

Every PR stops when CI is green and is ready for review; **the owner merges it** (D-M2-7). The next PR starts only after the previous one is merged and, after a migration PR, after its production migration has succeeded.

| Package | PR | Contents | Migration |
|---|---|---|---|
| **1** | 1 | This contract, the Fable prompt, ADR 0005, status and roadmap updates. Docs only. **Merged (#16).** | none |
| **1.1** | — | Migration-first process (this section, ADR 0005 §16, `MIGRATIONS.md`). Docs only. | none |
| **S — Deployment safety** | one PR, **merged (#20)** | Rule 6: `recordAudit` returns `id` only, every caller checked. Every other query on `audit_log`, including `listAudit`, names its columns, so 2a can add columns to its Drizzle definition safely. Rule 7: the previous-schema compatibility job in CI. No schema change. Must merge **before** the first M2 migration PR. | none |
| **2 — Foundation and People** | **2a** migration-only, **merged (#21), migrated in production** | `person`; the P-1 columns on `audit_log`; their Drizzle schema; migration and `home_app` privilege tests. | `0003` |
| | **2b** application | `src/domain/common/`; sensitivity predicate; record-following `listAudit` with `person` registered; `person` service including `linkSelf`; `profile` engine; fixture people. Opened only after `0003` has succeeded in production. PRs for packages 3–5 register each new entity with `listAudit` in the application PR that uses it. | none |
| **3 — Events, projects, tasks, notes** | 3a / 3b | `event`, `event_person`, `project`, `task`, `note`; then their services, reference rules (§5.5), fixtures and leak tests. | `0004` |
| **4 — Capture, context, proposals** | 4a / 4b | `capture`, `context`, `proposal` and `origin_capture_id` on `event`, `project`, `task`, `note`; then the `staleness` engine, proposal approval (§5.7) and fixtures. | `0005` |
| **5 — Kev bookkeeping, seed, privacy suite** | 5a / 5b | `conversation`, `message`, `kev_usage` (append-only), `insight_response`, `capture.message_id` foreign key; then their services, `pnpm db:seed:fixtures`, the privacy suite (§8.3) and docs (§9). | `0006` |

### 2.3 Status of the first Package 2 attempt (PR #17)

PR #17 implemented Package 2 as a single PR (migration `0003` together with the code that needs it). It was opened against `docs/m2-build-contract` after that branch had already merged to `main`, and on 2026-10-02 it was merged **only into that obsolete branch** (merge commit `b1113f8`). **Its implementation is not on `main`, migration `0003` has not run in any environment, and none of it is approved for production.** It must never be merged from that branch.

Its review found a blocker that this section exists to prevent: deployed before its migration, PR #17's `recordAudit` asked for the new `audit_log` columns and would have failed every audit write, including sign-in. Package 2 is rebuilt from `main` as 2a and 2b, and 2b also carries these review findings:

- a test proving a failed audit insert rolls back the write (not a failure elsewhere in the transaction);
- the visibility predicate in every `UPDATE`'s `WHERE`, not only in the preceding read, so a concurrent visibility change cannot let the other adult write into a now-private record;
- a test that every table with a `visibility` column is registered with `listAudit`.

## 3. Decisions

### 3.1 Approved by the owner, 2026-10-02 (ADR 0005)

| # | Decision |
|---|---|
| **D-M2-1** | M2 starts while M1 acceptance remains open. M1 is not marked complete. M3 real-user and real-data work is gated on M1 production acceptance and the required Neon recovery capability. |
| **D-M2-2** | A user is linked to their Person by `person.user_id` in HOME's schema. Better Auth-owned tables are not modified. `User.preferences` is deferred until something uses it. |
| **D-M2-3** | CalendarConnection and CalendarSource are **deferred to M4**, with the ICS adapter and credential encryption. Event stays provider-neutral in M2. This is a deliberate deviation from the roadmap's M2 list. |
| **D-M2-4** | Regular-week derivation in `profile` is deferred until recurrence support arrives. No RRULE dependency is added for M2. |
| **D-M2-5** | The fixture seed runs against local and CI databases only. `home-dev` and production are not seeded in M2. |
| **D-M2-6** | The purge mechanism is deferred, but M2 models every timestamp, state and foreign-key behaviour the approved retention rules need, so they can be implemented later without a schema retrofit. |
| **D-M2-7** | M2 implementation PRs do not auto-merge (originally PRs 2–5; now every PR in §2.2). Each stops when CI is green; the owner approves each merge. |
| **D-M2-8** | M2 contains no real household or family data. Development, tests, seeds and examples use the synthetic fixture family only. |

### 3.2 Contract rules, approved by the owner, 2026-10-02 (ADR 0005)

| # | Proposal | Why |
|---|---|---|
| **P-1** (refined) | **Audit visibility follows the affected record.** Invariant: *audit metadata never reveals more than the underlying record would reveal.* (a) Every domain audit row names the affected record (`subject_type`, `subject_id`) and stores a write-time snapshot of its visibility in two additive columns: `audit_log.visibility` (`household` \| `private`, default `household`) and `audit_log.visible_to_user_id` (the owner of a private or owner-only record; null for household). (b) `listAudit` shows a domain row to an actor **only if that actor can currently see the affected record**, by the same predicate the record's own service uses (owner-only for captures, proposals, conversations, messages and insight responses; `event_person` follows its event). If the record no longer exists, the snapshot decides. (c) So a private record's events stay private **whoever or whatever acted**: the owner, the proposal executor, a future system process (sync, purge) or any other permitted path. If a household record later becomes private, its earlier rows are hidden from the other adult; if a private record becomes household, its rows become visible with it. (d) **Domain audit summaries and meta are structural only**: event name, subject type and id, actor and approver ids, changed field names, enum values, counts. Never user-written content, titles, names, captured text, proposal payloads or proposal summaries, or any other record payload. (e) Rows with no domain subject (`auth.*`) are unchanged and stay household. | Settings › Activity shows every row's summary to both adults today. Without this, a private record's existence, timing or title would reach the other adult, which breaks rule 1 and the "surprise weekend" threat in SYSTEM-ARCHITECTURE §5.1. Evaluating against the record's current visibility, not only the snapshot, keeps the invariant when visibility changes, because append-only rows cannot be rewritten. |
| **P-2** | **Proposals are private to the requesting user**, and only that user can approve or reject them. | Conversations are private per user (D9), and proposals come from conversations. Cross-adult approval can be added later as a decision. |
| **P-3** | **Pending proposals expire 7 days after creation**, evaluated on read: a proposal past `expires_at` cannot be approved and is reported as `expired`. Its stored status is updated when next touched; no job. | The data model has an `expired` state but no period. Read-time evaluation needs no background job. |
| **P-4** | **A 29 February birthday falls on 28 February in common years.** | The `profile` engine needs one rule; this keeps the birthday in its own month. |
| **P-5** | **Context category `other` uses the 12-month staleness period.** | D16 lists periods for five categories; `other` has none. |
| **P-6** | **Context created in M2 starts `active`.** Pending state lives in the Proposal; `proposed` stays in the enum, reserved, and no M2 code produces it. | Avoids two parallel "pending" states for the same thing. |

---

## 4. Schema rules

### 4.1 Columns and conventions

- **Ids:** `uuid` primary keys, `defaultRandom()`. References to users are `text` foreign keys to `user.id`, because Better Auth's ids are text. They are `ON DELETE RESTRICT` (users are not deleted in V0.1), except `person.user_id` (`SET NULL`) and `conversation.user_id` (`CASCADE`). `kev_usage.user_id`, like `audit_log.actor_user_id`, is plain text with no foreign key, so an append-only table never blocks or is changed by a delete.
- **Common fields** on every user-facing table (FAMILY-DATA-MODEL §2): `id`, `created_at`, `updated_at`, `created_by` (text, null only for `sync`), `created_via` (`ui` \| `kev` \| `sync`), `visibility` (`household` \| `private`), `archived_at`. `origin_capture_id` on `event`, `project`, `task`, `note` and `context` (added in PR 4). `updated_at` is set by the service on every write; no triggers.
- **Enums** are `text` columns with `CHECK` constraints, never Postgres enum types, so values can be added in an additive migration. Each value list is defined once as a `const` array in `src/domain/common/` (or the entity's schema module) and shared by the Drizzle `CHECK`, the Zod schema and the TypeScript type.
- **Time** (CLAUDE.md conventions): instants are `timestamptz` plus a `time_zone` IANA name validated with `Intl.DateTimeFormat`; all-day items use `date`; no naive local times. Engines and services receive "today" as a plain `YYYY-MM-DD` date computed in `HOME_TIMEZONE` by the caller, never from the server clock inside an engine.
- **Free-text limits** in the Zod schemas: titles 200 characters, names 100, notes, bodies, descriptions, capture text and context content 10,000.
- **Indexes:** every foreign key, plus `(visibility, created_by)` on each user-facing table and `archived_at` where lists filter on it.

### 4.2 Tables (work package in brackets)

Field meanings follow FAMILY-DATA-MODEL §3 unless stated.

- **`person`** [2]: `name`, `short_name`, `role` (`parent` \| `child` \| `other`), `relationship`, `in_household` (boolean), `date_of_birth` (date, null), `stage_note`, `colour` (null or one of `moss`, `sky`, `sun-soft`, `plum`, `sage`, `mist`; M3 maps keys to tokens), **`user_id`** (text, unique, null, FK `user.id` `ON DELETE SET NULL`).
- **`event`** [3]: `title`, `description`, `location`, `all_day`, `starts_at`, `ends_at`, `time_zone`, `start_date`, `end_date` (**exclusive**, as RFC 5545), `rrule` (text, stored only), `exdates` (`text[]` of ISO 8601 values, stored only), `kind`, `domain` (null allowed), `source` (`manual` \| `synced`), `calendar_source_id` (uuid, null, **no foreign key until M4**), `external_uid`, `external_etag`. `CHECK`s: timed events have `starts_at`, `ends_at`, `time_zone` and no dates; all-day events the reverse; end not before start; `source = 'synced'` requires `calendar_source_id` and `external_uid`.
- **`event_person`** [3]: `event_id` (FK `ON DELETE CASCADE`), `person_id` (FK `ON DELETE CASCADE`), `role` (`attending` \| `responsible`), `created_at`, `created_by`, `created_via`; unique `(event_id, person_id, role)`. **No visibility column:** an annotation is visible exactly when its event is. Annotations on synced series by `external_uid` are designed in M4.
- **`project`** [3]: `title`, `summary`, `domain` (V0.1 services accept only `home`), `status` (`idea` \| `active` \| `paused` \| `done`), `target_date`.
- **`task`** [3]: `title`, `notes`, `status` (`open` \| `done` \| `dropped`), `project_id` (FK `ON DELETE SET NULL`), `domain`, `assignee_person_id`, `about_person_id` (FKs `ON DELETE SET NULL`), `due_date`, `estimate_minutes` (positive), `needs` (`jsonb` array of `dry_weather` \| `daylight` \| `two_people` \| `shops_open`), `scheduled_starts_at`, `scheduled_ends_at` (both or neither), `completed_at`.
- **`note`** [3]: `body` (markdown), `subject_type` (`project` \| `person` \| `event` \| null), `subject_id` (uuid, null; no FK, validated by the service).
- **`capture`** [4]: `text` (verbatim, never trimmed or rewritten), `captured_by` (= `created_by`), `channel` (`web`), `message_id` (uuid, null; FK added in Package 5, `ON DELETE SET NULL`), `status` (`new` \| `proposed` \| `organised` \| `dismissed`), `organised_into` (`jsonb` list of `{type, id}`), **`organised_at`**, **`dismissed_at`**. `CHECK (visibility = 'private')`.
- **`context`** [4]: `subject_type` (`person` \| `household` \| `project`), `subject_id` (null for household), `content`, `category` (`interest` \| `preference` \| `routine` \| `intention` \| `practical` \| `other`), `source_type` (`told_kev` \| `manual` \| `capture`), `source_user_id`, `source_ref`, `last_confirmed_at`, `valid_until` (date), `sensitivity` (`normal` \| `sensitive`), `status` (`proposed` \| `active` \| `retired`), **`retired_at`**.
- **`proposal`** [4]: `conversation_id` (uuid, null; FK added in Package 5, `ON DELETE SET NULL`), `requested_by_user_id`, `capture_id` (FK `ON DELETE SET NULL`), `action`, `payload` (`jsonb`), `summary`, `status` (`pending` \| `approved` \| `rejected` \| `expired` \| `failed`), **`expires_at`**, `decided_by`, `decided_at`, `decided_channel`, `result_ref` (`jsonb`), `failure_reason` (fixed code, never free text). `visibility` is always `private` (P-2).
- **`conversation`** [5]: `user_id` (owner, FK `ON DELETE CASCADE`), `created_at`, `updated_at`, **`last_message_at`**, `archived_at`. Private to its owner by `user_id`.
- **`message`** [5]: `conversation_id` (FK `ON DELETE CASCADE`), `role` (`user` \| `kev`), `channel`, `content` (`jsonb`, provider-neutral, validated by a versioned Zod schema `{ v: 1, text, citations?, toolSummaries?, proposalIds?, captureIds? }`), `tier`, `model` (null on user messages), `created_at`.
- **`kev_usage`** [5]: `at`, `user_id`, `conversation_id` (null), `tier` (`fast` \| `deep`), `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd_micros` (bigint), `escalated` (boolean). **Append-only:** follow the MIGRATIONS.md rule (revoke `UPDATE`, `DELETE`, `TRUNCATE` from `home_app`, plus an append-only trigger), with the matching `app-role` integration test. Cost is stored as the provider's cost in **micro-US-dollars**. M2 introduces **no NZD conversion**; converting for the NZ$ spend cap is an M8 concern.
- **`insight_response`** [5]: `user_id`, `insight_key`, `response` (`dismissed` \| `not_useful`), `responded_at`; unique `(user_id, insight_key)`, upserted.

### 4.3 Migrations

- Generated by drizzle-kit; hand-written SQL (CHECKs Drizzle cannot express, triggers, revokes) appended after a `--> statement-breakpoint`, as in `0001` and `0002`.
- **Additive only.** Every migration must be safe against the currently deployed app, because deploy and migrate are not atomic and production is live. No drops, renames or tightened constraints on existing columns.
- **Migration-first (§2.1).** A migration whose schema new application code requires lands in a migration-only PR, and the code that needs it merges only after the production migration has succeeded. This adds to the additive rule; it never replaces it.
- **Previous-schema compatibility (§2.1 rule 7).** CI builds a database from the base branch's migrations only and runs, as `home_app`, at least the sign-in gate, session, auth and audit integration suites and the boot-validation check with the PR's code. Tests that assert the PR's own new schema are excluded from this job. A PR whose application code needs schema that `main` does not yet have fails it.
- `home_app` reaches new tables through migration `0002`'s default privileges; no new grants except the `kev_usage` revoke. Role-dependent SQL is guarded by `IF EXISTS (… pg_roles … 'home_app')`.
- Each migration applies from empty and on top of the previous one in `tests/integration/migrations.test.ts`.

### 4.4 Retention readiness (D-M2-6)

The approved rules, and what M2 stores so a later purge needs no schema change:

| Rule | Stored in M2 |
|---|---|
| Soft-deleted records purged after 30 days | `archived_at` on every user-facing table and `conversation` |
| Dismissed captures purged after 30 days | `capture.dismissed_at` |
| Conversations and messages deleted after 90 days | `message.created_at`, `conversation.last_message_at` |
| Hard delete on request | Foreign keys chosen so a record can be deleted without orphaning or blocking: `ON DELETE SET NULL` for provenance links (`origin_capture_id`, `capture_id`, `message_id`, `conversation_id`, `project_id`, person references on tasks), `ON DELETE CASCADE` for owned children (`event_person`, `message`) |
| Audit stays complete after a purge | Audit rows are structural only (P-1 d), so purging a record leaves nothing private behind in the append-only log; once the record is gone, the row's snapshot keeps it private (P-1 b) |

---

## 5. Domain service rules

### 5.1 Shape

- `src/domain/<entity>/schema.ts`: the const enums and one Zod schema per input, exported for reuse by future forms and Kev tools.
- `src/domain/<entity>/service.ts`: plain async functions. **The first parameter of every exported function is a `UserActor`.** No domain service accepts the system actor in M2; system paths (sync, purge) are added as separately named functions when they are built.
- Dependency injection like `src/trust/audit.ts` (`deps: { db? }`), so integration tests pass the test database.
- Services return plain objects, never Drizzle query builders.
- Engines import nothing from `db` or `trust`.

### 5.2 Reads

- Visibility, archive state and sensitivity are filtered **in the SQL query** with `visibleTo` and the new sensitivity predicate. Never in application code after the query.
- Archived records are excluded unless `includeArchived: true`.
- A record the actor cannot see is indistinguishable from one that does not exist: `get` throws `NotFoundError` for both.

### 5.3 Writes

- Each write runs in one transaction with its audit row. If the audit insert fails, the write does not happen.
- Audit events are `<entity>.<verb>` (e.g. `task.create`, `task.archive`). Every domain audit row carries the affected record and its visibility snapshot, and summary and meta are structural only (P-1). The shared write helper records them, so no service writes audit rows by hand.
- **Kev never writes directly** (CLAUDE.md rule 3): every write function rejects an actor with `via: 'kev'`, except `captures.captureVerbatim` and `proposals.create`.
- `created_via` is `ui` for direct writes and `kev` only when the write is executed by an approved proposal; only the proposal executor may set it.
- Only the creator may edit a private record, change any record's visibility, or archive a private record. Household records are editable by either adult.
- Archive sets `archived_at`; restore clears it. No service hard-deletes in M2.

### 5.4 Sensitivity

- `visibility.ts` gains a predicate that excludes `sensitivity = 'sensitive'` unless the caller passes `includeSensitive: true`. It composes with `visibleTo`, so a sensitive private record is still visible only to its creator.
- A read with `includeSensitive: true` is audited as `context.sensitive_read` (no content).
- Sensitive context can be created or edited only by an actor with `via: 'ui'`. Proposal payload schemas reject `sensitivity: 'sensitive'`, and the executor rejects it again.

### 5.5 Reference rules

- A reference to another record is resolved through that record's service with the same actor. Referencing something the actor cannot see fails with `NotFoundError`.
- **A household record may not reference a private record** (e.g. a household task in a private project, or a household note about a private event). Otherwise the household record would reveal the private one.

### 5.6 Entity specifics

- **People:** `linkSelf(actor, personId)` sets `user_id` to the acting user only, on a household-visible person with role `parent`, and only if neither is already linked. `unlinkSelf(actor)` clears only the acting user's own link (ADR 0005 §22). Nothing else sets or clears `user_id`.
- **Events:** M2 services create and edit `manual` events only. `synced` rows can be created only by M4's sync path.
- **Captures:** `captureVerbatim(actor, { text, channel, messageId? })` stores `text` exactly as given (rejecting only empty or whitespace-only text and the length limit) and always `private`. Captures are listed only to their creator. Dismiss sets `status` and `dismissed_at`.
- **Context:** `confirm` sets `last_confirmed_at`; `retire` sets `status = 'retired'` and `retired_at`. Retired and stale context is never deleted.
- **Conversations and messages:** private to `conversation.user_id`, enforced in the query.
- **KevUsage:** `recordUsage` inserts; `monthToDateCostUsdMicros(actor, month)` returns the household total (rows hold no content).
- **InsightResponse:** `respond(actor, key, response)` upserts for the acting user; `respondedKeys(actor, keys)` returns that user's set.

### 5.7 Proposals

- `create(actor, { action, payload, summary, captureId?, conversationId? })` validates `payload` with the action's Zod schema and stores a `pending` proposal with `expires_at = created_at + 7 days` (P-3). Actors with `via: 'kev'` may create proposals.
- Actions, as FAMILY-DATA-MODEL §3: `task.create`, `task.update` (including complete and drop), `task.schedule`, `event.create`, `event.update` (manual only), `event_person.set`, `project.create`, `project.update`, `note.create`, `context.create`, `context.update` (including confirm and retire), `capture.dismiss`.
- `approve(actor, id)` and `reject(actor, id)` require a user actor with `via: 'ui'` who is the requester (P-2). Approve re-validates the payload, then executes it through the target service, as the approving user with `created_via = 'kev'`, in one transaction with the status change and an audit row naming both the requester and the approver. Any failure leaves no partial write and marks the proposal `failed` with a fixed reason code.
- Expired, rejected, approved or failed proposals can never execute.
- `approveMany` approves each proposal independently and reports each result.
- An approved proposal with a `capture_id` sets `origin_capture_id` on what it created and adds it to the capture's `organised_into`. When no pending proposals remain for a capture and at least one was approved, the capture becomes `organised`.

---

## 6. Engines

Pure functions with exhaustive unit tests. No database, no clock, no environment.

- **`profile`**: `ageOn(dateOfBirth, today)` in whole years; `nextBirthday(dateOfBirth, today)` returning the date and the age reached. 29 February falls on 28 February in common years (P-4). Tests cover the birthday itself, the day before, leap years, year ends and a null date of birth. Regular week is **not** built (D-M2-4).
- **`staleness`**: `assessStaleness(context, today)` returns `{ possiblyStale, reason: 'past_valid_until' | 'unconfirmed_for' | null, since }`. Periods per D16: interest 12 months, preference 12, routine 6, intention 3, practical 12; `other` 12 (P-5). `valid_until` before today wins. Months are calendar months. Tests cover each category at the boundary day, month-end clamping (31 Jan + 1 month) and `valid_until` today versus yesterday. The engine never mutates or deletes.

---

## 7. Fixture family and seed

- `tests/fixtures/family.ts` holds the household from `docs/concepts/README.md` as **domain inputs**: Sam and Alex (parents, users `sam@example.test` and `alex@example.test`), Milo (child, aged 9 on 14 October 2026), Isla (child, 6), Nana Jo (other, not in household, birthday 20 October). Projects *Back fence* (paint task, 180 minutes, needs dry weather) and *Garage* (light needs sorting). Events, context, captures and proposals as each PR needs them. Scenario date: Wednesday 14 October 2026, Pacific/Auckland.
- It must include **canary private records** for the privacy suite: at least one private record of every user-facing type for each adult, and one sensitive context record. Each carries a distinctive synthetic string so tests can search for leaks.
- `scripts/seed-fixtures.mts`, run as `pnpm db:seed:fixtures`, creates the two fixture users and writes everything **through the domain services**, so the seed exercises the same rules as the app.
- **The seed refuses to run** unless the database host is local (`localhost`, `127.0.0.1` or `::1`), and refuses whenever `VERCEL_ENV` is set or the host ends in `neon.tech`. It never prints the database URL. Negative tests prove each refusal.
- No real names, places, schools, dates or addresses (D-M2-8). The private-terms scan must stay clean.

---

## 8. Testing requirements

### 8.1 Unit

- `profile` and `staleness` per §6.
- Every Zod input schema: valid input, each invalid field, length limits, the event time `CHECK` rules mirrored in Zod, proposal payloads rejecting `sensitivity: 'sensitive'`.
- Seed host guard refusals.

### 8.2 Integration (as `home_app`, like the application)

- Migrations from empty and in sequence.
- Per service: create, get, list, update and archive happy paths; `NotFoundError` for the other adult's private record on get, update and archive; archived excluded by default; household-references-private refused; `via: 'kev'` direct writes refused.
- The sensitivity predicate against a scratch table, as M1's `visibility.test.ts` does.
- Proposals: approve executes and audits requester and approver; reject, expiry and failure never write; the other adult cannot see, approve or reject; `via: 'kev'` cannot approve; capture organised after its last proposal; partial failure leaves no write.
- `kev_usage`: as `home_app`, `UPDATE`, `DELETE` and `TRUNCATE` fail with permission errors.
- P-1: a private record's audit rows are hidden from the other adult when written by the owner, by the proposal executor and by a test-only system-actor write; after household→private, earlier rows are hidden; after private→household, they appear; for a deleted subject, the snapshot decides; `auth.*` rows are unchanged.

### 8.3 Privacy suite (Package 5b)

One test file seeds the full fixture family, then for **every** service and list function, as each adult:

- none of the other adult's canary strings appear in any result;
- no sensitive record appears unless `includeSensitive: true` is passed by its creator;
- no canary string appears in any `audit_log` row's summary or meta;
- `listAudit` for one adult returns no row about any record that adult cannot currently see.

### 8.4 Unchanged

The existing unit, integration and e2e suites and the Vercel bundle check stay green. No test is skipped, weakened or deleted.

---

## 9. Documentation

- `docs/FAMILY-DATA-MODEL.md`: implementation notes for the choices in §4 (text user ids, text+CHECK enums, exclusive all-day end, scheduled window columns, `event_person` visibility, retention columns) and pointers to ADR 0005 for the deferrals.
- ADR 0005: record any implementation clarification of D-M2-1…8 and P-1…P-6, as ADR 0003 did.
- `docs/runbooks/LOCAL-DEV.md`: `pnpm db:seed:fixtures`. `docs/runbooks/MIGRATIONS.md`: the additive rule now applies to a live production database.
- `CLAUDE.md` and `docs/ROADMAP.md`: M2 code complete, awaiting review, when Package 5b is ready. The M1 acceptance status stays as recorded in DEPLOY.md §E until the owner confirms it.

---

## 10. Acceptance criteria

M2 is done when **all** of these are true:

- [ ] Every M2 work package merged by the owner, each PR with CI green on its final commit; migration PRs before their application PRs, and each application PR merged only after its production migration succeeded (§2.1).
- [ ] `recordAudit` returns only `id` unless a caller needs more, and CI runs the previous-schema compatibility check (§2.1 rules 6–7).
- [ ] Every table in §4.2 exists with the §4.1 conventions; migrations are additive and applied to production through the protected workflow; production still boots and serves as before.
- [ ] Every service follows §5: `UserActor` first, query-level visibility, archive and sensitivity filtering, transactional content-free audit, Kev write refusal, creator-only rules, reference rules.
- [ ] Proposal approval works for every action in §5.7 with the guarantees listed there.
- [ ] `profile` and `staleness` engines are pure and exhaustively tested.
- [ ] The fixture family and canaries exist; the seed runs locally and refuses every non-local target.
- [ ] The §8.3 privacy suite passes.
- [ ] `kev_usage` is append-only for `home_app`.
- [ ] No UI, Kev, integration, calendar-table, recurrence, purge, backup, export or Better Auth table change (§1.2).
- [ ] No new runtime dependency; no real household data; gitleaks and the private-terms scan are clean.
- [ ] Audit rows follow P-1: record-following visibility and structural content only.
- [ ] Docs updated per §9.
- [ ] Handed back for Opus code and architecture review before M3.
