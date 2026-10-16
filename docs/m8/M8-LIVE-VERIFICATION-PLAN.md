# M8 — Controlled live verification plan (synthetic data only)

*Prepared 2026-10-16, main @ eebb639 (Packages 0–4 merged); approved by the owner the same day, with the decisions below. A plan: nothing in it has been run, no account, workspace, key or credential exists, and no gate below is marked PASS that was not already PASS. Authoritative: the M8 contract (`M8-BUILD-CONTRACT.md` §5.7 gate register, §12.4, §13.6, §14) and DEPLOY.md §E items 23–31. Where this plan and those differ, they win.*

## Owner decisions (2026-10-16)

Recorded as given; none authorises a live call.

1. **The plan is approved** (this document).
2. **A dedicated live verification runner may be built**, without executing any paid model call. It uses HOME's approved gateway: G1 through the approved Models API path; G8 and the Haiku 5.5 checks through the controlled provider path where supported; no direct provider call where a gateway operation exists; no unrestricted network exception; no provider credential in source control; no model call during implementation; no automatic execution after deployment; every live run needs the owner's explicit approval; G22's preflight count is kept.
3. **A separate throwaway database** for the runner is approved, holding only synthetic fixtures, budget reservations and usage records (the reading of stage B's "no HOME database" in §5). No real family record and no Production database.
4. **A US$10 maximum first-session allocation is approved, but not its execution.** It is enforced by the runner and kept separate from the household's NZ$100 cap; the Package 5 campaign's US$200 stays separate from household usage.
5. **G16 may be tested against home-dev's pooled connection, after isolation checks.**
6. **Isolation is not marked verified without evidence:** home-dev holding synthetic data only, Preview not using a Production clone, the runner's database isolated, and no connection string targeting Production. If these cannot be verified, the runner is not enabled.

G3, G4, G17 and G18 stay with their infrastructure steps (§8). No gate is marked PASS until it has run.

## 1. Readiness in one paragraph

Everything that can be proven without a provider account is proven: the stage-A gates (G2, G5, G6, G16's local half, G20's stub half), G22's preflight built and tested offline, and G9/G21's request shape on the wire to a local stub. **No stage-B, C or D gate can be run today**, for four reasons: there is no provider account or evaluation workspace; there is **no live runner** (contract §12.4's owner-approved `kev-evals` workflow is unbuilt); the gateway cannot express three stage-B probes (Haiku 5.5 has no tier, `ProviderMessage` has no `system` role for G8, and nothing calls the Models API for G1); and the contract puts `HOME_KEV=on` in Preview only after Package 5's thresholds (§14), so G4 and G17 wait for Package 5. G3, G18 and G16 (Neon) can be checked now without a model or a key.

## 2. Gate matrix (G1–G22)

Status as recorded in the contract's register, with what each needs. "Free now" = can be checked today at no cost.

| Gate | Stage | Status | Needs | Free now |
|---|---|---|---|---|
| G1 model ids, availability | B | NOT VERIFIED (docs half: ids and retirement dates in `config.ts`, re-verified 2026-10-16) | account, eval key, Models API GET (no model input) | docs only |
| G2 prices | A | **PASS** (docs; `kev-money.test.ts`). Re-verified 2026-10-16: Sonnet 5.5 cache read US$0.10/MTok equals `config.ts` | — | done |
| G3 Vercel duration | D | NOT VERIFIED | owner reads Vercel › Settings › Functions | **yes** |
| G4 disconnect | D | NOT VERIFIED (local half passes, `kev-turn-route.test.ts`) | Kev on in Preview (after Package 5, §14) | no |
| G5 SDK custom fetch | A | **PASS** (`kev-anthropic.test.ts`) | — | — |
| G6 timeout/abort | A | **PASS** (`kev-anthropic.test.ts`) | — | — |
| G7 structured output + tools | B | NOT VERIFIED (both answer forms built) | eval key, live calls, runner | no |
| G8 mid-conversation system | B (record) | NOT VERIFIED (HOME uses a labelled user turn, not `system`) | eval key, a raw request outside `KevProvider` | no |
| G9 grow-only history | C | NOT VERIFIED live (offline half passes, `kev-request-wire.test.ts`) | runner + `kev.handle()` on the fixture DB | no |
| G10 `usage.inference_geo` | B | NOT VERIFIED (code fails closed without `us`) | eval key, live call, an observer seam to record it | no |
| G11 geo enforcement (eval) | B | NOT VERIFIED | Console setting on the eval workspace | **yes (Console)** |
| G12 workspace spend limit (eval) | B | NOT VERIFIED | Console setting on the eval workspace | **yes (Console)** |
| G13 ZDR in writing | E | NOT VERIFIED | owner request to Anthropic | owner |
| G14 default retention | E | NOT VERIFIED | Console › Data retention (`/settings/privacy`) | **yes (Console)** |
| G15 sub-processors | E | NOT VERIFIED | owner reads the Trust Center list | **yes** |
| G16 pooled lock | A local **PASS**; D Neon | NOT VERIFIED on Neon | reservation-only script against home-dev's pooled URL (the register's alternative), or two adults in item 27 | **yes (no model)** |
| G17 cold start | D | NOT VERIFIED | Kev on in Preview (after Package 5) | no |
| G18 scheduled cleanup | C | NOT VERIFIED (route built and tested; no `crons`) | dashboard + docs; manual call in Preview | **yes** |
| G19 prompt caching | B (record) | NOT VERIFIED | two live calls, read `cache_read_input_tokens` | no |
| G20 failed/aborted usage | A stub **PASS**; B live | NOT VERIFIED live | one aborted live call, an abort seam | no |
| G21 thinking replay | C | NOT VERIFIED live (offline half passes) | part of G9 | no |
| G22 preflight count | B (precondition) | NOT VERIFIED live (built, tested offline; free per provider docs, re-verified 2026-10-16) | first live count | no |

## 3. Provider workspace (owner actions; none automated)

Verified against the provider's docs on 2026-10-16 (see §10 for what could not be verified):

1. **Organisation** under the Commercial Terms (not a consumer plan). Record the Terms' and DPA's effective dates (DPA: 24 Feb 2025).
2. **A dedicated evaluation workspace** (Console › Workspaces; the Default workspace cannot take limits): name it for evals only; `allowed_inference_geos: ["us"]`, `default_inference_geo: "us"` (G11); a **monthly workspace spend limit** at the lowest value the Console accepts at or above the session budget (G12; whether US$10–20 is accepted is unverified).
3. **Billing:** prepaid credits only, the smallest top-up the Console offers; **auto-reload off** (Billing › Manage auto-reload › Turn off). Credits expire after a year. A limit the owner sets returns HTTP 400; the tier cap returns 429 `enforced_spend_limit_reached` — HOME never retries the spend cap.
4. **One API key scoped to the evaluation workspace**, created by the owner, stored only as the GitHub `kev-evals` environment secret (required reviewer: the owner). Never in Vercel, never in a file, never in a screenshot, chat or log. Preview's and Production's keys are separate workspaces later (item 25).
5. **Read, don't change:** Console › Data retention (G14), and request ZDR in writing if wanted (G13; the Console and Workbench are not covered by ZDR, so never paste anything into Workbench).

## 4. First-session budget (proposal)

Worst cases from the gateway's own accounting (`trust/usage.ts`, `router.ts`, `budget.ts`): per call Sonnet 5.5 (fast) **US$0.133**, Opus 5.5 (deep) **US$0.356** (32k input at the cache-write rate + `max_tokens` output, × 1.1 for US inference); a whole turn is capped at **US$1.50**; `count_tokens` is free. Planned stage-B and stage-C probes total about **US$5.3 worst case** (realistically under US$2).

**Proposed: a first-session cap of US$10**, enforced three ways — the runner refuses any plan whose computed maximum exceeds it; HOME's own reservations run with a NZ-dollar cap equal to it; and the workspace spend limit and prepaid credit bound the provider side. It comes out of the US$200 Package 5 allocation and is unrelated to the household's NZ$100 monthly cap. A second, separate approval would be needed for the Preview session (G4, G17 and item 27: worst case 11 turns × US$1.50 ≈ US$17).

## 5. Before any live call: what must be built (a separate, approved package)

A small **live verification runner**, contract §12.4's design, with no live call in its PR:

- a `workflow_dispatch` job in the `kev-evals` GitHub environment (owner approval per run), with an ephemeral Postgres seeded with the fixture family only (as §14 requires for live evals);
- guards before any network: refuse if deployed (`VERCEL`/`VERCEL_ENV`), if `HOME_REAL_DATA` is set, if the database is not the job's own; refuse a plan whose computed maximum exceeds the approved budget (tied to the plan's hash);
- probes through HOME's gateway (G22, G7, G10, G19, G20) and through `kev.handle()` (G9, G21); small seams to record `usage.inference_geo` and the provider's `request-id`, and to abort a stream (G20);
- G1 (Models API), G8 (`role: "system"`) and any Haiku probe need either a reviewed addition to `anthropic.ts` or an owner-run request outside HOME; the owner chooses;
- a report of tokens, cost, stop reason, `inference_geo` and `request-id` per call — never a prompt, answer or key.

Owner ruling needed: stage B says "no HOME database". The gateway cannot call without a budget reservation, which lives in Postgres. **Recommended reading:** the job's own ephemeral database holding only the fixture family and the ledger counts as "no HOME family-record access"; production and home-dev are never reachable from the job.

## 6. Synthetic-data and privacy evidence

From the code (tested): in Production with the gate closed `kevConfig` is `off (gate closed)` whatever the key (`env.ts`, S10), no provider is built and the turn route refuses before any read; Preview's boot guard refuses a database host equal to Production's; every read is actor-bound with visibility in SQL (`kev-non-interference`, `privacy` suites); external text is labelled untrusted; no key reaches the client bundle (S13). **Owner facts the repository cannot prove:** that home-dev holds only synthetic records (people's names reach Kev's context); that **Neon's Vercel integration is not creating Preview branches copied from Production** (the integration's default makes copy-on-write `preview/<branch>` databases from the parent); that no provider key exists in any Vercel environment today.

## 7. Live verification tests (stage B and C; runner only, after approval)

| Gate | Method | Expected | Max cost | Pass | Evidence | If it fails |
|---|---|---|---|---|---|---|
| G1 | GET `/v1/models/{id}` ×3 | 200 for each id; context and output limits as documented | US$0 | all three resolve | ids, date | stop; update `config.ts` with a reviewed PR |
| G22 | count_tokens for each probe below, before its call | a count ≤ 32,000; free | US$0 | every call preceded by a count; no charge in Console | counts | the call never runs (fails closed) |
| G7 | one structured-output answer with one tool round, per tier | valid `KevAnswer`; tool use composes | 0.27 / 0.71 | schema-valid on both tiers | stop reason, validity | switch that tier's `ANSWER_PATH` to `tool` |
| G8 | a request with a mid-conversation `role: "system"` (Sonnet, Opus) | accepted (recorded only) | 0.13 / 0.36 | recorded | status | none (HOME uses a user turn) |
| G10 | read `usage.inference_geo` on every probe | `"us"` | in the above | every response | values | HOME already fails closed |
| G19 | the same prefix twice | `cache_read_input_tokens` > 0 on the second | 0.27 | recorded | token counts | cost model drops the caching saving |
| G20 | abort one stream after the first event | HOME records usage ≥ reported; Console bills consistently | 0.13 | HOME ≥ provider | rows vs Console | keep the per-call maximum charge |
| G9 + G21 | a two-tool turn with a regeneration through `kev.handle()` on the fixture DB | accepted; thinking blocks replay verbatim | ≤ 1.50 | no 400 on replay | status, attempt ids | stop: the loop is not append-only |

Total worst case ≈ US$5.3 (fast and deep); the US$10 cap covers one retry of each.

## 8. Preview infrastructure

- **G3 (now, no Kev):** Vercel › Project › Settings › Functions: plan, Fluid compute on, region `syd1`, maximum duration (≥ 90 s passes; 70–89 s: set `maxDuration` to it and the deadline to `maxDuration − 35 s`; < 70 s: stop).
- **G18 (now, no Kev):** crons on Hobby run once a day within the hour and only on Production; record the plan; set `CRON_SECRET` in Preview and call `/kev/retention` with and without it (401 without), planting an expired synthetic message (item 28). The cron entry for Production follows the result.
- **G16 (now, no model):** a reservation-only script on a trusted machine against home-dev's **pooled** URL: two synthetic adults reserve concurrently, ten rounds, then settle with no calls; expect serialisation, no deadlock, no open or unreconciled rows. Needs the owner's approval to use the pooled URL.
- **G4, G17 (after Package 5, with a Preview-only key and `HOME_KEV=on` for Preview only):** item 27's steps — close a tab mid-turn and check the rows (G4); ten first turns after 15 minutes idle, p95 to the first `working` ≤ 2 s (G17).

## 9. Reconciliation after each session

1. No reservation left `open` or `unreconciled` (`getSpendReport`, system-only).
2. For each attempt, settled amount = Σ `kev_usage.cost_usd_micros` by `attempt_id`.
3. Conservative charges identified: rows whose cost ≠ tokens × price × 1.1 (unknown or partial usage, charged at the per-call maximum).
4. Tokens by model and UTC day against the Console's Usage and Cost for the evaluation workspace; HOME's figure must be ≥ the provider's. Per-call matching needs the runner's `request-id` report (HOME's tables store neither `request-id` nor `inference_geo`).
5. The credit balance and the workspace's month-to-date spend recorded in the campaign ledger; anything above the approved cap stops the campaign.

## 10. Could not be verified from documentation (owner to read in the Console or dashboards)

The minimum workspace spend limit; how an aborted stream is billed; which retention value applies to this account; ZDR eligibility; the sub-processor list (Trust Center unreachable from the sandbox); whether Vercel pre-warms Preview; where the dashboard shows the plan; whether `pg_advisory_xact_lock` works through Neon's pooler (expected, needs G16).

## 11. Order

1. **Owner, free:** read G3 and G18 in Vercel; confirm home-dev is synthetic-only and Neon's Vercel integration is not branching Production; confirm no provider key in Vercel.
2. **Owner, free:** organisation, evaluation workspace (US geo, spend limit), auto-reload off, read retention (G11, G12, G14, G15 recorded).
3. **Owner approval:** the runner package (code, no live calls) → review → merge.
4. **Owner approval:** the first-session budget (US$10) and the probe plan's hash.
5. **Owner:** buy the smallest prepaid credit; create the eval key; store it only as the `kev-evals` secret.
6. **Run (owner approves the job):** G1 → G22 → G7, G10, G19 → G20 → G8 → G9/G21.
7. **Reconcile** (§9) and record each gate with its date in the register.
8. **G16** reservation script on home-dev's pooled URL (separate approval).
9. **Decision:** Package 5 readiness. G4 and G17 follow Package 5 and item 27, with their own budget approval.
