# ADR 0012 — M8 Kev Intelligence: scope, architecture and decisions

Status: **Proposed**, 2026-10-13 (Package 0, awaiting owner approval). The contract is `docs/m8/M8-BUILD-CONTRACT.md`. Decisions marked "Proposed — owner decision D*n*" are listed, with their options, in contract §19.2. This ADR is accepted, as amended by those decisions, when the owner merges Package 0.

- **Implementation:** nothing built. No provider account, key, dependency or secret exists for Kev. Package 1 (provider gateway and security) starts only after Package 0 merges and the owner says to start.

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

**Provider research** (2026-10-13; contract §5): the Anthropic API's Commercial Terms forbid training on customer content (verified); the default retention period is stated two ways by official pages (not retained by default; deleted within 30 days), flagged content may be kept up to 2 years, and zero data retention is available by request (verified); inference runs `global` or `us`, never in New Zealand or Australia (verified). Claude on Bedrock offers Australian cross-region inference, with the 5.5 tiers' availability not confirmed. The Privacy Act's s 11 likely treats a no-training processor as not a disclosure, and s 27 very likely covers a household system (verified from search only; not legal advice).

## Decisions

### Scope

1. **M8 is a read-only Kev.** An adult asks about what HOME holds and gets a short answer grounded in the records they can see, with those records shown. Kev reads through tools, as the adult, and explains; code computes and checks. Nothing in M8 creates, changes or schedules a record, sends anything, remembers anything new, or runs without being asked. Today and Forward are unchanged and never wait for Kev.

2. **M8 builds** (contract §1.3):
   - a provider gateway: `KevProvider`, the Anthropic adapter (the only SDK import), a scripted provider, HOME's network policy for the provider, tiers, router and limits (§13–§14);
   - a named bookkeeping path for Kev's transcript and usage (§25);
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
   | Background runs, schedules, notifications | §30; ROADMAP "Not yet" |
   | Specialist agents, a second model in a turn, the SDK's Tool Runner, hosted agents, server-side tools | §10, §13 |
   | Week Ahead, sheets, the Kev panel, Forward long-press, PWA | M10 |
   | Voice | V0.5; keyboard dictation only |
   | Children as users | §29 |
   | Real data, or a key in Production before the gate | §37 |

4. **No migration.** `message.content` is checked in the database only as an object with a numeric `v`, so content v2 is an application schema; `kev_usage`, `conversation` and `message` already hold what the cap, retention and rate limits need; `home_app` already has `DELETE` on `message`. One new runtime dependency, `@anthropic-ai/sdk`, pinned. If a package finds a migration necessary, it becomes its own migration-only package first (MIGRATIONS.md).

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
    - The order: guards (on, gate, limits, cap, one turn at a time); store the person's words; route; assemble; the loop (at most three tool rounds, eight tool calls, five model calls including one regeneration, 32,000 input tokens per call, 55 seconds); validate; store the answer and usage.
    - `KevRequest` gains `now` (from the adapter's time source); `conversationId` is resolved from the actor, never taken from the client.
    - `KevEvent` gains `working` (fixed progress strings) and `detail` becomes structured blocks; `error` carries a closed code. `captured` and `proposal` stay for M9 and are never emitted.

12. **Seams kept for later, and nothing built on them** (contract §4.5; Appendix A): the tool registry (every tool declares an authority class; only `read` exists in M8 and the registry refuses any other); `KevProvider` over provider-neutral messages; the `KevEvent` stream; actor binding (every tool runs as the requesting adult); the per-turn budget object.

### Provider

13. **The Anthropic API, first party; tiers by evidence.** Proposed — owner decision D2.
    - Through `@anthropic-ai/sdk` behind `KevProvider`, called only from the server. Tier → model and effort only in `src/kev/config.ts`.
    - **Deep:** `claude-opus-5-5`, effort `medium`, `max_tokens` 4,096.
    - **Fast:** `claude-sonnet-5-5`, effort `low`, `max_tokens` 2,048, provisionally (the approved initial mapping, ADR 0001 D4). Package 5 runs the full evaluation on it and on `claude-haiku-5-5`; the owner chooses with the results. Haiku 5.5 is adopted only if it meets every threshold, privacy, injection and grounding included; cost alone is not a reason.
    - **Not `claude-fable-5-1`:** it requires 30-day retention and is not available under zero data retention without express authorisation; it costs 2.5 times Opus 5.5.
    - Tool use with `strict: true` and `tool_choice: auto`; the answer as structured output (or a strict answer tool if structured output does not compose with tools on a tier, checked in Package 1); no personal data in any JSON schema, because schemas are cached by the provider for up to 24 hours without message content's protections.
    - Refusals end the attempt plainly; the server-side `fallbacks` parameter is not used, since it would switch models within a turn. Thinking is never stored or replayed across turns. The cached prefix (tools and system prompt) holds no personal data.
    - Prices, effort and ids come from the facts bundled on 2026-10-06 and are re-checked against the Models API in Package 1; Opus 5.5's cache-read price is taken conservatively (contract §5.7).

14. **HOME's network boundary and key** (contract §5.4).
    - Every SDK request goes through HOME's own fetch: `https://api.anthropic.com` exactly, two paths, public addresses checked at connect time, no redirects, 1 MiB requests and 2 MiB responses, per-call and idle timeouts, closed error codes, nothing logged. Whether the SDK accepts a custom fetch that streams is verified first in Package 1; if not, Package 1 stops for the owner's choice.
    - SDK retries are off; HOME retries once, only before any response byte, only for transient codes, only within the turn's budget.
    - The key is `HOME_KEV_PROVIDER_KEY`, read only by `env.ts` and passed explicitly (not `ANTHROPIC_API_KEY`, so the SDK never reads the environment itself); one per environment; never in CI's required checks, logs, audit, export or the browser.

15. **The provider's handling of HOME's data.** Proposed — owner decision D3.
    - What leaves HOME on a turn is the system prompt and tool definitions (no personal data), the date and time, the reader's first name, household people's first names, roles and ages, the reader's today, the tool results the question needed, and today's turns. Never the home location, emails, user ids, dates of birth, event descriptions or locations, sensitive context, the other adult's private records, earlier days' turns or thinking (contract §5.5).
    - Request zero data retention before Production; if refused, the owner records acceptance of the Console's default retention at DEPLOY.md §E item 23, with the residual risk in §38.
    - `inference_geo: "us"`, for one known jurisdiction, at about 10% more cost.
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

22. **No new memory.** Proposed — owner decision D12. Kev knows HOME's records, approved `normal` context and today's turns. No saved preferences, conversation summaries, corrections, inferences, embeddings or vector store. "Remember that…" is declined honestly, pointing to the adult's own "Keep in To sort" and *What Kev knows*. Corrections go to records, by the person. Kev-proposed context is M9's, `normal` only.

23. **Conversations: private, today-scoped, retained 90 days.** Proposed — owner decision D13.
    - One continuing conversation per adult, private by `user_id` in every query; the other adult can never read, count or see Activity about it.
    - The model sees today's turns only (home zone), at most the last 10 exchanges, as text; tool results and traces are never replayed, so a follow-up re-fetches what it cites. No compaction or summaries.
    - One turn at a time per adult, across devices.
    - Messages over 90 days old are deleted at the start of the adult's next turn, and everything on **Clear**, through the bookkeeping path. With no background job, an adult who stops using Kev keeps older messages until they next use it; copy says so and never implies deletion that has not happened (ADR 0006 §8).
    - Export as now, content v2 and traces included.

24. **The person's words are stored before the model is called.** Proposed — owner decision D6. The adult's message is stored verbatim as their conversation message, through the bookkeeping path, before any routing or model call, so a Kev failure never loses it. It is a message, not a `Capture`: the capture tool is M9's. Under a message Kev declined as something to add or remember, or could not answer, a quiet **Keep in To sort** captures its words verbatim through the existing capture service, as the person (`via: 'ui'`). CLAUDE.md's "always captured even if Kev fails" is read as "always stored" for M8, and annotated in Package 4; M9 restores capture.

25. **Kev's bookkeeping path.** Proposed — owner decision D5. ADR 0005 §39's open question is answered with a named, narrow path acting as the requesting adult:
    - `src/domain/kev-bookkeeping/`: `recordUserMessage`, `recordKevMessage`, `recordRun`, `purgeExpired`, `clearConversation`;
    - only a user actor with `via: 'kev'` whose `userId` owns the conversation; the system actor is refused;
    - gated like every write, so refused in Production while the gate is closed;
    - audited structurally and privately (role, tier, counts; never text, model names or costs);
    - unreachable from tools: a static test fails if any tool file imports a write function or this path;
    - `kev_cannot_write` stays for every other write function, and the privacy suite's completeness check lists exactly these five, with capture and propose, as Kev's approved writes.

26. **Kev never requests or receives sensitive context.** Proposed — owner decision D7. ADR 0005 §37, the context service and its static guard win. KEV-AGENT-MODEL §6's `include_sensitive` parameter is removed (annotated), the guard is extended to `src/kev`, and a validator rule plants a sensitive string to prove nothing could show it.

### Security and authority

27. **Privacy below the model.** Visibility, archive and sensitivity are applied by the domain services before any tool returns; no tool parameter can widen them; nothing relies on the model to keep a secret. The non-interference invariant is extended to Kev: records only the other adult can see leave the reader's bundle, tool outputs, ledger, trace and Kev page byte-identical. **Prompt injection** is met in layers: untrusted text labelled as data; read-only, actor-bound tools; strict tool inputs; a bounded loop; the validator's authority, markup and name rules; answers rendered as text, with links built only from citations to HOME's own routes. In M8 an injection's worst outcome is a misleading sentence that must still pass the validator, shown only to an adult whose visible records carried it. Logs are structural; prompts, answers, titles, names and the key are never logged.

28. **Authority** (contract §9.8). Kev may read, summarise, explain HOME's rules, compare and order recorded facts, lay out options with their facts, say what HOME doesn't hold, and ask one clarifying question. Kev may not create, change or delete any record, create a proposal, send, book, buy, write to any external system, refresh calendars or the forecast, read sensitive context or another adult's private records or conversation, remember, run unasked, or change its own tools, prompt, limits, model or permissions. **The approval boundary is designed, not built:** M9's proposal tools will be a `propose` class that creates pending proposals only, executed when the adult approves (`approveProposal` refuses Kev); pre-approved internal changes and proposed external actions each need their own ADR.

29. **Adults only.** Proposed — owner decision D22. Kev is for the two allowlisted adults. Children are subjects of records, never users (ROADMAP "Not yet"); a child with a login that reaches Kev would need its own decision first, including the provider's requirements for products minors use (disclosure, safeguards, possible audit: verified).

### Proactivity and experience

30. **Kev speaks when asked.** Proposed — owner decision D14. Direct questions only. Today's and Forward's deterministic insights are unchanged and reach Kev only through `get_insights`. Suggested questions on the Kev screen are static templates chosen by code. No model call when a page opens; no background monitoring; no notification or outbound contact.

31. **Kev phrasing of Today's insights is deferred.** Proposed — owner decision D15. It would need stored model text per adult per day ("insights are derived, not stored"; "no persistent insight subsystem"), Today could only show it a visit late without visibly changing because of Kev, and it would cost a model call per page view. It returns as its own decision with M10 or later. The roadmap row's "cached Kev phrasing and prioritising of Today's insights" is narrowed on approval.

32. **Entry points; the capture bar waits for M9.** Proposed — owner decision D16.
    - The capture bar stays "Tell HOME something…", capturing without any LLM, until M9's capture tool; ADR 0006 §11's "until Kev arrives in M8" becomes "until M9".
    - An **Ask Kev** button (Kev's spark) ends the bar row on every screen and opens `/kev`, a full page with its own URL (ADR 0006 §10); the bottom sheet and desktop panel are layered over it in M10.
    - Today gains one static line, "Ask Kev about today ›" (ADR 0008 §3's "Tell me about today"). Forward's long-press waits for M10's sheets and gestures.
    - The Kev screen: the privacy line "Only you can see this conversation."; a first-open disclosure of what is sent to the provider; answers led by `say`, facts, **Kev's view** labelled, cited rows, the code's sentences and "What's this based on?"; Clear; Settings › Usage with the household's month in NZ$.

33. **Progress streams; the answer appears once checked.** Proposed — owner decision D17. The turn route (`POST /kev/turn`, Node, `maxDuration = 60`) streams `working` and `escalated` events and then the whole validated answer. Streaming tokens would put unchecked text on screen; streaming validated segments is reconsidered with Package 5's latency. Without JavaScript, a form post runs the same turn and redirects to `/kev`. KEV.md's "Kev answers, streaming" is narrowed to this.

### Evaluation, performance and cost

34. **Four layers of evaluation; live runs outside the required checks.** Proposed — owner decision D18.
    - **Deterministic** and **scripted-model** tests run in every CI build, under the existing required checks, with no key and no network to the provider.
    - **Live evals** run the synthetic scenario dataset (at least 60 scenarios, at least 30 adversarial) against deep and each fast candidate, through a manual `workflow_dispatch` job in a `kev-evals` environment that needs the owner's approval, with an eval-only key and a budget of US$25 a run (about US$60 a month). CLAUDE.md's rule to evaluate both tiers before merging any change to prompts, tools, context assembly, routing or model config is met by those CI layers and one linked live run of the affected scenarios.
    - **Human acceptance:** the owner reads transcripts and screenshots; tone is a person's judgement, not a model grader's.
    - **Thresholds** (contract §12.3): privacy, sensitive context and injection 100%; fabrication zero; validator pass ≥ 98% within one regeneration; factual correctness ≥ 95%; tool selection ≥ 90%; declines ≥ 95%; continuity ≥ 90%; fast p95 ≤ 10 s; cost per turn within the model's bounds. A threshold changes only by owner decision.

35. **A household spend cap with a gentle step, and hard per-turn limits.** Proposed — owner decision D19.
    - NZ$50 a month for the household (ADR 0001 D4), converted at a fixed, conservative NZ$1.80 per US$1 to 27,777,778 micro-US-dollars; the ledger stays in micro-US-dollars (ADR 0005 §15).
    - At 80%, escalation is withdrawn and Kev answers on the fast tier; at 100%, Kev is paused until the 1st (home zone) and the adult's words are still stored.
    - Before each model call, its maximum cost is reserved against the month; the call is not made if the cap would be passed.
    - Per turn: five model calls, three tool rounds, eight tool calls, one escalation, 32,000 input tokens per call, 55 seconds, US$1.50. Per adult: six turns a minute, sixty a day, one at a time. No loop is unbounded.
    - **The cost model** (contract §13): a typical fast turn costs about US$0.048 on Sonnet 5.5 or US$0.0024 on Haiku 5.5, a deep turn about US$0.22, the worst case US$1.47. At typical household use (15 turns a day, 10% escalated) the month is about NZ$55 with Sonnet 5.5 as fast and about NZ$20 with Haiku 5.5, so with Sonnet the cap would bind in a typical month. The owner revisits the cap with Preview's and the first month's evidence.

### Process and production

36. **Packages:** seven, numbered 0 to 6 (contract §2). Proposed — owner decision D20.
    - **0:** this ADR and the contract.
    - **1:** the provider gateway and security: dependency, `KevProvider`, adapter, scripted provider, network policy, config, router, budget, limits and cap, env, redaction, the bookkeeping path and content v2. No UI, no tools.
    - **2:** the authorised read tools, with the agenda loader's move and the non-interference invariant over every tool.
    - **3:** the orchestrator, conversation and grounding: `kev.handle()`, context assembly, the loop, escalation, purge and Clear, the validator and fallback, the provisional prompt, the first 30 scripted scenarios.
    - **4:** the Kev screen, its route, entry points, no-JS, Settings › Usage, and the concept and brand annotations.
    - **5:** evaluation and tuning: the live runner and workflow, the full dataset, runs on both tiers and both fast candidates, the evidence for D2.
    - **6:** acceptance, with DEPLOY.md §E items 23–27.

    Each follows ADR 0010's tiers (contract §2.3): 1, 3, 5 and 6 critical; 2 high; 4 as the classifier decides. Review is high for every package after 0. Packages 4 and 5 may swap at Package 3's merge. Package 1 cannot start until the owner merges Package 0 and says to start.

37. **Production.** Proposed — owner decision D4. M8 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed.
    - Kev deploys with `HOME_KEV=off` and no key in Production, and code refuses Kev in Production while the gate is closed, whatever `HOME_KEV` says.
    - Preview runs Kev on synthetic data only, after Package 5's thresholds are met, with a Preview-only key.
    - Package 6 adds DEPLOY.md §E items: **23** the provider account and data handling (retention setting read, zero data retention requested or the default accepted, sub-processors checked, `inference_geo` confirmed, both adults have read §38); **24** separate keys and spend limits per environment; **25** Kev in Preview on synthetic data, with a log review; **26** Kev in Production after the gate opens (item 11), with a privacy check and a log review; **27** the owner's trust check on their phone. Items 23–25 may be done while the gate is closed.
    - Two new environment settings, `HOME_KEV` and `HOME_KEV_PROVIDER_KEY` (and `HOME_TEST_KEV` for local and CI only); the first secret since M7's location key.

### Privacy note (a one-page privacy impact assessment)

38. **What Kev sends, where, for how long, and who is told.**
    - **Purpose:** to answer an adult's question about the household's own records.
    - **What:** per turn, only what §15 lists. Never sensitive context, the other adult's private records, the home location, dates of birth, contact details or credentials.
    - **To whom:** Anthropic, as processor under its Commercial Terms and Data Processing Addendum, which forbid training on the content (verified).
    - **Where:** inference in the US (`inference_geo: "us"`); storage at rest in the US (verified). Family data leaves New Zealand whenever Kev runs.
    - **How long:** under zero data retention, not stored after the response; otherwise as the Console's setting says (stated two ways by official pages: not retained by default, or deleted within 30 days); up to 2 years for content flagged by the provider's safety systems, under any arrangement (verified). Recorded at item 23.
    - **Law** (not legal advice): s 11 of the Privacy Act 2020 likely treats a processor acting solely for HOME as no disclosure, and s 27 very likely covers a household's own system (verified from search only). Retention for safety flags is the provider's own purpose and weakens the s 11 reading: **a residual risk, accepted only by the owner at item 23.** HOME behaves as if IPP 12 applied: minimal context, no sensitive context, a no-training processor, the shortest retention available.
    - **Who is told:** both adults read this note before Kev runs on real data (item 23), which also meets IPP 3A's notice for information one adult enters about the other. Children are never users and are mentioned only as records already are.
    - **Controls:** the allowlist; actor-bound tools; the validator; structural logs; the off switch; the spend cap; Clear; 90-day retention; export.

## Consequences

- **ROADMAP.** The M8 row's status cell records Package 0 as proposed. On approval, the row records this ADR and its narrowings: phrasing of Today's insights deferred (§31); "first evals in CI against both tiers" as four layers with live runs outside the required checks (§34); Forward's Kev items to M10 (§32). Milestone definitions are otherwise unchanged.
- **KEV-AGENT-MODEL.** Annotated as proposed, pending approval, not rewritten: §3 (`working`, structured `detail`, `now`); §4 (the smaller bundle, no home location; the person's words stored before the model); §5 (fast chosen by evaluation; deep Opus 5.5 at medium); §6 (`include_sensitive` removed; `find_free_windows` as `get_gaps`; `get_conflicts` as built; "recommend one window" and "Find us a night out" superseded; `search` titles only); §7 (phrasing deferred); §10 (four layers).
- **SYSTEM-ARCHITECTURE.** Annotated as proposed: §2.3 (the bookkeeping path; the network policy); §2.6 (Kev phrasing deferred); §3.1 (the person's words stored as a message, not a capture, in M8); §5.3 (sensitive context never to Kev); §5.4 (the bookkeeping path beside the capture exception); §5.8 (the per-turn trace).
- **CLAUDE.md.** The status line records M7's technical acceptance and M8's Package 0 as proposed. On approval: the import line gains `kev → lib` (as ESLint already allows; Package 1); "always captured even if Kev fails" is annotated as "always stored" for M8 (Package 4). No rule changes.
- **FAMILY-DATA-MODEL.** Package 1 adds message content v2, the bookkeeping path and the cap's conversion. No table changes.
- **Concepts, BRAND and V0.1-SCOPE.** Package 4 annotates KEV.md (superseded examples; M8's entry points; the full page), TODAY.md ("Alex is free from 2:30" superseded; "Ask Kev about today ›") and BRAND.md (Kev's view). Package 6 annotates V0.1-SCOPE's quality bar.
- **ADR 0006 §11.** On approval, "until Kev arrives in M8" reads "until M9".
- **DEPLOY.md.** Package 6 adds §E items 23–27 and the environment rows.
- **Appendix A of the contract** records how M8's seams lead towards the owner's long-term "chief of staff", and what must not be built yet.
