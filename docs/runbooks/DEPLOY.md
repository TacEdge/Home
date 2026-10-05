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

1. Note the owner role's **direct** connection string. Change its trailing `sslmode=require` to `sslmode=verify-full` (same TLS verification `pg` 8 already performs, stated explicitly so a future `pg` 9 cannot weaken it). That is the **migration/admin credential**.
2. From a trusted machine, connected with the migration/admin credential, create the runtime/app role with a generated password that is never committed:
   ```sql
   CREATE ROLE home_app LOGIN PASSWORD '<openssl rand -base64 36>' NOINHERIT NOCREATEDB NOCREATEROLE;
   ```
3. Apply the migrations with the migration/admin credential, through GitHub Actions so no machine needs the credential: for `home`, the **Migrate production database** workflow (`production` environment, required reviewer); for `home-dev`, the **Migrate preview database** workflow (`preview` environment). Both are dispatched from *Actions → <workflow> → Run workflow* on `main`, and each reads its own environment's `DATABASE_URL_MIGRATE`. Migration `0002_app_role` grants `home_app` exactly what the app needs.
4. Build the **runtime/app credential**: the project's **pooled** connection string with the user and password replaced by `home_app` and its password, ending in **exactly one** `sslmode=verify-full` (Neon's console gives `sslmode=require`; change it). Keep it for the Vercel step below.
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
| `HOME_REAL_DATA` | **unset** until §E item 11; then exactly `open` | **never set** (the gate applies only to Production) |

Notes:
- On Vercel, HOME refuses to boot unless `DATABASE_URL` carries exactly one `sslmode=verify-full` (`src/lib/env.ts`). The runtime log's first line, `[home] database tls: sslmode=… (n occurrence(s))`, reports what `pg` parsed from the URL and nothing else from it, so a wrong mode is diagnosed without exposing the credential. `pg` 8 verifies the certificate for `require` too; `verify-full` states it so `pg` 9, which will not, cannot weaken the connection silently.
- `HOME_PRODUCTION_DB_HOST` is always derived from Production's `DATABASE_URL`, never typed from memory. For this check HOME treats Neon's pooled (`ep-x-pooler.<region>.aws.neon.tech`) and direct (`ep-x.<region>.aws.neon.tech`) names of one endpoint as the same database, so it does not matter which form is in which variable.
- The migration/admin credential is **never** entered in Vercel. `DATABASE_URL_MIGRATE` exists only as a GitHub secret.
- `HOME_REAL_DATA` is the real-data gate (ADR 0006 §2). In Production, every family-domain write is refused unless it is exactly `open` (lower case, no spaces); any other value, or none, keeps it closed and never stops the app booting. Sign-in, Activity and audit work either way.
- No `NEXT_PUBLIC_*` variables exist. `BETTER_AUTH_URL` must be `https` in production (`env.ts` refuses otherwise). `VERCEL_ENV` is set by Vercel itself.
- The client IP used for rate limiting is read **only** from `x-real-ip`, which Vercel sets to the public address of the client that made the request. Do not put another proxy in front of Vercel without preserving that header; if it is missing, every request shares one small rate-limit budget rather than an unlimited one.

### 4. GitHub
1. **Default branch** `main`. **Branch protection** on `main`: require a pull request, require status checks `Lint, typecheck, unit and integration tests`, `End-to-end (Playwright)`, `Vercel bundle build` and `Secret scan (gitleaks)`, block force-pushes. Leave required approvals at 0 so green PRs can merge without a second person (M1-D6).
2. **Environments → `production`**: add required reviewer (you); **Deployment branches and tags → Selected branches → `main` only**; secret `DATABASE_URL_MIGRATE` = the `home` project's **migration/admin credential** (direct URL). The workflow also refuses to run from any ref but `main`.
   **Environments → `preview`**: **Deployment branches and tags → Selected branches → `main` only**; secret `DATABASE_URL_MIGRATE` = the `home-dev` project's **migration/admin credential** (direct URL), never `home`'s. No required reviewer: `home-dev` holds fixture data only. The two environments share a secret *name* so the two migration workflows mirror each other; they never share a *value*.
3. **Repository secret** `HOME_PRIVATE_TERMS`: comma-separated real-world terms that must never appear in the repo (family names, street, school, suburb…). CI fails if any appears in tracked files; the list never enters the repo. Until it is set, every CI run shows a warning annotation.
4. Enable **secret scanning** (Settings → Code security).
5. **Your GitHub account → Settings → Emails**: enable **Keep my email addresses private** and **Block command line pushes that expose my email**, so merges made on github.com no longer carry your address.
6. Dependabot (`.github/dependabot.yml`) opens weekly PRs for the SHA-pinned actions; merge them like any other PR.
7. Tag the prototype if not yet done: tag `m0.6-prototype` on commit `3d58390`.

## B. Each release

1. Merge the PR into `main` (CI green).
2. If it touched `src/db/migrations/**`, approve the **Migrate production database** run in Actions and confirm it succeeded.
3. Schema-dependent changes are **migration-first** (`MIGRATIONS.md`): the application PR that uses new schema merges only after step 2 has succeeded for its migration PR.
4. Vercel deploys `main` automatically. A misconfigured deployment **fails at boot**: `src/instrumentation.ts` validates the environment and the database role before the server accepts requests, so the failure (naming the variable, never its value) is in the deployment's runtime logs and the deployment serves nothing.

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
- [ ] Neon: ≥ 7-day point-in-time restore confirmed on `home` before any real family data (§E item 6).

## D. Rotation and recovery

- Rotate `BETTER_AUTH_SECRET` to sign everyone out everywhere; `AUDIT_HASH_SECRET` rotation changes future hashes only.
- Rotate the runtime/app credential with `ALTER ROLE home_app PASSWORD '…'` (as the migration/admin role), then update Vercel's `DATABASE_URL`.
- Remove an address from `HOME_ALLOWED_EMAILS` and redeploy: that person is signed out on their next request.
- Restore: see **Recovery** below. Never restore production data into `home-dev`.

### Recovery (ADR 0006 §7, M3 contract §7.2)

HOME's backup is Neon's point-in-time restore on the `home` project (at least 7 days, §E item 6). A restore never overwrites the database in place: it creates a **new branch of the same project** from a moment in the past, which is checked before anything points at it. Neon branches carry the parent's roles and passwords, so `home_app` and the owner role work on the branch unchanged; only the host differs. Every step below is done by the owner, in the Neon console and from a trusted machine; nothing here is automated, and no step needs a credential in the repository.

**Rules**

- A restore of `home` stays inside the `home` project. Its data is never copied, branched, dumped or restored into `home-dev`, and Preview never points at a `home` branch.
- Verification of a `home` branch is done from the trusted machine with the migration/admin credential (owner role), pointed at the branch host. Results are recorded as counts and yes/no checks only, never row contents.
- Delete a restore branch as soon as it is no longer needed.

**R1. Create the restore branch.** Neon console → the project → *Branches* → create a branch from the main branch **at a point in time** (the restore point, in UTC). Name it `restore-YYYYMMDD-HHMM`. Note its direct host and its pooled host.

**R2. Verify the branch** (trusted machine, owner role, the branch's **direct** host, `sslmode=verify-full`):

```sql
-- 1. Migrations: the count matches the entries in src/db/migrations/meta/_journal.json at the deployed commit.
select count(*) from drizzle.__drizzle_migrations;
-- 2. Row counts, compared with the same queries on the main branch (expect the restore point's numbers).
select 'person', count(*) from person union all select 'event', count(*) from event
union all select 'task', count(*) from task union all select 'project', count(*) from project
union all select 'note', count(*) from note union all select 'context', count(*) from context
union all select 'capture', count(*) from capture union all select 'audit_log', count(*) from audit_log;
-- 3. The audit trail is intact and still append-only: the triggers exist…
select tgname from pg_trigger where tgrelid = 'audit_log'::regclass and not tgisinternal;
-- …and the newest audit row is no later than the restore point.
select max(at) from audit_log;
```

Then, connected as **`home_app`** to the same branch: `update audit_log set summary = 'x' where false;` must fail with *permission denied*, and `alter table audit_log disable trigger all;` must fail with *must be owner* (as in §A.1 step 5).

**R3. Point the app at the branch** (a real restore only, or the `home-dev` rehearsal): in Vercel, change only the **host** of the environment's `DATABASE_URL` (the runtime/app credential: user `home_app`, its password, exactly one `sslmode=verify-full`) to the branch's **pooled** host, and redeploy that environment. For Production, also set `HOME_PRODUCTION_DB_HOST` to the new host (the boot guard compares them). Watch the runtime log's first line (`[home] database tls: sslmode=verify-full (1 occurrence(s))`) and confirm the app boots and serves.

**R4. Confirm, then keep or roll back.** Sign in and check the records you expect at the restore point. To roll back, set the host back to the original and redeploy. Once a restore is accepted, the restored branch becomes the database: in Neon, make it the project's default (primary) branch so point-in-time restore keeps protecting it, and point `DATABASE_URL_MIGRATE` (GitHub `production` environment) at its direct host. Delete the old branch only when you are sure.

**Rehearsal 1 — `home-dev`, end to end (§E item 7).** Synthetic data only. Run it once M3 has at least one domain-entry screen (the first is People, Package 3), so the markers are synthetic household records; it is mandatory before `HOME_REAL_DATA=open` (ADR 0006 §27).

1. Make a before-and-after marker in Preview: add a synthetic record **A** (for example a person named "Rehearsal A"), note the UTC time **T** a minute later, then add a synthetic record **B** ("Rehearsal B"). Use whichever domain-entry screen exists (People, To do, …).
2. R1 on the `home-dev` project, at time **T**.
3. R2 on the branch: migrations count matches; the marker query returns only **A** (for people, `select count(*) from person where name like 'Rehearsal%'` returns 1; for tasks, the same on `task.title`); append-only checks hold.
4. R3 for **Preview only**: change Preview's `DATABASE_URL` host to the branch's pooled host and redeploy the Preview branch. The preview boot guard still requires that host to differ from `HOME_PRODUCTION_DB_HOST`, which it does.
5. Sign in to the Preview deployment: **A** is there and **B** is not, on the screen where they were added; Activity loads; Settings › Export downloads and `node scripts/check-export.mts <file>` reports it valid (Node 22.18 or later runs the `.mts` file directly).
6. R4 roll back: Preview's host back to the original `home-dev` host, redeploy, confirm **B** is visible again. Delete the restore branch.

**Rehearsal 2 — `home`, branch verification only (§E item 8).** No family data is involved (the real-data gate is closed, so `home` holds sign-in and audit rows only), nothing is pointed at the branch, and nothing leaves the `home` project.

1. R1 on the `home` project, at a time within the last 7 days.
2. R2 on the branch: migrations count matches the deployed commit's journal; row counts are as expected; the audit triggers exist; `max(at)` is no later than the restore point; the `home_app` append-only checks fail as they should.
3. Delete the branch.

## E. Production status and M1 acceptance

**M1 is deployed to production but not accepted.** M2 is complete (ADR 0005). M3 is being built on synthetic data in local and Preview (ADR 0006 §1). **Real household data waits until every item below is closed**; the owner then opens the real-data gate (item 11).

Confirmed by the owner, 2026-10-02:

- Production runs on Node.js 22 and connects to the `home` Neon project as `home_app`.
- `DATABASE_URL` carries exactly one `sslmode=verify-full`; the TLS boot guard passes; the runtime shows no environment or TLS errors.
- Postmark DKIM and Return-Path are verified for the sending subdomain.
- A sign-in request from HOME reaches Postmark.

**Status on 2026-10-05:** none of items 1–11 below is recorded as passed, so the real-data gate stays closed. M3's build is complete and audited (`docs/m3/M3-ACCEPTANCE.md`); M3 acceptance additionally waits on items 7 and 8. M4 (calendars, ADR 0007) is being built on synthetic data: no calendar credential exists in Production, and no real calendar is connected anywhere, until the gate opens and M4 is accepted. Preview may hold only a throwaway Google account's synthetic calendar (M4 contract §6.2). M4 adds its own rows here in its Package 9, and `HOME_CREDENTIALS_KEY` to the env table in its Package 2. The R2 verification SQL in §D was checked against a local migrated database on 2026-10-05 (synthetic data, not an §E item): it runs as written, the migrations count matches the journal, both audit triggers are present, and both `home_app` append-only checks fail as expected.

Outstanding M1 acceptance items. Record the date and result of each here when it passes.

| # | Item | Proves |
|---|---|---|
| 1 | **Postmark live sending approved** for the production server. | Sign-in email can reach a real inbox. |
| 2 | **Each parent completes a magic-link sign-in** on their phone, from `home@auth.<domain>`, and lands on Today. The link points directly at the HOME domain, not a Postmark tracking host. | The whole sign-in path works end to end. |
| 3 | **The signed-in smoke checks in §C**: link reuse shows "That link didn't work."; a non-household address gets the same confirmation and no email; Settings › Activity shows both sign-ins, the link requests and the refused attempt (hash only); sign-out works and `/today` then redirects to sign-in; the session cookie expires 30 days after sign-in and is not extended by use. | Allowlist, audit, sign-out and fixed sessions behave as designed in production. |
| 4 | **The remaining unsigned §C checks**, if not already recorded: HTTPS, `robots.txt`, the security headers, `POST /api/auth/sign-in/magic-link` returning 404, and the preview deployment prompting for Vercel authentication and using `home-dev`. | The production surface matches M1. |
| 5 | **Rate-limit verification on the live deployment**, unless already recorded: from one network, repeated link requests hit the per-IP limit (5 per 15 minutes), and the limit is keyed on Vercel's `x-real-ip` (ADR 0003 §22). | Rate limiting sees real client addresses in production. |
| 6 | **Neon recovery capability for `home`**: the project is on a plan with at least 7 days of point-in-time restore, confirmed in the Neon console (M1-D5), before any real family data. | Real data can be recovered. |

Real-data gate items (ADR 0006 §2, §7; M3 contract §6–7). Procedures: §D *Recovery* and the export check below. Record each result here with the evidence listed under the table.

| # | Item | Proves |
|---|---|---|
| 7 | **Restore rehearsal on `home-dev`**, end to end: synthetic data entered through the Preview UI, point-in-time restore to a new branch, Preview's runtime host switched to it, the app boots and shows the data, switched back. | The restore procedure works, including the app. |
| 8 | **Restore check on `home`**: a point-in-time restore branch created, schema, migrations and `audit_log` verified, branch deleted. No family data involved. | Production can be restored. |
| 9 | **Export check**: each adult downloads their export from Production (or Preview before then) and it validates against version 1. | The family can take its data away. |
| 10 | **Logging review** (ADR 0003 §8): runtime logs confirmed to carry no family data; error tracking stays off unless decided otherwise. | Real data does not leak into logs. |
| 11 | **Open the gate**: only after items 1–10 are recorded, set `HOME_REAL_DATA` to exactly `open` in Vercel **Production** (never Preview) and redeploy. Until then every family-domain write in Production is refused. | Real household data may enter. |

**Evidence required before `HOME_REAL_DATA=open`.** Each item is recorded here with its date and the owner's initials, as counts and yes/no observations only, never record contents, credentials, hosts or addresses.

| Item | Evidence to record |
|---|---|
| 1–5 | The date each passed, and anything noted (for 5: the request number at which the limit applied). |
| 6 | The Neon plan name and the point-in-time restore window shown in the console (≥ 7 days). |
| 7 | Restore point **T**; branch name; migrations count = journal count (both numbers); the marker query result on the branch (only **A**); append-only checks failed as expected (yes/no); Preview booted on the branch (yes/no) and showed **A** but not **B** (yes/no); export from the branch valid (`check-export` counts line); rolled back and **B** visible again (yes/no); branch deleted (yes/no). |
| 8 | Restore point; branch name; migrations count = journal count; row counts per table (numbers only); audit triggers present (names); `max(at)` ≤ restore point (yes/no); `home_app` append-only checks failed as expected (yes/no); branch deleted (yes/no). |
| 9 | For each adult, the date and the `node scripts/check-export.mts <file>` result line ("valid home-export v1, sensitive included: false") from Production. With the gate closed the file is nearly empty, which is expected; what is checked is that it downloads, validates and leaves sensitive items out by default. Delete the downloaded files afterwards. |
| 10 | The date the Vercel runtime logs for Production and Preview were reviewed, and that no names, addresses, record text or captured words were found; the decision on error tracking (default: none). |
| 11 | The date `HOME_REAL_DATA=open` was set in Production, and that Settings no longer shows "HOME isn't open for family data yet." |

Not an acceptance item, but recommended before any `pg` 9 upgrade: change both GitHub `DATABASE_URL_MIGRATE` secrets (`production` and `preview` environments) from `sslmode=require` to `sslmode=verify-full`. `pg` 8 already verifies certificates for `require`; `pg` 9 will not.
