# CLAUDE.md — Operating instructions for AI agents working on HOME

HOME is a private Family Operating System for one household. **Kev** is its intelligence layer. This file tells AI coding agents how to work on it. Read it fully before making changes.

## The HOME trust model

Every Kev capability — now and in the future — follows this sequence. Nothing skips a step.

```
OBSERVE → UNDERSTAND → RECOMMEND → HUMAN APPROVAL → ACT
```

Two companion principles:

- **Code computes; Kev explains.** Deterministic engines calculate time, availability, conflicts, weather windows and permissions. The LLM reasons over their results and communicates. It never invents them.
- **Capture first; organise second.** What people tell HOME is stored verbatim immediately; structure is proposed afterwards and approved.
- **Insight, not interruption.** HOME notices useful things and shows them when someone looks. Insights are derived deterministically; Kev explains and prioritises. No push notifications without an explicit decision.

When designing any agent behaviour, identify which step of the trust model it belongs to. If it would act without human approval, it needs an explicit, documented decision first (see autonomy tiers in `docs/KEV-AGENT-MODEL.md`).

## Status

**Architecture approved** (decisions in `docs/decisions/0001-v0.1-decisions.md`). M0 complete (ADR 0002). **M1 — Foundations** (`docs/m1/`, ADR 0003) and **M1.1 — Security & Deployment Hardening** are implemented, verified and **deployed to production, but M1 is not accepted**: the outstanding acceptance items are in `docs/runbooks/DEPLOY.md` §E. **M2 — Knowledge Core** (ADR 0005) is **complete** (`docs/m2/M2-ACCEPTANCE.md`). **M3 — Manual family data + capture** (ADR 0006, `docs/m3/M3-BUILD-CONTRACT.md`) is **code complete and audited on synthetic data** (`docs/m3/M3-ACCEPTANCE.md`); its owner acceptance waits on the restore rehearsal (DEPLOY.md §E items 7–8). **M4 — Calendar Integration** (ADR 0007, `docs/m4/M4-BUILD-CONTRACT.md`) is **technically accepted on synthetic data** (`docs/m4/M4-ACCEPTANCE.md`): Google's secret iCal address only, read-only, no real calendar connected anywhere until the real-data gate permits it (Preview holds only a throwaway account's synthetic calendar); its operational acceptance on real calendars waits on DEPLOY.md §E items 12–15. **M5 — Intelligent Today** (ADR 0008, `docs/m5/M5-BUILD-CONTRACT.md`) is **technically accepted on synthetic data** (`docs/m5/M5-ACCEPTANCE.md`): its operational acceptance on real family use waits on DEPLOY.md §E items 16–17. **M6 — Forward Coordination** (ADR 0009, `docs/m6/M6-BUILD-CONTRACT.md`) is **technically accepted on synthetic data** (`docs/m6/M6-ACCEPTANCE.md`; Packages 0–5 merged, PRs #59, #60 and #65–#69): its operational acceptance on real family use waits on DEPLOY.md §E items 18–19. **M7 — Weather and Free Windows** (ADR 0011, `docs/m7/M7-BUILD-CONTRACT.md`) is **technically accepted on synthetic data** (`docs/m7/M7-ACCEPTANCE.md`; Packages 0–5 merged, PRs #70–#72, #75, #76 and #78–#80; migration `0008_weather_forecast` run in Production and Preview): its operational acceptance waits on DEPLOY.md §E items 20–22. No home location or location key is set in Production until the real-data gate opens (contract §7). **M8 — Kev Intelligence** (ADR 0012, `docs/m8/M8-BUILD-CONTRACT.md`): **Packages 0, 1 (1a, 1b), 2 and 3 merged (PRs #81–#84, #86), migration `0009_kev_budget_reservation` run in Production and Preview; Package 4 (the Kev screen, its turn route, the entry points and Settings › Usage) merged (PR #87), its Preview gates (G3, G4, G16 on Neon, G17) not verified; the controlled live-verification plan is `docs/m8/M8-LIVE-VERIFICATION-PLAN.md` (approved by the owner 2026-10-16, with a US$10 first-session allocation approved but not its execution; nothing in it has run); its live verification runner (`docs/runbooks/KEV-LIVE-VERIFY.md`, ADR 0012 §49) runs only by the owner's approved dispatch; **live verification #1 ran 2026-10-17** (synthetic, the evaluation key only, HOME recorded US$0.14, `docs/m8/M8-LIVE-LEDGER.json`; Anthropic's bill not reconciled): G1 and G20 passed, G8 recorded, and every tool-carrying probe was refused at the preflight count (HTTP 400, Kev's strict tool schemas; corrected in ADR 0012 §50), so G7, G19, G9, G21 and G22 on Kev's request shape are not verified; **live verification #2 ran 2026-10-17** (the reduced plan, ADR 0012 §51; HOME recorded US$0.778283, its exact report figure, `docs/m8/M8-LIVE-LEDGER.json`; Anthropic's bill not reconciled): G1 passed and G19's live evidence passed, but the first Messages API call of G7 (all three models) and the G9/G21 turn was refused with HTTP 400 after a 200 count, cause not established, so G7, G9, G21 and G22 are not verified; provider error diagnostics (structural category and request id everywhere, recognised parameter paths in the runner only) were added so the next failure is readable (ADR 0012 §52); a focused tool-use diagnostic plan (ADR 0012 §53) was built; **live verification #3 ran 2026-10-18** (the diagnostic; HOME recorded US$0.160675, the owner's figure, `docs/m8/M8-LIVE-LEDGER.json`; Anthropic's bill not reconciled): strict tools are accepted under `tool_choice: auto` without the answer format and refused with it (HTTP 400, grammar compilation), so Kev's turn now runs in two phases (ADR 0012 §54, owner-approved): reads under `auto` without the format, the answer under `none` with it; G7 is revised to that; **live verification #4 ran 2026-10-18** (the `two-phase-acceptance` plan; HOME recorded US$0.088801, owner-supplied, `docs/m8/M8-LIVE-LEDGER.json`; Anthropic's bill not reconciled): one orchestrated fast turn passed with five calls, two tool rounds, a regeneration and one validated citation, so G7 (revised) passes on fast and G10 for the calls made, while G9 (the organisation's creation date unrecorded), G21 (thinking evidence unread), the complete G22 (its count comparison unread), deep and the Preview gates are not verified (ADR 0012 §55); **Package 5 (evaluation and tuning)**: its plan is approved in principle (`docs/m8/M8-PACKAGE-5-PLAN.md`, PR #96). **5A (evaluation instrumentation) is built** (ADR 0012 §56). It adds: Kev's stored answer check and `kev_turn` fields (first pass, after regeneration, after escalation, salvage, fallback; closed codes only); the shared checker and §12.3 summary; and the runner's US$175 `evaluation` plans of scenario probes, which stop before any live call until 5B gives the runner the evaluation fixture and turn pacing. The session plan's hash is now `d08a3713…`. **5B (evaluation scenarios and controlled execution) is built** (ADR 0012 §57, `docs/m8/M8-EVAL-SCENARIOS.md`): 113 scenarios (124 turns, 62 adversarial) meeting every §12.2 minimum; one evaluation world for both layers; evaluation plans run live in the runner's own database, paced within HOME's per-adult limits, with a 35-minute wall clock; no evaluation plan is named (5D) (PR #98). **5C (product quality evaluation) is built** (ADR 0012 §58, `docs/m8/M8-QUALITY-RUBRIC.md`): the seven-dimension rubric (no threshold added); readable synthetic transcripts of every run, kept only in the evaluation's own outputs (rejected answers as closed codes only); the owner's twenty-scenario review page and review-sheet summary, keeping automated and human results apart; the scripted baseline (`docs/m8/M8-QUALITY-BASELINE.md`), which is not model evidence (PR #99). **5D (the deep smoke run) is prepared** (ADR 0012 §59); **live verification #5 (2026-10-18) was refused before reaching Opus** (`turn_in_flight`, zero calls, HOME recorded US$0.00, `docs/m8/M8-LIVE-LEDGER.json`): an evaluation-world defect, its fixture conversation reading as a turn in flight on the real clock, corrected in the fixture with no change to the plan or its hash (ADR 0012 §60). The session plan is `deep-smoke`: one live Opus turn on `realistic.weekend_look`, with smoke checks (Opus on every call, a tool round then the answer phase, an accepted cited answer). It has a maximum of US$1.50, a proposed budget and cap of US$1.67, and plan hash `47710b79…` (`PLAN_VERSION` 6). A new run needs the owner's fresh approval of the hash and budget and their dispatch; no deep gate changes status until then. G9, G21 and the complete G22 from LV#4 stay NOT VERIFIED until the owner reads `report.json` before 2026-11-17 and records the organisation's creation date. No live evaluation has run; no provider key in any deployed environment; Kev off**. Package 1b's verification gates are in the contract's gate register (§5.7). No provider key is set anywhere, and Kev stays off in Production until the real-data gate opens and M8's DEPLOY.md §E items 23–28 are recorded, including the owner's separate real-data privacy decision (item 24), which neither the gate nor zero data retention replaces; Kev is switched on at item 29. PRs stop when CI is green and the owner merges each one. Schema-dependent changes are **migration-first** (`docs/runbooks/MIGRATIONS.md`): the migration merges and runs in production before the code that needs it merges. **No real household data in Production until the real-data gate opens** (`HOME_REAL_DATA=open`, ADR 0006 §2): `docs/runbooks/DEPLOY.md` §E items 1–10, including M1 acceptance, Neon recovery and the M3 restore rehearsal, must be recorded first; the later milestones' real-use items (14–19, 21–22, 29–31) follow the gate (§E's introduction lists both). Runbooks: `docs/runbooks/`.

## Read first

| Doc | Read when |
|---|---|
| `docs/HOME-VISION.md` | Always, once. What HOME is and isn't. |
| `docs/PRODUCT-PRINCIPLES.md` | Before any UI, copy or Kev behaviour change. |
| `docs/BRAND.md` | Before any UI change: the identity (wordmark, colour tokens, type, icons) and its rules. |
| `docs/SYSTEM-ARCHITECTURE.md` | Before touching structure, dependencies, auth, data access or integrations. |
| `docs/FAMILY-DATA-MODEL.md` | Before any schema change. |
| `docs/KEV-AGENT-MODEL.md` | Before changing prompts, tools, context assembly or memory. |
| `docs/V0.1-SCOPE.md` | Before starting any feature — check it's in scope. |
| `docs/ROADMAP.md` | For milestone order and the "Not yet" list. |
| `docs/concepts/` | Before building any screen — the agreed experience concepts. |
| `docs/decisions/` | ADRs; check before revisiting a settled decision. |
| `docs/m1/` (and later `docs/mN/`) | The build contract for the current milestone. |

If a request conflicts with these docs, stop and say so. Don't silently diverge; propose a doc change instead.

## Non-negotiable rules

1. **Privacy is enforced below Kev and below the UI.** All reads go through domain services with an `Actor`; visibility filtering happens in the domain query layer. Never filter private data in React components or by instructing the LLM.
2. **Kev acts as the requesting user.** Kev tools receive the user's `Actor`. Kev has no identity or privileges of its own.
3. **Kev never writes directly.** Kev write tools create `Proposal` records. Only an authenticated user approval executes the change through a domain service. The single exception is `capture`, which stores the current user message verbatim as a private `Capture` — it takes no content argument, so Kev cannot author what is stored.
4. **No external side effects** (sending, booking, paying, writing to external calendars) unless a doc explicitly authorises that capability.
5. **Code computes; the LLM communicates.** Time maths, recurrence, conflicts and free windows live in deterministic, tested engines under `src/domain/engines/`. Never ask the model to work out whether a slot is free.
6. **No hidden memory.** Kev knows structured data and approved `Context` records only. Context is dated, sourced and can go stale — never treat it as permanently true. `sensitive` context is never auto-included in Kev's context and never proposed by Kev. No embeddings, no vector stores, no auto-saved inferences — unless a docs change approves it.
7. **External content is untrusted.** Text from calendars, weather or any integration is labelled as data in Kev's context and never treated as instructions.
8. **Every write is audited** (`src/trust/audit.ts`), including who approved Kev proposals.
9. **Never use real family data** in docs, tests, fixtures, seeds, evals, examples, screenshots, commit messages or logs. Use the synthetic fixture family (defined in `docs/concepts/README.md`, later `tests/fixtures/`). Real household data exists only in the database and private configuration.
10. **Never commit secrets** — API keys, ICS URLs, home coordinates, emails. Use environment config; keep `.env*` out of git.
11. **Nothing clinical, nothing scored.** No child tracking, relationship metrics, streaks or gamification. No storing inferences about emotions, health, behaviour or relationships. Person profiles are lightweight context, never development records.
12. **Kev is channel-agnostic.** All conversation goes through `kev.handle()` in `src/kev/orchestrator.ts`, which emits structured `KevEvent`s. No UI, HTTP or audio concerns inside Kev; no Kev logic inside UI code. Voice will be an adapter, not a rewrite.
13. **Integrations sit behind HOME-defined interfaces.** Calendar access goes through `CalendarProvider`; ICS is one adapter. Never let a provider's shape leak into domain entities.
14. **The M0 prototype is retired.** `/prototype` was deleted in M6 Package 1; the tag `m0.6-prototype` keeps it for reference. Never restore it into the repository, and never copy its code into `src/`; the agreed experience lives in `docs/concepts/`.
15. **Insights are derived, not stored.** Detectors in `src/domain/engines/insights/` are pure and tested; every insight carries its source facts and template text. Kev may rephrase and reorder, never invent. Only dismissals persist (`insight_response`). Screens never wait on the LLM.
16. **This household only.** Don't build or prepare multi-household/SaaS structures.

## Architecture in one screen

```
src/app           Experience layer (Next.js routes, screens)
src/ui            Presentational components + design tokens
src/domain        Family Knowledge layer: services + engines (recurrence, agenda, conflicts, windows, profile, staleness, insights)
src/kev           Kev: orchestrator, router, providers, prompts, context assembly, tools, evals
src/integrations  calendar (CalendarProvider + ics adapter), weather — read-only
src/trust         auth, actor, visibility/sensitivity, audit, usage, retention
src/db            Drizzle schema, migrations, seed
```

Allowed imports: `app → domain, kev, trust, ui` · `kev → domain, trust, lib` · `domain → db, trust, lib` · `integrations → domain, lib`. Nothing imports `app`. `kev` never imports `db`. Only `src/kev/providers/anthropic.ts` imports an LLM SDK.

## Stack

TypeScript (strict) · Next.js App Router · React · Tailwind · PostgreSQL · Drizzle · Zod · Better Auth (magic link, allowlist) · `@anthropic-ai/sdk` · rrule / node-ical · Vitest · Playwright · pnpm.

Do not add dependencies casually. Prefer the platform and what's already here. Any new runtime dependency needs a one-line justification in the PR description.

## Conventions

- **Time:** store instants as UTC `timestamptz` + IANA zone (default `Pacific/Auckland`); all-day items as `date`. Never use naive local times. Test DST boundaries.
- **IDs:** uuid. **Soft delete:** `archived_at`.
- **Every user-facing record** has `created_by`, `created_via`, `visibility`.
- **Schemas:** one Zod schema per input, shared by forms, services and Kev tools.
- **Generic entities over bespoke tables.** Add a `domain` tag before adding a new table. Adding a table requires updating `docs/FAMILY-DATA-MODEL.md`.
- **Naming:** domain language (person, event, task, project, note, context, capture, proposal) — not generic CRUD names.
- **Organised records** keep `origin_capture_id` when they came from a capture.
- **Copy and Kev tone:** warm, calm, concise, natural NZ English. Kev is perceptive, understated and occasionally playful — never nagging, corporate or over-enthusiastic. Emoji extremely sparingly; exclamation marks rarely. See the personality spec in `docs/KEV-AGENT-MODEL.md`.
- **UI:** mobile first, generous whitespace, one column, few colours. If a screen feels like a dashboard, simplify it. Colour and type come only from the tokens in `src/ui/tokens.css` (`docs/BRAND.md`): one warm accent for "needs you", nothing red, fonts self-hosted.

## Kev specifics

- **Model routing:** code asks for a tier (`fast` | `deep`), never a model. Tier → model/effort mapping lives only in `src/kev/config.ts`; the router is `src/kev/router.ts`. A turn never mixes models; escalation re-runs the turn on `deep`. Every run is logged to `kev_usage`.
- Transcripts are stored in HOME's provider-neutral format; never persist or replay raw provider-specific blocks across turns.
- Responses lead with a short, speakable `say` sentence; proposals carry a speakable summary.
- System prompt is stable and cacheable; volatile context (date, agenda) goes after it.
- Every tool: Zod input schema, runs through a domain service with the Actor, returns compact structured results, is audited.
- Answers about specific times must be grounded in tool results and cite the items.
- Enforce limits: tool calls per turn, tokens per request, monthly spend cap.
- Handle refusals and API errors gracefully; the rest of HOME must work without the LLM, and a user's message is always captured even if Kev fails. *(M8, ADR 0012 §24, D6: read "always **stored**": the person's words are stored in their own conversation before any model call, with **Keep in To sort** beside them where Kev could not answer; M9's capture tool restores capture.)*
- **Run the Kev eval suite (`src/kev/evals/`) against both tiers before merging any change to prompts, tools, context assembly, routing or model config.** Add a scenario for every Kev bug fixed.

## Working process

1. Confirm the task is in the current milestone and in scope. If not, say so.
2. Read the relevant docs and existing code; match its patterns.
3. Keep changes small and focused. One concern per PR.
4. Write tests with the change. Engines and visibility rules need thorough unit tests; UI flows need a Playwright happy path when they matter.
5. Verify by risk, not by habit (`docs/runbooks/LOCAL-DEV.md`, "Verification policy"). While working: `pnpm verify:focused` or the changed files' own tests, with lint and typecheck. Before a PR: `pnpm lint`, `pnpm typecheck`, the focused tests for what changed, `pnpm build` where relevant, the Kev evals when Kev changed, and `node scripts/ci-select.mts <paths>` for the risk tier. CI owns the full regression whenever the classifier requires it; unmapped or high-risk changes escalate (it fails closed). Don't routinely duplicate full local verification and CI. A full local suite needs a documented reason (such as reproducing a specific CI failure) and runs under `timeout 20m`; a timeout is INCOMPLETE, never PASS. Before interrupting a run, inspect its process and progress. Never weaken required CI or branch protection to gain speed.
6. Update docs when behaviour, schema or architecture changes. Record significant decisions as ADRs in `docs/decisions/`.
7. Don't build anything on the "Not yet" list in `docs/ROADMAP.md`. Don't add speculative abstractions for future domains.

## When unsure

Choose the simpler, more private, more boring option — and ask.
