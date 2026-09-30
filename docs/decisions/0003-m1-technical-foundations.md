# ADR 0003 — M1 technical foundations

Status: **Accepted**, 2026-09-30 (owner confirmed M1-D1…D6). The implementer may append clarifications at the end of M1.

## Context

ADR 0001 fixed the stack (TypeScript, Next.js, Postgres/Neon, Drizzle, Zod, Tailwind, Better Auth, Vercel `syd1`). M1 needs the next layer of concrete, boring choices so the implementer doesn't invent them.

## Decisions

1. **Node runtime only.** No Edge runtime anywhere; one execution model, full Node APIs, `pg` works.
2. **`pg` driver + Drizzle.** Same driver locally (Docker Postgres) and in production (Neon pooled connection string). No serverless-specific driver.
3. **Migrations** via drizzle-kit, forward-only, expand-then-contract. Run by a GitHub Actions workflow on push to `main` against production (protected environment, manual approval) — not in the Vercel build.
4. **Authentication:** Better Auth, magic link only, database sessions, database-backed rate limiting. Allowlist from env, enforced at link request, user creation and every request. Middleware is never the security boundary; `requireActor()` in server layouts, actions and route handlers is.
5. **Audit log is append-only in the database** (trigger rejecting `UPDATE`/`DELETE`). Denied sign-in attempts store an HMAC of the email, never the address.
6. **Layer boundaries** enforced with ESLint `no-restricted-imports` overrides and the `server-only` package — no extra boundary tooling.
7. **Configuration** only through a Zod-validated `src/lib/env.ts`; `process.env` banned elsewhere; no `NEXT_PUBLIC_*` variables.
8. **Logging** through a small redacting JSON logger. No third-party error tracking in M1; revisit (with PII scrubbing) before real data if Vercel logs prove insufficient.
9. **Headers:** baseline security headers in M1; **full nonce-based script CSP required before M4** (first untrusted external content).
10. **Tests:** Vitest (unit + integration against real Postgres), Playwright (e2e). Test-only mail transport, refused in production.
11. **Test identities** use the reserved `.test` TLD (`sam@example.test`, `alex@example.test`).
12. **Private-terms scan:** CI checks tracked files against a secret list of real-world terms (`HOME_PRIVATE_TERMS`), so the list never enters the repo.
13. **Prototype:** stays as reference, excluded from build and deploy, deleted in M6; retrievable from tag `m0.6-prototype`.

## Consequences

- Cold starts are slightly slower than Edge; irrelevant at two users.
- Deploy and migrate are not atomic; migrations must be backward-compatible for one deploy.
- One more secret (`AUDIT_HASH_SECRET`) and one CI secret (`HOME_PRIVATE_TERMS`).
