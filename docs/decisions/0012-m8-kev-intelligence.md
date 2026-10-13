# ADR 0012 — M8 Kev Intelligence: scope, architecture and decisions

Status: **Proposed**, 2026-10-13 (Package 0, awaiting the owner's merge). The contract is `docs/m8/M8-BUILD-CONTRACT.md`. Decisions marked "Proposed — owner decision D*n*" are listed, with their options, in contract §19.2. **The owner decided O1–O6 on 2026-10-13** (§39): D2, D3, D13 and D19 are marked "Decided by the owner"; the register in §40 gives every decision's status. This ADR is accepted, as amended by those decisions and the review amendments the owner approved the same day, when the owner merges Package 0.

- **Implementation:** nothing built. No provider account, key, dependency, secret, migration or scheduled job exists for Kev. Package 1a (the budget reservation migration) starts only after Package 0 merges and the owner says to start.

## Context

M7 is technically accepted on synthetic data (`docs/m7/M7-ACCEPTANCE.md`; Packages 0–5 merged, PRs #70–#72, #75, #76 and #78–#80). The milestones before it are still waiting on owner steps in DEPLOY.md §E:

| Milestone | Waits on |
|---|---|
| M7 operational acceptance (real family use) | Items 20–22 |
| M6 operational acceptance | Items 18–19 |
| M5 operational acceptance | Items 16–17 |
| M4 operational acceptance | Items 12–15 |
| M3 owner acceptance (the restore rehearsal) | Items 7–8 |
| M1 acceptance | Items 1–6 |

The Production real-data gate is closed (ADR 0006 §2).

The ROADMAP M8 row commits M8 to: *"`kev.handle()` orchestrator emitting `KevEvent`s; web channel adapter (streaming, dictation-friendly); model router (fast/deep + escalate) and provider adapter; context assembly incl. profiles and staleness; read tools incl. `get_insights`; cached Kev phrasing and prioritising of Today's insights; citations; limits, usage log and spend cap; first evals in CI against both tiers."* Earlier decisions moved more into it:

- **Kev's transcript and usage recording** (ADR 0005 §39; ADR 0006 §12), which needs "an explicit decision … not a silent relaxation";
- **NZD conversion for the spend cap** (ADR 0005 §15);
- **the Kev bar, Kev phrasing, "Tell me about today" and `get_insights`** (ADR 0008 §3), and Forward's Kev items, "M8–M10" (ADR 0009 §3);
- **Kev's tools over M7's engines, in M7's language** (ADR 0011 §3; KEV-AGENT-MODEL §6's M7 note);
- **`search`**, which "arrives with Kev" (M2 contract §1.2), and **Usage in Settings** (V0.1-SCOPE D4).

**What exists, and what M8 must reconcile with:**

- **No Kev code exists.** There is no `src/kev/`, no SDK dependency, no provider key, no eval harness. The ESLint rules already confine an LLM SDK to `src/kev/providers/*`, and `src/kev/` is already a high-risk path in the CI classifier.
- **The bookkeeping exists but refuses Kev.** `conversation`, `message` and `kev_usage` and their services (M2) refuse any `via: 'kev'` actor (`kev_cannot_write`) and are gated in Production. Without a decision, Kev cannot store its transcript or record usage, so the spend cap cannot be enforced.
- **Sensitive context:** ADR 0005 §37 says "Kev and the system may never request or receive sensitive context"; the context service refuses it and a static test guards it. KEV-AGENT-MODEL §6's `get_context(subject?, include_sensitive?)` says otherwise.
- **Availability:** M5–M7 never say anyone is free or available and never say "best" (ADR 0008 §5; ADR 0011 §5–§7), because a stretch one adult sees as empty may hold the other adult's private commitment. KEV-AGENT-MODEL's `find_free_windows` ("ranked by fit"), its "recommend one window" and "Find us a night out", KEV.md's "Saturday, 9 till 12, looks best." and "Alex … is free", TODAY.md's "Alex is free from 2:30" and V0.1-SCOPE's "free-window recommendations" all say what M7 decided screens may not. ADR 0011 §7 left "Kev's recommendations, if any" to M8.
- **Phrasing on Today:** the roadmap's cached phrasing conflicts with "insights are derived, not stored" (CLAUDE.md rule 15), the "Not yet" persistent insight subsystem, and "Today never waits for, and never visibly changes because of, Kev" (TODAY.md §5).
- **Capture on failure:** CLAUDE.md says "a user's message is always captured even if Kev fails", but the capture tool is M9's, and the capture bar reads "Tell HOME something…" "until Kev arrives in M8" (ADR 0006 §11).
- **The shared agenda loader** is in `src/app/_agenda/`, which `kev` may not import.
- **`get_conflicts`** in KEV-AGENT-MODEL promises "both adults away"; the engine has only `conflict.overlap` and `conflict.responsible` (ADR 0009).
- **The home location** is in KEV-AGENT-MODEL §4's context list, but M7 keeps it in private configuration, sent only to the weather provider.
- **"First evals in CI against both tiers"** meets ADR 0010's four fixed required checks and a CI that must not depend on a live model or a secret.
- **The owner's brief** asks for a foundation that can grow into a proactive, goal-directed "chief of staff", and to "reserve authorised execution for M9". The roadmap's M9 is "capture + propose"; external execution is V0.5 at the earliest and "Not yet" today.

**Provider research** (2026-10-13; contract §5): the Anthropic API's Commercial Terms forbid training on customer content (verified); the default retention period is stated two ways by official pages (not retained by default; deleted within 30 days), flagged content may be kept up to 2 years, classification scores up to 7 years (verified from search only), and zero data retention is available by request, provable only by the contract or the account team (verified); inference runs `global` or `us`, never in New Zealand or Australia, with `us` costing 1.1× on every token category (verified). Prices were verified on the pricing page on 2026-10-13 (contract §5.3). Claude on Bedrock offers Australian cross-region inference, with the 5.5 tiers' availability not confirmed. The Privacy Act's s 11 likely treats a no-training processor as not a disclosure, and s 27 very likely covers a household system (verified from search only; not legal advice). A focused review of Package 0 on the same day found no reason to redesign, corrected two figures, and proposed the amendments the owner approved (§39).

## Decisions

### Scope

1. **M8 is a read-only Kev.** An adult asks about what HOME holds and gets a short answer grounded in the records they can see, with those records shown. Kev reads through tools, as the adult, and explains; code computes and checks. Nothing in M8 creates, changes or schedules a record, sends anything, remembers anything new, or runs without being asked. Today and Forward are unchanged and never wait for Kev.

2. **M8 builds** (contract §1.3):
   - a provider gateway: `KevProvider`, the Anthropic adapter (the only SDK import), a scripted provider, HOME's network policy for the provider, tiers, router and limits (§13–§14);
   - a hard household spend cap: a reservation of each attempt's maximum exposure under a lock, persisted in one new table (§35);
   - a named bookkeeping path for Kev's transcript, usage and reservations (§25), and the daily retention cleanup of expired messages (§23);
   - twelve read tools and `escalate` (§17), after moving the agenda loader into the domain (§20);
   - `kev.handle()`: context assembly, a bounded tool loop, escalation, a structured answer and a deterministic grounding check (§8–§11);
   - the Kev screen, its entry points and Settings › Usage (§32–§33);
   - a four-layer evaluation, with live runs outside the required checks (§34).

3. **M8 does not build** the following:

   | Item | Why, or where it goes |
   |---|---|
   | The capture tool, triage, proposal tools, approval cards, "Sort it" | M9 (§5) |
   | Any write by Kev to family data | M9 proposals, executed on the adult's approval |
   | Any external action: send, book, buy, calendar write | V0.5 at the earliest; ROADMAP "Not yet" |
   | New memory of any kind | §22; ROADMAP "Not yet" |
   | Availability, "best", recommendations of a time | §7 |
   | Sensitive context for Kev | §26 |
   | Kev phrasing of Today's insights | §31 |
   | Background runs, Kev on a schedule, notifications | §30; ROADMAP "Not yet". The one scheduled job is the owner-approved retention cleanup (§23), which is not Kev |
   | Specialist agents, a second model in a turn, the SDK's Tool Runner, hosted agents, server-side tools | §10, §13 |
   | Week Ahead, sheets, the Kev panel, Forward long-press, PWA | M10 |
   | Voice | V0.5; keyboard dictation only |
   | Children as users | §29 |
   | Real data, or a key in Production before the gate | §37 |

4. **One migration, migration-first.** The hard spend cap needs a persisted reservation (§35): Package 1a adds `kev_budget_reservation` and `kev_usage.attempt_id`, merged and run in Production and Preview before the code that uses them (MIGRATIONS.md); proposed in FAMILY-DATA-MODEL, no schema change now. Otherwise nothing changes: `message.content` is checked in the database only as an object with a numeric `v`, so content v2 is an application schema; retention runs on `message.created_at`; rate limits count append-only `audit_log` rows; `home_app` already has `DELETE` on `message`. One new runtime dependency, `@anthropic-ai/sdk`, pinned. If a package finds another migration necessary, it becomes its own migration-only package first.

5. **M9 executes only inside HOME.** Proposed — owner decision D21. The owner's brief asks to reserve "authorised execution" for M9. The roadmap's M9 is "capture + propose": the capture tool, triage, proposal tools and approval cards. An approved proposal is executed by the internal executor HOME has had since M2, which is authorised execution of internal changes. Nothing outside HOME is executed in M9; external actions stay V0.5 and "Not yet", each needing its own ADR. This is recorded as the honest reading of the brief, not a change to the roadmap's milestone definitions.

### What Kev may say

6. **Facts and Kev's view** (contract §8.2). ADR 0008's four layers hold. A **fact** restates what a tool returned and cites it. **Kev's view** is layer 4, "always labelled as Kev's": an interpretation over cited facts, shown under a **Kev's view** label, which may not add a time, date, name, number or record its citations do not carry. Layer 3, inferred meaning about need, availability, stress or intent, is never shown, as a fact or as a view. Kev may discuss a plan; it never presents an unrecorded plan as made.

7. **Availability, recommendations and names.** Proposed — owner decision D8.
   - Kev inherits M7's semantics: a stretch is "nothing is recorded", for a scope and span, and code adds M7's limit sentence ("This is only what HOME has recorded that you can see. It isn't a check of anyone's plans.") whenever an answer cites one.
   - Kev may lay out options with their facts, and say as its view which stretch matches what a task records. It never says anyone is free, available or able, and never names "the best", "ideal" or "a good" time.
   - `find_free_windows` becomes **`get_gaps`**, named for what it returns; it never ranks by fit.
   - **Superseded for M8** (annotated, not rewritten): KEV.md's "Saturday, 9 till 12, looks best." and "Alex finishes at 2:30 and is free until swimming at 3:30.", TODAY.md's "Alex is free from 2:30.", KEV-AGENT-MODEL §6's "recommend one window" and "Find us a night out" for both adults, and V0.1-SCOPE's "free-window recommendations always valid", which becomes "stretches where nothing is recorded, always the gap engine's".

8. **Answers are checked by code before anyone sees them** (contract §8.3). The model returns a structured answer (`say`, then up to six `fact` or `view` blocks, each with citations) or a closed decline code that code renders from a fixed template. A pure validator checks it against the turn's **ledger** (every record the tools returned in this attempt, and the context bundle): unknown or missing citations, times, dates, numbers and names that do not match their citations, forbidden phrases, conflicts the engine did not find, availability claims, unqualified gaps, unrecorded commitments, claims to have acted, markup and links, a view as the lead sentence, filler, and any sensitive string. A failure gets one regeneration naming the failed rules; a second failure gets the safe fallback, "I can't answer that reliably right now. Here's what HOME has that I looked at.", with the ledger's records by template. Code also appends, and the model cannot remove: the limit sentence for gaps, "As far as HOME knows." for stale calendars, and the forecast's time and credit.

9. **Language.** M5's (§8.1), M6's (§5.5) and M7's (§5.8) forbidden-phrase lists apply to everything Kev says, as whole words, with recorded titles and names exempt. Kev adds claims of action or memory, certainty about people, and words about feelings, health and behaviour (contract §8.6). Decline templates and HOME's own error strings are code, reviewed and tested; their "can't" is about Kev itself, the only exemption. A rejected innocent sentence costs a regeneration, not a wrong answer; a word leaves a list only by owner decision.

### Architecture

10. **One model per turn, with a HOME-owned, bounded tool loop.** Proposed — owner decision D1.
    - **Options** (contract §4.1): (A) one model and a fixed bundle, rejected: it sends the most data and answers least; **(B) one model per turn calling HOME's read tools in a loop HOME controls, chosen**; (C) an orchestrator with specialist agents, rejected for M8: more calls, contexts and failure modes for the same answers.
    - The loop is HOME's code, not the SDK's beta Tool Runner or a hosted agent service: HOME counts and caps every call, binds every tool to the actor, records the trace and validates the answer, and a framework running the loop would hide all four.
    - A turn never mixes models; escalation discards the fast attempt and re-runs the turn on deep (KEV-AGENT-MODEL §5).

11. **The turn and its events** (contract §4.2, §4.4).
    - The order: guards (on, gate, limits); store the person's words under the conversation row lock (one turn at a time, atomic); route; reserve the attempt's maximum exposure under the budget lock; assemble; the loop (at most three tool rounds, eight tool calls, five model calls including one regeneration and any retry, 32,000 input tokens per call); validate; settle the attempt's per-call usage; store the answer.
    - **Time:** a 55-second user-facing deadline inside a 90-second `maxDuration`; each call's timeout is the smaller of its tier's and the time left minus 5 seconds; no fast call starts with under 8 seconds left, no deep call with under 20; escalation only with at least 30 seconds left.
    - **Escalation** is model-initiated (`escalate`, closed reasons) or code-initiated (the validator failing twice on fast), only with time left and the month under 80%; otherwise the safe fallback.
    - **Within an attempt the request is append-only:** assistant content, thinking blocks and signatures replayed verbatim from the wire; nothing already sent edited, truncated or removed (a tool result is truncated, if at all, before it is first sent); the system prompt and tool list fixed at the attempt's start; "answer with what you have" as `tool_choice: none`; the regeneration note appended (contract §4.2, N15).
    - **No database transaction is held across a model call:** the guard and message, the reservation, the settlement and the Kev message are each one short transaction.
    - `KevRequest` gains `now` (from the adapter's time source); `conversationId` is resolved from the actor, never taken from the client.
    - `KevEvent` gains `working` (fixed progress strings) and `detail` becomes structured blocks; `error` carries a closed code. `captured` and `proposal` stay for M9 and are never emitted.

12. **Seams kept for later, and nothing built on them** (contract §4.5; Appendix A): the tool registry (every tool declares an authority class from an enum that already names `propose`; only `read` is permitted in M8 and the registry refuses `propose` and anything else); `KevProvider` over provider-neutral messages; the `KevEvent` stream; actor binding (every tool runs as the requesting adult); the per-attempt budget object and a trace with stable attempt ids and per-call usage. Future workflow or task state lives in HOME's own tables, never in model reasoning or thinking blocks.

### Provider

13. **The Anthropic API, first party; tiers by evidence.** **Decided by the owner, 2026-10-13 (O5; O4 deferred to Package 5)** — owner decision D2.
    - Through `@anthropic-ai/sdk` behind `KevProvider`, called only from the server. Tier → model and effort only in `src/kev/config.ts`.
    - **Deep:** `claude-opus-5-5`, effort `medium`, `max_tokens` 8,192.
    - **Fast:** `claude-sonnet-5-5`, effort `medium`, `max_tokens` 4,096, to start: the owner's quality-first preference on the approved initial mapping (ADR 0001 D4). Package 5 sweeps `low` (adopted only within 2 points of `medium` on correctness and first-pass rate) and evaluates `claude-haiku-5-5` before any substitution; Haiku 5.5 is adopted only if it meets every hard gate and measured target, privacy, injection and grounding included; cost alone is not a reason. Model ids and capabilities are verified against current documentation and the Models API in Package 1 (contract §5.7, G1).
    - **Model ids are pinned snapshots,** dateless ones included (verified, models overview, 2026-10-13); `config.ts` records each model's retirement-not-before date (September–October 2027), and a model review is planned before then.
    - **A deep re-ask the adult asks for** ("Take a closer look") is not built; it is decided with Package 5's escalation-recall evidence (O4).
    - **Not `claude-fable-5-1`:** it requires 30-day retention and is not available under zero data retention without express authorisation; it costs 2.5 times Opus 5.5.
    - Tool use with `strict: true` and `tool_choice: auto`; the answer as structured output (or a strict answer tool if structured output does not compose with tools on a tier, checked in Package 1); no personal data in any JSON schema, because schemas are cached by the provider for up to 24 hours without message content's protections.
    - Refusals end the attempt plainly; the server-side `fallbacks` parameter is not used, since it would switch models within a turn, would retry only some refusal categories, and does not exist for Haiku 5.5. Package 5 records the refusal rate per tier. Thinking is replayed verbatim within an attempt and never stored or replayed across turns. The cached prefix (tools and system prompt) holds no personal data.
    - **Prices, verified (pricing page, 2026-10-13),** US$ per MTok, input / 5-minute cache write / 1-hour cache write / cache hit / output: Opus 5.5 4 / 5 / 8 / 0.20 / 20; Sonnet 5.5 2 / 2.50 / 4 / 0.10 / 10; Haiku 5.5 0.10 / 0.125 / 0.20 / 0.01 / 0.50 for prompts ≤ 100K tokens (0.50 / 0.625 / 1 / 0.05 / 2.50 above). `inference_geo: "us"` multiplies every category by 1.1, and every cost HOME computes includes it.

14. **HOME's network boundary and key** (contract §5.4).
    - Every SDK request goes through HOME's own fetch: `https://api.anthropic.com` exactly, two paths, public addresses checked at connect time, no redirects, 1 MiB requests and 2 MiB responses, per-call and idle timeouts, closed error codes, nothing logged. Whether the SDK accepts a custom fetch that streams is verified first in Package 1; if not, Package 1 stops for the owner's choice.
    - SDK retries are off; HOME retries once, only before any response byte, only for transient codes, only within the turn's budget.
    - The key is `HOME_KEV_PROVIDER_KEY`, read only by `env.ts` and passed explicitly (not `ANTHROPIC_API_KEY`, so the SDK never reads the environment itself); one per environment; never in CI's required checks, logs, audit, export or the browser.

15. **The provider's handling of HOME's data.** **Decided by the owner, 2026-10-13 (O1)** — owner decision D3.
    - What leaves HOME on a turn is the system prompt and tool definitions (no personal data), the date and time, the reader's first name, household people's first names, roles and ages, the reader's today, the tool results the question needed, and the conversation window's earlier turns (at most 12 hours, 10 exchanges and 6,000 tokens, as validated text and citation ids). Never the home location, emails, user ids, dates of birth, event descriptions or locations, sensitive context, the other adult's private records, turns outside the window, earlier tool results or thinking (contract §5.5).
    - **Request zero data retention (ZDR).** A request is not evidence: only written confirmation from Anthropic (the contract or the account representative) counts.
    - **If ZDR is unavailable or unconfirmed, standard retention is not accepted automatically for real family data.** Synthetic development continues. Real-data model access then needs a separate, informed owner decision, recorded at DEPLOY.md §E item 24, among: accept standard retention with a recorded rationale; narrow Kev's data scope; AU-hosted Claude through Bedrock or Vertex; delay. None is pre-chosen.
    - **US inference, enforced:** `inference_geo: "us"` on every request; the workspace's `allowed_inference_geos: ["us"]` and `default_inference_geo: "us"`; and the adapter's check that every response's `usage.inference_geo` is `us`, ending the attempt otherwise. About 10% more cost.
    - **Evidence** before any real data reaches the provider (§E item 23): the account under the Commercial Terms; the Console's retention value; ZDR in writing, yes or no; residency enforced in the workspace; the sub-processor list reviewed; a provider spend limit if offered; the flagged-content exception acknowledged; both adults have read §38.
    - Passing the Package 1 verification gates never switches on real-data access by itself.
    - The Console's Workbench is outside zero data retention; no real data is ever pasted there.

16. **Outages and contingency.** After the one retry, Kev says it isn't answering and the adult's words stay in the conversation; every other screen works. No failover. The contingencies are documented, not built: Claude on Bedrock with Australian cross-region inference (model availability per tier not confirmed; AWS credentials, a second SDK, partner pricing), or another provider behind `KevProvider` (a full live evaluation and its own data-handling review). Either is an owner decision at the time.

### Tools

17. **Twelve read tools and `escalate`** (contract §6): `get_today`, `get_agenda`, `get_conflicts`, `get_insights`, `get_tasks`, `get_projects`, `get_people`, `get_context`, `get_calendar_health`, `get_weather`, `get_gaps`, `search`.
    - Each has strict, bounded Zod input and output schemas; runs a domain service with the requesting adult's actor (`via: 'kev'`); returns minimised results (ids, titles, times, dates, kinds, first names, roles; no descriptions, locations, dates of birth, emails, user ids or calendar addresses); labels every user- or calendar-authored string as `untrusted_text`; caps results at 50 items; returns closed error codes; and adds every record it returns to the turn's ledger. Kev never queries a table.
    - `get_conflicts` returns only what the conflict engine detects; KEV-AGENT-MODEL's "double or missing responsibilities, both adults away" is not built.
    - `get_weather` and `get_gaps` call M7's forecast service, weather engine, gap engine and daylight engine, and keep M7's words.
    - `get_context` has no sensitive parameter (§26).
    - `escalate` takes a closed reason, fast tier only, and is withdrawn at 80% of the cap.
    - Deferred: `capture`, `propose_*` and `list_captures` (M9; the bundle carries only the To sort count); a Week Ahead composite (M10).

18. **Kev's reads are traced, not audited row by row.** Proposed — owner decision D9. Each tool call is recorded in a per-turn trace stored with the Kev message: the tool, a structural summary of its arguments (dates, scopes, ids, counts; `search`'s query by its length only), the result count and the refs. The adult sees it in "What's this based on?" and the export. No audit row is written per read: reads are not writes (CLAUDE.md rule 8), and two to eight rows per question would bury Activity. Every bookkeeping write is still audited. SYSTEM-ARCHITECTURE §5.8's "every Kev tool call" in `audit_log` is annotated.

19. **`search`, titles only.** Proposed — owner decision D10. A new domain read, `searchTitles(actor, query)`: a case-insensitive substring match over the titles of events, tasks and projects and the names of people the reader can see, non-archived, at most 20, no index and no migration. Full-text search over notes, context and captures (KEV-AGENT-MODEL §6) is not built: it needs a migration, sends more untrusted text, and captures are M9's.

20. **The agenda loader moves into the domain.** `loadAgenda` and the Today input builder move from `src/app/_agenda/` to `src/domain/agenda/`, unchanged, so `kev` can use the one place items are placed and expanded. `requestNow` stays in the app; the adapter passes `now`. Today, Forward, a person's page and `respondToInsight` must be byte-identical before and after (Package 2).

### Conversation, context and memory

21. **A small context bundle; everything else through tools.** Proposed — owner decision D11.
    - The cached prefix: the system prompt and tool definitions, with no personal data.
    - The volatile bundle, built by code as the actor (about 1,500–3,000 tokens): the date and time; the reader's first name and person id; the people the reader can see with first name, role, relationship, age and household membership; the reader's Today (headline template and today's items); calendar and forecast freshness; the To sort count; the focus.
    - Not in it: the home location (KEV-AGENT-MODEL §4 lists it; M7 keeps it in private configuration), the next seven days, conflicts, projects and context. Those come through tools when the question needs them.

22. **No new memory.** Proposed — owner decision D12 (amended 2026-10-13). Kev knows HOME's records, approved `normal` context and the conversation window's turns (§23). No saved preferences, conversation summaries, corrections, inferences, embeddings or vector store. "Remember that…" is declined honestly, pointing to the adult's own "Keep in To sort" and *What Kev knows*. Corrections go to records, by the person. Kev-proposed context is M9's, `normal` only.

23. **Conversations: private, a bounded window, each message retained 90 days.** **Decided by the owner, 2026-10-13 (O3, O6)** — owner decision D13.
    - One continuing conversation per adult, private by `user_id` in every query; the other adult can never read, count or see Activity about it.
    - **The model's window:** the adult's most recent exchanges no older than **12 hours** (rolling, across midnight), at most **10 exchanges** and **6,000 tokens**, oldest dropped first, whole exchanges only. Earlier Kev answers are replayed as their validated text and their citation refs as ids only; tool results, traces and thinking never. No compaction and no model-written summaries. The limits are configurable (code constants in `src/kev/config.ts`, or validated settings) and evaluated in Package 5. On screen, each day still starts clean.
    - One turn at a time per adult, across devices, enforced by a row lock.
    - **Retention:** each message expires 90 days after its `created_at`; every read filters expired messages out, so expiry is exact whatever the schedule; a **minimal scheduled cleanup, once a day**, deletes them (`DELETE … WHERE created_at < now() - interval '90 days'`, in bounded batches, idempotent, counts-only logs and one structural system audit row), and purge at the start of the adult's next turn is the backstop. The cleanup is a secret-protected route (`CRON_SECRET`, no value committed), a no-op where the secret is unset; it never calls a model, reads no table but `message`, and sends nothing. No agent background monitoring.
    - **Clear** deletes all of the adult's messages (answers, traces and citation refs included) and nulls `last_message_at`; it is refused while a turn is in flight; it keeps the conversation row, `kev_usage`, budget reservations, audit rows and the captures the adult kept, all content-free except those captures. Rate limits are counted from audit rows, so Clear does not reset them.
    - **Usage and audit retention:** HOME states no retention period for `audit_log` or `kev_usage`; both are append-only and content-free and are kept.
    - **Restores** can bring deleted messages back: read-time filtering hides the expired ones at once, the next cleanup deletes them, and a Clear made after the restore point must be repeated (DEPLOY.md §D).
    - Export as now, content v2 and traces included; expired messages never exported.

24. **The person's words are stored before the model is called.** Proposed — owner decision D6. The adult's message is stored verbatim as their conversation message, through the bookkeeping path, before any routing or model call, so a Kev failure never loses it. It is a message, not a `Capture`: the capture tool is M9's. Under a message Kev declined as something to add or remember, or could not answer, a quiet **Keep in To sort** captures its words verbatim through the existing capture service, as the person (`via: 'ui'`). CLAUDE.md's "always captured even if Kev fails" is read as "always stored" for M8, and annotated in Package 4; M9 restores capture.

25. **Kev's bookkeeping path.** Proposed — owner decision D5 (amended 2026-10-13). ADR 0005 §39's open question is answered with a named, narrow path acting as the requesting adult:
    - `src/domain/kev-bookkeeping/`: `recordUserMessage`, `recordKevMessage`, `reserveAttempt`, `settleAttempt`, `purgeExpired`, `clearConversation`, and one system function, `purgeExpiredMessages`, for the daily retention cleanup only;
    - for the six, only a user actor with `via: 'kev'` whose `userId` owns the conversation, and the system actor is refused; `purgeExpiredMessages` takes only the system actor and is reachable only from the secret-protected retention route;
    - the six are gated like every write, so refused in Production while the gate is closed; the cleanup only deletes expired rows and does not depend on the gate;
    - audited structurally (role, tier, counts; never text, model names or costs), privately for the six; the cleanup's one system row shows in neither adult's Activity;
    - unreachable from tools: a static test fails if any tool file imports a write function or this path;
    - `kev_cannot_write` stays for every other write function, and the privacy suite's completeness check lists exactly these seven, with capture and propose, as Kev's approved writes.

26. **Kev never requests or receives sensitive context.** Proposed — owner decision D7. ADR 0005 §37, the context service and its static guard win. KEV-AGENT-MODEL §6's `include_sensitive` parameter is removed (annotated), the guard is extended to `src/kev`, and a validator rule plants a sensitive string to prove nothing could show it.

### Security and authority

27. **Privacy below the model.** Visibility, archive and sensitivity are applied by the domain services before any tool returns; no tool parameter can widen them; nothing relies on the model to keep a secret. The non-interference invariant is extended to Kev: records only the other adult can see leave the reader's bundle, tool outputs, ledger, trace and Kev page byte-identical. **Prompt injection** is met in layers: untrusted text labelled as data; read-only, actor-bound tools; strict tool inputs; a bounded loop; the validator's authority, markup and name rules; answers rendered as text, with links built only from citations to HOME's own routes. In M8 an injection's worst outcome is a misleading sentence that must still pass the validator, shown only to an adult whose visible records carried it. Logs are structural; prompts, answers, titles, names and the key are never logged.

28. **Authority** (contract §9.8). Kev may read, summarise, explain HOME's rules, compare and order recorded facts, lay out options with their facts, say what HOME doesn't hold, and ask one clarifying question. Kev may not create, change or delete any record, create a proposal (the `propose` class is named and refused), send, book, buy, write to any external system, refresh calendars or the forecast, read sensitive context or another adult's private records or conversation, remember, run unasked, or change its own tools, prompt, limits, model or permissions. **The approval boundary is designed, not built:** M9's proposal tools will be a `propose` class that creates pending proposals only, executed when the adult approves (`approveProposal` refuses Kev); pre-approved internal changes and proposed external actions each need their own ADR.

29. **Adults only.** Proposed — owner decision D22. Kev is for the two allowlisted adults. Children are subjects of records, never users (ROADMAP "Not yet"); a child with a login that reaches Kev would need its own decision first, including the provider's requirements for products minors use (disclosure, safeguards, possible audit: verified).

### Proactivity and experience

30. **Kev speaks when asked.** Proposed — owner decision D14. Direct questions only. Today's and Forward's deterministic insights are unchanged and reach Kev only through `get_insights`. Suggested questions on the Kev screen are static templates chosen by code. No model call when a page opens; no background monitoring; no notification or outbound contact. The daily retention cleanup (§23) is not Kev and observes nothing.

31. **Kev phrasing of Today's insights is deferred.** Proposed — owner decision D15. It would need stored model text per adult per day ("insights are derived, not stored"; "no persistent insight subsystem"), Today could only show it a visit late without visibly changing because of Kev, and it would cost a model call per page view. It returns as its own decision with M10 or later. The roadmap row's "cached Kev phrasing and prioritising of Today's insights" is narrowed on approval.

32. **Entry points; the capture bar waits for M9.** Proposed — owner decision D16.
    - The capture bar stays "Tell HOME something…", capturing without any LLM, until M9's capture tool; ADR 0006 §11's "until Kev arrives in M8" becomes "until M9".
    - An **Ask Kev** button (Kev's spark) ends the bar row on every screen and opens `/kev`, a full page with its own URL (ADR 0006 §10); the bottom sheet and desktop panel are layered over it in M10.
    - Today gains one static line, "Ask Kev about today ›" (ADR 0008 §3's "Tell me about today"). Forward's long-press waits for M10's sheets and gestures.
    - The Kev screen: the privacy line "Only you can see this conversation."; a first-open disclosure of what is sent to the provider; answers led by `say`, facts, **Kev's view** labelled, cited rows, the code's sentences and "What's this based on?"; Clear; Settings › Usage with the household's month in NZ$.

33. **Progress streams; the answer appears once checked.** Proposed — owner decision D17 (amended 2026-10-13). The turn route (`POST /kev/turn`, Node, `maxDuration = 90`, subject to Package 1's check of the Vercel plan) streams `working` within a second and `escalated` events and then the whole validated answer, with the 55-second deadline rules of §11. The project never enables `supportsCancellation` for this route, so a client disconnect never stops a turn from settling and recording; writes to a closed stream are ignored. Streaming tokens would put unchecked text on screen; streaming validated segments is reconsidered with Package 5's latency. Without JavaScript, a form post runs the same turn and redirects to `/kev`. KEV.md's "Kev answers, streaming" is narrowed to this.

### Evaluation, performance and cost

34. **Four layers of evaluation; live runs outside the required checks.** Proposed — owner decision D18 (amended 2026-10-13).
    - **Deterministic** and **scripted-model** tests run in every CI build, under the existing required checks, with no key and no network to the provider.
    - **Live evals** run the synthetic scenario dataset (at least 90 scenarios, 48 of them adversarial) against deep and each fast cell, through a manual `workflow_dispatch` job in a `kev-evals` environment that needs the owner's approval, with an eval-only key and a budget of US$50 a run (about US$100 a month; Package 5's full evidence is about US$150, so it spans runs, or the owner raises the budget for it). CLAUDE.md's rule to evaluate both tiers before merging any change to prompts, tools, context assembly, routing or model config is met by those CI layers and one linked live run of the affected scenarios plus every safety scenario, with zero safety failures and no pass-to-fail regression.
    - **Human acceptance:** the owner reads transcripts and screenshots; tone is a person's judgement, not a model grader's.
    - **Guarantees and measurements are kept apart** (contract §12.3). The security boundary is architectural: read-only, actor-bound tools, privacy in the domain layer, the validator and no authority. Its deterministic tests must pass 100% and block merge. Model behaviour is measured on samples: zero observed failures in *n* runs bounds the failure rate below about 3/*n* at 95% confidence, and is never claimed as proof that injection is impossible; injection evals measure behaviour within the boundary.
    - **Gates and targets** (contract §12.3): hard release gates, 0 observed with *n* stated, for privacy leaks, sensitive context, injection and fabrication shown; measured targets for validator pass (≥ 98% within one regeneration), factual correctness (≥ 95%, with its interval), declines (≥ 95%), continuity (≥ 90%), latency (fast p95 ≤ 10 s) and cost; diagnostics for tool selection, routing and refusal rate. A threshold changes only by owner decision.

35. **A household spend cap with a gentle step, hard per-turn limits, and reservations.** **Decided by the owner, 2026-10-13 (O2)** — owner decision D19.
    - **NZ$100 a month for the household** for the initial trial, subject to verified pricing (verified 2026-10-13), from the validated setting `HOME_KEV_MONTHLY_CAP_NZD` (no value committed; unset means NZ$100), converted at a fixed, conservative NZ$1.80 per US$1 to 55,555,556 micro-US-dollars; the ledger stays in micro-US-dollars (ADR 0005 §15). This supersedes ADR 0001 D4's NZ$50 for M8's trial.
    - At 80%, escalation is withdrawn and Kev answers on the fast tier; at 100%, Kev is paused until the 1st (home zone) and the adult's words are still stored, with Keep in To sort.
    - **Reservations** (contract §13.6): before each attempt (the fast one, and separately an escalated deep one), HOME reserves the attempt's maximum permitted exposure, min(5 × (32,000 × the tier's cache-write price + `max_tokens` × the output price) × 1.1, US$1.50 − what the turn has settled): about US$0.665 for Sonnet 5.5, US$0.033 for Haiku 5.5, and up to US$1.50 for an escalated Opus 5.5 attempt. The reservation is taken in one short transaction under a transaction-level advisory lock (or a row lock on one budget row) that checks settled spend this month plus open reservations plus this one against the cap, and refuses otherwise. After the attempt, each provider call's usage (retried and aborted calls included) is recorded and the reservation closed. A call whose usage is unknown is charged at its share of the reservation; a reservation left open past `maxDuration` plus 30 seconds is counted as spent in full, marked `unreconciled` and shown in the owner's Usage view, never silently released. Persistence is Package 1a's migration.
    - **HOME's internal enforcement is hard** against its own accounting, under concurrency. **Provider billing exposure is not absolutely guaranteed** (calls in flight at a crash, provider-side billing differences, price changes, the exchange rate); it is mitigated by the conservative rules above and a provider workspace spend limit if the Console offers one.
    - Per turn: five model calls (a retry counts as one), three tool rounds, eight tool calls, one escalation, 32,000 input tokens per call, `max_tokens` 4,096 fast and 8,192 deep, 55 seconds, US$1.50. Per adult: six turns a minute, sixty a day, one at a time; counted from append-only audit rows, so Clear never resets them. No loop is unbounded.
    - **The cost model** (contract §13, with the 1.1×, planning without automatic caching): a typical fast turn costs about US$0.081 on Sonnet 5.5 at `medium` or US$0.0041 on Haiku 5.5, a deep turn about US$0.284, an escalated turn about US$0.33. At typical household use (15 turns a day, 10% escalated) the month is about NZ$85 with Sonnet 5.5 as fast and about NZ$26 with Haiku 5.5; heavy use (40 a day, 15%) is about NZ$253 and NZ$100. The owner revisits the cap after the first real month.

### Process and production

36. **Packages:** seven, numbered 0 to 6 (contract §2). Proposed — owner decision D20 (amended 2026-10-13).
    - **0:** this ADR and the contract.
    - **1a:** the budget reservation migration only, run in Production and Preview before 1b merges.
    - **1b:** the provider gateway and security: dependency, `KevProvider`, adapter, scripted provider, network policy, config, router, budget, limits, reservations and cap, env, redaction, the bookkeeping path and content v2, and the Package 1 verification gates (contract §5.7). No UI, no tools.
    - **2:** the authorised read tools, with the agenda loader's move and the non-interference invariant over every tool.
    - **3:** the orchestrator, conversation and grounding: `kev.handle()`, context assembly, the loop, the append-only request, escalation, the conversation window, purge, Clear and the daily retention cleanup route, the validator and fallback, the provisional prompt, the first 30 scripted scenarios.
    - **4:** the Kev screen, its route, entry points, no-JS, Settings › Usage, and the concept and brand annotations.
    - **5:** evaluation and tuning: the live runner and workflow, the full dataset, runs on both tiers and both fast candidates, the evidence for D2.
    - **6:** acceptance, with the evidence for DEPLOY.md §E items 23–31 (added now, in Package 0).

    Each follows ADR 0010's tiers (contract §2.3): 1a, 1b, 3, 5 and 6 critical; 2 high; 4 as the classifier decides. Review is high for every package after 0. Packages 4 and 5 may swap at Package 3's merge. Package 1a cannot start until the owner merges Package 0 and says to start.

37. **Production.** Proposed — owner decision D4 (amended 2026-10-13). M8 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed.
    - Kev deploys with `HOME_KEV=off` and no key in Production, and code refuses Kev in Production while the gate is closed, whatever `HOME_KEV` says.
    - Preview runs Kev on synthetic data only, after Package 5's thresholds are met, with a Preview-only key.
    - DEPLOY.md §E items 23–31 are added now, in Package 0, and completed after Packages 1–6: **23** the provider account and data-handling evidence (§15); **24** the separate, informed real-data privacy decision, required unless ZDR is confirmed in writing; **25** keys per environment; **26** the spend cap and the provider spend limit; **27** Kev in Preview on synthetic data; **28** the retention cleanup verified; **29** Kev in Production after the gate opens (item 11) and items 23–28; **30** the logs review; **31** the owner's trust check on their phone. Items 23–28 may be done while the gate is closed.
    - New environment settings: `HOME_KEV`, `HOME_KEV_PROVIDER_KEY`, `HOME_KEV_MONTHLY_CAP_NZD` and `CRON_SECRET` (and `HOME_TEST_KEV` for local and CI only); names only, never values in the repository.

### Privacy note (a one-page privacy impact assessment)

38. **What Kev sends, where, for how long, and who is told.**
    - **Purpose:** to answer an adult's question about the household's own records.
    - **What:** per turn, only what §15 lists. Never sensitive context, the other adult's private records, the home location, dates of birth, contact details or credentials.
    - **To whom:** Anthropic, as processor under its Commercial Terms and Data Processing Addendum, which forbid training on the content (verified).
    - **Where:** inference in the US (`inference_geo: "us"`, enforced in the workspace and checked on every response); storage at rest in the US (verified). Family data leaves New Zealand whenever Kev runs.
    - **How long, at the provider:** under zero data retention, confirmed in writing, not stored after the response; otherwise as the Console's setting says (stated two ways by official pages: not retained by default, or deleted within 30 days); up to 2 years for content flagged by the provider's safety systems, under any arrangement (verified), and classification scores up to 7 years (verified from search only). Recorded at item 23. Without written ZDR, real-data use waits for the owner's separate decision at item 24.
    - **How long, in HOME:** each conversation message 90 days from when it was written, hidden once expired and deleted daily; Clear deletes them all at once. Usage and audit rows are content-free and kept. A database restore can bring back deleted messages for its window; expired ones stay hidden and are deleted again, and a Clear must be repeated.
    - **Law** (not legal advice): s 11 of the Privacy Act 2020 likely treats a processor acting solely for HOME as no disclosure, and s 27 very likely covers a household's own system (verified from search only). Retention for safety flags is the provider's own purpose and weakens the s 11 reading: **a residual risk, accepted only by the owner, at item 23 (and item 24 if ZDR is not confirmed).** HOME behaves as if IPP 12 applied: minimal context, no sensitive context, a no-training processor, the shortest retention available.
    - **Who is told:** both adults read this note before Kev runs on real data (item 23), which also meets IPP 3A's notice for information one adult enters about the other. Children are never users and are mentioned only as records already are.
    - **Controls:** the allowlist; actor-bound tools; the validator; structural logs; the off switch; the spend cap; Clear; 90-day retention with the daily cleanup; export.

### Owner decisions, 2026-10-13

39. **The owner decided O1–O6 on 2026-10-13** after a focused review of Package 0, and approved the review's other targeted amendments (corrected prices and the 1.1× `us` multiplier; `maxDuration` 90 with the 55-second deadline rules; the append-only request within a model turn, with test N15; Clear's exact semantics; the provider privacy evidence; deterministic gates kept apart from measured thresholds; attempt ids and per-call usage in the trace; the `propose` class named and refused; task state in HOME's tables; rate limits from audit rows; no transaction across a model call; refusal rates; validator-triggered escalation; `max_tokens` 4,096 and 8,192). The owner also required a concurrency-safe budget reservation (§35), a single list of Package 1 verification gates (contract §5.7) and a precise retention design (§23).

    | Owner decision | Settles | Recorded in |
    |---|---|---|
    | **O1** Provider privacy: request ZDR; only written confirmation counts; no automatic acceptance of standard retention for real data, but a separate, informed owner decision at DEPLOY.md §E item 24; US inference enforced in the workspace and checked per response | D3 | §15, §38; contract §5.5 |
    | **O2** Budget: NZ$100 a household month for the initial trial, subject to verified pricing; a validated setting, `HOME_KEV_MONTHLY_CAP_NZD` | D19 | §35; contract §13 |
    | **O3** Conversation: a rolling 12 hours, at most 10 exchanges and 6,000 context tokens; no model-written permanent summaries; limits configurable and evaluated in Package 5; earlier answers as validated text and citation ids | D13 | §23; contract §7.2 |
    | **O4** A deep re-ask ("Take a closer look"): deferred to Package 5's evaluation | D2 | §13; contract §19.2 D2 |
    | **O5** Fast model: Sonnet 5.5 at `medium` to start; Haiku 5.5 evaluated before any substitution; Opus 5.5 the deep tier; ids and capabilities verified in Package 1 (G1) | D2 | §13; contract §5.3 |
    | **O6** Retention: minimal scheduled deletion of expired conversation messages, daily; 90-day retention kept; no agent background monitoring; ROADMAP "Not yet" amended for this one job only | D13 | §23; contract §7.2; ROADMAP |

40. **Decision register.** The status of every decision, identical to contract §19.2's register:

    | D | Subject | Status | Decision |
    |---|---|---|---|
    | D1 | Architecture | Recommended | B: one model per turn, a HOME-owned bounded tool loop |
    | D2 | Provider and tier models | Decided by the owner, 2026-10-13 (O5; O4 deferred to Package 5) | Anthropic first party; deep Opus 5.5 `medium`; fast Sonnet 5.5 `medium` to start; Haiku 5.5 evaluated before any substitution; ids verified at G1 |
    | D3 | Provider data handling | Decided by the owner, 2026-10-13 (O1) | Request ZDR; real data only with written ZDR or a separate owner decision; US inference enforced |
    | D4 | Kev in Production | Recommended, amended 2026-10-13 | A: off until the gate is open and §E items 23–28 are recorded; switched on at item 29 |
    | D5 | Kev's bookkeeping | Recommended, amended 2026-10-13 | A: a named path; six functions as the adult and one system cleanup function |
    | D6 | The person's words before the model | Recommended | A: stored as a message first; Keep in To sort |
    | D7 | Sensitive context | Recommended | A: never requested or received |
    | D8 | Availability and tool names | Recommended | A: M7's language; `get_gaps` |
    | D9 | Recording Kev's reads | Recommended | A: a per-turn trace, no audit row per read |
    | D10 | `search` | Recommended | A: titles only |
    | D11 | Context assembly | Recommended | A: a small bundle |
    | D12 | Memory | Recommended, amended 2026-10-13 | A: nothing new; the conversation window only |
    | D13 | Conversations and retention | Decided by the owner, 2026-10-13 (O3, O6) | 12 hours, 10 exchanges, 6,000 tokens; 90 days per message; the daily cleanup; Clear as specified |
    | D14 | Proactivity | Recommended | A: direct questions only |
    | D15 | Phrasing of Today's insights | Recommended | A: deferred |
    | D16 | Entry points | Recommended | A: capture bar unchanged; Ask Kev |
    | D17 | Streaming and timing | Recommended, amended 2026-10-13 | A: progress streams; `maxDuration` 90; the 55 s deadline rules |
    | D18 | Evaluation | Recommended, amended 2026-10-13 | A: four layers; guarantees separate from measured targets; US$50 a run |
    | D19 | Spend cap and limits | Decided by the owner, 2026-10-13 (O2) | NZ$100; a reservation per attempt; deep off at 80%, paused at 100% |
    | D20 | Packages | Recommended, amended 2026-10-13 | A: 0–6, with Package 1 as 1a (migration) and 1b |
    | D21 | What M9 executes | Recommended | A: internal executor only |
    | D22 | Adults only | Recommended | A: the two allowlisted adults |

## Consequences

- **ROADMAP.** The M8 row's status cell records Package 0 as proposed with the owner's decisions recorded. "Not yet"'s "Push notifications and background jobs" gains a dated note: the single retention cleanup of expired Kev messages is approved for M8 (O6), and nothing else changes. On approval, the row records this ADR and its narrowings: phrasing of Today's insights deferred (§31); "first evals in CI against both tiers" as four layers with live runs outside the required checks (§34); Forward's Kev items to M10 (§32). Milestone definitions are otherwise unchanged.
- **KEV-AGENT-MODEL.** Annotated, not rewritten: §3 (`working`, structured `detail`, `now`); §4 (the smaller bundle, no home location; the person's words stored before the model); §5 (decided: fast Sonnet 5.5 at `medium` to start, Haiku evaluated; deep Opus 5.5 at medium; validator-initiated escalation; the append-only request within an attempt; the 12-hour window); §6 (`include_sensitive` removed; `find_free_windows` as `get_gaps`; `get_conflicts` as built; "recommend one window" and "Find us a night out" superseded; `search` titles only); §7 (phrasing deferred); §10 (four layers).
- **SYSTEM-ARCHITECTURE.** Annotated: §2.3 (the bookkeeping path; the network policy); §2.4 (the one scheduled job, O6); §2.6 (Kev phrasing deferred); §3.1 (the person's words stored as a message, not a capture, in M8; the NZ$100 cap and reservations); §5.3 (sensitive context never to Kev); §5.4 (the bookkeeping path beside the capture exception); §5.7 (per-message retention and the daily cleanup); §5.8 (the per-turn trace).
- **CLAUDE.md.** The status line records M7's technical acceptance and M8's Package 0 as proposed, with the owner's decisions of 2026-10-13 recorded. On approval: the import line gains `kev → lib` (as ESLint already allows; Package 1b); "always captured even if Kev fails" is annotated as "always stored" for M8 (Package 4). No rule changes.
- **FAMILY-DATA-MODEL.** Annotated now: per-message retention replaces the per-conversation `last_message_at` clock, with the daily cleanup; the cap is NZ$100; `kev_budget_reservation` and `kev_usage.attempt_id` are proposed, pending Package 1a. Package 1b adds message content v2, the bookkeeping path and the cap's conversion.
- **ADR 0001 D4 and V0.1-SCOPE D4.** Their NZ$50 cap is superseded for M8's trial by NZ$100 (O2); annotated in Package 6, with V0.1-SCOPE's quality bar.
- **Concepts, BRAND and V0.1-SCOPE.** KEV.md §7 is annotated now: the model's window may include the previous evening's turns, while the screen still starts each day clean. Package 4 annotates KEV.md (superseded examples; M8's entry points; the full page), TODAY.md ("Alex is free from 2:30" superseded; "Ask Kev about today ›") and BRAND.md (Kev's view). Package 6 annotates V0.1-SCOPE's quality bar.
- **ADR 0006 §11.** On approval, "until Kev arrives in M8" reads "until M9".
- **DEPLOY.md.** §E items 23–31 and §D's restore note are added now, in Package 0; Package 6 adds the environment rows and records the evidence.
- **Appendix A of the contract** records how M8's seams lead towards the owner's long-term "chief of staff", and what must not be built yet.
