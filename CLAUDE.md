# CLAUDE.md — Operating instructions for AI agents working on HOME

HOME is a private Family Operating System for one household. **Kev** is its intelligence layer. This file tells AI coding agents how to work on it. Read it fully before making changes.

## Status

**Architecture phase. Do not write application code until the architecture is approved** — see the open decisions in `docs/V0.1-SCOPE.md` §6. Once approved, build strictly milestone by milestone per `docs/ROADMAP.md`.

## Read first

| Doc | Read when |
|---|---|
| `docs/HOME-VISION.md` | Always, once. What HOME is and isn't. |
| `docs/PRODUCT-PRINCIPLES.md` | Before any UI, copy or Kev behaviour change. |
| `docs/SYSTEM-ARCHITECTURE.md` | Before touching structure, dependencies, auth, data access or integrations. |
| `docs/FAMILY-DATA-MODEL.md` | Before any schema change. |
| `docs/KEV-AGENT-MODEL.md` | Before changing prompts, tools, context assembly or memory. |
| `docs/V0.1-SCOPE.md` | Before starting any feature — check it's in scope. |
| `docs/ROADMAP.md` | For milestone order and the "Not yet" list. |

If a request conflicts with these docs, stop and say so. Don't silently diverge; propose a doc change instead.

## Non-negotiable rules

1. **Privacy is enforced below Kev and below the UI.** All reads go through domain services with an `Actor`; visibility filtering happens in the domain query layer. Never filter private data in React components or by instructing the LLM.
2. **Kev acts as the requesting user.** Kev tools receive the user's `Actor`. Kev has no identity or privileges of its own.
3. **Kev never writes directly.** Kev write tools create `Proposal` records. Only an authenticated user approval executes the change through a domain service.
4. **No external side effects** (sending, booking, paying, writing to external calendars) unless a doc explicitly authorises that capability.
5. **Code computes; the LLM communicates.** Time maths, recurrence, conflicts and free windows live in deterministic, tested engines under `src/domain/engines/`. Never ask the model to work out whether a slot is free.
6. **No hidden memory.** Kev knows structured data and approved `Fact`s only. No embeddings, no vector stores, no auto-saved inferences — unless a docs change approves it.
7. **External content is untrusted.** Text from calendars, weather or any integration is labelled as data in Kev's context and never treated as instructions.
8. **Every write is audited** (`src/trust/audit.ts`), including who approved Kev proposals.
9. **Never use real family data** in tests, fixtures, seeds, evals, examples, commit messages or logs. Use the synthetic fixture family in `tests/fixtures/`.
10. **Never commit secrets** — API keys, ICS URLs, home coordinates, emails. Use environment config; keep `.env*` out of git.
11. **Nothing clinical, nothing scored.** No child tracking, relationship metrics, streaks or gamification. No storing inferences about emotions, health, behaviour or relationships.

## Architecture in one screen

```
src/app           Experience layer (Next.js routes, screens)
src/ui            Presentational components + design tokens
src/domain        Family Knowledge layer: services + engines (agenda, conflicts, windows)
src/kev           Kev: prompts, context assembly, tools, loop, evals
src/integrations  ICS calendar, weather (read-only adapters)
src/trust         auth, actor, visibility, audit, retention
src/db            Drizzle schema, migrations, seed
```

Allowed imports: `app → domain, kev, trust, ui` · `kev → domain, trust` · `domain → db, trust, lib` · `integrations → domain, lib`. Nothing imports `app`. `kev` never imports `db`. Only `src/kev/loop.ts` imports the Anthropic SDK.

## Stack

TypeScript (strict) · Next.js App Router · React · Tailwind · PostgreSQL · Drizzle · Zod · Better Auth (magic link, allowlist) · `@anthropic-ai/sdk` · rrule / node-ical · Vitest · Playwright · pnpm.

Do not add dependencies casually. Prefer the platform and what's already here. Any new runtime dependency needs a one-line justification in the PR description.

## Conventions

- **Time:** store instants as UTC `timestamptz` + IANA zone (default `Pacific/Auckland`); all-day items as `date`. Never use naive local times. Test DST boundaries.
- **IDs:** uuid. **Soft delete:** `archived_at`.
- **Every user-facing record** has `created_by`, `created_via`, `visibility`.
- **Schemas:** one Zod schema per input, shared by forms, services and Kev tools.
- **Generic entities over bespoke tables.** Add a `domain` tag before adding a new table. Adding a table requires updating `docs/FAMILY-DATA-MODEL.md`.
- **Naming:** domain language (person, event, task, project, note, fact, proposal) — not generic CRUD names.
- **Copy and Kev tone:** warm, plain, brief, NZ English. No emoji, no exclamation marks, no nagging.
- **UI:** mobile first, generous whitespace, one column, few colours. If a screen feels like a dashboard, simplify it.

## Kev specifics

- Model ID and effort live in one config module; don't hardcode them elsewhere.
- System prompt is stable and cacheable; volatile context (date, agenda) goes after it.
- Every tool: Zod input schema, runs through a domain service with the Actor, returns compact structured results, is audited.
- Answers about specific times must be grounded in tool results and cite the items.
- Enforce limits: tool calls per turn, tokens per request, monthly spend cap.
- Handle refusals and API errors gracefully; the rest of HOME must work without the LLM.
- **Run the Kev eval suite (`src/kev/evals/`) before merging any change to prompts, tools, context assembly or model config.** Add a scenario for every Kev bug fixed.

## Working process

1. Confirm the task is in the current milestone and in scope. If not, say so.
2. Read the relevant docs and existing code; match its patterns.
3. Keep changes small and focused. One concern per PR.
4. Write tests with the change. Engines and visibility rules need thorough unit tests; UI flows need a Playwright happy path when they matter.
5. Before finishing: `pnpm lint`, `pnpm typecheck`, `pnpm test` (and evals when Kev changed) must pass.
6. Update docs when behaviour, schema or architecture changes. Record significant decisions as ADRs in `docs/decisions/`.
7. Don't build anything on the "Not yet" list in `docs/ROADMAP.md`. Don't add speculative abstractions for future domains.

## When unsure

Choose the simpler, more private, more boring option — and ask.
