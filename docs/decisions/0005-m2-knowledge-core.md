# ADR 0005 — M2 knowledge core: scope and deviations

Status: **Accepted**, 2026-10-02 (owner): D-M2-1…8, and contract rules P-1…P-6 with the owner's refinement of P-1. Full wording of P-1…P-6: `docs/m2/M2-BUILD-CONTRACT.md` §3.2.

## Context

The roadmap defines M2 as the knowledge core: schema, domain services, sensitivity, the `profile` and `staleness` engines, fixtures and leak tests. M1 is deployed to production, but its acceptance is still open (`docs/runbooks/DEPLOY.md` §E): Postmark live sending is pending, so no production sign-in has happened yet. M2 needs no signed-in production user and introduces no real data, so the owner chose to proceed in parallel, with narrowed scope where the roadmap was ahead of the design.

## Decisions

1. **M2 runs in parallel with open M1 acceptance (D-M2-1).** M1 is not marked complete. **M3 real-user and real-data work is gated** on M1 production acceptance and on the `home` Neon project having the recovery capability M1-D5 requires (a plan with at least 7 days of point-in-time restore).
2. **User ↔ Person is `person.user_id` (D-M2-2).** A nullable, unique foreign key in HOME's own `person` table. Better Auth-owned tables are never modified. `User.preferences` from FAMILY-DATA-MODEL §3 is deferred until a feature uses it.
3. **Calendar tables move to M4 (D-M2-3).** *Deliberate roadmap deviation.* CalendarConnection and CalendarSource are built with the ICS adapter in M4, together with credential encryption; a credentials column without encryption behind it would be a trap. `event` keeps provider-neutral sync columns (`source`, `calendar_source_id` without a foreign key, `external_uid`, `external_etag`); M4 adds the tables and the foreign key additively.
4. **Regular week waits for recurrence (D-M2-4).** *Roadmap deviation.* The `profile` engine computes age and next birthday in M2. Regular-week derivation needs RRULE handling and arrives with recurrence support. No RRULE dependency is added for M2.
5. **Fixture seed is local and CI only (D-M2-5).** `home-dev` and production are not seeded in M2; no seed workflow exists.
6. **Retention is modelled now, executed later (D-M2-6).** No purge mechanism in M2, but every timestamp, state and foreign-key behaviour the approved retention rules need is in the M2 schema (contract §4.4), so the mechanism needs no schema retrofit.
7. **PRs are owner-merged (D-M2-7).** M2 implementation PRs stop when CI is green; the owner approves each merge. This differs from M1 and M1.1, where green PRs merged automatically.
8. **No real household data (D-M2-8),** restating D18 for M2's fixtures and seed.

### Contract rules accepted at review

9. **P-1, refined by the owner: audit visibility follows the affected record.** Invariant: audit metadata never reveals more than the underlying record would reveal. Domain audit rows name the affected record and store a snapshot of its visibility (`audit_log.visibility`, `audit_log.visible_to_user_id`, both additive). The Activity list shows a row only to someone who can currently see that record, so a private record's events stay private whoever acted (its owner, an approved proposal, a future system process); the snapshot decides once the record no longer exists. Domain audit summaries and meta are structural only: never user-written content, titles, captured text, proposal payloads or summaries, or other record payload.
10. **P-2:** proposals are private to the requesting user, who alone can approve or reject them.
11. **P-3:** pending proposals expire 7 days after creation, evaluated on read; no job.
12. **P-4:** a 29 February birthday falls on 28 February in common years.
13. **P-5:** context category `other` uses the 12-month staleness period.
14. **P-6:** context created in M2 starts `active`; the pending state lives in the Proposal; `proposed` is reserved.
15. **`kev_usage` stores the provider's cost in micro-US-dollars.** M2 introduces no NZD conversion; conversion for the NZ$ spend cap belongs to M8.

### Amendment, 2026-10-02: migration-first deployment

16. **Schema lands before the code that needs it** (owner decision after the PR #17 review). Vercel deploys `main` on merge while the production migration waits for owner approval, so new code can meet the old schema. For every schema-dependent change: a migration-only PR, containing no code that requires the new schema, merges first; the production migration stays owner-approved through the protected workflow; only after it succeeds may the dependent application code merge. `recordAudit` returns only the columns its caller needs (`id` unless more is explicitly required), so authentication and auditing never depend on future additive `audit_log` columns. CI runs a previous-schema compatibility check against a database migrated only to the base branch's migrations. M2 work packages therefore use separate migration and application PRs where needed. The additive-only, expand-first rules are unchanged. Details: `docs/m2/M2-BUILD-CONTRACT.md` §2.1, `docs/runbooks/MIGRATIONS.md`.
17. **PR #17 is not part of M2's history on `main`.** It was merged only into the obsolete `docs/m2-build-contract` branch; none of it is on `main` or approved for production, and migration `0003` has not run. Package 2 is rebuilt from `main` under decision 16 (contract §2.3).

### Implementation clarifications, Package 2b (for review with its PR)

18. **Writes lock what they check.** Every People write locks the row with the visibility predicate (`SELECT … FOR UPDATE`) and repeats the predicate in the `UPDATE` itself, so a concurrent change to private can never let the other adult write into the record. Timestamps come from the database clock, one value per write.
19. **A linked person stays what `linkSelf` required**: a household-visible parent. While `user_id` is set, changing its visibility to private, its role away from `parent`, or archiving it is refused (`linked_person`). Once unlinked (§22), the record is an ordinary person again.
20. **Restore applies only to an archived record** (`not_archived` otherwise). A malformed id reads as `NotFoundError`, like a missing or invisible one.
21. **Auth audit rows keep their pre-0003 SQL.** `recordAudit` names the P-1 columns only for domain writes that carry a snapshot; sign-in and other auth events are written exactly as Package S left them.
22. **`unlinkSelf(actor)`, owner-approved 2026-10-03,** is the recovery path for a wrong link. It clears only the acting user's own `user_id`; there is no way to name another person or user, so no one can unlink another adult. It changes no other field (`updated_at` aside), runs in one transaction with a structural audit row (`person.unlink_self`, no meta), and refuses Kev and the system actor. The row is locked under the visibility rule and the `UPDATE` repeats both that rule and `user_id = actor`, so a concurrent unlink or relink cannot clear someone else's link. Every domain write now also refuses a system actor at runtime (`not_a_user`), not only by type.

### Implementation clarifications, Package 3b (§23–26; §27 accepted by the owner, 2026-10-03)

23. **Reference rules hold both ways.** A write that sets a reference locks the referenced row (`FOR SHARE`) under the actor's visibility: invisible or archived targets read as `NotFoundError`, and a household record pointing at a private one is refused (`references_private`). A person, project or event that household records reference — archived ones included, since they can be restored — cannot be made private (`referenced_by_household`); for a person this now includes the People service. The two locks order against each other, so neither side can win a race.
24. **EventPerson follows its event.** An annotation has no visibility of its own: it is visible, written and audited as its event (`subjectType: 'event'`, events `event_person.set` / `event_person.remove`), and a household event cannot annotate a private person. Setting an existing annotation is an idempotent no-op with no audit row.
25. **Synced events are read-only in M2.** Services never set `source` or the sync fields; update, archive and restore of a `synced` event are refused (`synced_event`). Only M4's sync path will write them.
26. **Event time is validated where it enters.** Timed events need instants with an offset and a zone accepted by `Intl` (`isValidTimeZone`); all-day events need real dates with an exclusive end after the start. Changing an event's time replaces the whole shape and clears the other one's columns. Events list by local date with all-day items first in their day. `completed_at` on a task is set from the database clock when its status becomes `done` and cleared when it leaves `done`.
27. **Accepted by the owner, 2026-10-03, at the PR #24 review:**
    - **People reference rule.** A person referenced by household-visible tasks, notes or event participation cannot be made private while those household references exist (§23).
    - **Event ordering.** Within a calendar day, all-day events sort before timed events; timed events then sort chronologically (§26).
    - **Duplicate EventPerson.** Setting an annotation that already exists is a true no-op: no state changes, so no audit row is written (§24).

### Implementation clarifications, Package 4a (§28–31; §32 accepted by the owner, 2026-10-03)

28. **`origin_capture_id` on existing tables is deferred in Drizzle, not in SQL.** Migration `0005` adds the column (nullable, no default, `ON DELETE SET NULL`, indexed) to `event`, `project`, `task` and `note`, but their Drizzle definitions gain it only in Package 4b: the deployed 3b services insert into and return every defined column, so defining it now would break them on production's schema until `0005` runs (contract §2.1 rule 2). `tests/unit/deferred-columns.test.ts` lists exactly these four columns as the only difference between the Drizzle schema and the newest migration snapshot; 4b adds the definitions and empties the list. Until then `pnpm db:generate` would emit drops, which the additive-migration guard refuses. `context` is new, so it defines `origin_capture_id` now.
29. **A capture's words cannot change.** A row trigger (`capture_source_immutable`, owned by the migration role) refuses any `UPDATE` that changes `text`, `created_by`, `created_at`, `created_via` or `channel`, for every role. `message_id` stays writable, so Package 5 can attach or backfill the message. Organising writes beside the text (`status`, `organised_into`, `organised_at`); deleting the row (a later purge) is unaffected. `text` must contain a non-space character and is otherwise stored exactly. Captures are always `private` and always have an author (never `sync`). `dismissed_at` is set exactly while a capture is `dismissed`, so the 30-day purge clock is reliable; `organised` requires `organised_at` and at least one `{type, id}` in `organised_into`, whose elements are checked for shape (a known record type and a uuid).
30. **Proposals are private and decided only by their requester, in the database too.** `visibility` is always `private`; `created_by` is the requester (Kev proposes as the requesting user); `decided_by`, when set, must equal `requested_by_user_id` (P-2). Each status has one shape: `pending` and `expired` carry no decision; `approved` carries who, when, channel and `result_ref`; `rejected` carries who, when and channel; `failed` carries who, when, channel and a `failure_reason` code (`^[a-z][a-z0-9_]{0,63}$`, never free text). `expires_at` defaults to `now() + 7 days` and must follow `created_at` (P-3). `conversation_id` and `capture.message_id` get their foreign keys with their tables in Package 5. Allowing another adult to decide later would be its own decision and migration.
31. **Context is sourced and dated.** `source_user_id` (who said it) is required; `source_ref` is a conversation or capture id with no foreign key. `last_confirmed_at` defaults to creation; `valid_until` is an optional date; `sensitivity` defaults to `normal` and `status` to `active` (P-6); `retired_at` is set exactly while `retired`. A household subject has no id, a person or project subject must have one (validated by the service, no foreign key). Staleness stays derived, never stored.
32. **Accepted by the owner, 2026-10-03, at the PR #25 review:**
    - **Proposal decider.** Only the requesting user may approve or reject their proposal in V0.1, enforced by `proposal_decider_check` (§30).
    - **Context provenance.** `source_user_id` stays required (§31).
    - **Capture immutability.** The protected provenance fields are `text`, `created_by`, `created_at`, `created_via` and `channel` (§29). `message_id` is deliberately not protected yet: Package 5 may need to attach or backfill the message relationship.
    - **Proposal lifecycle.** Expired proposals carry no decision fields, and a successful approval and execution must record its `result_ref` (§30).

## Consequences

- The roadmap's M2 and M4 rows are updated to show the moved tables and the regular-week deferral.
- Production receives four additive migrations during M2, each in its own migration-only PR and approved by the owner in the migration workflow before any code that depends on it merges. No screen reads the new tables until M3.
- One extra PR before the first migration (contract §2.2, Package S) makes `recordAudit` schema-independent and adds the previous-schema CI check.
- The M1 acceptance items remain open and are tracked in DEPLOY.md §E, independently of M2.
