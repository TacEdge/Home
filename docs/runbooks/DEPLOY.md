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
| `HOME_CREDENTIALS_KEY` | `openssl rand -base64 32`, generated for Production alone; may be set ahead, but no calendar is connected in Production until §E item 11 and M4's acceptance | a **different** `openssl rand -base64 32`, generated for Preview alone, before the Preview test calendar is connected (M4 contract §6.2) |
| `HOME_CREDENTIALS_KEY_PREVIOUS` | **unset**, except while rotating (§D) | same |
| `HOME_FINGERPRINT_KEY` | another `openssl rand -base64 32`, generated for Production alone and **never** equal to `HOME_CREDENTIALS_KEY`; set before the first calendar is connected and then left alone | a **different** `openssl rand -base64 32`, generated for Preview alone |
| `HOME_LAT` | **unset** until §E item 21 (after the gate opens, item 11); then the home's latitude to two decimal places | the synthetic public point only, `-41.29` (Wellington's Civic Square, §E item 20); never the home's |
| `HOME_LON` | **unset** until §E item 21; then the home's longitude to two decimal places | the synthetic public point only, `174.78` (§E item 20); never the home's |
| `HOME_ELEVATION` | **unset** until §E item 21; then optional, the home's elevation in metres | unset |
| `HOME_WEATHER_LOCATION_KEY` | **unset** until §E item 21; then `openssl rand -base64 32`, generated for Production alone and never equal to any other key | a **different** `openssl rand -base64 32`, generated for Preview alone (§E item 20) |

Notes:
- On Vercel, HOME refuses to boot unless `DATABASE_URL` carries exactly one `sslmode=verify-full` (`src/lib/env.ts`). The runtime log's first line, `[home] database tls: sslmode=… (n occurrence(s))`, reports what `pg` parsed from the URL and nothing else from it, so a wrong mode is diagnosed without exposing the credential. `pg` 8 verifies the certificate for `require` too; `verify-full` states it so `pg` 9, which will not, cannot weaken the connection silently.
- `HOME_PRODUCTION_DB_HOST` is always derived from Production's `DATABASE_URL`, never typed from memory. For this check HOME treats Neon's pooled (`ep-x-pooler.<region>.aws.neon.tech`) and direct (`ep-x.<region>.aws.neon.tech`) names of one endpoint as the same database, so it does not matter which form is in which variable.
- The migration/admin credential is **never** entered in Vercel. `DATABASE_URL_MIGRATE` exists only as a GitHub secret.
- `HOME_CREDENTIALS_KEY` seals calendar credentials (secret calendar addresses) in the database (M4 contract §4.1, ADR 0007 §11). It is exactly 32 random bytes in standard base64: the 44-character output of `openssl rand -base64 32`, with nothing else on the line. Production and Preview each get their own, generated separately and never copied between them; a credential sealed in one environment does not open in the other. Never paste the key, or a secret calendar address, into chat, an issue, a PR, a commit, a log, a screenshot or a support message. HOME logs one boot line, `[home] calendar credentials key: ready | absent | invalid`, and never the value. A missing or malformed key never stops HOME booting: it only refuses calendar connections and refreshes. Losing the key loses only the stored calendar addresses (each calendar is connected again); HOME's events, people and notes are unaffected.
- `HOME_FINGERPRINT_KEY` (ADR 0007 §34) fingerprints secret calendar addresses, and does nothing else: it is how HOME recognises the exact same address again (refusing a duplicate, or reconnecting a calendar you disconnected, with its people and notes). It is separate key material from `HOME_CREDENTIALS_KEY`, in the same format, generated separately for Production and Preview and never copied between them; a value equal to either credentials key is refused as invalid. It is **stable**: rotating `HOME_CREDENTIALS_KEY` never touches it, so a calendar disconnected long ago is still recognised. Change it only if it may have leaked; changing it means HOME no longer recognises any disconnected calendar, which then connects as a new one (its old events stay archived). HOME logs one boot line, `[home] calendar fingerprint key: ready | absent | invalid`, never the value. A missing or invalid key never stops HOME booting: it only refuses connecting calendars.
- `HOME_REAL_DATA` is the real-data gate (ADR 0006 §2). In Production, every family-domain write is refused unless it is exactly `open` (lower case, no spaces); any other value, or none, keeps it closed and never stops the app booting. Sign-in, Activity and audit work either way.
- `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION` and `HOME_WEATHER_LOCATION_KEY` (M7, ADR 0011 §13, §40) give HOME its weather location. HOME rounds the point to two decimal places and the elevation to 10 m before any use; the location is never stored, logged or sent to the browser, and the key only fingerprints which location the cached forecast is for. A key shorter than 32 bytes, or equal to `HOME_CREDENTIALS_KEY`, `HOME_FINGERPRINT_KEY` or another secret, is refused and weather is treated as unconfigured. HOME logs one boot line, `[home] weather location: set | absent | invalid | set, key missing`, never a value; a missing or invalid setting never stops HOME booting, it only leaves weather out. While the gate is closed, Production refuses every refresh even with a location set. These values are private configuration: never commit them, and never paste the home's coordinates or the key into chat, an issue, a PR, a log or a screenshot. `HOME_TEST_WEATHER` is for local and CI only and is refused on Vercel.
- No `NEXT_PUBLIC_*` variables exist. `BETTER_AUTH_URL` must be `https` in production (`env.ts` refuses otherwise). `VERCEL_ENV` is set by Vercel itself.
- The client IP used for rate limiting is read **only** from `x-real-ip`, which Vercel sets to the public address of the client that made the request. Do not put another proxy in front of Vercel without preserving that header; if it is missing, every request shares one small rate-limit budget rather than an unlimited one.

### 4. GitHub
1. **Default branch** `main`. **Branch protection** on `main`: require a pull request, require status checks `Lint, typecheck, unit and integration tests`, `End-to-end (Playwright)`, `Vercel bundle build` and `Secret scan (gitleaks)`, block force-pushes. Leave required approvals at 0 so green PRs can merge without a second person (M1-D6).
   - **Not yet in place:** on 2026-10-10 GitHub reported `main` as **not protected** (`protected: false`, no required checks, no rulesets).
   - **To set it:** *Settings → Branches → Add branch protection rule* (or a ruleset) for `main`. Tick *Require status checks to pass*, add the four names above exactly as written, and tick *Require branches to be up to date* as well if you want it. Record the date here once it shows as protected.
   - **Risk-based CI keeps these names** (ADR 0010). Every one of the four jobs always runs and reports, including the browser job on a low-risk change, where it reports success after classifying it, so requiring them never blocks a docs-only PR.
2. **Environments → `production`**: add required reviewer (you); **Deployment branches and tags → Selected branches → `main` only**; secret `DATABASE_URL_MIGRATE` = the `home` project's **migration/admin credential** (direct URL). The workflow also refuses to run from any ref but `main`.
   **Environments → `preview`**: **Deployment branches and tags → Selected branches → `main` only**; secret `DATABASE_URL_MIGRATE` = the `home-dev` project's **migration/admin credential** (direct URL), never `home`'s. No required reviewer: `home-dev` holds fixture data only. The two environments share a secret *name* so the two migration workflows mirror each other; they never share a *value*.
3. **Repository secret** `HOME_PRIVATE_TERMS`: comma-separated real-world terms that must never appear in the repo (family names, street, school, suburb…). CI fails if any appears in tracked files; the list never enters the repo. Until it is set, every CI run shows a warning annotation.
4. Enable **secret scanning** (Settings → Code security).
5. **Your GitHub account → Settings → Emails**: enable **Keep my email addresses private** and **Block command line pushes that expose my email**, so merges made on github.com no longer carry your address.
6. Dependabot (`.github/dependabot.yml`) opens weekly PRs for the SHA-pinned actions; merge them like any other PR.
7. Tag the prototype if not yet done: tag `m0.6-prototype` on commit `3d58390`. (Done; `/prototype` itself was deleted in M6 Package 1, and the tag keeps it.)

## B. Each release

1. Merge the PR into `main` (CI green).
2. If it touched `src/db/migrations/**`, approve the **Migrate production database** run in Actions and confirm it succeeded.
3. Schema-dependent changes are **migration-first** (`MIGRATIONS.md`): the application PR that uses new schema merges only after step 2 has succeeded for its migration PR.
4. Vercel deploys `main` automatically. A misconfigured deployment **fails at boot**: `src/instrumentation.ts` validates the environment and the database role before the server accepts requests, so the failure (naming the variable, never its value) is in the deployment's runtime logs and the deployment serves nothing.

## C. Production smoke checklist (after setup, before any real data)

- [ ] Production URL loads over HTTPS; `/robots.txt` disallows all.
- [ ] Response headers include HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, a `Content-Security-Policy` whose `script-src` is a `'nonce-…'` that changes on every reload plus `'strict-dynamic'` (no `'unsafe-inline'` or `'unsafe-eval'`), with `frame-ancestors 'none'`, `X-Robots-Tag: noindex`; no `X-Powered-By`. The browser console shows no "Refused to …" CSP message while signing in and moving between places.
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
- Rotate `HOME_CREDENTIALS_KEY` (one environment at a time): generate a new key with `openssl rand -base64 32`; in Vercel set `HOME_CREDENTIALS_KEY_PREVIOUS` to the current value and `HOME_CREDENTIALS_KEY` to the new one; redeploy. Stored credentials sealed with the old key still open, and nothing new is sealed with it. Each calendar's credential is resealed with the new key on its next refresh (ADR 0007 §34), so refresh every connected calendar (**Refresh now**, or simply use HOME), then check with the migration credential that no live connection still uses the old key: `select credentials_key_id, count(*) from calendar_connection where status = 'active' group by 1` must show one key id only (key ids name a key without revealing it). Then remove `HOME_CREDENTIALS_KEY_PREVIOUS` and redeploy. Address fingerprints are unaffected: they use `HOME_FINGERPRINT_KEY`, which is not rotated with it. If the old key may have leaked, rotate, then ask each adult to reset the secret address in Google Calendar and connect again, because the address itself is the credential.
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

**After an accepted restore, once Kev exists (M8, ADR 0012 §23).** A restore can bring back Kev conversation messages that had already been deleted, by the 90-day retention or by an adult's Clear. Messages older than 90 days stay hidden, because every read filters them out, and the next daily cleanup deletes them again; nothing needs doing for them. **A Clear made after the restore point is undone by the restore:** tell both adults, and ask each to clear their Kev conversation again if they had cleared it since the restore point. Budget reservations open at the restore point are counted in full at the next turn (`unreconciled`), so the spend cap stays safe.

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

**M1 is deployed to production but not accepted.** M2 is complete (ADR 0005). M3 is being built on synthetic data in local and Preview (ADR 0006 §1).

**Which items come before the real-data gate, and which after** (clarified 2026-10-13 in M8 Package 0; no item's substance changes):

- **Before the gate opens:** items **1–10** must be recorded first: M1 acceptance (1–6, item 6 being Neon recovery), the restore rehearsal on `home-dev` (7), the restore check on `home` (8), the export check (9) and the logging review (10). Only then does the owner open the gate (item 11).
- **While the gate is closed, but not conditions of opening it:** items **12–13** (calendar keys; the Preview test calendar), **20** (the forecast in Preview) and **23–28** (M8: provider evidence, the real-data privacy decision, keys, spend limits, Kev in Preview on synthetic data, the retention cleanup) may be, and normally are, done before the gate opens. Each is a condition of its own milestone's later items: 12–13 before 14, 20 before 21, 23–28 before 29.
- **After the gate opens:** items **14–19, 21–22 and 29–31** need real data, so they follow item 11. Each is still recorded before its milestone counts as operationally accepted.
- **Kev on real data** also needs the owner's separate, informed privacy decision (item 24), whatever ZDR's outcome. Opening the gate, passing M8's verification gates or confirming ZDR never enables Kev on real data by itself.

Confirmed by the owner, 2026-10-02:

- Production runs on Node.js 22 and connects to the `home` Neon project as `home_app`.
- `DATABASE_URL` carries exactly one `sslmode=verify-full`; the TLS boot guard passes; the runtime shows no environment or TLS errors.
- Postmark DKIM and Return-Path are verified for the sending subdomain.
- A sign-in request from HOME reaches Postmark.

**Status on 2026-10-05:** none of items 1–11 below is recorded as passed, so the real-data gate stays closed. M3's build is complete and audited (`docs/m3/M3-ACCEPTANCE.md`); M3 acceptance additionally waits on items 7 and 8. M4 (calendars, ADR 0007) is being built on synthetic data: no calendar credential exists in Production, and no real calendar is connected anywhere, until the gate opens and M4 is accepted. Preview may hold only a throwaway Google account's synthetic calendar (M4 contract §6.2). M4's own rows are items 12–15 below (added by its Package 9), and M5's are items 16–17 (added by its Package 5); its keys are in the env table (§A). The R2 verification SQL in §D was checked against a local migrated database on 2026-10-05 (synthetic data, not an §E item): it runs as written, the migrations count matches the journal, both audit triggers are present, and both `home_app` append-only checks fail as expected.

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

M4 (calendars) items. M4 is technically accepted on synthetic data (`docs/m4/M4-ACCEPTANCE.md`); these close its operational acceptance. Items 12 and 13 may be done while the gate is closed; 14 and 15 need it open (item 11) and come last. Never paste a secret calendar address or a key anywhere but the HOME form and the Vercel variable it belongs to.

| # | Item | Proves |
|---|---|---|
| 12 | **Calendar keys in Production and Preview**: `HOME_CREDENTIALS_KEY` and `HOME_FINGERPRINT_KEY` generated separately for each environment (`openssl rand -base64 32`, four different values, never equal), set in Vercel and redeployed; the boot lines read `calendar credentials key: ready` and `calendar fingerprint key: ready` in each. | Calendars can be connected, and each environment's sealed addresses open only there. |
| 13 | **Preview test calendar** (ADR 0007 §2, M4 contract §6.2): in a throwaway Google account holding synthetic events only, its secret iCal address connected in Preview; Refresh now brings its events onto Today and Forward; Settings › Calendars shows its freshness; disconnect, then reconnect with the same address restores it; Preview's runtime logs show no part of the address. | The real Google feed path works end to end on synthetic data, in a deployed environment. |
| 14 | **First real calendar, after the gate opens**: an adult connects their own Google calendar's secret address in Production; it refreshes; events appear with the right times on Today and Forward; a private calendar is not visible to the other adult; Settings › Activity shows the connect and refresh rows with counts only. | M4 works on the family's real calendar. |
| 15 | **Calendar logging review**: after item 14, Production's runtime logs reviewed for the calendar flow: no secret address, calendar id, event title or place appears. | Calendar data does not leak into logs. |

M5 (Intelligent Today) items. M5 is technically accepted on synthetic data (`docs/m5/M5-ACCEPTANCE.md`) and adds no Production setting, key or migration; these close its operational acceptance on the family's real records, after the gate opens (item 11) and the first real calendar (item 14).

| # | Item | Proves |
|---|---|---|
| 16 | **Today on a real day**: each adult opens Today on a weekday morning and in the evening; the headline, each person's lines and To do match what is recorded; nothing private to the other adult appears; Worth knowing, Why and Dismiss work, and a dismissal on one adult's Today does not change the other's. | M5 works on the family's real records, privately. |
| 17 | **The five-second check**: the owner confirms, on their own phone, that a real day can be understood in about five seconds (concepts README design tests 1–3, 7), noting anything that reads wrong. Usefulness itself is evaluated in the M10 trial (ADR 0008 §22). | The approved design holds on real days. |

M6 (Forward Coordination) items. M6 is assessed on synthetic data (`docs/m6/M6-ACCEPTANCE.md`) and adds no Production setting, key or migration; these close its operational acceptance on the family's real records, after the gate opens (item 11), the first real calendar (item 14) and Today's items (16–17).

| # | Item | Proves |
|---|---|---|
| 18 | **Forward on a real week**: each adult opens Week and Month; the rows match what is recorded; nothing private to the other adult appears; a real overlap, if any, is marked with correct facts (the person, both commitments, the overlap's times); Dismiss and Not useful work and stay one adult's. | M6 works on the family's real records, privately. |
| 19 | **The anticipation check**: the owner confirms, on their own phone, that the coming week and month can be understood at a glance without alarm (concepts README design tests 2, 4, 7), noting anything that reads wrong. Usefulness itself, the `not_useful` review and the evidence for transport at M9 planning are evaluated in the M10 trial (ADR 0009 §17, §20), including whether conflicts are worth their marks. | The approved Forward design holds on real weeks. |

M7 (Weather and Free Windows) items. M7 is assessed on synthetic data (`docs/m7/M7-ACCEPTANCE.md`). Its migration (`0008_weather_forecast`) has run in Production and Preview, and its four settings are in the env table (§A); no location or location key is set in Production until item 21. Item 20 may be done while the gate is closed; 21 needs the gate open (item 11); 22 comes after 21 and the earlier real-use items (14–19). Never paste the home's coordinates or a location key anywhere but the Vercel variable it belongs to.

| # | Item | Proves |
|---|---|---|
| 20 | **The forecast in Preview**: the synthetic public point and a Preview-only location key set in Preview; the boot line reads `weather location: set`; Today and Forward Week show the forecast with the credit after a refresh; Activity shows `weather.refresh` with the status only; Preview's runtime logs show no coordinate or provider URL. (May be done while the gate is closed.) | The forecast path works end to end in a deployed environment, privately. |
| 21 | **The home location in Production, after the gate opens (item 11)**: the owner sets `HOME_LAT` and `HOME_LON` (two decimal places), optionally `HOME_ELEVATION`, and `HOME_WEATHER_LOCATION_KEY` (generated for Production alone), and redeploys; the boot line reads `set`; the first refresh succeeds; the forecast reads sensibly against the sky outside; Production's logs show no coordinate. | M7's weather works for the home, and the location stays private. |
| 22 | **Openings on a real weekend**: each adult opens Today and Forward Week before a weekend; any opening matches what is recorded; nothing private to the other adult appears; Dismiss and Not useful stay one adult's; the owner confirms that "nothing is recorded" reads as a fact, not as advice or a claim that anyone is free. Usefulness itself is evaluated in the M10 trial, with the `not_useful` review. | M7 works on the family's real records, privately, and says only what is recorded. |

**Migration `0009_kev_budget_reservation` (M8 Package 1a), recorded in Package 1b on 2026-10-14** (from the GitHub Actions API; job logs were not readable from the recording session):

- PR #82 merged as commit `30d63a5` on `main`, 2026-10-13 about 20:16 UTC.
- **Preview** (`home-dev`): **Migrate preview database** run [38510917377](https://github.com/TacEdge/Home/actions/runs/38510917377), `workflow_dispatch` on `main` at `30d63a5`, created 2026-10-14T04:20:53Z; job "Apply migrations (home-dev)" succeeded 04:20:58Z–04:21:16Z.
- **Production** (`home`): **Migrate production database** run [38461526089](https://github.com/TacEdge/Home/actions/runs/38461526089), triggered by the push of the merge (2026-10-13T20:16:37Z), held for the `production` environment's required approval, approved by the owner; job "Apply migrations" succeeded 2026-10-14T17:21:22Z–17:21:44Z. And run [38605454487](https://github.com/TacEdge/Home/actions/runs/38605454487), `workflow_dispatch` 2026-10-14T17:17:52Z, approved; job succeeded 17:22:53Z–17:23:19Z. Two earlier dispatches, 38530539770 and 38530888409, were cancelled before any job ran. **Which of the two successful runs applied `0009` is not verified** (the job logs were not readable); `drizzle-kit migrate` applies only pending migrations, so the second would have found none.
- **Owner-provided Neon evidence (2026-10-14; not independently verified by the recording agent):** 10 migrations recorded; `kev_budget_reservation` exists and is empty; all three reservation triggers enabled; `home_app` has `INSERT`, `SELECT` and `UPDATE`. Migration hashes were not provided: **unverified**. `0009` is never run again.

M8 (Kev Intelligence) items. **Added in M8 Package 0** (ADR 0012 §37, the owner's decisions of 2026-10-13), so the evidence is defined before anything is built; **they are completed only after M8 Packages 1–6** (contract `docs/m8/M8-BUILD-CONTRACT.md` §14), and none is recorded as passed yet. Items 23–28 may be done while the gate is closed; 29 needs the gate open (item 11) and comes after 23–28; 30 follows 27 and 29; 31 comes last. Kev stays off in Production, with no key, until item 29. Passing M8's Package 1 verification gates, confirming zero data retention or opening the gate never switches Kev on for real data by itself: item 24's separate privacy decision is always required before any real family data reaches the provider. The retention cleanup's daily schedule depends on M8's gate G18; if G18 fails, the owner chooses the alternative scheduler, and expiry stays exact meanwhile through read-time filtering and purge on use. Never paste a provider key anywhere but the Vercel variable or GitHub environment secret it belongs to, and never paste real family data into the provider's Console or Workbench.

| # | Item | Proves |
|---|---|---|
| 23 | **Provider account and data-handling evidence** (contract §5.5): an Anthropic Console organisation under the Commercial Terms (not a consumer plan), with the Terms' and DPA's effective dates; the data-retention value shown in the Console for the Production organisation; zero data retention requested, and **written** confirmation from Anthropic naming the organisation, or none (a request is not evidence); the Production workspace set to `allowed_inference_geos: ["us"]` and `default_inference_geo: "us"`; the sub-processor list reviewed; a workspace spend limit set if the Console offers one; the flagged-content exception (up to 2 years, classification scores up to 7 years) acknowledged as residual risk; both adults have read ADR 0012's privacy note (§38). The owner's actions for gates G11–G15 are in the contract's gate register (`docs/m8/M8-BUILD-CONTRACT.md` §5.7). (May be done while the gate is closed.) | The household knows where its words go, for how long, and on what evidence |
| 24 | **The real-data privacy decision**, always required before any real family data reaches the provider, whether or not item 23 records written ZDR confirmation: the owner's separate, informed decision, with both adults' agreement and the rationale. With written ZDR, the decision may be to proceed under it; without it, it is among: accept standard API retention; narrow Kev's data scope (no note bodies, project summaries or context content; `get_context` off); AU-hosted Claude through Bedrock or Vertex (an ADR amendment and a full re-evaluation first); or delay Kev on real data. Standard retention is never accepted by default. (May be done while the gate is closed.) | No privacy trade-off is made silently |
| 25 | **Keys per environment:** separate provider keys for evals, Preview and Production, each in its own workspace with US inference enforced; `HOME_KEV_PROVIDER_KEY` set in Vercel for Preview only at this stage (Production's waits for item 29); the eval key only as the `kev-evals` environment's secret; Preview's boot line `kev: on` after item 27's run, Production's `kev: off (gate closed)`. Before any live check, gates G1, G7–G10, G19 and G20 need the eval or development key (gate register, contract §5.7). (May be done while the gate is closed.) | Keys are separated, bounded and resident |
| 26 | **Spend cap and provider spend limit:** `HOME_KEV_MONTHLY_CAP_NZD` set in Vercel or left unset for the decided NZ$100 (ADR 0012 §35), and Settings › Usage showing that cap; a spend limit set on each provider workspace if the Console offers one (the eval workspace's no higher than the evaluation allocation's remainder: US$200 for the Package 5 campaign, contract §12.4). Evaluation spending is never counted in the household cap. HOME's cap is hard in its own accounting; the provider's limit is the only bound on provider-side billing differences. G12 in the gate register records whether the Console offers a workspace limit (monthly, non-default workspaces only, per the docs). (May be done while the gate is closed.) | HOME's cap is in force, and the provider's where it exists |
| 27 | **Kev in Preview on synthetic data:** the owner asks the contract's §3.1 questions and five adversarial ones in Preview; answers cite the right records; Alex's private record never appears for Sam; Settings › Usage shows the month's spend; Activity shows Kev's rows with structure only. (May be done while the gate is closed.) | Kev works end to end in a deployed environment, privately |
| 28 | **The retention cleanup verified:** `CRON_SECRET` set in Production and Preview; a call to the retention route without it is refused (401); in Preview, a planted synthetic message older than 90 days is deleted by a scheduled run (or, if Preview has no schedule, an authenticated manual call) and the log line shows counts only; Production's Vercel cron list shows the daily run, and its log shows a run (deleting nothing while the gate is closed); if M8's gate G18 failed, the scheduler the owner chose instead is recorded and seen to run. G3 and G18's dashboard checks are in the gate register (contract §5.7). (May be done while the gate is closed.) | Retention happens on its own, and the route is closed to everyone else |
| 29 | **Kev in Production, after the gate opens (item 11) and items 23–28**, item 24's decision included: the Production key and `HOME_KEV=on` set; each adult asks about their real day; answers match the records; nothing private to the other adult appears; the Usage line is plausible. | Kev works on the family's real records, privately |
| 30 | **Kev logs review:** Preview's runtime logs after item 27 and Production's after item 29 reviewed for Kev's turns and the retention route: no question, answer, title, name, prompt, provider body or key. | Kev's data does not leak into logs |
| 31 | **The trust check:** the owner confirms on their own phone that answers read as facts with Kev's view clearly marked, that nothing reads as a claim that anyone is free or as a recommendation of "the best" time, and that declines are honest (concepts README design tests 5, 7). Usefulness itself is evaluated in the M10 trial. | The approved design holds in real use |

**Evidence for each item.** Items 1–10 are recorded before `HOME_REAL_DATA=open` (item 11); the others when each is done, before or after the gate as §E's introduction says. Each item is recorded here with its date and the owner's initials, as counts and yes/no observations only, never record contents, credentials, hosts or addresses.

| Item | Evidence to record |
|---|---|
| 1–5 | The date each passed, and anything noted (for 5: the request number at which the limit applied). |
| 6 | The Neon plan name and the point-in-time restore window shown in the console (≥ 7 days). |
| 7 | Restore point **T**; branch name; migrations count = journal count (both numbers); the marker query result on the branch (only **A**); append-only checks failed as expected (yes/no); Preview booted on the branch (yes/no) and showed **A** but not **B** (yes/no); export from the branch valid (`check-export` counts line); rolled back and **B** visible again (yes/no); branch deleted (yes/no). |
| 8 | Restore point; branch name; migrations count = journal count; row counts per table (numbers only); audit triggers present (names); `max(at)` ≤ restore point (yes/no); `home_app` append-only checks failed as expected (yes/no); branch deleted (yes/no). |
| 9 | For each adult, the date and the `node scripts/check-export.mts <file>` result line ("valid home-export v3, sensitive included: false") from Production. With the gate closed the file is nearly empty, which is expected; what is checked is that it downloads, validates and leaves sensitive items out by default. Delete the downloaded files afterwards. |
| 10 | The date the Vercel runtime logs for Production and Preview were reviewed, and that no names, addresses, record text or captured words were found; the decision on error tracking (default: none). |
| 11 | The date `HOME_REAL_DATA=open` was set in Production, and that Settings no longer shows "HOME isn't open for family data yet." |
| 12 | The date; for each environment, that both boot lines read `ready` (yes/no). Never the key. |
| 13 | The date; refresh worked (yes/no); events on Today and Forward (yes/no); disconnect and reconnect restored the calendar (yes/no); the address absent from Preview's logs (yes/no). |
| 14 | The date; which adult (initials); refresh worked (yes/no); times correct on Today and Forward (yes/no); a private calendar not visible to the other adult (yes/no, if one was connected private). |
| 15 | The date; no address, calendar id, title or place in the logs (yes/no). |
| 16 | The date; for each adult (initials): headline and lines matched the records (yes/no); nothing of the other adult's private records seen (yes/no); Dismiss worked and stayed one adult's (yes/no). |
| 17 | The date; understood in about five seconds (yes/no); anything that read wrong, in general terms only (no record contents). |
| 18 | The date; for each adult (initials): Week and Month rows matched the records (yes/no); nothing of the other adult's private records seen (yes/no); an overlap was marked with correct facts (yes/no/none recorded); Dismiss and Not useful worked and stayed one adult's (yes/no). |
| 19 | The date; the week and month understood at a glance without alarm (yes/no); anything that read wrong, in general terms only (no record contents). |
| 20 | The date; the boot line read `weather location: set` in Preview (yes/no); the forecast and credit shown on Today and Forward Week after a refresh (yes/no); Activity's `weather.refresh` row showed the status only (yes/no); no coordinate or provider URL in Preview's runtime logs (yes/no). Never the point's values or the key. |
| 21 | The date the location was set in Production (on or after item 11's date); the boot line read `set` (yes/no); the first refresh succeeded (yes/no); the forecast read sensibly against the sky (yes/no); no coordinate in Production's logs (yes/no). Never the coordinates, the elevation or the key. |
| 22 | The date (the weekend); for each adult (initials): any opening matched the records (yes/no/none shown); nothing of the other adult's private records seen (yes/no); Dismiss and Not useful worked and stayed one adult's (yes/no); "nothing is recorded" read as a fact, not advice or a claim that anyone is free (yes/no); anything that read wrong, in general terms only (no record contents). |
| 23 | The date; the Commercial Terms and DPA effective dates; the Console's retention value as text (for example "30 days"); "ZDR confirmed in writing on [date]: yes/no" (the confirmation filed privately, never here); workspace residency enforced (yes/no); the sub-processor list reviewed on [date], with the count and the number outside the US; workspace spend limit set (yes/no, and its value in US$); flagged-content exception acknowledged (yes/no); both adults' initials and the date they read ADR 0012 §38. Never a key, screenshot or account identifier. |
| 24 | The date; whether written ZDR was confirmed at item 23 (yes/no); the decision (proceed under written ZDR, or the alternative chosen); both adults' initials; a one-line rationale. |
| 25 | The date; three separate keys and workspaces (yes/no); US inference enforced in each (yes/no); each boot line as expected (yes/no). Never the key. |
| 26 | The date; the cap shown in Settings › Usage (NZ$ amount); provider spend limits set (yes/no per workspace, and the US$ values, or "not offered"); the eval workspace's limit at or below the evaluation allocation's remainder (yes/no/not offered). |
| 27 | The date; the questions answered with the right citations (yes/no); the five adversarial questions handled (yes/no); Alex's private record absent for Sam (yes/no); Usage and Activity as expected (yes/no). |
| 28 | The date; `CRON_SECRET` set in each environment (yes/no; never the value); a call without it refused (yes/no); the planted message deleted and the log line counts only (yes/no); the Production schedule seen and a run logged (yes/no), or, if G18 failed, the owner's chosen scheduler named and a run logged (yes/no). |
| 29 | The date the key and `HOME_KEV=on` were set in Production (on or after item 11's and items 23–28's dates); for each adult (initials): answers matched the records (yes/no); nothing of the other adult's private records seen (yes/no); the Usage line plausible (yes/no). |
| 30 | The dates Preview's and Production's logs were reviewed; no question, answer, title, name, prompt, provider body or key found (yes/no). |
| 31 | The date; answers read as facts with Kev's view marked (yes/no); nothing read as availability or "the best" time (yes/no); declines honest (yes/no); anything that read wrong, in general terms only. |

Not an acceptance item, but recommended before any `pg` 9 upgrade: change both GitHub `DATABASE_URL_MIGRATE` secrets (`production` and `preview` environments) from `sslmode=require` to `sslmode=verify-full`. `pg` 8 already verifies certificates for `require`; `pg` 9 will not.
