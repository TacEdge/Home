# M8 final acceptance campaign (Option A): preparation

*Prepared 2026-10-24 on the owner's direction ("M8 Final Acceptance Campaign Preparation"), recorded in ADR 0012 §76. Nothing here has run. No provider call was made, nothing was dispatched, no spending limit was changed, and no real data was used. Every paid batch waits on the owner's approval and dispatch.*

## 1. Owner decisions this prepares

- **Option A is approved.** Run the original, contract-compliant campaign: §12.3's full suite as written.
- **No threshold is amended or lowered.** Every sample, scoring rule and gate in contract §12.3 stands, including owner decisions A and B (ADR 0012 §75).
- **M8's scope stays frozen.** No prompt, tool, orchestrator, routing or model change is part of this campaign.
- **O4 is deferred beyond M8** (§8). It is not built.

## 2. Verified baseline

- **PR #119** (`m8/p6-acceptance-record`, owner decisions A–C and the acceptance record) is **open, not merged**, as checked on GitHub on 2026-10-24.
  - Its head is `19af096`. GitHub's test merge commit is `a08d7b7`. It merges cleanly; GitHub reports the branch as behind `main`.
  - `19af096` is **not** an ancestor of `main` (`d0413fe`, PR #118's merge).
  - So `main` does not yet hold its changes: no `docs/m8/M8-ACCEPTANCE.md`, no `completenessOnly()` and no ADR 0012 §75.
- **This preparation is stacked on #119's branch**, so it neither duplicates nor overwrites those changes.
  - #119 merges first; then this PR.
  - The campaign's runner must be on `main` before any batch is dispatched, because the workflow runs from `main` only.
- **The ledger** (`docs/m8/M8-LIVE-LEDGER.json`): 12 sessions, HOME recorded US$8.898823, **remainder US$191.101177** of the US$200 allocation.
- **The evaluation workspace** (owner-supplied, ADR 0012 §65): US inference only, a US$10 monthly spend limit, automatic reload off. HOME has recorded US$8.90 of October's US$10.

## 3. Existing evidence: the credit manifest

**Result: no turn is credited. The campaign is the full 878 turns.**

The proposal (the decision paper, §2) offered 36 turns as reusable, one repeat each:

- 18 fast turns from run #8 (`review-fast`, Sonnet 5.5 `medium`, commit `dc88673`, plan `29d57657…`);
- 18 deep turns from run #10 (`review-deep`, Opus 5.5 `medium`, commit `5315d64`, plan `f6d41061…`).

A turn is credited only if it is **proven** compatible on four counts. Each count was checked against the code at those commits and now.

| Test | What was checked | Result |
|---|---|---|
| **Model and effort** | `src/kev/config.ts` and the plans' canonical `models` and `tiers`: unchanged since both runs (Sonnet 5.5 `medium` fast, Opus 5.5 `medium` deep) | Compatible |
| **Tool contracts and behaviour** | Tool *definitions* sent to the model: unchanged (ADR 0012 §71: the description is unchanged). Tool *behaviour*: `get_projects` with `project_id` now returns `open_tasks`, and the answer renderer now refuses `open_tasks` on a read that carries no count instead of saying "no open tasks" (§71, `src/kev/tools/get-projects.ts`, `src/kev/answer/render.ts`). | **Not proven** for any turn: whether a turn read a project by id, or showed a project's open tasks, is only in its transcript, which is not reachable here |
| **Scenario expectations** | Each review-set scenario's full definition, hashed at `dc88673`, `5315d64` and now: 19 of 20 unchanged; `realistic.why_overlap` changed (§71, `citesConflict`). The live judge (`judge.ts`) changed after run #8 (§67, live judging of the 21 obeying scenarios) and after both runs (§71, `cites_conflict`). | Changed for `why_overlap` (both runs) and for run #8's judging of `injection.synced_title` |
| **Privacy and validator rules** | The orchestrator, context assembly and privacy code: unchanged since both runs. The validator's renderer: changed (the `open_tasks` rule above). | **Not proven**: the renderer's rule bears on what each answer was allowed to show |

**Plan identity.** Neither run's plan hash is the plan the code computes now:

- `review-fast` is now `9854c0fe…`, not run #8's `29d57657…`;
- `review-deep` is now `235207b5…`, not run #10's `f6d41061…`.

The campaign summary accepts only reports whose hash is a campaign batch's as the code computes it (§6). A turn from another hash is outside that identity by construction.

**The 36 candidates, each with its verdict:**

| Run | Scenarios (turns) | Verdict | Reason |
|---|---|---|---|
| #8 fast | `realistic.tomorrow`, `realistic.weekend_look`, `realistic.follow_weather` (2 turns), `realistic.where_conflicts`, `realistic.kids_coming_up`, `realistic.milo_today`, `availability.who_take_milo`, `realistic.before_saturday`, `realistic.household_task_time`, `realistic.weather_no_location`, `realistic.weather_old`, `realistic.ambiguous`, `privacy.alex_saturday`, `privacy.birthdays`, `injection.context_2`, `realistic.attention_week`, `routing.weekend_plan_escalates` (18) | Not credited | The tool behaviour and renderer changed since (§71). Compatibility per turn needs the run's transcripts and report, which cannot be downloaded from this environment. Different plan hash. |
| #10 deep | The same 17 scenarios less `routing.weekend_plan_escalates` (fast-only), plus `injection.synced_title` (18) | Not credited | The same reasons. |
| (excluded in the proposal) | `realistic.fence_project` (both), `realistic.why_overlap` (both), `injection.synced_title` (#8) | Not credited | A tool change, an expectation change and a judging change, respectively. |

**Double counting is impossible either way.** No earlier run's records enter the campaign summary: it refuses any report that is not a campaign batch's, and any `(scenario, tier, repeat)` recorded twice.

## 4. The campaign: §12.3's full suite as written

- **Fast (Sonnet 5.5 `medium`, escalating to Opus 5.5 `medium`):**
  - the safety classes (privacy, sensitive, injection, fabrication), out-of-scope and routing × 5;
  - realistic and availability × 3.
- **Deep (Opus 5.5 `medium`):** every scenario × 3, except the two fast-only routing scenarios.
- **Size.** 114 scenarios and 125 turns in the catalogue give **878 turns**: 509 on fast and 369 on deep.
- **Kept as is:** every safety-critical scenario, every required repetition, the thresholds, synthetic-only isolation (the job's own database, the fixture family, the evaluation key), the US$1.50 turn ceiling, the US$175 run ceiling and HOME's per-adult limits (six turns a minute, sixty a day).

### The batch sequence

Fifteen batches, each its own plan, hash, budget, approval, run and report:

- each repeat's block of the catalogue, in catalogue order, is split into two by turns (a scenario's turns are never split);
- fast and deep alternate by repeat;
- fast's fourth and fifth repeats of the five-run classes come last, in three batches.

The smallest batches come last, when the remainder is smallest. Each batch is at most 63 turns. At the measured 16–20 seconds a turn (runs #8, #10–#12), that is about 17–21 minutes, inside the runner's 35-minute wall clock. No adult has more than 60 turns in a batch.

| Batch | Plan | Tier | Repeat | Turns | Maximum | Budget (approve) | Expected | Plan hash |
|---|---|---|---|---|---|---|---|---|
| 1 | `campaign-01` | fast | 1 | 63 | US$94.50 | US$95.00 | US$5.24 | `2b99538f340fb8e2d58cf25736019dc39b7be580bec44ef6d084b5e030e8ae58` |
| 2 | `campaign-02` | fast | 1 | 62 | US$93.00 | US$93.34 | US$5.15 | `f9073b7b8a519c444004964ed52cc6230fc403969f40feeee2fa655283e1f528` |
| 3 | `campaign-03` | deep | 1 | 62 | US$93.00 | US$93.34 | US$6.74 | `adfac4fd5e2148f45bf31e0567a59b94eddee3eb0784a6cc8f50ea32f5d3e5ea` |
| 4 | `campaign-04` | deep | 1 | 61 | US$91.50 | US$91.67 | US$6.63 | `a176cab003663dc23d83db8c214ffbd993c14cf603ef928a85437c1fe37666e7` |
| 5 | `campaign-05` | fast | 2 | 63 | US$94.50 | US$95.00 | US$5.24 | `4889ce52a2d509a66469cef07c204cc720ea9cc1e3106dcca9023b1f97756477` |
| 6 | `campaign-06` | fast | 2 | 62 | US$93.00 | US$93.34 | US$5.15 | `99e50fad6e4908c6d371778cbd8335313994ca861acf1af6d1d2eb8edbab2f9e` |
| 7 | `campaign-07` | deep | 2 | 62 | US$93.00 | US$93.34 | US$6.74 | `e6660ab3f44bda115a6beeb4e208439480fa60e75359ed8e338a7b975b7ed183` |
| 8 | `campaign-08` | deep | 2 | 61 | US$91.50 | US$91.67 | US$6.63 | `9be510bbda7bac803c65adfe428fec3179336e3a0f4755ff79e2c4aecb2e5233` |
| 9 | `campaign-09` | fast | 3 | 63 | US$94.50 | US$95.00 | US$5.24 | `fd21ae33ef1852b76a272fedcdfc81db6d8ce9b39f8d3f39de95cdc50114a381` |
| 10 | `campaign-10` | fast | 3 | 62 | US$93.00 | US$93.34 | US$5.15 | `30881ac9548c5ac9f290c8800a89fea137b983533e301e8cc7a9ec381a1f6d4e` |
| 11 | `campaign-11` | deep | 3 | 62 | US$93.00 | US$93.34 | US$6.74 | `8d6ec3366335da7efb1a160436e2d23d726e97c3fc669679f5c4565614a0fbd6` |
| 12 | `campaign-12` | deep | 3 | 61 | US$91.50 | US$91.67 | US$6.63 | `d877510dbc4bbfe6bef16ac00c3cb8931b3cccecefa2e077dfa21f167719bcfc` |
| 13 | `campaign-13` | fast | 4–5 | 45 | US$67.50 | US$67.78 | US$3.74 | `bda0810f470dd56dd463dc3eca6cbb30b1eea4d665d0116af2daf52202d240f3` |
| 14 | `campaign-14` | fast | 4–5 | 45 | US$67.50 | US$67.78 | US$3.74 | `46f9a5f166a9adc14fdb252ac3878acfb3993181038ff5bece4ca34d724a69ed` |
| 15 | `campaign-15` | fast | 4–5 | 44 | US$66.00 | US$66.12 | US$3.66 | `53c20b91e5f911660b1631eb9e2c54dace62105d6b863601c14b4fefb1c35288` |
| **All** | | | | **878** | (never all at once) | | **US$82.41** | |

- **Maximum.** Each batch's maximum is every turn at the US$1.50 ceiling.
- **Budget.** Each budget is the smallest whose whole-NZ$ reservation cap holds that maximum, the rule behind Stage 1's US$31.67 (`smallestPracticalCap`, tested).
- **Hashes.** They bind each batch's place in the campaign (`campaign-NN of 15`), its probes and their scenario digests, the prompt, tools, answer schema, models, tiers and limits (`PLAN_VERSION` 6). Every earlier plan's hash is unchanged.
- **Showing them.** `node scripts/kev-live/run.mts` (the keyless dry run) prints each batch and the table above.

## 5. Financial plan

- **Expected cost: about US$82.41** (±30%: US$58–107). That is fast US$0.0831 a turn (run #8, a provisional upper bound) × 509, plus deep US$0.1087 a turn (run #10, exact) × 369. Escalations are included at the rates those runs showed.
- **Maximum exposure, per batch:** US$66.00–94.50, held by its budget, HOME's reservation cap and the US$1.50 turn ceiling.
- **Maximum exposure, campaign:** never above the remainder, **US$191.101177**. Each batch is approved only if its budget fits the remainder after every earlier batch's recorded spend.
- **The headroom.** At the planning rates, the tightest point is batch 12: US$126.46 left against its US$91.67 budget. Earlier spend could run 54% over the estimate before batch 12 would be refused, a safe stop (§7).
- **Available allocation:** US$191.101177. No new allocation is needed: rule 6 applies only if the remainder cannot hold the batches still to run.
- **Provider workspace requirements (the owner's action; nothing is changed here):**
  - **The limit.** The evaluation workspace's US$10 monthly limit cannot hold even one batch (about US$5–7 expected, US$1.10 left in October). Before batch 1 the owner raises it, as rule 10 allows, to **no higher than the campaign remainder (US$191)**.
  - **Recommended: US$120 for each month the campaign runs.** That holds the expected US$82 with 45% margin, and is a provider-side backstop well inside the remainder.
  - **The rest stays:** US inference only, and automatic reload off. The key is `KEV_EVAL_PROVIDER_KEY` in the `kev-evals` environment, never Preview's or Production's.
  - **Starting in November** avoids October's US$8.90 already used.
- **Reconciliation.** Each run reconciles HOME's own reservations and usage (its report). The provider's bill stays **NOT RECONCILED** until the owner compares the workspace's Usage and Cost with the campaign summary's per-run figures. HOME's figure must be at least the provider's.

## 6. Execution: one campaign, individually controlled runs

**Each batch, in order (`docs/runbooks/KEV-LIVE-VERIFY.md`):**

1. **Check (keyless, free).** `node scripts/kev-live/run.mts` shows the batch's plan, maximum, budget and hash.
2. **Dispatch** *Kev live verification* from `main` with three inputs:
   - `plan_hash`: the batch's hash;
   - `budget_usd`: its budget;
   - `campaign_spent_usd`: HOME's recorded spend of the earlier batches **not yet in the ledger**. That is the sum of their "HOME recorded" figures from each job log or `report.json` (`reconciliation.recordedUsdMicros`), in US dollars to the micro-dollar, and `0` for batch 1.
3. **The keyless `plan` job checks, before anyone is asked:**
   - the hash names a batch;
   - the budget fits the batch's cap and holds its maximum;
   - HOME's whole-NZ$ cap holds the peak;
   - the ledger does not already record this batch;
   - the budget fits the remainder **after the ledger's recorded spend and the declared unrecorded spend**.

   A missing or malformed declaration is refused (exit 16), and so is a declaration given to a plan that is not a campaign batch.
4. **The owner approves** the `run` job in `kev-evals`, having read the plan job's log line: `campaign m8-final-acceptance, batch N of 15: ledger remainder …, declared unrecorded spend …, left …`.
5. **After the run:** download its `kev-live-report` artifact. It is kept 30 days. Note HOME's recorded figure, then go to the next batch.

**What each run keeps** (its report, `report.json`):

- its workflow run id and commit;
- the exact plan hash;
- the approved budget and the plan maximum;
- HOME's recorded cost, and the cost at list prices;
- HOME's reconciliation;
- the campaign block: batch, ledger remainder at dispatch and declared unrecorded spend;
- every scenario run's record, by `scenario@tier#repeat`, closed check codes only;
- per-turn usage, cost and latency.

The review files beside it hold the synthetic transcripts for the owner's human review (contract §12.3: 30 a tier).

**The consolidated ledger (rule 7, as amended).** The ledger need not be updated by a PR after each run.

- The declared spend keeps every approval held to the true remainder.
- When the campaign ends, or the owner pauses it, **one evidence PR** adds every batch's row from the campaign summary's proposed rows.
- The summary checks each declaration afterwards: the runner must never have believed in more remainder than there was.
- An understated declaration is reported as `Money: CHECK`. Over-declaring is always safe.

**The campaign summary (built):**

```
node scripts/kev-live/campaign.mts <out-dir> <batch-01/report.json> … <batch-15/report.json>
```

It reads every downloaded report with the committed ledger and writes `campaign-summary.md` and `.json`.

**It refuses:**

- a report that is not a batch of this campaign as the code computes it;
- a batch counted twice;
- a record outside its batch, or counted twice;
- a scripted run.

**It reports, never hides:**

- batches not run, stopped runs, unreconciled runs and probes with no record;
- every run's id, commit, plan hash, maximum, approved budget, recorded cost, reconciliation, declaration check and ledger status;
- the commits the runs used (one expected);
- every failed run by batch, with its closed codes;
- §12.3's summary over every run on each tier (the same `summarise` every report uses: targets, scoring across repeats, the safety gates, decision A);
- the proposed ledger rows.

Its exit status is 0 only when the campaign is complete and its money checks hold.

## 7. Safe stop conditions

No retry and no automatic dispatch, ever. The campaign **pauses for the owner** when any of these happens:

1. **Refused before spending:** a batch is refused by the keyless check or the live preflight (exits 2, 10–20; nothing is spent). Correct the input, or stop if the remainder cannot hold the batch (rule 6).
2. **A batch stops early:** at its cap, the wall clock, a provider error or the turn ceiling.
   - Its probes without a record cannot be re-run under the same hash. A batch runs once: the summary refuses a batch counted twice, and the runner refuses a batch the ledger records.
   - Completing them needs a new top-up plan, through a reviewed PR and the owner's approval.
3. **A hard safety failure is observed in any batch:** a privacy or sensitive disclosure, an injection followed, or a fabrication shown. The release gate is then already failed (0 observed). Continuing spends money on a campaign that cannot pass as is.
4. **A batch's recorded cost is more than twice its expected figure**, or a conservative-charge row appears without a known cause.
5. **A provider-side problem:** the workspace limit is reached, a billing or authorisation error occurs, or the residency check (N16) fails.
6. **A change merges to `main` during the campaign** that touches `src/` or `scripts/kev-live/`. Its batches' hashes or behaviour may no longer be the approved ones. Hold such merges until the campaign ends; the ledger evidence PR is the exception.
7. **Artifacts near expiry:** 30 days from each run. Consolidate before the first batch's artifact expires.

## 8. O4: deferred beyond M8

O4 was "deferred to Package 5's evaluation; decided then". It is the "Take a closer look" deep re-ask under an answer.

- **The owner's decision (2026-10-24):** it is **deferred beyond M8**. It is not built, not part of M8's acceptance, and not evaluated by this campaign.
- **Routing measured as before.** The routing scenarios still run × 5 on fast and are reported as §12.3's diagnostic ("informs O4"), with no gate.
- **If it returns,** it comes back as a later milestone's decision, not as M8 scope.

## 9. The owner's approvals needed

Nothing runs, and nothing is spent, until each of these is given:

1. **Merge PR #119**, then this PR. The runner runs from `main` only.
2. **Approve the campaign:** the fifteen plan hashes and budgets in §4; the expected US$82.41 within the remaining US$191.101177; and the consolidated ledger (rule 7 as amended, §6).
3. **Raise the evaluation workspace's monthly limit** yourself, before batch 1: no higher than US$191, US$120 recommended. Automatic reload stays off and US-only inference stays on. Nothing here changes it.
4. **For each batch:** dispatch with its hash, budget and declared unrecorded spend, then approve its `run` job. Fifteen dispatches, each its own decision.
5. **At the end:** download the reports and run the campaign summary. Open the consolidated ledger PR. Reconcile the provider's bill. Score the 30 transcripts a tier (§12.3, the owner's review).

**After the campaign.** M8's acceptance (§17.1 #12) is read from the campaign summary against §12.3 as written. M8 is not accepted by this preparation.
