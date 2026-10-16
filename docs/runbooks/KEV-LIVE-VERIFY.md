# Kev live verification: the runner, the isolation check and G16

How the owner runs M8's controlled live verification (`docs/m8/M8-LIVE-VERIFICATION-PLAN.md`; contract §5.7 stages B and C, §12.4; ADR 0012 §49). Synthetic data only. **Nothing here has been run.** The runner was built without a single provider call; a live run happens only when the owner approves it, every time.

Owner decisions this follows (2026-10-16): the runner uses HOME's own gateway, so every model call is counted first (G22), held to US inference and to HOME's budget; it runs against its own throwaway database holding only the fixture family; the first session is capped at **US$10**, separate from the household's NZ$100 and taken from the Package 5 campaign's US$200; G16 may run against home-dev's pooled connection after the isolation check; and isolation is not marked verified without evidence.

## What exists

| Piece | What it does |
|---|---|
| `scripts/kev-live/run.mts` | The runner. A dry run by default (the plan, each probe's maximum, the total, the plan hash; no key, database or network). `--check-plan`: the keyless check of the hash, the budget and the ledger. `--live`: the approved plan, from the workflow only. |
| `scripts/kev-live/plan.ts` | The plan as code: thirteen probes, their synthetic prompts, their maxima and the hash (over the probes, Kev's models, prices, tiers and limits, and digests of the system prompt, tools and answer schema). |
| `.github/workflows/kev-live-verify.yml` | `workflow_dispatch` only, from `main`. Job `plan` (no key): `--check-plan`. Job `run` (environment `kev-evals`, the owner approves): the job's own Postgres, migrations, the fixture seed, `--live`, the report as an artifact. |
| `docs/m8/M8-LIVE-LEDGER.json` | The campaign ledger: US$200, and one entry per live session with HOME's recorded cost. The runner refuses a budget above the remainder. |
| `scripts/kev-live/isolation-check.mts` | Read-only evidence for owner decision 6, against any database but Production. |
| `scripts/kev-live/g16-pooled.mts` | G16 on home-dev's pooled connection: reservations only, no model, no key. |

The plan today (`node scripts/kev-live/run.mts`): G1's Models API read of the three ids; G7 (a tool round and an answer plan) on fast, deep and Haiku 5.5; G19 (the same request twice); G20 (a stream aborted after its first event); G8 (one system message) on fast, deep and Haiku; `low` effort on all three (G1); and one turn through `kev.handle()` for G9 and G21. G10 and G22 are checked on every call. **Maximum US$7.28** (every call retried once, each attempt within its reservation, the turn at US$1.50); **US$4.39** if no call is retried. The dry run prints the hash to approve.

## Guards, before any network call

Each refuses with its own exit code (`scripts/kev-live/guards.mts`), never echoing a URL, host, password or key:

| Exit | Refused when |
|---|---|
| 10 | `VERCEL`, `VERCEL_ENV` or `NODE_ENV=production` is set (also inside the probe gateway itself, which refuses to exist on a deployed process) |
| 11 | `HOME_REAL_DATA` is set, to anything |
| 12 | `DATABASE_URL` is not `localhost`/`127.0.0.1` with the database `home_live_verify`, or overrides its host; or its `current_database()` differs |
| 13 | `KEV_EVAL_PROVIDER_KEY` is missing or malformed (the runner reads no other key variable: `HOME_KEV_PROVIDER_KEY` and `ANTHROPIC_API_KEY` are ignored); or it is present for `--check-plan` |
| 14 | `KEV_LIVE_BUDGET_USD` is malformed, above **US$10**, or below the plan's maximum |
| 15 | `KEV_LIVE_APPROVED_PLAN_HASH` is not exactly this plan's hash |
| 16 | the ledger is missing or malformed, or its remainder is below the budget |
| 17 | HOME's reservation cap for the run, less what the database already counts, cannot hold the plan |
| 18 | the database holds a person who is not the fixture family's, an account not on a `.test` address, or any calendar connection |
| 19 | (G16, isolation check) `PRODUCTION_DB_HOST` is missing, or the target is Production's host or endpoint |
| 20 | (G16) the isolation check fails |

## Budget enforcement, in layers

1. **The plan:** each probe's maximum from the gateway's own per-call maxima (`perCallMax`: Sonnet 5.5 US$0.133056, Opus 5.5 US$0.356224; Haiku 5.5 runs on a fast budget, so it is reserved and bounded at Sonnet's per-call maximum, and a completed Haiku call is recorded at Haiku's own prices; unknown or partial usage is still charged conservatively at the fast tier's maximum), so the total is known before anything runs; the owner approves its hash.
2. **The runner:** the budget must hold the plan and be at most US$10 (a constant tied to owner decision 4); no probe starts if the maxima of those already run plus its own would pass the budget.
3. **HOME's own cap:** the runner sets `HOME_KEV_MONTHLY_CAP_NZD` to the budget in whole NZ dollars (US$10 → NZ$18 → exactly US$10.00), so `reserveAttempt` refuses any attempt the run's own ledger cannot hold, and each call is held to its attempt's reservation by `TurnBudget`. A refusal stops the session.
4. **The provider:** the evaluation workspace's spend limit and the prepaid credit (plan §3), set by the owner.
5. **The campaign ledger:** the budget must fit the US$200 less every recorded session.

Choose a budget of **US$10**: a smaller one may refuse at layer 3, because HOME's cap is whole NZ dollars and each attempt reserves up to five calls before it starts.

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
5. **Approve:** record the plan hash and the budget (US$10) as approved.
6. **Dispatch:** Actions › Kev live verification › Run workflow on `main`, with `plan_hash` and `budget_usd`. The `plan` job checks them without any key; the `run` job then waits for the owner's approval in `kev-evals`.
7. **Reconcile (plan §9):** download the `kev-live-report` artifact. `report.md` gives each probe and call (tokens, HOME's cost, stop, `inference_geo`, `request-id`) and the reconciliation (no open or unreconciled reservation; each attempt settled at Σ its usage; conservative charges; tokens by model and UTC day). It keeps three figures apart: **reserved** (the session's maximum exposure, its reservations at the tier's prices), **recorded** (what HOME charged, each completed call at its own model's prices, Haiku at Haiku's, unknown or partial usage conservatively), and **at list prices** (every call's reported tokens at its model's prices × 1.1, the figure the provider's bill should match; recorded exceeds it only by the conservative charges). Compare the last table and the list-price figure with the evaluation workspace's Usage and Cost in the Console: HOME's recorded figure must be at least the provider's. Match calls by `request-id` where needed.
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
