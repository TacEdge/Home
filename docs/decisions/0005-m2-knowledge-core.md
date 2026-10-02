# ADR 0005 — M2 knowledge core: scope and deviations

Status: **Accepted** for D-M2-1…8, 2026-10-02 (owner). P-1…P-6 are **proposed** in `docs/m2/M2-BUILD-CONTRACT.md` §3.2 and are recorded here as accepted or amended at contract review.

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

## Consequences

- The roadmap's M2 and M4 rows are updated to show the moved tables and the regular-week deferral.
- Production receives four additive migrations during M2, each approved by the owner in the migration workflow. No screen reads the new tables until M3.
- The M1 acceptance items remain open and are tracked in DEPLOY.md §E, independently of M2.
