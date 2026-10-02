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

## Consequences

- The roadmap's M2 and M4 rows are updated to show the moved tables and the regular-week deferral.
- Production receives four additive migrations during M2, each in its own migration-only PR and approved by the owner in the migration workflow before any code that depends on it merges. No screen reads the new tables until M3.
- One extra PR before the first migration (contract §2.2, Package S) makes `recordAudit` schema-independent and adds the previous-schema CI check.
- The M1 acceptance items remain open and are tracked in DEPLOY.md §E, independently of M2.
