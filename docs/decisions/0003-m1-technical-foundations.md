# ADR 0003 — M1 technical foundations

Status: **Accepted**, 2026-09-30 (owner confirmed M1-D1…D6). Amended 2026-10-01 by M1.1 (`docs/m1/M1.1-FIX-CONTRACT.md`): items 16 and 20–28.

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

## Clarifications recorded during implementation

14. **Auth and database handles are built lazily** (`getAuth()`, `getDb()`), never at import, so `next build` and CI need no runtime configuration. Session-dependent routes are `force-dynamic`.
15. **E2E runs against the dev server.** `next start` forces `NODE_ENV=production`, where `env.ts` refuses the test mail transport — correctly. A test-only `HOME_NEXT_DIST_DIR` knob lets a second dev server (narrower allowlist) run from the same checkout to prove allowlist removal signs a person out.
16. ~~Rate limits live in `sendMagicLink`.~~ **Superseded by M1.1 (item 20).** Better Auth stores a pending token, with the address, before calling `sendMagicLink`, so limits and the allowlist there were too late; and `x-forwarded-for` was the wrong header to trust.
17. ~~System font stacks~~ **Amended by ADR 0004:** the brand's three faces are self-hosted from `public/fonts/`. The intent stands: no `next/font/google`, no font fetched from a third party at build or runtime.
18. **`agentRules: false`** in `next.config.ts`: `next dev` must never edit `CLAUDE.md`.
19. **Stacked milestone PRs merge with merge commits**, not squashes, so each branch shares history with `main`.

## Amendments recorded by M1.1 (security and deployment hardening)

20. **Sign-in requests are gated before Better Auth** (`src/trust/sign-in-gate.ts`): per-IP limit on every request (5 per 15 minutes), then the household allowlist, then the per-email limit (5 per 15 minutes). Nothing outside the household or over a limit reaches Better Auth, so no token row and no address is ever stored for it. Denied attempts are audited at most once per IP per window; repeats are only logged with a hashed IP. `sendMagicLink` keeps the allowlist check as defence in depth only. Rate-limit counters are one atomic `INSERT … ON CONFLICT … RETURNING count` statement.
21. **Public auth surface is one endpoint** (decision D-M1.1-2): the route handler forwards only `GET /api/auth/magic-link/verify` to Better Auth; every other Better Auth path is 404 before any auth code runs (`src/trust/auth-surface.ts`). Requesting a link is possible only through the server action. Any future endpoint added there must apply the allowlist check (`actorFor`) before forwarding.
22. **Client IP comes from `x-real-ip` only**, the header Vercel documents as the public IP address of the client that made the request (Vercel request-headers reference, https://vercel.com/docs/headers/request-headers), set at the edge so a client-supplied value is replaced. Exactly one valid address is accepted; IPv6 is bucketed to its /64; anything else falls back to one shared `unknown` bucket (fail closed). Better Auth's `ipAddressHeaders` uses the same header.
23. **Sessions are fixed at 30 days from sign-in and never extended by use** (`disableSessionRefresh: true`), amending M1-D3's rolling sessions. A deliberate V0.1 simplification: the refresh would only have happened through a route handler or server action, and the simpler rule is easier to reason about. Cookie: `__Secure-home.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`, no `Domain` (asserted by an in-process production-shaped test).
24. **Runtime/app role** (decision D-M1.1-1, I5): the application connects as `home_app`, the runtime/app credential — a role that owns no objects, has `USAGE` on `public` without `CREATE`, data access on the auth tables and only `SELECT, INSERT` on `audit_log`. The migration/admin credential (the project owner) runs migrations and administration and is never supplied to the app or Vercel; the app refuses to start on Vercel if its role owns `audit_log`. The trigger remains the second layer. Local and CI use the same two roles. Migration `0002_app_role` is a no-op where the role does not exist.
25. **Preview/dev is a separate Neon project** (`home-dev`, decision D-M1.1-3), never a branch of production, with its own credentials; `env.ts` refuses a preview deployment whose `DATABASE_URL` host equals `HOME_PRODUCTION_DB_HOST`, and a production deployment whose host differs from it when set.
26. **Library log messages are never forwarded as free text.** Better Auth's logger maps to fixed events (`auth.library_warn` / `auth.library_error`) with a sanitised detail (emails, URLs and token-like strings stripped, 200 characters). Better Auth may still call `console.*` directly in rare paths (e.g. plugin configuration warnings at construction); those carry no user data and are accepted.
27. **Accepted: per-email lockout by a distributed attacker.** Anyone who knows a household address can spend its 5-per-15-minutes budget from many IPs and delay that person's sign-in by up to 15 minutes. Accepted for a two-person household; the per-IP limit and the sealed HTTP surface make it the only remaining lever, and it cannot store or send anything.
28. **Environment is validated at server start** (`src/instrumentation.ts`), so a misconfigured deployment fails at boot in the runtime logs rather than on its first request. Test code is excluded from the production `tsconfig.json`; `tsconfig.test.json` type-checks it; CI builds the exact Vercel upload (`scripts/vercel-bundle-check.mjs`). Workflow actions are pinned to commit SHAs (Dependabot refreshes them); the migration workflow runs only from `main`.

## Consequences

- Cold starts are slightly slower than Edge; irrelevant at two users.
- Deploy and migrate are not atomic; migrations must be backward-compatible for one deploy.
- One more secret (`AUDIT_HASH_SECRET`) and one CI secret (`HOME_PRIVATE_TERMS`).
