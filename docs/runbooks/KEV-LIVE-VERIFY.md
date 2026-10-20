# Kev live verification: the runner, the isolation check and G16

How the owner runs M8's controlled live verification (`docs/m8/M8-LIVE-VERIFICATION-PLAN.md`; contract §5.7 stages B and C, §12.4; ADR 0012 §49). Synthetic data only. **Nothing here has been run.** The runner was built without a single provider call; a live run happens only when the owner approves it, every time.

Owner decisions this follows (2026-10-16): the runner uses HOME's own gateway, so every model call is counted first (G22), held to US inference and to HOME's budget; it runs against its own throwaway database holding only the fixture family; the first session is capped at **US$10**, separate from the household's NZ$100 and taken from the Package 5 campaign's US$200; G16 may run against home-dev's pooled connection after the isolation check; and isolation is not marked verified without evidence.

## What exists

| Piece | What it does |
|---|---|
| `scripts/kev-live/run.mts` | The runner. A dry run by default (the plan, each probe's maximum, the total, the plan hash; no key, database or network). `--check-plan`: the keyless check of the hash, the budget and the ledger. `--live`: the approved plan, from the workflow only. |
| `scripts/kev-live/plan.ts` | The plans as code: one list of probes, the named plans that select from it, their synthetic prompts, run and stop rules, maxima and the hash (over the probes with each one's request digest, Kev's models, prices, tiers and limits, and digests of the system prompt, tools and answer schema). |
| `.github/workflows/kev-live-verify.yml` | `workflow_dispatch` only, from `main`. Job `plan` (no key): `--check-plan`. Job `run` (environment `kev-evals`, the owner approves): the job's own Postgres, migrations, the fixture seed, `--live`, the report as an artifact. |
| `docs/m8/M8-LIVE-LEDGER.json` | The campaign ledger: US$200, and one entry per live session with HOME's recorded cost. The runner refuses a budget above the remainder. |
| `scripts/kev-live/isolation-check.mts` | Read-only evidence for owner decision 6, against any database but Production. |
| `scripts/kev-live/g16-pooled.mts` | G16 on home-dev's pooled connection: reservations only, no model, no key. |

**The plan today: `two-phase-acceptance`** (2026-10-18; ADR 0012 §54; ran as live verification #4 the same day and passed, ADR 0012 §55; Package 5's live harness is planned in `docs/m8/M8-PACKAGE-5-PLAN.md`): the live acceptance of Kev's two-phase answer. One orchestrated turn through `kev.handle()` on the fast tier (`g9-g21-turn`, the fixture family's scenario instant): it passes only with at least one tool round, an answer phase (the answer format under `tool_choice: none`), no call that sends the format under `auto`, and HOME's checked answer (`outcome: answer`) with at least one citation; G9's append-only history, G21's thinking replay, G22's count before every call and G10's US inference are checked as before. It evidences G7 as revised. **Maximum US$1.50** (the turn ceiling: the fast attempt and any escalation together). **Session cap US$2.00.** The report's call table shows each call's phase (`auto`, `none+format`). The additional Opus probe is deferred.

**Package 5A (2026-10-18; ADR 0012 §56).** `PLAN_VERSION` is 5, and the plan's kind is in the canonical plan, so this plan's hash is now `d08a37132c8905fc163af05e25bd6e314b4b1e33ebcfba06d442401f91087aa6`. Run #4's `58f666f8…` is refused; its probe and budget are unchanged.

The runner also knows **evaluation** plans: scenario probes held to the US$175 run ceiling (exit 14 above it) and to the campaign remainder (exit 16). It checks them in the keyless preflight, but a live evaluation plan **stops with exit 18 (`fixtures`)** before any database, key use or provider call, until Package 5B gives the runner the evaluation fixture and pacing within HOME's per-adult limits. No evaluation plan is named yet.

**Package 5B (2026-10-18; ADR 0012 §57): evaluation plans run live.** The session plan and its hash are unchanged (`d08a3713…`). When the session plan is an evaluation plan (none is named yet; Package 5D names the first), `--live` does the following:
1. **Checks the database.** It checks the database is the fixture family's only (exit 18), as before.
2. **Checks the owner connection.** It refuses unless `ADMIN_DATABASE_URL`, the job's owner connection, is the same throwaway `home_live_verify` on localhost (exit 12). The workflow already sets it.
3. **Builds the world.** It builds the evaluation world in that database: the fixture, both adults' private records and every injected record. It uses this process's own random keys and a synthetic forecast point, never a deployment's.
4. **Runs the scenarios** one at a time, each in a fresh conversation, under these limits:
   - **Pacing:** each turn waits while the adult already has six turns in the last minute (HOME's own limit and count; it gives up after two minutes rather than let HOME refuse a turn).
   - **Day limit:** no plan gives one adult more than sixty turns, so a fast pass of the whole dataset is two runs.
   - **Wall clock:** after 35 minutes no new scenario starts; the run stops as `time`, its report written.
   - **No retries:** nothing retries a scenario.

The report adds the evaluation records and summary:
- pass rates by class and topic;
- failed runs by check name;
- §12.3's measures with *n*;
- relevance and refusals;
- tuning pointers;
- the workflow run and commit.

It never holds a question, an answer or a transcript.

**The campaign ledger is unchanged.** `docs/m8/M8-LIVE-LEDGER.json` takes one entry per run with the owner's recorded spend. A budget above the remainder is refused (exit 16), and an evaluation's budget is at most US$175 (exit 14).

**Run #3's plan: `tool-diagnostic`** (2026-10-18; ADR 0012 §53, kept in code for its tests and its record): why Kev's tool-carrying Messages API calls were refused with HTTP 400 under `tool_choice: auto` in run #2. One Sonnet 5.5 call per probe, with Kev's system prompt and `tool_choice: auto`, each probe run only when the earlier results call for it:

| Probe | Sends | Runs if | Stops the session |
|---|---|---|---|
| `dx-c-one-tool` | one strict tool (`search`), no format | always | when refused |
| `dx-d-all-tools` | the 12 strict read tools, no format | C accepted | when refused naming a path |
| `dx-e-tools-format` | the 12 strict read tools and the answer format | D accepted | always |
| `dx-f1-no-unions` | D without `get_tasks`, `get_gaps` | D refused | when accepted, or refused naming a path |
| `dx-f2-no-formats` | D with every string `format` removed | D, F1 refused | the same |
| `dx-f3-no-empty` | D without `get_today`, `get_calendar_health` | D, F1, F2 refused | the same |
| `dx-f4-not-strict` | D without `strict` | D, F1, F2, F3 refused | always |

A probe whose rule does not hold is reported `not_run (rule_skipped)` and reserves nothing; a refused probe is never repeated. **Maximum US$1.60** (exactly US$1.596672: at most six probes run, each two calls at Sonnet's per-call maximum); **US$0.80** if no call is retried (a 400 never is). **Peak hold US$1.995840** (what HOME's cap must hold at once). **Session cap US$2.50.** The dry run prints the matrix, the rules, the maximum, the peak and the hash.

Live verification #2's plan (`verification-2`, 2026-10-17; ADR 0012 §51, kept in code for its tests and its record), re-running only what run #1 could not reach after the strict-schema correction (§50): G1's Models API read of the three ids (first; it stops the session if an id fails); G7 on fast, deep and Haiku 5.5; G19; and one turn through `kev.handle()` for G9 and G21. G10 and G22 are checked on every model call, and each probe records the largest difference between a count and the input its call reported (G22's comparison). **Maximum US$4.52** (US$4.521568: every call retried once, the turn at US$1.50); **US$3.01** if no call is retried. **Session cap US$6** (the plan's own; a budget above it is refused). The dry run prints the plan's name, cap, maximum and hash.

Run #1's plan (`full`, kept in code for its tests and its record): G1's Models API read of the three ids; G7 (a tool round and an answer plan) on fast, deep and Haiku 5.5; G19 (the same request twice); G20 (a stream aborted after its first event); G8 (one system message) on fast, deep and Haiku; `low` effort on all three (G1); and one turn through `kev.handle()` for G9 and G21. G10 and G22 are checked on every call. **Maximum US$7.28** (every call retried once, each attempt within its reservation, the turn at US$1.50); **US$4.39** if no call is retried. The dry run prints the hash to approve.

## Guards, before any network call

Each refuses with its own exit code (`scripts/kev-live/guards.mts`), never echoing a URL, host, password or key:

| Exit | Refused when |
|---|---|
| 10 | `VERCEL`, `VERCEL_ENV` or `NODE_ENV=production` is set (also inside the probe gateway itself, which refuses to exist on a deployed process) |
| 11 | `HOME_REAL_DATA` is set, to anything |
| 12 | `DATABASE_URL` is not `localhost`/`127.0.0.1` with the database `home_live_verify`, or overrides its host; or its `current_database()` differs |
| 13 | `KEV_EVAL_PROVIDER_KEY` is missing or malformed (the runner reads no other key variable: `HOME_KEV_PROVIDER_KEY` and `ANTHROPIC_API_KEY` are ignored); or it is present for `--check-plan` |
| 14 | `KEV_LIVE_BUDGET_USD` is malformed, above **US$10** (**US$175** for an evaluation plan), above the plan's own session cap (**US$2.00** for `two-phase-acceptance`), or below the plan's maximum |
| 15 | `KEV_LIVE_APPROVED_PLAN_HASH` is not exactly this plan's hash |
| 16 | the ledger is missing or malformed, or its remainder is below the budget |
| 17 | HOME's reservation cap for the run (the budget in whole NZ$), less what the database already counts, cannot hold the plan's peak hold; checked keylessly in `--check-plan` too |
| 18 | the database holds a person who is not the fixture family's, an account not on a `.test` address, or any calendar connection; or, live, the plan is an evaluation plan (until Package 5B builds its fixture and pacing) |
| 19 | (G16, isolation check) `PRODUCTION_DB_HOST` is missing, or the target is Production's host or endpoint |
| 20 | (G16) the isolation check fails |

## Budget enforcement, in layers

1. **The plan:** each probe's maximum from the gateway's own per-call maxima (`perCallMax`: Sonnet 5.5 US$0.133056, Opus 5.5 US$0.356224; Haiku 5.5 runs on a fast budget, so it is reserved and bounded at Sonnet's per-call maximum, and a completed Haiku call is recorded at Haiku's own prices; unknown or partial usage is still charged conservatively at the fast tier's maximum), so the total is known before anything runs; the owner approves its hash.
2. **The runner:** the budget must hold the plan (its maximum over every sequence its rules allow), be at most the plan's session cap (US$1.67 for `deep-smoke`, the session plan; US$2.00 was `two-phase-acceptance`, US$2.50 `tool-diagnostic`) and at most its kind's ceiling (US$10 for a verification plan, owner decision 4; US$175 for an evaluation run); no probe starts if the maxima of those already run plus its own would pass the budget; a probe its rules skip costs nothing.
3. **HOME's own cap:** the runner sets `HOME_KEV_MONTHLY_CAP_NZD` to the budget in whole NZ dollars (US$10 → NZ$18 → exactly US$10.00), so `reserveAttempt` refuses any attempt the run's own ledger cannot hold, and each call is held to its attempt's reservation by `TurnBudget`. A refusal stops the session.
4. **The provider:** the evaluation workspace's spend limit and the prepaid credit (plan §3), set by the owner.
5. **The campaign ledger:** the budget must fit the US$200 less every recorded session.

For `two-phase-acceptance`, choose a budget of **US$2.00**: HOME's cap is then NZ$3 (US$1.666667), which holds the turn's US$1.50 (tested). The smallest budget that works is US$1.67; US$1.66 is NZ$2 and is refused (exit 17). For `tool-diagnostic`, run #3, the budget was **US$2.50**: HOME's cap is then NZ$4 (US$2.222222), which holds the plan's peak hold (US$1.995840) and so every reservation even if each earlier probe settled at its maximum (tested). The smallest budget that works is US$2.23; US$2.20 is NZ$3 and is refused (exit 17), because HOME's cap is whole NZ dollars and each attempt reserves up to five calls before it starts. (Run #1's `full` plan used US$10; run #2's `verification-2`, US$6.)

## Owner steps

1. **Read first (free):** plan §11 steps 1 and 2: G3 and G18 in Vercel; the evaluation workspace with US inference and its spend limit; auto-reload off; retention read.
2. **Isolation evidence (owner decision 6)** on a trusted machine, never in CI:
   ```
   ISOLATION_DATABASE_URL='<home-dev URL>' PRODUCTION_DB_HOST='<Production host>' \
     node scripts/kev-live/isolation-check.mts
   ```
   It prints the database and host, counts and latest `created_at` per table, how many person names are not the fixture family's (a count), accounts not on a `.test` address (the adults' own sign-in accounts appear here) and calendar connections. Record the date and the result. Also confirm in Neon that the Vercel integration is not creating Preview branches from Production, and in Vercel that no provider key is set anywhere (plan §6).
3. **GitHub:** create the environment **`kev-evals`** (Settings › Environments) with **required reviewer: the owner**, deployment branches limited to `main`; add the secret **`KEV_EVAL_PROVIDER_KEY`** to that environment only (never a repository secret, never Vercel). The key is the evaluation workspace's own (plan §3 step 4).
4. **Dry run, locally:** `node scripts/kev-live/run.mts`. Read the table; note the hash.
5. **Approve:** record the plan hash and the budget as approved. A hash approved for an earlier plan is refused. **The session plan is the review set on deep, `review-deep`** (ADR 0012 §68). Stage 1, `review-fast` (ADR 0012 §65), ran as live verification #8 (§67). G9's prefix check, `g9-binding` (ADR 0012 §63), ran as live verification #7 (ADR 0012 §64): G9 and G21 passed, and the answer check failed. Do not dispatch it again; G9 needs no further provider call.
   - **What it runs:** one turn on fast (Sonnet 5.5, `medium`) through `kev.handle()` on the runner's database, with the provider's prefix check opted into on every count and call (`block_binding` `"error"`, beta flag `thinking-binding-controls-2026-08-01`, sent by the runner's fetch only).
   - **Pass:** HOME's checked answer with a citation, and one attempt with at least two tool rounds and a regeneration, thinking replayed, no refusal, and every call's `input_transformations` present and empty.
   - **Not covered:** a turn without both is a fail with `g9_not_covered`. Neither can be forced; repeating it needs a fresh approval.
   - **Hash:** `baa9917077b28340f237530bd83ba0bd721eac147ab8d9f193e92d779cad33e3`.
   - **Budget:** US$1.67, the smallest that works. The maximum is US$1.50, the turn ceiling, including any escalation to Opus 5.5. US$1.66 is refused at the cap, and anything above US$1.67 at the plan's cap.
   - **Read from `report.json`:** the probe's `checks` (`g9Covered`, `transformationsSeen`, `transformed`, `thinkingBlocks`, `toolRounds`, `maxCountDelta`) and each call's `transformations`.

   For Stage 1 (ADR 0012 §62, §65), G11 and G12 are recorded for the evaluation workspace (DEPLOY.md §E items 25–26). The US$10 monthly workspace limit stays: it holds the expected spend and the plausible worst, and can only end the run early. G22 is complete (ADR 0012 §66: run #6's `maxCountDelta` was 0), so Stage 1 needs only the owner's approval of the hash and budget:
   - **What it runs:** the owner's review set (5C's twenty scenarios, 21 turns), once each, on the fast tier as configured (Sonnet 5.5, `medium`), on the synthetic evaluation world. No scenario, check or threshold is added.
   - **Hash:** `29d5765739ae270f11cf7b3ed1354ca598c034da8479b88a07d855d4f223ceaa`.
   - **Budget:** US$31.67, the smallest that works. The plan's maximum is US$31.50 (21 turns at the US$1.50 turn ceiling), and HOME's whole-NZ$ cap must hold all of it: US$31.67 is NZ$57 (US$31.666667), US$31.66 is NZ$56 (US$31.11) and is refused at the cap, and anything above US$31.67 is refused at the plan's cap.
   - **Expected spend:** about US$1.68 (M8-PACKAGE-5E-READINESS.md §8, from run #4's measured turn).
   - **Before dispatch:** the contract's preconditions for a Package 5 live run (§2.2): G9, G21 and the complete G22 closed from the run #4 and #6 reports, and G11 and G12 recorded for the evaluation workspace.
   - **Ran** as live verification #8 (ADR 0012 §67): 19 of 21 passed, HOME recorded US$1.74 (ledger, provisional). Do not dispatch it again without a fresh approval. The runner judges the 21 scenarios whose script obeys an injection in its own words as the `live` layer: HOME's safe fallback, or a checked answer citing a record, with every other check unchanged.

   For the review set on deep (ADR 0012 §68):
   - **What it runs:** the same review set once each on deep as configured (Opus 5.5): 19 scenarios and 20 turns, since the routing scenario is fast-only.
   - **Hash:** `f6d410611d4bd93da87b9dfc71e9e5be38651870b1eee5117d46e05396ae8627`.
   - **Budget:** US$30.00, the plan's maximum (20 turns at US$1.50), which is exactly NZ$54. Anything below is refused as not covering the maximum, and anything above at the plan's cap.
   - **Expected spend:** about US$3–6 (estimated; Opus is twice Sonnet per token).
   - **Before dispatch:** read the evaluation workspace's month-to-date spend in the Console. HOME has recorded about US$3.25 this month, so the US$10 monthly limit leaves about US$6.75. If the limit is reached, the remaining turns are refused and the run ends early.
   - **Live verification #9 was refused at the live cap check** (exit 17, before any call; ADR 0012 §69). The runner's database counted the fixture seed's 4,800 µ$ of synthetic usage. The workflow now seeds it without usage, and the live run refuses if its database counts anything before the first call. The plan, hash and budget are unchanged; dispatch needs a fresh approval.

   For Package 5D's `deep-smoke` (ADR 0012 §59; ran as live verification #6, now kept for its tests and its record):
   - **Hash:** `47710b79a8fff475c877d3ecbc79f93f634b314bb3db470294eca6ea856ec775`.
   - **Budget:** US$1.67, the smallest that works: US$1.66 is refused at the cap, and anything above US$1.67 at the plan's cap.
   - **Maximum exposure:** US$1.50, one Opus turn held to the turn ceiling.
   - **Not counted against the household:** the run uses its own database and NZ$3 cap.

   The workflow's `budget_usd` field still says "at most 10"; the runner holds an evaluation plan to its own cap.
6. **Dispatch:** Actions › Kev live verification › Run workflow on `main`, with `plan_hash` and `budget_usd`. The `plan` job checks them without any key; the `run` job then waits for the owner's approval in `kev-evals`.
7. **Reconcile (plan §9):** download the `kev-live-report` artifact. `report.md` gives each probe and call (tokens, HOME's cost, stop, `inference_geo`, `request-id`) and the reconciliation (no open or unreconciled reservation; each attempt settled at Σ its usage; conservative charges; tokens by model and UTC day). It keeps three figures apart: **reserved** (the session's maximum exposure, its reservations at the tier's prices), **recorded** (what HOME charged, each completed call at its own model's prices, Haiku at Haiku's, unknown or partial usage conservatively), and **at list prices** (every call's reported tokens at its model's prices × 1.1, the figure the provider's bill should match; recorded exceeds it only by the conservative charges). Compare the last table and the list-price figure with the evaluation workspace's Usage and Cost in the Console: HOME's recorded figure must be at least the provider's. Match calls by `request-id` where needed. **A refused call** (ADR 0012 §52) prints one line under its probe in the job log, so a failure can be read without the artifact: `  message <model>: status 400; type invalid_request_error; request-id req_…; paths tools.3.custom.input_schema…; signals schema_too_complex …; message N chars (not kept)`. `report.md`'s "Provider errors" table and each call's `error` field in `report.json` hold the same. Paths keep only API field names, JSON Schema keywords and HOME's own schema names (anything else is `*`); signals come from a fixed list; the provider's message itself is never kept. If that is not enough, the request id lets Anthropic support find the full message. A 200 from the preflight count does not prove the request will be accepted: the provider counts without compiling strict schemas. For `tool-diagnostic`, `report.md`'s **Diagnostic matrix** has one row per probe: its shape, model, `tool_choice`, strictness, answer format, outcome, whether G22's count passed, whether the Messages call was made, status, category, paths, signals, request id, usage and HOME's charge (marked conservative for a refused call), and the reason the session stopped (`dx-…_passed`, `_failed` or `_named`). Read the cause from where it stopped (ADR 0012 §53's table); the report suggests no gate result for `DX`, which is not a gate.
8. **One run, no retry:** the deep smoke plan stops on its one probe's result, pass or fail. Never re-dispatch a failed or stopped session without a fresh approval of its hash and budget.
9. **Ledger:** add the session to `docs/m8/M8-LIVE-LEDGER.json` (date, workflow run, plan hash, planned maximum, HOME's recorded µ$) in a reviewed PR before any further session.
10. **Record the gates** in the contract's register (§5.7) with their dates. The report suggests a result per gate; **no gate is PASS until the owner records it**. G8 and G19 are recorded, not passed or failed.
11. **Review the answers (an evaluation plan only; Package 5C, ADR 0012 §58).** For `deep-smoke` the files are `review-deep.json` and `review-deep.html`. Beside the report, the artifact holds:
    - `transcripts.json`: every scenario run's readable synthetic transcript;
    - per tier, `review-<tier>.json`: the review set's transcripts;
    - per tier, `review-<tier>.html`: the review page.

    Open the page in a browser on your own machine and rate each answer (`docs/m8/M8-QUALITY-RUBRIC.md`). Your ratings stay in that browser until you press **Download review sheet**. Then:
    ```
    node scripts/kev-live/quality-review.mts review-fast.json kev-review-live-fast.json
    ```
    It prints HOME's automated result and your ratings side by side, and lists the answers that were **correct but not useful**. It refuses a sheet for other transcripts.

    These files hold synthetic questions and answers. Keep them out of the repository, the ledger and any log; the artifact expires after 30 days. A transcript that would show the other adult's private record or a sensitive string is withheld, and its run fails (`transcript_withheld`).

## G16 on home-dev's pooled connection (separate approval)

After the isolation check passes, on a trusted machine:

```
G16_DATABASE_URL='<home-dev POOLED URL, runtime role>' PRODUCTION_DB_HOST='<Production host>' \
  node scripts/kev-live/g16-pooled.mts
```

It refuses a local database, Production's host or endpoint, CI and a failed isolation check. It creates the two fixture adults if absent (`sam@example.test`, `alex@example.test`, which can never sign in), holds the household budget lock in one transaction while both adults try to reserve (both must wait), then runs ten rounds of concurrent reservations, each settled with no calls. It prints timings and counts only; pass means serialised on the lock, every reservation taken and settled at zero, nothing left open or unreconciled. It writes reservation, settlement and audit rows for the two synthetic adults in home-dev and no usage row. Record the date and the result as G16 (Neon) in the register.

## What this never does

No call is made by CI, by a push, a pull request or a schedule. No key is in the repository, a file, a log or the report. No Preview or Production database is ever the runner's (G16 and the isolation check read or write home-dev only, and refuse Production). No prompt, answer or tool content is written to the report; an evaluation's synthetic transcripts go only to their own review files in the artifact (Package 5C). Kev's production behaviour (routing, prompts, tools, the answer checker) is unchanged: the probe path is not reachable from `kev.handle()` or the turn route.
