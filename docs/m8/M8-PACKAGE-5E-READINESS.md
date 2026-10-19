# M8 Package 5E — Evaluation readiness and targeted tuning: the owner's decision paper

*Prepared 2026-10-19 (evidence closure and investigation only). No code, prompt, validator, gateway or orchestrator change. No provider call, no dispatch, no live evaluation. Kev stays off in Preview, `HOME_REAL_DATA` stays closed. Each section separates **confirmed** evidence (with its source) from **inference** and **recommendation**. STOP FOR OWNER REVIEW before any implementation.*

**Sources.**
- Live verification #6: workflow run 39189762049 on `f9eba68`, read through the GitHub API (first-party), and the owner's reading of its `report.json` (owner-supplied).
- The code, cited by file and line.
- `M8-BUILD-CONTRACT.md` (§5.7, §12, §13, §15.6, §17.1), `M8-PACKAGE-5-PLAN.md` (§8–§11, §15), ADR 0012 §54–§61, and `M8-LIVE-LEDGER.json`.
- **Not readable here:** `report.json` and the transcript (artifact 12160000016). GitHub serves artifacts from a host the build session cannot reach. Every figure taken from them is the owner's.

## 1. Live verification #6: evidence closed

**Confirmed, first-party (GitHub API):**
- The run was dispatched on `main` (`f9eba68`) on 2026-10-19 at 02:23 UTC and approved by the owner in `kev-evals`.
- The keyless plan check passed. The live job seeded the fixture database and ran "Run the approved plan" from 02:24:49 to 02:25:28 (39 s, including the world's build). The job succeeded.
- **The job succeeds only when every check of the `deep-smoke` probe passed:**
  - every call on Opus 5.5 (`smokeModelReasons`);
  - each call counted first and in the US;
  - a grow-only history;
  - at least one tool round, then the answer phase, never the format under `auto`;
  - an answer HOME's checker accepted, first time or after its one regeneration, with at least one citation;
  - the scenario's own checker (`realistic.weekend_look`: `get_agenda` read, Saturday's football cited, the forecast's credit, never "free" or "quiet weekend") (`scripts/kev-live/probes.ts`; `runner.ts` exit 0 only when `report.passed`).

**Owner-supplied** (from `report.json`):
- Opus 5.5, outcome PASS.
- Five model calls: three tool rounds with five tool calls, the answer phase and one regeneration.
- The first answer was refused with `answer.schema`; the regeneration was accepted, with a validated answer.
- 35.64 s to the checked answer.
- HOME recorded **US$0.248311**, and the reservations were reconciled.

**Recorded in this PR:**
- **The ledger.** `M8-LIVE-LEDGER.json` row #6 at 248,311 µ$. The campaign remainder is now **198,578,930 µ$ (US$198.578930)**. Anthropic's bill is **NOT RECONCILED**.
- **The gate register.** Contract §5.7's live verification #6 update. **G7 (revised) PASS on deep** (n = 1) and **G10 PASS** for the calls made. G8 is recorded: the labelled regeneration was accepted on Opus.
- **Not verified.** G9 (the organisation's creation date), G21 (`thinkingBlocks` unread) and the complete G22 (`maxCountDelta` unread) stay **NOT VERIFIED**. E1 and E9 have n = 1 evidence and are not passed.

## 2. Current acceptance status (fast and deep)

| | Fast (Sonnet 5.5 `medium`) | Deep (Opus 5.5 `medium`) |
|---|---|---|
| Live orchestrated turns | 1 (LV#4, two-part question) | 1 (LV#6, `realistic.weekend_look`) |
| G7 revised (two phases) | **PASS** | **PASS** |
| G10 (US inference) | PASS (calls made) | PASS (calls made) |
| G9, G21, complete G22 | NOT VERIFIED (owner's `report.json` reading and the creation date) | NOT VERIFIED (same) |
| First answer accepted | No (refused; code not recorded, before 5A) | No (`answer.schema`) |
| Cost of the turn | US$0.088801 | US$0.248311 |
| Contract acceptance (§17.1 #12, E1–E11) | Not started: needs the campaign | Not started: needs the campaign |
| Stage-D gates (G3, G4, G16 Neon, G17) | NOT VERIFIED | NOT VERIFIED |
| Before the first full campaign run (contract §2.2 at Package 5) | G11 and G12 for the evaluation workspace; every stage-B gate (G22 included), G9 and G21 | Same |

**Confirmed:** both tiers have now completed a live, grounded, two-phase conversation. **Not established:** reliability, latency or cost distributions. Each tier has n = 1.

## 3. The first answer's `answer.schema`: cause and remaining uncertainty

**Confirmed (code):**
- **Where it comes from.** `answer.schema` has one source: `parsePlan` returned null (`src/kev/answer/validate.ts:134-142`).
- **When `parsePlan` returns null** (`src/kev/answer/schema.ts:279-310`):
  - the text is not JSON;
  - it has a key other than `lead`, `facts`, `view` or `decline`;
  - `decline` is set alongside other content, or there is no lead without a decline;
  - the shaped plan fails the Zod `answerPlanSchema`.
- **Two schemas, deliberately.** The provider's grammar is a hand-written `ANSWER_JSON_SCHEMA` (`schema.ts:208-240`, sent as `output_config.format`). HOME's check is Zod. The file says lengths, counts and phrase-by-type are "the Zod schema's alone" (`schema.ts:27-30`). So **grammar-conforming output can still fail HOME's check**:
  - a view phrase of another view type (`schema.ts:160`);
  - a `show` field the kind does not offer (`schema.ts:129-132`);
  - a record block with a `scope`, or a summary block with a `ref` (`schema.ts:258-270`);
  - more than ten facts;
  - `view.about` out of range;
  - a `ref.at` that is not an ISO instant with offset, or `scope.from`/`to` not ISO dates (`src/kev/tools/types.ts:163-170`; `schema.ts:106-114`);
  - `lead: null` with `decline: null`.
- **Truncation also becomes `answer.schema`.** The orchestrator never reads a call's `stop`; it only copies it into the stored `calls[]` (`orchestrator.ts:855`). An answer cut off at `max_tokens` is unparseable JSON. Deep's `maxTokens` is **8,192, thinking included** (`config.ts:103-109`). No `thinking` parameter is sent; the contract records that Opus 5.5 thinks adaptively under `effort` (contract §5.1).
- **Not the provider.** The call returned a usable stream (the turn continued to a regeneration on the same attempt). A provider refusal would be HTTP 400 or `refused`, not `answer.schema`.
- **The regeneration** (`orchestrator.ts:182-193`, `688-716`):
  - **What is sent:** the rejected assistant turn stays in the history. HOME's labelled note names only `answer.schema in the answer`, without saying which rule failed.
  - **Limits:** one regeneration per attempt. On deep, a second failure shows the salvage or the safe fallback (no escalation).

**Classification:**
- **Not a provider or schema defect.** The grammar and the Zod rules are intentionally different. No provider error occurred.
- **One of two expected, recoverable classes. Which one is NOT VERIFIED:**
  - **(a) A model formatting failure inside the grammar.** One Zod-only rule broken. The likeliest by the design are a view phrase of the wrong type, or a `ref.at` written as a date (forecast refs carry no `at`, `get-weather.ts:76`, so `at` must be `null`).
  - **(b) Truncation** at the 8,192-token output budget, shared by adaptive thinking and the JSON.
- **Not shown to be overly restrictive.** Every Zod-only rule protects what HOME renders. None is a candidate for loosening, and none is recommended.

**How to settle it for free:** from #6's `report.json`, read the probe's call 4 (`answerFormat: true`, `toolChoice: "none"`): its `stop`, `outputTokens` and `blocks`.
- `stop: "max_tokens"`, or output near 8,192, or large `blocks.thinking`, means (b).
- `stop: "end_turn"` with modest output means (a).

**Why it matters:**
- **Both live turns needed a regeneration.** First-pass is 0 of 2 (LV#4 fast, LV#6 deep), against a ≥ 90 % target. That says nothing statistically, but it is the most important reliability signal so far.
- **Each failure costs one full answer call** (time and money).
- **On deep it also eats the deadline.** At 35.64 s, about 19 s remained. That is below deep's 20 s minimum to start a call (`config.ts:108`), so no further call could have started. Inference: a slightly slower read phase would have left no time for the regeneration.

**Coverage today:**
- `answer.schema` followed by a passing regeneration is tested (`tests/integration/kev-eval-harness.test.ts:143-165`, `kev-request-wire.test.ts`, `tests/unit/kev-context-window.test.ts:219-231`).
- Grammar-valid but Zod-invalid plans are tested at the parser (`tests/unit/kev-plan.test.ts`, `kev-plan-final.test.ts`).
- **Missing:**
  - an orchestrator test of an answer phase cut off at `max_tokens`;
  - any record of *which* structural rule failed.

## 4. Latency: the 35.64 s turn

**Confirmed (code; the owner's figures):**
- **The sequence:** read call 1 → tools → read call 2 → tools → read call 3 → tools → answer (refused) → regeneration (accepted).
- **Why there was no read-phase end call.** The third tool round reached `toolRoundsPerAttempt: 3` (`config.ts:158`), so the read phase ended without a prose call of its own (`orchestrator.ts:776-787`). All five calls of `modelCallsPerAttempt` were used.
- **Count calls.** Each model call is preceded by its own awaited `count_tokens` request (G22; `providers/anthropic.ts:775-778`), up to 5 s each. That makes **ten sequential provider round trips** plus three batches of HOME's tool reads. A batch's reads run in parallel (`Promise.all`, `orchestrator.ts:743-745`).
- **What the 35.64 s covers.** It is the turn from its start to the checked answer, before storage (`answerMs`, `orchestrator.ts:1073`).
- **Where the per-part times are.** Per-call `ms` (count and message separately), `stop` and cache tokens are in `report.json`, unread here. The `kev_turn` log line has no per-call timing.

**Breakdown, where the evidence permits:**
- **What is known:** 3 tool rounds, 5 tool calls, 5 model calls and 5 counts.
- **What is not known:** the split between the read phase, the counts, HOME's tool execution, the answer and the regeneration. Those come from `report.json`'s per-call `ms`.
- **Inference only:** HOME's reads run against a local database and are expected to be a small share. The bulk is Opus generation (three read calls with adaptive thinking, two answer calls) and ten network round trips.

**Were three rounds necessary? No (inference).**
- The scenario's reference is **one round of two parallel reads**: `get_agenda` (Saturday to Sunday, `get-agenda.ts`, up to 31 days) and `get_weather` (Saturday to Sunday).
- The prompt already says "Tools can be called together in one step" (`src/kev/prompts/system.ts:60`).
- The model reached the round limit, so it was still reading on its third call. Five calls over three rounds means at least one round held a single read.
- **Which reads it made is NOT VERIFIED.** The stored trace and `report.json` hold them. Plausible extras for this question:
  - `get_conflicts`: Sam has a private overlap with Milo's football on Saturday at 09:30, which is genuinely relevant;
  - `get_gaps` or `get_insights`;
  - per-person agenda reads prompted by "our".
- **One round would save an Opus read call.** The read-phase end call would return (R1, end, answer), but one tool batch would go. In model calls it is 4–5 rather than 5. **The first-pass failure costs more than the extra rounds:** a full answer call, a count, and the deadline headroom.

**Tools and orchestration: no change recommended.**
- The tools already support date ranges and parallel reads in one round. The constraint is the model's choice, not the tools.
- **Parallel tool execution already exists.** Changing the orchestration has no demonstrated benefit and touches the five-call ceiling, the round limit and the deadlines, which this paper preserves.
- **G22's counts could not overlap their calls** without changing the owner's preflight decision. They are not recommended for change.

**The latency targets:**
- The contract sets no latency target for a turn on deep from the start. Its nearest is escalated turns' p95 ≤ 35 s. The summary applies latency targets to fast only (`summary.ts:324`).
- **LV#6's single deep turn is at about that line** (35.64 s).
- **Fast's p50 ≤ 5 s / p95 ≤ 10 s is the threshold most at risk.** LV#4's whole job step took 24 s.

## 5. Cost per successful turn

**Confirmed (owner-supplied, recorded):**

| Turn | Model | Calls | Cost | Against |
|---|---|---|---|---|
| LV#4 | Sonnet 5.5 `medium` | 5 (2 rounds, end, answer, regeneration) | **US$0.088801** | Fast mean target ≤ US$0.09 (contract §12.3): at it, on a heavy turn |
| LV#6 | Opus 5.5 `medium` | 5 (3 rounds, answer, regeneration) | **US$0.248311** | Contract planning figure US$0.284 (§13.2); the turn ceiling US$1.50 (16.6 % of it) |

**Inference:** both were "heavy" turns, multi-part with a regeneration each. A first-pass success would remove one answer call. The catalogue's typical turn is likely cheaper, but that is unmeasured. Opus costs about 2.8× Sonnet per turn here.

## 6. Product quality: the Opus weekend answer

**Not reviewable here.** The answer and transcript are in the artifact only.

**Confirmed (job success):** the accepted answer cited Saturday's football and carried the forecast's credit. It never said "free" or "quiet weekend", and nothing private to the other adult was shown (the scenario's checks and the transcript's own refusal of a leaked marker; a withheld transcript fails the run). That establishes correctness and privacy for this run. Usefulness, conciseness and tone need the owner's rubric scores (`M8-QUALITY-RUBRIC.md`, the seven dimensions).

**The three additional citations: what they can be (confirmed by code).**
- The review's "extra" count is the relevance diagnostic (`src/kev/evals/judge.ts:123-139`). It counts cites outside the scenario's `mustCite` and `mayCite`.
- For this scenario those are: the football, **any event**, and the forecasts for Saturday and Sunday (`scenarios-5b.ts:122-123`).
- **So the three extras are necessarily not events and not those two forecasts.** They can only be a conflict, gap, insight, task, project, person, note, calendar, context, or a forecast for another day.
- Relevance is a diagnostic. It does not decide the checker's pass.

**Candidates, by what Sam's evaluation world holds that weekend (inference until the transcript is read):**

| Candidate | Useful? | Note |
|---|---|---|
| **The conflict:** Sam's private Saturday 09:30 overlap with Milo's football | **Likely genuinely useful** | A clash on the weekend asked about. The scenario's `mayCite` is narrower than the answer it should accept |
| A **gap** or an **opening** (`insight`) on the weekend | Possibly useful, often noise | "What does our weekend look like?" does not ask for free time; a gap is easy to over-cite |
| A **person** (Milo) or a **task** | Likely duplicative or unnecessary | The event block already names its people |
| A forecast for **Friday** or **Monday** | Unnecessary | Outside the weekend |

**More citations are not better.** The prompt allows at most ten blocks (`system.ts:35`) but says nothing about citing only what the answer uses.

**Recommendation:**
1. The owner classifies the three from the transcript with the rubric.
2. If one is the conflict, widen the scenario's `mayCite` to accept it. This is an eval-definition correction; it changes no threshold and needs the owner's approval.
3. If they are gaps, people or out-of-range forecasts, note "cite only the blocks the answer is about" as a prompt candidate. It is eval-gated, and not now.

## 7. Recommended targeted improvements (none implemented)

**In priority order. Each needs the owner's approval; changes to prompts, the validator or config carry the eval rule.**

1. **Free, now (owner).** Read #4's and #6's `report.json`:
   - call 4's `stop`, `outputTokens` and `blocks`;
   - per-call `ms` and cache tokens;
   - `thinkingBlocks` and `maxCountDelta`;
   - relevance, and the trace's reads;
   - plus the organisation's creation date.

   This settles §3's (a) or (b), §4's breakdown and G9/G21/G22 on both tiers. The artifacts expire on 2026-11-17 (#4) and 2026-11-18 (#6).
2. **Answer-phase diagnostics (correctness and privacy unchanged; no validation weakened).** Two parts:
   - record a closed structural sub-code for `answer.schema`: not JSON, truncated (`stop: max_tokens`), shape, or the Zod rule's area (phrase/type, show field, ref, scope, count);
   - read the answer call's `stop` in the orchestrator's diagnostics.

   It stores no answer text, only closed codes. Without it, the campaign measures first-pass failures blind. A unit test pinning which Zod rules the grammar cannot express documents the deliberate gap.
3. **Conditional on 1:**
   - **If truncation:** consider deep's `maxTokens` (8,192, thinking included). It raises the per-call maximum and so the reservations, a spending-control change that needs the owner's decision.
   - **If a Zod-only rule:**
     - first consider telling the model which rule failed in the regeneration note. That is prompt text and eval-gated.
     - consider expressing phrase-by-type in the grammar (per-type `anyOf`), which tightens it. That only goes ahead if it stays inside the strict-schema limits (live verifications #1 and #3).
4. **Later, eval-gated prompt candidates.** Read multi-part questions in one round. Cite only what the answer is about. Measure after 2, never on n = 1.
5. **Not recommended:** parallel or overlapping calls, orchestration changes, or loosening any rule or limit.

## 8. Proposed staged evaluation plan

**The contract's coverage is preserved** (§12.2, §12.3, contract lines 1492-1538; `M8-EVAL-SCENARIOS.md`): 113 scenarios, 124 turns.
- **Fast pass:** 124 turns (Sam 83, Alex 41).
- **Deep pass:** 122 turns. The two routing-escalation scenarios are fast-only.
- **The full suite:** fast × 3, with the safety classes × 5. On §12.3's strict reading, out of scope and routing are also × 5, giving **506 fast turns** (the catalogue counts 488). Deep × 3 gives **366 deep turns**.
- **E11:** the same scenarios on Sonnet `low` and Haiku 5.5 (Opus `low` optional).
- **The owner's review:** 30 transcripts per tier.

| Stage | What | Turns | Expected (measured basis) | Plan maximum → budget | Approval point |
|---|---|---|---|---|---|
| **A. Fast smoke** (§9's 5D ii) | 10 scenarios × 1 on Sonnet `medium`, across classes (privacy and injection included) | 10 | **≈ US$0.89** (10 × US$0.0888) | US$15.00 → budget US$15 (NZ$27 cap holds the US$1.50 peak) | Hash and budget; then the ledger row |
| **B. Deep smoke** | 6 scenarios × 1 on Opus (multi-part, a follow-up, a privacy probe) | 6 | **≈ US$1.49** (6 × US$0.2483) | US$9.00 → budget US$9 | Same |
| **C. Model and effort comparison** (E11) | **Needs a runner change first:** scenario probes take only `fast` or `deep` from `TIERS`, with no model or effort override (`plan.ts:151-175`); a model change needs the owner (`config.ts:17-20`). The contract requires the full sweep on the same scenarios. A screening pass (the 20-scenario review set × 1 on `low` and Haiku) may inform but **cannot replace it** without the owner's amendment | 40 (screening) | ≈ US$2–3 | US$60 → split into runs | Owner decision on scope |
| **D. Full campaign** | Fast `medium` 506; deep 366; `low` 506; Haiku 506; targeted reruns | 1,884 + reruns | See §9 | Per run: turns × US$1.50 | Every run: hash and budget; ledger row before the next |
| **E. Owner review** | 30 transcripts per tier from the runs' `transcripts.json`. The review page holds 20 (5C); 10 more per tier are needed. A small tooling gap, or read from the JSON | — | US$0 | — | The owner's sheet |

**Run sizing (confirmed limits):**
- At most 60 turns per adult per run (`plan.ts`), so Sam's 83 turns need two runs per pass.
- Pacing is 6 turns a minute. No new scenario starts after 35 minutes.
- HOME's per-run cap is whole NZ$ and **at most NZ$300** (`src/lib/env.ts:81-85`). So a run's budget is at most about US$166.67, which is **111 turns** at US$1.50.
- **Inference:** wall-clock time at about 35 s a deep turn allows about 60 deep turns per run, and fast turns more. Expect about 7 deep runs, about 6–9 per fast cell, and about 30–36 approvals in all.

## 9. Estimated campaign cost

**Basis:**
- **Measured:** Sonnet `medium` US$0.0888 a turn (LV#4) and Opus `medium` US$0.2483 a turn (LV#6), each n = 1 and each a heavy turn.
- **Not measured:** Sonnet `low` (about US$0.075, the plan's estimate) and Haiku (about US$0.005 plus escalations, the plan's figure for the cell about US$17).
- **Escalations on fast:** the routing-escalation scenarios, about 10 turns at about US$0.34.

| Cell | Turns | Expected |
|---|---|---|
| A. Fast smoke | 10 | US$0.89 |
| B. Deep smoke | 6 | US$1.49 |
| C. Screening (if chosen) | 40 | about US$2.50 |
| D. Fast `medium` | 506 | about US$47.40 (44.93 + escalations about 2.5) |
| D. Deep | 366 | about US$90.90 |
| D. Sonnet `low` | 506 | about US$40.50 |
| D. Haiku | 506 | about US$17 |
| D. Targeted reruns and tuning | — | about US$20 |
| **Total expected** | | **about US$220.70** (range about US$165–300: n = 1 per measured model, two cells unmeasured) |

**The remainder and the binding rule (confirmed):**
- The remainder is **US$198.578930**.
- Each run's budget must cover its plan maximum (turns × US$1.50; `runner.ts`, `assertBudgetCovers`) and be at most the remainder (`assertLedgerCovers`).
- **So the whole campaign's exposure can never exceed the remainder.** That is the conservative maximum, held by the runner and the ledger.

**What follows (arithmetic):**
- **Expected spend shortfall:** about **US$22** (220.70 − 198.58).
- **Headroom.** The rule needs the last runs to start with unspent headroom. A final run of about 40 turns needs about US$60 left even though it spends about US$3–10. As the remainder falls, runs shrink geometrically. To finish D as specified with sensibly sized final runs, the allocation must be about **expected spend plus US$40–60: about US$260–280**.
- **Allocation shortfall:** about **US$60–80** above the remainder. Only about US$22 of it is expected to be spent.

**Options for the owner** (no coverage is reduced and no allocation increased here):
1. **A further allocation** (§12.4 rule 6): about US$60–80, mostly headroom, never all spent.
2. **Run the cheap cells first.** Order Haiku and `low` first, then fast `medium`, with deep while the remainder is still large. This reduces, but cannot remove, the shortfall at the end.
3. **Amend the programme.** For example, screen E11 before committing to the full `low` and Haiku cells. This reduces required coverage and needs the owner's explicit decision.

**Recommended:** run A and B first (about US$2.40 expected, US$24 maximum). Their measured means replace n = 1, and then this table is re-estimated before D's budget is decided (the owner's decision 6 holds).

## 10. Remaining acceptance gates

- **G9, G21, complete G22 (both tiers):** the owner reads `report.json` and records the creation date.
- **G11, G12:** the evaluation workspace's geo enforcement and spend limit, recorded before the first full campaign run (contract §2.2 at Package 5).
- **E1–E11:** need the campaign's recorded runs. E12 and E13 are built and stub-tested.
- **§17.1 #12** (both tiers meet every gate and target) and **#15** (the owner's 30 transcripts per tier and screenshots).
- **D2** (fast model and effort) and **O4:** after E11.
- **Stage D** (G3, G4, G16 on Neon, G17): Preview, later.
- **Stage E:** real-data items, after the real-data gate.

## 11. Owner decisions required

1. Accept #6's records: the ledger row at 248,311 µ$, and the gate updates in §1.
2. The free `report.json` reading and the creation date (§7.1), before 2026-11-17.
3. Approve the answer-phase diagnostics (§7.2) as the next implementation step, or choose otherwise.
4. Stages A and B: approve their preparation, then each plan's hash and budget (US$15 and US$9).
5. E11: build the runner support for the full sweep, or amend the programme (screening).
6. The campaign budget (§9): a further allocation of about US$60–80, or an amended programme, decided after A and B.
7. The 30-transcript review per tier: extend the review page to 30, or read the JSON.
8. Whether to widen `realistic.weekend_look`'s `mayCite` once the three extra citations are classified (§6).
9. Whether a series of runs may be approved together. Today each run needs its own hash and budget approval, about 30–36 in D.

## 12. Recommended next implementation step

1. **First, free:** the owner's `report.json` reading (§7.1). It may settle §3 outright.
2. **Then one focused PR: answer-phase diagnostics** (§7.2). It adds closed structural sub-codes for `answer.schema` and the answer call's stop in the diagnostics, with the documenting test.
   - **Unchanged:** the validator's rules, the grammar, the prompt, limits and spending.
   - **Eval rule:** it changes diagnostics only. If it touches the orchestrator, the scripted evals run on both tiers.
3. **After that:** stage A's and B's named plans (dry-run and keyless-checked), for the owner's approval.

No live evaluation, provider call, Preview Kev or real data is part of any of this until the owner approves each step.
