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

**The plan today: `tool-diagnostic`** (2026-10-18; ADR 0012 §53): why Kev's tool-carrying Messages API calls were refused with HTTP 400 under `tool_choice: auto` in run #2. One Sonnet 5.5 call per probe, with Kev's system prompt and `tool_choice: auto`, each probe run only when the earlier results call for it:

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
| 14 | `KEV_LIVE_BUDGET_USD` is malformed, above **US$10**, above the plan's own session cap (**US$2.50** for `tool-diagnostic`), or below the plan's maximum |
| 15 | `KEV_LIVE_APPROVED_PLAN_HASH` is not exactly this plan's hash |
| 16 | the ledger is missing or malformed, or its remainder is below the budget |
| 17 | HOME's reservation cap for the run (the budget in whole NZ$), less what the database already counts, cannot hold the plan's peak hold; checked keylessly in `--check-plan` too |
| 18 | the database holds a person who is not the fixture family's, an account not on a `.test` address, or any calendar connection |
| 19 | (G16, isolation check) `PRODUCTION_DB_HOST` is missing, or the target is Production's host or endpoint |
| 20 | (G16) the isolation check fails |

## Budget enforcement, in layers

1. **The plan:** each probe's maximum from the gateway's own per-call maxima (`perCallMax`: Sonnet 5.5 US$0.133056, Opus 5.5 US$0.356224; Haiku 5.5 runs on a fast budget, so it is reserved and bounded at Sonnet's per-call maximum, and a completed Haiku call is recorded at Haiku's own prices; unknown or partial usage is still charged conservatively at the fast tier's maximum), so the total is known before anything runs; the owner approves its hash.
2. **The runner:** the budget must hold the plan (its maximum over every sequence its rules allow), be at most the plan's session cap (US$2.50 for `tool-diagnostic`) and at most US$10 (a constant tied to owner decision 4); no probe starts if the maxima of those already run plus its own would pass the budget; a probe its rules skip costs nothing.
3. **HOME's own cap:** the runner sets `HOME_KEV_MONTHLY_CAP_NZD` to the budget in whole NZ dollars (US$10 → NZ$18 → exactly US$10.00), so `reserveAttempt` refuses any attempt the run's own ledger cannot hold, and each call is held to its attempt's reservation by `TurnBudget`. A refusal stops the session.
4. **The provider:** the evaluation workspace's spend limit and the prepaid credit (plan §3), set by the owner.
5. **The campaign ledger:** the budget must fit the US$200 less every recorded session.

For `tool-diagnostic`, choose a budget of **US$2.50**: HOME's cap is then NZ$4 (US$2.222222), which holds the plan's peak hold (US$1.995840) and so every reservation even if each earlier probe settled at its maximum (tested). The smallest budget that works is US$2.23; US$2.20 is NZ$3 and is refused (exit 17), because HOME's cap is whole NZ dollars and each attempt reserves up to five calls before it starts. (Run #1's `full` plan used US$10; run #2's `verification-2`, US$6.)

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
5. **Approve:** record the plan hash and the budget (US$2.50 for `tool-diagnostic`) as approved. A hash approved for an earlier plan is refused.
6. **Dispatch:** Actions › Kev live verification › Run workflow on `main`, with `plan_hash` and `budget_usd`. The `plan` job checks them without any key; the `run` job then waits for the owner's approval in `kev-evals`.
7. **Reconcile (plan §9):** download the `kev-live-report` artifact. `report.md` gives each probe and call (tokens, HOME's cost, stop, `inference_geo`, `request-id`) and the reconciliation (no open or unreconciled reservation; each attempt settled at Σ its usage; conservative charges; tokens by model and UTC day). It keeps three figures apart: **reserved** (the session's maximum exposure, its reservations at the tier's prices), **recorded** (what HOME charged, each completed call at its own model's prices, Haiku at Haiku's, unknown or partial usage conservatively), and **at list prices** (every call's reported tokens at its model's prices × 1.1, the figure the provider's bill should match; recorded exceeds it only by the conservative charges). Compare the last table and the list-price figure with the evaluation workspace's Usage and Cost in the Console: HOME's recorded figure must be at least the provider's. Match calls by `request-id` where needed. **A refused call** (ADR 0012 §52) prints one line under its probe in the job log, so a failure can be read without the artifact: `  message <model>: status 400; type invalid_request_error; request-id req_…; paths tools.3.custom.input_schema…; signals schema_too_complex …; message N chars (not kept)`. `report.md`'s "Provider errors" table and each call's `error` field in `report.json` hold the same. Paths keep only API field names, JSON Schema keywords and HOME's own schema names (anything else is `*`); signals come from a fixed list; the provider's message itself is never kept. If that is not enough, the request id lets Anthropic support find the full message. A 200 from the preflight count does not prove the request will be accepted: the provider counts without compiling strict schemas. For `tool-diagnostic`, `report.md`'s **Diagnostic matrix** has one row per probe: its shape, model, `tool_choice`, strictness, answer format, outcome, whether G22's count passed, whether the Messages call was made, status, category, paths, signals, request id, usage and HOME's charge (marked conservative for a refused call), and the reason the session stopped (`dx-…_passed`, `_failed` or `_named`). Read the cause from where it stopped (ADR 0012 §53's table); the report suggests no gate result for `DX`, which is not a gate.
8. **Ledger:** add the session to `docs/m8/M8-LIVE-LEDGER.json` (date, workflow run, plan hash, planned maximum, HOME's recorded µ$) in a reviewed PR before any further session.
9. **Record the gates** in the contract's register (§5.7) with their dates. The report suggests a result per gate; **no gate is PASS until the owner records it**. G8 and G19 are recorded, not passed or failed.

## G16 on home-dev's pooled connection (separate approval)

After the isolation check passes, on a trusted machine:

```
G16_DATABASE_URL='<home-dev POOLED URL, runtime role>' PRODUCTION_DB_HOST='<Production host>' \
  node scripts/kev-live/g16-pooled.mts
```

It refuses a local database, Production's host or endpoint, CI and a failed isolation check. It creates the two fixture adults if absent (`sam@example.test`, `alex@example.test`, which can never sign in), holds the household budget lock in one transaction while both adults try to reserve (both must wait), then runs ten rounds of concurrent reservations, each settled with no calls. It prints timings and counts only; pass means serialised on the lock, every reservation taken and settled at zero, nothing left open or unreconciled. It writes reservation, settlement and audit rows for the two synthetic adults in home-dev and no usage row. Record the date and the result as G16 (Neon) in the register.

## What this never does

No call is made by CI, by a push, a pull request or a schedule. No key is in the repository, a file, a log or the report. No Preview or Production database is ever the runner's (G16 and the isolation check read or write home-dev only, and refuse Production). No prompt, answer or tool content is written to the report. Kev's production behaviour (routing, prompts, tools, the answer checker) is unchanged: the probe path is not reachable from `kev.handle()` or the turn route.
