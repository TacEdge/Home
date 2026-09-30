# M1 — Foundations: Build Contract

Status: **Ready for implementation once the §3 decisions are confirmed.**
Implementer: Fable 5.1. Reviewer at completion: Opus (code + architecture review before M2).

M1 is **foundations only**. It builds a boring, secure, maintainable production base. It does not build Today, Forward or Kev. At the end of M1, the two adults can sign in to a deployed HOME on their phones and see an empty, calm, correctly structured app — and everything underneath is ready for M2.

Authoritative references: `CLAUDE.md`, `docs/SYSTEM-ARCHITECTURE.md`, `docs/FAMILY-DATA-MODEL.md`, `docs/decisions/0001–0003`, `docs/concepts/`. If this contract conflicts with them, stop and ask.

---

## 1. Scope

### 1.1 Build

| Area | What |
|---|---|
| **Repository hygiene** | `main` as base branch, pinned Node LTS and pnpm, `.gitignore`, `.env.example`, `.editorconfig`, README with local setup. |
| **Application scaffold** | Next.js (current stable, App Router, **Node runtime only**, no Edge), React, TypeScript `strict` (+ `noUncheckedIndexedAccess`), Tailwind CSS. |
| **Styling foundation** | Design tokens (colour, type, spacing) derived from the M0 prototype's direction, as CSS custom properties with light/dark, exposed to Tailwind. Two fonts (serif for the single headline, sans for everything else). No component library. |
| **Config / environment** | One server-only module that validates all environment variables with Zod at startup and fails fast. No `NEXT_PUBLIC_*` variables. |
| **Logging** | A tiny structured logger with a redaction list. No third-party logging/error service in M1. |
| **Database** | PostgreSQL via Drizzle ORM + drizzle-kit migrations. `pg` driver. Local Postgres via Docker Compose. A separate test database for integration tests. |
| **Authentication** | Better Auth, email **magic link only**, database sessions, household allowlist enforced in three places (§5.2). Sign-in, sign-out. Rate-limited. |
| **Trust primitives** | `Actor` type and `requireActor()`; visibility enum and predicate builder; audit recording and listing. |
| **Audit infrastructure** | `audit_log` table, **append-only enforced in the database**, written for all auth events. Visible in *Settings › Activity*. |
| **App shell** | Sign-in page; protected `(home)` layout with **server-side** session check; places navigation driven by a places list with a `primary` flag (Today, Forward primary); placeholder Today and Forward pages; Settings › Activity. Calm error and not-found pages. |
| **Layer boundaries** | Import rules from `SYSTEM-ARCHITECTURE.md` enforced by ESLint; server-only modules guarded with `server-only`. |
| **Testing foundation** | Vitest (unit + integration against real Postgres), Playwright (e2e), fixture strategy, test-only mail transport. |
| **CI** | GitHub Actions: lint, typecheck, unit, integration, build, e2e, secret scan, private-terms scan. Required on `main`. |
| **Deployment foundation** | Vercel (`syd1`) + Neon (Sydney), production and preview environments isolated, migration workflow, security headers, runbook. |
| **Docs** | ADR 0003 finalised, `docs/runbooks/` (local dev, deploy, migrations), ROADMAP and CLAUDE.md status updated. |

### 1.2 Do not build

- No domain entities beyond auth and audit: no Person, Event, Task, Project, Note, Capture, Context, Proposal, Conversation, KevUsage, InsightResponse tables (M2).
- No `src/domain`, `src/kev` or `src/integrations` code. Create those directories only when a milestone needs them; the lint boundary rules may reference them in advance.
- No Claude API, no `@anthropic-ai/sdk`, no Kev bar that does anything.
- No calendar, weather or any external integration.
- No Today/Forward content beyond a placeholder line.
- No real family data anywhere in the repository (docs, fixtures, seeds, tests, screenshots, commits, logs).
- No passkeys, OAuth/social login or passwords.
- No push notifications, background jobs or cron.
- No third-party analytics, error tracking or session replay.
- No multi-household structures (no `household_id`, no tenant concept).
- No migration of prototype code (§4).
- No extra dependencies beyond §6 without a one-line justification in the PR.

---

## 2. Implementation order

Each step is small, independently verifiable and ends green (`pnpm lint && pnpm typecheck && pnpm test`, plus integration/e2e once they exist). Group into PRs as shown; one concern per PR.

| # | Step | Verify by | PR |
|---|---|---|---|
| 1 | **Repo hygiene** — confirm `main` exists and is the base; confirm tag `m0.6-prototype` exists on the remote at commit `3d58390` (create it in GitHub if missing); `.nvmrc`/`engines`, `packageManager` (pnpm), `.gitignore` (incl. `.env*` except `.env.example`), `.editorconfig`, README skeleton. | Clean install on a fresh clone. | A |
| 2 | **Scaffold** — Next.js App Router + TS strict + Tailwind; delete scaffold boilerplate; root layout with tokens and fonts; calm `error.tsx`, `not-found.tsx`, `global-error.tsx`; security headers in `next.config` (§5.6); `robots` disallow + `X-Robots-Tag: noindex`. | `pnpm build` passes; headers present on `pnpm start`. | A |
| 3 | **Lint and boundaries** — ESLint (flat config) + Prettier; `no-restricted-imports` per layer (§7); `server-only` in every module under `src/db`, `src/trust`, `src/lib/env.ts`, `src/lib/log.ts`; rule forbidding `process.env` outside `src/lib/env.ts`. | A deliberate bad import fails lint (verify locally, then remove). | A |
| 4 | **Config and logging** — `src/lib/env.ts` (Zod schema, parse once, typed export); `src/lib/log.ts` (JSON lines, levels, redaction of `email`, `token`, `url`, `text`, `body`, `name`, `cookie`, `authorization`). Unit tests for both. | Missing/invalid env fails fast with a clear message naming the variable, never its value. | A |
| 5 | **Database** — `docker-compose.yml` (Postgres, current major); `src/db/client.ts` (`pg` Pool + Drizzle); `drizzle.config.ts`; scripts `db:generate`, `db:migrate`, `db:studio` (local only), `db:reset:test`; Vitest integration project that migrates a fresh test database. | Integration test: migrations apply from empty; `select 1` via Drizzle. | B |
| 6 | **Audit** — `audit_log` schema and migration; DB trigger rejecting `UPDATE` and `DELETE`; `src/trust/audit.ts` with `recordAudit(actor, event)` and `listAudit(actor, { limit, before })`. | Integration tests: insert works; update and delete raise; list is newest-first and paginates. | B |
| 7 | **Trust primitives** — `src/trust/actor.ts` (`Actor` type, `systemActor`, `requireActor()`), `src/trust/visibility.ts` (`Visibility` enum `household \| private`; `visibleTo(actor, table)` returning a Drizzle `SQL` predicate). | Unit tests for actor; integration test for `visibleTo` against a table created only inside the test. | B |
| 8 | **Authentication** — Better Auth with Drizzle adapter (schema in `src/db/schema/auth.ts` + migration); magic-link plugin; `src/trust/allowlist.ts`; `src/trust/mail.ts` (transport: `provider` or `test`); three-layer allowlist enforcement; rate limiting; session cookie settings; audit events `auth.link_requested`, `auth.sign_in`, `auth.sign_in_denied`, `auth.sign_out`. Route handler `src/app/api/auth/[...all]/route.ts`. | Integration tests for allowlist normalisation and denial paths; e2e in step 10. | C |
| 9 | **App shell** — `/sign-in` (one email field; identical response for allowed and non-allowed addresses); `(home)` layout calling `requireActor()` server-side; places nav from `src/ui/places.ts`; `/today` and `/forward` placeholders; `/settings/activity` listing audit entries; sign-out. Mobile-first, M0 visual language. | Manual check at phone/tablet/desktop widths; no client component imports server modules. | C |
| 10 | **Test foundation** — Playwright config (starts app against test DB with `HOME_MAIL_TRANSPORT=test`); helper reads the magic link from the test mailbox; fixture users `sam@example.test`, `alex@example.test`; e2e suite (§8.3). | `pnpm test:e2e` green locally. | D |
| 11 | **CI** — `.github/workflows/ci.yml`: install (frozen lockfile), lint, typecheck, unit, integration (Postgres service container), build, e2e; gitleaks; `scripts/check-private-terms.ts` (reads terms from secret `HOME_PRIVATE_TERMS`, skips cleanly if unset on forks). | CI green on the PR; branch protection requires it. | D |
| 12 | **Deployment** — `vercel.json`/project settings (`syd1`, Node runtime); `.vercelignore` excludes `prototype/` and `docs/`; `.github/workflows/migrate.yml` (runs `db:migrate` against production on push to `main`, using a GitHub environment secret, with manual approval); `docs/runbooks/DEPLOY.md` with the exact human steps (§9). **Stop and hand over** for account setup; resume to run the production smoke checklist once the owner confirms setup. | Owner signs in on phone at the production URL; Activity shows the sign-in. | E |
| 13 | **Close-out** — finalise ADR 0003; `docs/runbooks/LOCAL-DEV.md`, `MIGRATIONS.md`; ROADMAP M1 marked done; CLAUDE.md status → M1 complete, awaiting review. | Docs reviewed; all acceptance criteria ticked (§10). | E |

---

## 3. Decisions required before implementation

Everything not listed here is decided in ADR 0003. These need the owner:

| # | Decision | Recommendation |
|---|---|---|
| **M1-D1** | **Production URL** (needed for auth base URL, cookies and email links). | A subdomain you control, e.g. `home.<your-domain>`. Keep it out of the repo; it lives in env config. |
| **M1-D2** | **Magic-link email provider** and sending address. | **Postmark** (mature, transactional-only, good deliverability) from a verified subdomain such as `mail.<your-domain>`. Resend is an acceptable alternative. |
| **M1-D3** | **Session lifetime.** | 30-day rolling sessions (refreshed daily with use), `httpOnly`, `Secure`, `SameSite=Lax`. Sign-out revokes the session server-side. A new magic link is needed after 30 days without use. |
| **M1-D4** | **Preview deployments.** | Enabled, protected by Vercel Deployment Protection, connected **only** to a Neon `dev` branch seeded with fixture users. Never production data. |
| **M1-D5** | **Neon plan / point-in-time restore.** | Free tier is fine during M1 (no real data). Move to a paid plan with ≥7 days of point-in-time restore **before** real family data arrives (M3/M4). |
| **M1-D6** | **Git base branch.** | Create `main` from the current docs branch, make it the default, protect it (CI required, no force-push). Milestone work happens on branches merged into `main`. |

---

## 4. Prototype transition

**Survives (as concepts, re-expressed in production code):**
- The experience language: headline first, Worth knowing for connections only, Getting everyone there, Everyone's day, healthy quiet, evening mode, the Who?/Sort it pattern, Kev as assistant vs destination, proposal cards (Yes / Change / Not now), "✓ Kept".
- Design direction and tokens: warm paper background, ink, one terracotta accent for *needs you*, soft person colours, serif headline + sans body, no red, no badges. Re-derive values into `src/ui/tokens.css`; do not copy `styles.css`.
- The **places** model (ordered list with a `primary` flag).
- The **fixture family** (Sam, Alex, Milo, Isla, Nana Jo) and the **six scenarios** — these become test and eval fixtures in later milestones (M5 onwards), rebuilt as domain data, not display strings.
- The scripted Kev lines — later seeds for the Kev eval set (M8), not code.

**Not reused:** `app.js` (imperative DOM rendering), `kev.js` (regex intent matching), `fixtures.js` (display strings, not domain data), `styles.css` as-is, the prototype bar, inline handlers, any breakpoint hacks.

**Keep or remove:** keep `/prototype` in place as a read-only reference until the real Today (M5) and Forward (M6) exist, then delete it in the M6 PR. It is excluded from lint, typecheck, build and deployment (`.vercelignore`, ESLint/TS ignores). It is permanently retrievable from the tag **`m0.6-prototype`**.

---

## 5. Security checkpoint

HOME will hold the family's most sensitive information. M1 sets the defaults everything else inherits.

### 5.1 Authentication
- Magic link only. Links are single-use and expire after **15 minutes**. No passwords, no social login.
- Better Auth's database sessions; cookies `httpOnly`, `Secure`, `SameSite=Lax`, `__Secure-`/`__Host-` prefixes where supported. Lifetime per M1-D3.
- Sign-out deletes the session server-side, not just the cookie.
- Rate limits on link requests: per IP and per normalised email (e.g. 5 per 15 minutes), using Better Auth's database-backed rate limiter (works across serverless instances).
- `BETTER_AUTH_URL` is the production URL; trusted origins limited to it (and the preview domain in preview).

### 5.2 Household allowlist (defence in depth)
The allowlist is `HOME_ALLOWED_EMAILS` (comma-separated, env only, never in the repo), normalised (trim, lower-case). Enforced at:
1. **Link request** — non-allowlisted addresses get **the same response** as allowed ones ("If that address can use HOME, a link is on its way") and **no email is sent**.
2. **User creation** — Better Auth `databaseHooks.user.create.before` rejects any email not on the list. Open sign-up is otherwise disabled.
3. **Every request** — `requireActor()` re-checks the session user's email against the current allowlist; removing an address locks it out on the next request.

Denied attempts are audited as `auth.sign_in_denied` with an **HMAC-SHA256 hash** of the normalised email (keyed by `AUDIT_HASH_SECRET`), never the address itself.

### 5.3 Secrets
- All secrets in Vercel environment variables (production / preview separate) and local `.env.local` (git-ignored). `.env.example` lists names only.
- Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `HOME_ALLOWED_EMAILS`, `HOME_MAIL_TRANSPORT`, `MAIL_API_KEY`, `MAIL_FROM`, `AUDIT_HASH_SECRET`, `HOME_TIMEZONE` (`Pacific/Auckland`). Migration workflow uses `DATABASE_URL_MIGRATE` in a protected GitHub environment.
- `env.ts` refuses to start in production if `HOME_MAIL_TRANSPORT=test`, if secrets are shorter than 32 bytes, or if `BETTER_AUTH_URL` is not `https`.
- gitleaks in CI; GitHub secret scanning enabled.

### 5.4 Database access
- Only `src/db` creates connections; only `src/trust` (in M1) and later `src/domain` query it. `app` never imports `db`.
- Neon: pooled connection string for the app, direct connection for migrations. TLS required (`sslmode=require`).
- `audit_log` is append-only via trigger. Migrations are forward-only and written expand-then-contract, because deployment and migration are not atomic.
- Production and preview use different Neon branches; preview never sees production data.

### 5.5 Server / client boundaries
- Server Components by default. Client components only for interaction, and they receive plain serialisable props — never DB rows, sessions or env.
- `server-only` imported by every module in `src/db`, `src/trust`, `src/lib/env.ts`, `src/lib/log.ts`; build fails if a client bundle imports them.
- No `NEXT_PUBLIC_*` variables.
- **Authorisation is checked in the server layout and in every server action / route handler** via `requireActor()`. Middleware may redirect for convenience but is never the security boundary.
- Server actions validate input with Zod and call `requireActor()` first.

### 5.6 Headers
`Strict-Transport-Security` (2 years, includeSubDomains), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (camera, microphone, geolocation off), `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, `X-Robots-Tag: noindex, nofollow`. A full nonce-based script CSP is **required before M4** (the first untrusted external content); record this in ADR 0003.

### 5.7 Private data
- M1 stores only: users (email, name if given), sessions, verification tokens, rate-limit counters, audit entries. Nothing else.
- The visibility predicate exists and is tested now so M2 can't forget it.
- Seeds and fixtures use `@example.test` addresses (reserved TLD) and the fixture family only.

### 5.8 Logging
- Log events and IDs, not content: `{ level, event, requestId, userId?, ... }`. Redaction list applied recursively.
- Never log emails, magic-link URLs or tokens, cookies, headers, request bodies or env values.
- Better Auth's logger routed through the redacting logger.

### 5.9 Error handling
- Users see calm, generic messages ("Something went wrong. Try again in a moment."); no stack traces, IDs or internals in production responses.
- Errors are logged server-side with a request ID; the user may see the short request ID to quote.
- Env validation failures crash at startup rather than serving a half-configured app.

### 5.10 Test data
- Unit/integration/e2e use fixture users and a disposable test database; CI's Postgres is ephemeral.
- The `test` mail transport writes links to a test-only table/in-memory store readable by Playwright; it is refused in production by `env.ts` and by a production build assertion.
- `scripts/check-private-terms.ts` fails CI if any term from the `HOME_PRIVATE_TERMS` secret (real names, street, school, etc.) appears in tracked files. The list itself never enters the repo.

---

## 6. Technology (decided — ADR 0003)

| Concern | Choice |
|---|---|
| Runtime | Node.js current LTS, pinned; Next.js Node runtime only |
| Package manager | pnpm (pinned via `packageManager`) |
| Framework | Next.js current stable, App Router, React Server Components |
| Language | TypeScript strict + `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS (current major) + CSS custom-property tokens |
| DB | PostgreSQL; Neon in production (`ap-southeast-2`), Docker Compose locally |
| DB access | Drizzle ORM, drizzle-kit, `pg` driver |
| Validation | Zod |
| Auth | Better Auth (Drizzle adapter, magic-link plugin, DB rate limiter) |
| Mail | Provider per M1-D2 via its HTTP API; `test` transport for dev/CI |
| Boundaries | ESLint `no-restricted-imports` overrides + `server-only` |
| Tests | Vitest (unit, integration), Playwright (e2e, Chromium) |
| CI | GitHub Actions, gitleaks |
| Hosting | Vercel `syd1` |
| Monitoring | Vercel logs only in M1 (no third-party error service) |

Allowed runtime dependencies in M1: `next`, `react`, `react-dom`, `drizzle-orm`, `pg`, `zod`, `better-auth`, `server-only`, the mail provider's official SDK (or `fetch`). Anything else requires justification.

---

## 7. Repository layout and boundaries after M1

```
/
├── CLAUDE.md
├── README.md
├── .env.example  .editorconfig  .gitignore  .nvmrc  .vercelignore
├── docker-compose.yml
├── drizzle.config.ts  next.config.ts  tsconfig.json  eslint.config.mjs
├── vitest.config.ts  playwright.config.ts  package.json  pnpm-lock.yaml
├── .github/workflows/ci.yml  .github/workflows/migrate.yml
├── docs/ …  docs/runbooks/{LOCAL-DEV,DEPLOY,MIGRATIONS}.md
├── prototype/                      # reference only, excluded from everything
├── scripts/check-private-terms.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx  error.tsx  global-error.tsx  not-found.tsx  robots.ts
│   │   ├── sign-in/page.tsx
│   │   ├── (home)/layout.tsx       # requireActor(), places nav
│   │   ├── (home)/today/page.tsx   # placeholder
│   │   ├── (home)/forward/page.tsx # placeholder
│   │   ├── (home)/settings/activity/page.tsx
│   │   └── api/auth/[...all]/route.ts
│   ├── ui/
│   │   ├── tokens.css  places.ts
│   │   └── (a few presentational components: Headline, Label, Row, NavSwitch)
│   ├── trust/
│   │   ├── auth.ts  allowlist.ts  mail.ts  actor.ts  visibility.ts  audit.ts
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/{index.ts, auth.ts, audit.ts}
│   │   └── migrations/
│   └── lib/
│       ├── env.ts  log.ts
└── tests/
    ├── unit/  integration/  e2e/
    └── fixtures/users.ts
```

**Import rules (lint-enforced):**
`app → trust, ui, lib` (later also `domain`, `kev`) · `trust → db, lib` · `db → lib` · `ui → lib` (types only) · `lib` → nothing internal. Nothing imports `app`. `ui` never imports `db` or `trust`. Client components never import `db`, `trust` or `lib/env`.

---

## 8. Testing requirements

### 8.1 Unit (Vitest)
- `env.ts`: valid config parses; each missing/invalid variable fails with its name; production refuses `test` mail transport, short secrets, non-https URL.
- `log.ts`: redaction of every listed key, nested and in arrays.
- `allowlist.ts`: normalisation (case, whitespace, empty entries); membership.
- `actor.ts`: construction; `systemActor` cannot be produced from a request.
- `places.ts`: primary places in order; quiet places present.

### 8.2 Integration (Vitest + Postgres)
- Migrations apply to an empty database and are idempotent.
- `audit_log`: insert, list order, pagination; `UPDATE` and `DELETE` rejected by the database.
- `visibleTo`: creator sees `private` and `household`; the other user sees only `household`.
- Auth hooks: user creation rejected for non-allowlisted email; allowed email succeeds.
- Denied sign-in audit stores a hash, not the email.

### 8.3 End-to-end (Playwright)
1. Unauthenticated visit to `/today` → redirected to `/sign-in`.
2. Allowlisted fixture user requests a link → same confirmation text → link from test mailbox → lands on `/today` signed in.
3. Non-allowlisted address → identical confirmation text → no link in mailbox → no session.
4. Magic link reused → rejected. Expired link → rejected.
5. Signed-in user sees places nav with Today and Forward; Settings › Activity lists the sign-in.
6. Sign-out → session gone → `/today` redirects.
7. Removing the user from the allowlist (test env override) → next request is signed out.
8. Security headers present on `/sign-in` and `/today`.
9. Phone (390px) and desktop (1440px) viewport snapshots of sign-in and Today shell render without layout errors (visual review, not pixel diffing).

---

## 9. Deployment requirements

**Human setup (owner), documented step by step in `docs/runbooks/DEPLOY.md` by Fable:**
1. Neon project in `ap-southeast-2` with branches `main` (production) and `dev` (previews); app role and connection strings (pooled for the app, direct for migrations).
2. Vercel project linked to the GitHub repo, function region `syd1`, production branch `main`, Deployment Protection on previews.
3. Environment variables for Production and Preview (separate values; preview uses the `dev` branch and fixture/test allowlist).
4. Mail provider account, verified sending domain (SPF, DKIM, DMARC), API key.
5. Custom domain per M1-D1, HTTPS.
6. GitHub: `main` protected, CI required; `production` environment with `DATABASE_URL_MIGRATE` and required reviewer for `migrate.yml`; secret `HOME_PRIVATE_TERMS`.

**Fable provides:** all config files, workflows, the runbook, and a production smoke checklist. Fable does not handle real credentials and never commits them.

**Production smoke checklist (run after owner setup):** production URL loads over HTTPS; headers present; each parent receives a link and signs in on their phone; a non-allowlisted address receives nothing; Activity shows the sign-ins and the denied attempt (hashed); sign-out works; preview deployment is protected and not connected to production data.

---

## 10. Acceptance criteria / Definition of done

M1 is done when **all** of these are true:

- [ ] `main` is the protected default branch; CI is required and green on the final merge.
- [ ] Fresh clone → `pnpm install` → `docker compose up -d` → `pnpm db:migrate` → `pnpm dev` works using only `docs/runbooks/LOCAL-DEV.md`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit + integration) and `pnpm test:e2e` pass locally and in CI.
- [ ] A forbidden cross-layer import fails lint; a client import of a server-only module fails the build.
- [ ] All §8 tests exist and pass.
- [ ] Allowlist enforced at request, creation and every request; non-allowlisted responses indistinguishable.
- [ ] `audit_log` is append-only at the database level; all auth events audited; Activity page shows them.
- [ ] No secrets, real emails, real names or home location in the repository (gitleaks + private-terms scan clean).
- [ ] Production deployed in Sydney; both parents have signed in on their phones; smoke checklist complete.
- [ ] Preview deployments protected and isolated from production data.
- [ ] Security headers present in production.
- [ ] ADR 0003 accepted; runbooks written; ROADMAP and CLAUDE.md updated.
- [ ] No out-of-scope items (§1.2) present.
- [ ] Handed back for Opus code and architecture review before M2.
