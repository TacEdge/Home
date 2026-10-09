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

**Architecture approved** (decisions in `docs/decisions/0001-v0.1-decisions.md`). M0 complete (ADR 0002). **M1 — Foundations** (`docs/m1/`, ADR 0003) and **M1.1 — Security & Deployment Hardening** are implemented, verified and **deployed to production, but M1 is not accepted**: the outstanding acceptance items are in `docs/runbooks/DEPLOY.md` §E. **M2 — Knowledge Core** (ADR 0005) is **complete** (`docs/m2/M2-ACCEPTANCE.md`). **M3 — Manual family data + capture** (ADR 0006, `docs/m3/M3-BUILD-CONTRACT.md`) is **code complete and audited on synthetic data** (`docs/m3/M3-ACCEPTANCE.md`); its owner acceptance waits on the restore rehearsal (DEPLOY.md §E items 7–8). **M4 — Calendar Integration** (ADR 0007, `docs/m4/M4-BUILD-CONTRACT.md`) is **technically accepted on synthetic data** (`docs/m4/M4-ACCEPTANCE.md`): Google's secret iCal address only, read-only, no real calendar connected anywhere until the real-data gate permits it (Preview holds only a throwaway account's synthetic calendar); its operational acceptance on real calendars waits on DEPLOY.md §E items 12–15. **M5 — Intelligent Today** (ADR 0008, `docs/m5/M5-BUILD-CONTRACT.md`) is **approved and in progress**: Packages 0–1 merged; Package 2 (the Today and insights engines) is in review. PRs stop when CI is green and the owner merges each one. Schema-dependent changes are **migration-first** (`docs/runbooks/MIGRATIONS.md`): the migration merges and runs in production before the code that needs it merges. **No real household data in Production until the real-data gate opens** (`HOME_REAL_DATA=open`, ADR 0006 §2): every item in `docs/runbooks/DEPLOY.md` §E, including M1 acceptance, Neon recovery and the M3 restore rehearsal, must be recorded first. Runbooks: `docs/runbooks/`.

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
14. **`/prototype` is reference only.** It must never import from `src/`, be imported by `src/`, be built, linted or deployed, or gain a database, auth, API, AI or integration. Never copy its code into `src/`. Delete it in M6; tag `m0.6-prototype` keeps it.
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

Allowed imports: `app → domain, kev, trust, ui` · `kev → domain, trust` · `domain → db, trust, lib` · `integrations → domain, lib`. Nothing imports `app`. `kev` never imports `db`. Only `src/kev/providers/*` imports an LLM SDK.

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
- Handle refusals and API errors gracefully; the rest of HOME must work without the LLM, and a user's message is always captured even if Kev fails.
- **Run the Kev eval suite (`src/kev/evals/`) against both tiers before merging any change to prompts, tools, context assembly, routing or model config.** Add a scenario for every Kev bug fixed.

## Working process

1. Confirm the task is in the current milestone and in scope. If not, say so.
2. Read the relevant docs and existing code; match its patterns.
3. Keep changes small and focused. One concern per PR.
4. Write tests with the change. Engines and visibility rules need thorough unit tests; UI flows need a Playwright happy path when they matter.
5. Before finishing: `pnpm lint`, `pnpm typecheck`, `pnpm test` (and evals when Kev changed) must pass. `pnpm verify:focused` is the routine check while working; the full `pnpm verify` is required before a PR (`docs/runbooks/LOCAL-DEV.md`).
6. Update docs when behaviour, schema or architecture changes. Record significant decisions as ADRs in `docs/decisions/`.
7. Don't build anything on the "Not yet" list in `docs/ROADMAP.md`. Don't add speculative abstractions for future domains.

## When unsure

Choose the simpler, more private, more boring option — and ask.
