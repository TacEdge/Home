# Runbook — Deployment (Vercel `syd1` + Neon Sydney)

Owner steps are numbered. Nothing here needs a credential in the repository. Decisions: ADR 0003; M1-D1…D6 in `docs/m1/M1-BUILD-CONTRACT.md` §3; M1.1 in `docs/m1/M1.1-FIX-CONTRACT.md`.

## Two credentials, never mixed

| Term | Meaning | Where it lives |
|---|---|---|
| **Runtime/app credential** | The restricted database role used by the HOME application (`home_app`). It owns no database objects and cannot change or delete audit rows, disable the audit trigger, alter tables or create them. | The **only** database credential supplied to Vercel: `DATABASE_URL`, the **pooled** connection string. |
| **Migration/admin credential** | The privileged database role used only for migrations and database administration (the Neon project's owner role). | GitHub `production` environment secret `DATABASE_URL_MIGRATE` (the **direct** connection string), and a trusted machine for administration. **Never** supplied to the HOME application or the Vercel runtime. |

The app refuses to start on Vercel if the role it is connected as owns `audit_log` (`src/instrumentation.ts`), so a mix-up fails loudly at deploy time.

## A. One-time setup

### 1. Neon (database)

Two **separate projects**, not two branches of one project: **`home`** (production) and **`home-dev`** (previews and cloud-side development). Separate projects have separate credentials, so production data can never be copied, branched or reset into the preview database. Both in region **AWS ap-southeast-2 (Sydney)**, Postgres 16. Free tier is fine for M1; move production to a paid plan with ≥7 days point-in-time restore **before real family data** (M1-D5).

For **each** project:

1. Note the owner role's **direct** connection string (`sslmode=require`). That is the **migration/admin credential**.
2. From a trusted machine, connected with the migration/admin credential, create the runtime/app role with a generated password that is never committed:
   ```sql
   CREATE ROLE home_app LOGIN PASSWORD '<openssl rand -base64 36>' NOINHERIT NOCREATEDB NOCREATEROLE;
   ```
3. Apply the migrations with the migration/admin credential: `DATABASE_URL_MIGRATE=<direct url> pnpm exec drizzle-kit migrate`. Migration `0002_app_role` grants `home_app` exactly what the app needs. (After the first time, production migrations run through the GitHub workflow.)
4. Build the **runtime/app credential**: the project's **pooled** connection string with the user and password replaced by `home_app` and its password. Keep it for the Vercel step below.
5. Verify from the trusted machine, connected as `home_app`: `update audit_log set summary = 'x'` must fail with *permission denied*; `alter table audit_log disable trigger all` must fail with *must be owner*.

Order matters: create `home_app` → migrate (grants apply) → configure Vercel with the runtime/app credential → deploy.

### 2. Postmark (sign-in email)
1. Create a server (transactional). Add the sending domain **`auth.<your-domain>`** (a dedicated subdomain, never the root — M1-D2) and complete DKIM and Return-Path DNS records; add SPF/DMARC on that subdomain.
2. Create a Server API token. Note the sending address, e.g. `home@auth.<your-domain>`.
3. In the server's **Message Streams → Transactional (outbound) → Settings**, turn **open tracking off** and **link tracking off**. Sign-in links must go straight to HOME, never through a tracking redirect (the smoke checklist verifies this).

### 3. Vercel (hosting)
1. Import the GitHub repository. Framework: Next.js. Production branch: `main`. `vercel.json` pins region `syd1` and the pnpm commands.
2. **Settings → Deployment Protection**: enable for Preview deployments (M1-D4).
3. **Settings → Domains**: add the production domain (M1-D1). Until you have one, use the `*.vercel.app` URL.
4. **Settings → Environment Variables** — set each variable separately for **Production** and **Preview** (never share values between them):

| Variable | Production | Preview |
|---|---|---|
| `DATABASE_URL` | **Runtime/app credential** for project `home` (pooled, user `home_app`) | **Runtime/app credential** for project `home-dev` (pooled, user `home_app`) |
| `HOME_PRODUCTION_DB_HOST` | the **host part of Production's `DATABASE_URL`** (the text between `@` and `/`), optional here: asserts production runs against its own database | the **same value, copied from Production's `DATABASE_URL`** (**required**: preview refuses to start if its `DATABASE_URL` points at that endpoint) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | a different random value |
| `BETTER_AUTH_URL` | `https://<production domain>` | the stable branch URL Vercel assigns to the branch you use for previews (form `https://<project>-git-<branch>-<team>.vercel.app`), set once |
| `HOME_ALLOWED_EMAILS` | the two household addresses | `sam@example.test,alex@example.test` or your own test addresses |
| `HOME_MAIL_TRANSPORT` | `provider` | `provider` (test transport is refused in production builds) |
| `MAIL_API_KEY` | Postmark server token | a Postmark **sandbox** server token |
| `MAIL_FROM` | `home@auth.<your-domain>` | same |
| `AUDIT_HASH_SECRET` | `openssl rand -base64 48` | a different random value |
| `HOME_TIMEZONE` | `Pacific/Auckland` | same |

Notes:
- `HOME_PRODUCTION_DB_HOST` is always derived from Production's `DATABASE_URL`, never typed from memory. For this check HOME treats Neon's pooled (`ep-x-pooler.<region>.aws.neon.tech`) and direct (`ep-x.<region>.aws.neon.tech`) names of one endpoint as the same database, so it does not matter which form is in which variable.
- The migration/admin credential is **never** entered in Vercel. `DATABASE_URL_MIGRATE` exists only as a GitHub secret.
- No `NEXT_PUBLIC_*` variables exist. `BETTER_AUTH_URL` must be `https` in production (`env.ts` refuses otherwise). `VERCEL_ENV` is set by Vercel itself.
- The client IP used for rate limiting is read **only** from `x-real-ip`, which Vercel sets to the public address of the client that made the request. Do not put another proxy in front of Vercel without preserving that header; if it is missing, every request shares one small rate-limit budget rather than an unlimited one.

### 4. GitHub
1. **Default branch** `main`. **Branch protection** on `main`: require a pull request, require status checks `Lint, typecheck, unit and integration tests`, `End-to-end (Playwright)`, `Vercel bundle build` and `Secret scan (gitleaks)`, block force-pushes. Leave required approvals at 0 so green PRs can merge without a second person (M1-D6).
2. **Environments → `production`**: add required reviewer (you); **Deployment branches and tags → Selected branches → `main` only**; secret `DATABASE_URL_MIGRATE` = the `home` project's **migration/admin credential** (direct URL). The workflow also refuses to run from any ref but `main`.
3. **Repository secret** `HOME_PRIVATE_TERMS`: comma-separated real-world terms that must never appear in the repo (family names, street, school, suburb…). CI fails if any appears in tracked files; the list never enters the repo. Until it is set, every CI run shows a warning annotation.
4. Enable **secret scanning** (Settings → Code security).
5. **Your GitHub account → Settings → Emails**: enable **Keep my email addresses private** and **Block command line pushes that expose my email**, so merges made on github.com no longer carry your address.
6. Dependabot (`.github/dependabot.yml`) opens weekly PRs for the SHA-pinned actions; merge them like any other PR.
7. Tag the prototype if not yet done: tag `m0.6-prototype` on commit `3d58390`.

## B. Each release

1. Merge the PR into `main` (CI green).
2. If it touched `src/db/migrations/**`, approve the **Migrate production database** run in Actions.
3. Vercel deploys `main` automatically. A misconfigured deployment **fails at boot**: `src/instrumentation.ts` validates the environment and the database role before the server accepts requests, so the failure (naming the variable, never its value) is in the deployment's runtime logs and the deployment serves nothing.

## C. Production smoke checklist (after setup, before any real data)

- [ ] Production URL loads over HTTPS; `/robots.txt` disallows all.
- [ ] Response headers include HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Robots-Tag: noindex`; no `X-Powered-By`.
- [ ] Each parent requests a link on their phone, receives it from `home@auth.<domain>`, signs in, lands on Today.
- [ ] The received link points **directly at the HOME domain** (`https://<production domain>/api/auth/magic-link/verify?…`), not a Postmark tracking host.
- [ ] Reusing a link shows "That link didn't work."
- [ ] A non-household address gets the same confirmation and **no email**.
- [ ] `POST https://<production domain>/api/auth/sign-in/magic-link` returns 404 (only the verify endpoint is public).
- [ ] Settings › Activity shows both sign-ins, the link requests, and the refused attempt (hash only).
- [ ] Sign out works; `/today` then redirects to sign-in.
- [ ] Sessions are fixed at 30 days from sign-in; they are not extended by use.
- [ ] Preview deployment prompts for Vercel authentication and uses the `home-dev` project (check Activity there is separate).
- [ ] Neon: automated backups/PITR plan confirmed before M3.

## D. Rotation and recovery

- Rotate `BETTER_AUTH_SECRET` to sign everyone out everywhere; `AUDIT_HASH_SECRET` rotation changes future hashes only.
- Rotate the runtime/app credential with `ALTER ROLE home_app PASSWORD '…'` (as the migration/admin role), then update Vercel's `DATABASE_URL`.
- Remove an address from `HOME_ALLOWED_EMAILS` and redeploy: that person is signed out on their next request.
- Restore: Neon point-in-time restore to a new branch **of the production project**, verify, then switch the runtime/app credential's host. Never restore production data into `home-dev`.
