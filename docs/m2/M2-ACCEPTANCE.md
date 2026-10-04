# M2 — Knowledge Core: acceptance check

Checked against `M2-BUILD-CONTRACT.md` §10 (2026-10-04). **M2 is complete:** the owner merged Package 5b (#28) and the closeout hardening (#29) and recorded M2 as formally complete on 2026-10-04. M1 acceptance remains as recorded in `docs/runbooks/DEPLOY.md` §E.

| # | Criterion (§10) | Status | Evidence |
|---|---|---|---|
| 1 | Every work package merged by the owner with CI green; migration PRs before their application PRs, each application PR merged only after its production migration | Met | #16 (contract), #18–#20 (fixes, migration-first, Package S), 2a #21 → `0003` → 2b #22; 3a #23 → `0004` → 3b #24; 4a #25 → `0005` → 4b #26; 5a #27 → `0006` (production and preview confirmed by the owner) → 5b #28; closeout hardening #29. |
| 2 | `recordAudit` returns only `id`; CI runs the previous-schema check | Met | Package S (#20); `scripts/check-previous-schema.mts --boot` and `--self-test` run in CI on every PR. |
| 3 | Every §4.2 table exists with the §4.1 conventions; additive migrations applied to production through the protected workflow; production boots and serves as before | Met | Migrations `0003`–`0006`; `tests/unit/migrations-additive.test.ts`; schema assertions in `tests/integration/migrations.test.ts`; owner-approved **Migrate production database** runs for each. |
| 4 | Every service follows §5 | Met | `UserActor` first; SQL-level visibility, archive and sensitivity filtering; transactional structural audit; Kev refusal; creator-only rules; reference rules both ways. Per-service suites plus `privacy.test.ts`. |
| 5 | Proposal approval works for every §5.7 action with its guarantees | Met | `tests/integration/proposals.test.ts` (all 12 actions, P-2, expiry, races, rollback, sensitive, capture organisation). |
| 6 | `profile` and `staleness` engines pure and exhaustively tested | Met | `src/domain/engines/` import nothing from `db` or `trust`; `tests/unit/profile.test.ts`, `tests/unit/staleness.test.ts`. |
| 7 | Fixture family and canaries exist; the seed runs locally and refuses every non-local target | Met | `tests/fixtures/family.ts`, `tests/fixtures/seed.ts`; `pnpm db:seed:fixtures`; `tests/unit/seed-guard.test.ts` (Vercel, production, Neon, remote, docker-name, look-alike hosts; launcher exits before connecting; no URL printed). |
| 8 | The §8.3 privacy suite passes | Met | `tests/integration/privacy.test.ts`; mutation-checked against visibility, sensitivity, structural audit and Kev refusal. |
| 9 | `kev_usage` append-only for `home_app` | Met | `0006` revoke and trigger; `tests/integration/app-role.test.ts`; owner's production verification. |
| 10 | No UI, Kev, integration, calendar-table, recurrence, purge, backup, export or Better Auth table change | Met | No change under `src/app`, `src/ui`, `src/kev` or `src/integrations` since M2 began; no calendar tables (D-M2-3); RRULE stored only; no purge/backup/export code; Better Auth tables unchanged (`migrations-additive.test.ts`). |
| 11 | No new runtime dependency; no real household data; gitleaks and private-terms clean | Met | `package.json` dependencies unchanged since M2 began; synthetic fixtures only; gitleaks green on every PR; private-terms scan runs in CI with its secret set. |
| 12 | Audit rows follow P-1 | Met | `src/trust/audit-subjects.ts` registers every visibility-bearing and owner-only table; Activity privacy proven per entity in `privacy.test.ts`; content-free meta proven by canary sweeps. |
| 13 | Docs updated per §9 | Met | FAMILY-DATA-MODEL implementation notes; ADR 0005 §§9–42; LOCAL-DEV (`pnpm db:seed:fixtures`); MIGRATIONS (live production); CLAUDE.md and ROADMAP status. |
| 14 | Handed back for Opus code and architecture review before M3 | Met | Final adversarial audit (recommendation B) and its fixes in #29; owner accepted M2 on 2026-10-04. |

## Final audit and closeout hardening

The final adversarial audit of M2 (2026-10-04) found no blocker and recommended targeted fixes (B). All of its Important and the applicable Minor findings are fixed in the closeout hardening PR (ADR 0005 §43), each with regression tests, privacy-suite coverage and a mutation check: host-override guard bypass; Kev-authored captures and cross-adult message links; per-run Kev usage visible in Activity; sensitive context in Activity; context writes returning content; proposal provenance; conversation ownership; retention note.

## Items carried forward

- **M1 acceptance is still open** (DEPLOY.md §E). It no longer blocks M3 development on synthetic data, but it gates real household data in Production (ADR 0006 §1–2).
- **Kev's own transcript and usage recording** (ADR 0005 §39) is decided with the orchestrator in M8 (ADR 0006 §12). M2 refuses every Kev write except capture (of the person's own message) and propose.
