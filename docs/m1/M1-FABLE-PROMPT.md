# M1 IMPLEMENTATION PROMPT — FABLE 5.1

You are implementing **M1 — Foundations** for HOME, a private family operating system for one household. Its intelligence layer is called Kev. The product and architecture are designed and approved. Your job is to execute a precise build contract. You are the engineer, not the designer.

## Read first, in this order

1. `CLAUDE.md` — permanent operating rules. They override everything except the owner.
2. `docs/m1/M1-BUILD-CONTRACT.md` — **the contract**. Scope, order, security, tests, deployment and definition of done.
3. `docs/decisions/0001`, `0002`, `0003` — settled decisions. Do not reopen them.
4. `docs/SYSTEM-ARCHITECTURE.md` (layers, boundaries, privacy), `docs/FAMILY-DATA-MODEL.md` (for context only; M1 builds none of it).
5. `docs/concepts/README.md` and `prototype/` — **experience reference only**. Use them to understand the visual direction and the places model. Never copy prototype code into `src/`.

If anything in this prompt conflicts with those documents, stop and ask.

## Owner decisions for M1 (from contract §3)

- **M1-D1 Production URL:** a dedicated HOME subdomain on a domain the owner controls, or the Vercel deployment URL for M1 if none is ready. **Owner-supplied deployment configuration** — read it from env (`BETTER_AUTH_URL`), never hard-code it, and do not block local foundation work on it.
- **M1-D2 Mail provider:** Postmark, sending from a dedicated subdomain (e.g. `auth.<domain>`), never the root domain. The sending address and API key are **owner-supplied deployment configuration** (`MAIL_FROM`, `MAIL_API_KEY`); don't block on them — use the `test` transport locally and in CI.
- **M1-D3 Sessions:** 30-day rolling, refreshed daily; `httpOnly`, `Secure`, `SameSite=Lax`; server-side revocation on sign-out.
- **M1-D4 Previews:** enabled, Vercel Deployment Protection on, Neon `dev` branch with fixture users only.
- **M1-D5 Neon:** free tier during M1; paid plan with ≥7-day point-in-time restore before real data (not your task).
- **M1-D6 Git:** `main` is the protected default branch; all M1 work merges into it.

## What you are building

Exactly contract §1.1: repo hygiene; Next.js (App Router, Node runtime only) + TypeScript strict + Tailwind with M0-derived tokens; Zod-validated env; redacting logger; Postgres + Drizzle (`pg` driver, Docker Compose locally); Better Auth magic-link auth with a three-layer household allowlist; trust primitives (`Actor`, `requireActor()`, `visibleTo()`); an append-only `audit_log` (DB trigger) with a *Settings › Activity* page; a protected app shell with the places nav (Today and Forward primary), placeholder Today and Forward pages; lint-enforced layer boundaries and `server-only`; Vitest + Playwright; GitHub Actions CI; Vercel `syd1` + Neon deployment config, migration workflow and runbooks.

## What you must not build

Everything in contract §1.2. In particular: no domain tables (Person, Event, Task, Capture, Context…), no `src/domain`, `src/kev` or `src/integrations` code, no Claude API or Anthropic SDK, no calendar or weather, no real Today/Forward content, no passkeys, OAuth or passwords, no background jobs, no analytics or third-party error tracking, no multi-household structures, no prototype code migration, no dependencies beyond contract §6 without a one-line justification.

**Never put real family information anywhere in the repository**: no real names, emails, addresses, schools, places or screenshots containing them. Use the fixture family (Sam, Alex, Milo, Isla, Nana Jo) and `@example.test` addresses. Never commit secrets.

## How to work

Implement the contract's §2 steps **in order, one at a time**. For each step:

1. Re-read that step and the contract sections it references.
2. Implement only that step.
3. Write its tests alongside it.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` (and `pnpm test:integration` / `pnpm test:e2e` once they exist). Fix until green. Never skip, disable or weaken a test to get green.
5. Re-read your diff adversarially against contract §5 (security) and §7 (boundaries).
6. Commit with a clear message. Keep commits focused.

Group steps into branches and pull requests into `main` exactly as the contract's PR column shows (A: steps 1–4, B: 5–7, C: 8–9, D: 10–11, E: 12–13). Open each PR only when its steps are green locally; describe what it contains and how it was verified, and list any new runtime dependency with its justification.

Flow: **A → CI green → B → CI green → C → CI green → D → CI green → E.** Wait for CI, not for the owner: when a group's CI is green, merge it into `main` (or, if you can't merge, base the next branch on it) and carry straight on. Don't stop for approval between groups. If CI fails, root-cause and fix; don't retry blindly. Stop and ask only if CI can't be made green, something conflicts with the docs, or you reach step 12.

## Security rules you must hold throughout (contract §5)

- Authorisation is enforced server-side with `requireActor()` in the protected layout, every server action and every route handler. Middleware is never the security boundary.
- The allowlist (`HOME_ALLOWED_EMAILS`, env only) is enforced at link request (same response, no email sent for non-allowlisted addresses), at user creation (Better Auth hook) and on every request.
- Denied attempts are audited with an HMAC of the email, never the email.
- `process.env` only in `src/lib/env.ts`; no `NEXT_PUBLIC_*`; `server-only` on every `src/db`, `src/trust` and `src/lib/env|log` module.
- Logs contain events and IDs only — never emails, links, tokens, cookies, headers, bodies or env values.
- Users see calm, generic errors; no stack traces or internals in production.
- The `test` mail transport must be impossible in production (env validation + build assertion).
- `audit_log` rejects `UPDATE` and `DELETE` at the database level.

## Deployment step (step 12)

You cannot create cloud accounts or handle real credentials. Prepare everything — config, workflows, `.vercelignore` (exclude `prototype/` and `docs/`), and `docs/runbooks/DEPLOY.md` with exact, numbered owner steps (contract §9). Then **stop and hand over**: tell the owner exactly what to set up. When the owner confirms setup is done, walk through the production smoke checklist with them and fix anything it reveals.

## Style

Match the calm visual language: warm paper background, one terracotta accent reserved for "needs you", serif for the single headline, sans elsewhere, generous whitespace, one column on phones, no badges, no red. Copy is warm, plain, NZ English. The Today placeholder can say something like "Today will live here." Keep components few and presentational.

## When you are done

Stop when **every** item in contract §10 is satisfied. Then report:

1. What was built, by PR, with links.
2. The acceptance checklist, each item ticked with how it was verified.
3. Any deviation from the contract, and why.
4. Anything you found that the M2 contract should address.
5. Confirmation that no out-of-scope item was built and no real data or secret was committed.

Then STOP. Do not begin M2. M1 goes to an Opus code and architecture review first.

If you are unsure at any point, choose the simpler, more private, more boring option — and ask.
