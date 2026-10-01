# Runbook — Deployment (Vercel `syd1` + Neon Sydney)

Owner steps are numbered. Nothing here needs a credential in the repository. Decisions: ADR 0003; M1-D1…D6 in `docs/m1/M1-BUILD-CONTRACT.md` §3.

## A. One-time setup

### 1. Neon (database)
1. Create a project in region **AWS ap-southeast-2 (Sydney)**, Postgres 16. Free tier is fine for M1; move to a paid plan with ≥7 days point-in-time restore **before real family data** (M1-D5).
2. Branches: keep `main` (production) and create `dev` (previews).
3. On each branch, note two connection strings for the default role: **pooled** (for the app) and **direct** (for migrations). Both must use `sslmode=require`.
4. Apply migrations to `main` once: from a trusted machine, `DATABASE_URL=<main direct url> pnpm exec drizzle-kit migrate`. (After that the GitHub workflow does it.)

### 2. Postmark (sign-in email)
1. Create a server (transactional). Add the sending domain **`auth.<your-domain>`** (a dedicated subdomain, never the root — M1-D2) and complete DKIM and Return-Path DNS records; add SPF/DMARC on that subdomain.
2. Create a Server API token. Note the sending address, e.g. `home@auth.<your-domain>`.

### 3. Vercel (hosting)
1. Import the GitHub repository. Framework: Next.js. Production branch: `main`. `vercel.json` pins region `syd1` and the pnpm commands.
2. **Settings → Deployment Protection**: enable for Preview deployments (M1-D4).
3. **Settings → Domains**: add the production domain (M1-D1). Until you have one, use the `*.vercel.app` URL.
4. **Settings → Environment Variables** — set each variable separately for **Production** and **Preview** (never share values between them):

| Variable | Production | Preview |
|---|---|---|
| `DATABASE_URL` | Neon `main` **pooled** URL | Neon `dev` **pooled** URL |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | a different random value |
| `BETTER_AUTH_URL` | `https://<production domain>` | the stable branch URL Vercel assigns to the branch you use for previews (form `https://<project>-git-<branch>-<team>.vercel.app`), set once |
| `HOME_ALLOWED_EMAILS` | the two household addresses | `sam@example.test,alex@example.test` or your own test addresses |
| `HOME_MAIL_TRANSPORT` | `provider` | `provider` (test transport is refused in production builds) |
| `MAIL_API_KEY` | Postmark server token | a Postmark **sandbox** server token |
| `MAIL_FROM` | `home@auth.<your-domain>` | same |
| `AUDIT_HASH_SECRET` | `openssl rand -base64 48` | a different random value |
| `HOME_TIMEZONE` | `Pacific/Auckland` | same |

Notes: no `NEXT_PUBLIC_*` variables exist. `BETTER_AUTH_URL` must be `https` in production (`env.ts` refuses otherwise). Vercel sets `x-forwarded-for` to the real client address, which the rate limiter trusts; do not put another proxy in front without preserving that.

### 4. GitHub
1. **Default branch** `main`. **Branch protection** on `main`: require a pull request, require status checks `Lint, typecheck, unit and integration tests`, `End-to-end (Playwright)` and `Secret scan (gitleaks)`, block force-pushes. Leave required approvals at 0 so green PRs can merge without a second person (M1-D6).
2. **Environments → `production`**: add required reviewer (you); secret `DATABASE_URL_MIGRATE` = Neon `main` **direct** URL.
3. **Repository secret** `HOME_PRIVATE_TERMS`: comma-separated real-world terms that must never appear in the repo (family names, street, school, suburb…). CI fails if any appears in tracked files; the list never enters the repo.
4. Enable **secret scanning** (Settings → Code security).
5. Tag the prototype if not yet done: tag `m0.6-prototype` on commit `3d58390`.

## B. Each release

1. Merge the PR into `main` (CI green).
2. If it touched `src/db/migrations/**`, approve the **Migrate production database** run in Actions.
3. Vercel deploys `main` automatically. Check the deployment log for `env` errors (startup validation).

## C. Production smoke checklist (after setup, before any real data)

- [ ] Production URL loads over HTTPS; `/robots.txt` disallows all.
- [ ] Response headers include HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Robots-Tag: noindex`; no `X-Powered-By`.
- [ ] Each parent requests a link on their phone, receives it from `home@auth.<domain>`, signs in, lands on Today.
- [ ] Reusing a link shows "That link didn't work."
- [ ] A non-household address gets the same confirmation and **no email**.
- [ ] Settings › Activity shows both sign-ins, the link requests, and the refused attempt (hash only).
- [ ] Sign out works; `/today` then redirects to sign-in.
- [ ] Preview deployment prompts for Vercel authentication and uses the Neon `dev` branch (check Activity there is separate).
- [ ] Neon: automated backups/PITR plan confirmed before M3.

## D. Rotation and recovery

- Rotate `BETTER_AUTH_SECRET` to sign everyone out everywhere; `AUDIT_HASH_SECRET` rotation changes future hashes only.
- Remove an address from `HOME_ALLOWED_EMAILS` and redeploy: that person is signed out on their next request.
- Restore: Neon point-in-time restore to a new branch, verify, then switch `DATABASE_URL`.
