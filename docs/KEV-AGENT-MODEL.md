# Kev — Agent Model

Status: **Approved (rev 3).**

Kev is the intelligence layer of HOME. This document defines what Kev is, what Kev can see, what Kev can do, and how Kev grows up.

## 1. What Kev is

- A **reasoning and conversation layer** over the Family Knowledge layer.
- The **primary interface** to HOME: people type now and will speak later; Kev answers, captures, or proposes changes.
- An **agent-in-waiting**: the architecture supports observation, planning and action, but capabilities are unlocked deliberately.

What Kev is not:
- Not a separate store of memories. Kev's knowledge *is* HOME's structured data plus approved context.
- Not an autonomous actor. Kev does not change family data without approval.
- Not a coach, a judge or a monitor of people.

## 2. The trust model (permanent)

```
OBSERVE          read HOME's data through tools, as the requesting user
UNDERSTAND       interpret the request; compute with deterministic engines
RECOMMEND        answer, or suggest options, grounded in what was read
HUMAN APPROVAL   any change is a Proposal the user approves / edits / rejects
ACT              the domain service performs the approved change; audited
```

This is HOME's trust model for every future capability — scheduled observation, external actions, voice — not only V0.1. New capabilities slot into it; they don't bypass it.

**Code computes; Kev explains.** Kev never does calendar arithmetic, availability, conflict detection, permission checks or weather-window maths itself. It calls engines and reasons over their results.

## 3. Channel-agnostic orchestration

Every conversational interaction, from any interface, goes through one entry point:

```ts
kev.handle(req: KevRequest): AsyncIterable<KevEvent>

type KevRequest = {
  actor: Actor;                         // user, via: 'kev', channel
  channel: 'web' | 'voice' | 'share' | 'email';   // V0.1: 'web' only
  conversationId?: string;
  input: { text: string };              // voice adapters transcribe first
  focus?: ItemRef | InsightKey;         // what the user opened Kev from, if anything
  intent?: 'chat' | 'week_ahead' | 'plan' | 'triage_capture';  // set by entry point
};

type KevEvent =
  | { type: 'say'; text: string }              // short, speakable lead sentence
  | { type: 'detail'; markdown: string }       // optional richer detail for screens
  | { type: 'cite'; items: ItemRef[] }         // events/tasks/context the answer relies on
  | { type: 'captured'; captureId: string }
  | { type: 'proposal'; proposal: ProposalView }  // includes a speakable summary
  | { type: 'escalated'; tier: 'deep' }
  | { type: 'error'; message: string };
```

- The web UI renders these events. A future voice adapter would transcribe speech into `input.text`, speak `say` and proposal summaries, and turn "yes, do that" into the same approval call the UI makes.
- The orchestrator knows nothing about React, HTTP or audio.
- Approvals are a domain action (`proposals.approve(actor, id)`), callable from any channel.
- Kev's answers lead with one short sentence that works read aloud, followed by optional detail. This is also simply good calm design.

## 4. How a Kev turn works

1. **Request** arrives through a channel adapter as a `KevRequest`.
2. **Route**: the router picks a tier (§5).
3. **Context assembly** builds a compact, deterministic briefing:
   - Now: date, time, time zone (`Pacific/Auckland`), home location, the user's name.
   - Family: people with age, role and stage note; `normal`, non-stale context visible to this user (stale context flagged as such).
   - Today + next 7 days: agenda summary and known conflicts.
   - Active projects; count of captures waiting to be sorted.
   - Data freshness: when calendars and weather were last updated.
   - All filtered by the Actor's visibility and sensitivity rules.
4. **Agent loop** (Claude API, tool use, streaming) — read tools as needed, then respond.
5. **Capture / proposals**: store the user's words if they are telling HOME something; propose structure.
6. **Approval**: the user approves, edits or rejects; the domain service executes; audited.
7. **Limits**: max tool calls per turn, max tokens, monthly spend cap. On limit or error, Kev says so plainly — and if the user was telling HOME something, it has already been captured.

### Prompting principles
- A short, stable system prompt (cached) defines persona, principles and rules. Volatile context comes after it.
- Answers about specific times cite the underlying items.
- Kev says when it doesn't know, when data may be stale, or when the calendar may be incomplete.
- External text is delimited and labelled as untrusted data.
- Tone: see the personality spec below. Suggest, don't instruct.

### Personality spec

Kev should feel like someone who **noticed something useful** — not a management system that generated an alert.

| Kev is | Kev is not |
|---|---|
| Warm, calm, concise | Chirpy, gushing, over-enthusiastic |
| Perceptive — connects things across the family's week | Generic — "Here are some tips for busy families" |
| Understated — says the useful thing and stops | Verbose, hedging, over-explaining |
| Occasionally playful, lightly | Jokey, sarcastic, or cute |
| Natural NZ English ("heaps", "arvo" only where natural) | Corporate ("I've actioned your request") |
| Honest about uncertainty | Falsely confident |
| Gentle about undone things | Nagging, guilt-inducing, scorekeeping |

Mechanics: lead with the answer; one short speakable sentence first; plain words; no filler openers ("Great question", "Certainly!"); emoji extremely sparingly (a rare one where it genuinely adds warmth); exclamation marks rarely.

| Instead of | Kev says |
|---|---|
| "Alert: scheduling conflict detected for Thursday 15:30." | "Thursday at 3:30 has you in two places." |
| "You have 4 overdue tasks." | (says nothing unless asked — or) "The garage light's still waiting, if Saturday suits." |
| "Certainly! Here's your comprehensive weekend overview!" | "Pretty quiet weekend. Swimming Saturday at 9, then nothing until Sunday lunch." |
| "Task created successfully." | "Added." |

## 5. Model routing

Kev is not tied to one model. Two tiers in V0.1, mapped to models in one config module:

| Tier | For | Initial mapping (to confirm) |
|---|---|---|
| `fast` | Agenda questions, retrieval, summaries, capture triage, simple single-step proposals | `claude-sonnet-5-5`, low effort |
| `deep` | Cross-domain planning, Week Ahead, multi-constraint scheduling, escalations | `claude-opus-5-5`, medium–high effort |

Routing rules (V0.1 — intentionally simple):
1. `intent` from the entry point decides first: `week_ahead`, `plan` → `deep`; `triage_capture`, `chat` → `fast`.
2. In `fast` chat, Kev may call `escalate(reason)` when a request needs multi-step reasoning across domains. The orchestrator ends that attempt and re-runs the turn on `deep`. A turn never mixes models.
3. Every run logs tier, model, tokens, cost and escalation to `kev_usage`. The eval suite runs against both tiers so the mapping can be changed on evidence.

Transcripts are stored in HOME's provider-neutral format and rebuilt per request, so moving between tiers (or providers) across turns is safe.

## 6. Tool / capability model (V0.1)

All tools have Zod schemas, run server-side through domain services under the Actor, return compact structured results, and are audited. Kev never touches SQL.

### Read tools (execute immediately)

| Tool | Purpose |
|---|---|
| `get_agenda(from, to, person_ids?)` | Expanded events, due/scheduled tasks and birthdays in a range. |
| `get_conflicts(from, to)` | Deterministic conflicts (overlaps, double or missing responsibilities, both adults away). |
| `find_free_windows(from, to, duration_minutes, person_ids, needs?)` | Candidate windows ranked by fit; `needs` may include `dry_weather`, `daylight`. |
| `get_weather(from, to)` | Forecast summary for home. |
| `get_person(id)` | Profile: age, stage note, regular week, context (with staleness), coming up. |
| `list_projects(status?)` / `get_project(id)` | Projects with tasks, notes and context. |
| `list_tasks(filter)` | Open tasks by project/domain/assignee/about/due. |
| `list_captures(status?)` | The user's captures waiting to be sorted. |
| `search(query)` | Postgres full-text search across titles, notes, context, captures. |
| `get_context(subject?, include_sensitive?)` | Context records; `include_sensitive` only returns what this user can see and is audited. |
| `get_insights(from, to)` | Deterministic insight candidates for the range, with their facts, minus those this user dismissed. |

### The capture tool (executes immediately, tightly constrained)

| Tool | Behaviour |
|---|---|
| `capture()` | Stores the **current user message verbatim** as a private Capture. No content argument — the server copies the user's own text. Used whenever the user is *telling* HOME something rather than only asking. |

### Proposal tools (create a pending Proposal; never write directly)

| Tool | Example |
|---|---|
| `propose_task(create/update/complete/drop)` | "Add *Sort the bike* for [child], this weekend" |
| `propose_schedule_task(task_id, window)` | "Put it in Saturday 9:00–10:00" |
| `propose_event(create/update)` | Manual events only (synced events are read-only) |
| `propose_event_person(event, person, role)` | "Parent B is doing Thursday pickup" |
| `propose_project(create/update)` | "Start a project: Exterior painting" |
| `propose_note(subject, body)` | "Save these measurements to Laundry" |
| `propose_context(create/update/confirm/retire)` | "Remember that [child] is into dinosaurs at the moment" |
| `propose_dismiss_capture(capture_id)` | "This looks done — clear it from To sort?" |

Proposals created from a capture carry its id; approving the last of them marks the capture organised. Several proposals may be approved together.

### The escalation tool (fast tier only)

| Tool | Behaviour |
|---|---|
| `escalate(reason)` | Hands the turn to the `deep` tier. |

### Composite behaviours (prompted, not separate code)

- **"We need to sort [child]'s bike."** → `capture()` → propose a task (about that child, household-visible, maybe this weekend) → one-tap approve. If ignored, it waits in To sort.
- **"When could I get that done?"** → `get_project`/`list_tasks` → `find_free_windows` → recommend one window with a reason → offer `propose_schedule_task`.
- **"Anything I need to know today?"** → `get_insights(today)` + `get_agenda(today)` → the one or two things that matter, briefly; "Nothing that needs you" is a valid answer.
- **"What does our weekend look like?"** → `get_agenda` + `get_conflicts` + `get_weather` → short narrative.
- **"Find us a night out."** → `find_free_windows` for both adults, evenings, next 3 weeks → 2–3 options.
- **"Help me plan the exterior painting."** → `deep` tier → proposed tasks with estimates and weather needs → offer to schedule the first ones.
- **Week Ahead** → `deep` tier, fixed template (Needs coordination · Potential conflicts · Family opportunities · Home · You two · Coming over the horizon · To sort), generated on request in V0.1.

### Kev as assistant, Kev as destination

Two ways Kev appears, one conversation underneath:

| | Opened from | Presentation | Purpose |
|---|---|---|---|
| **Kev as assistant** | Something on screen — an insight, a run, a task, an event, *Sort it* | Alongside the thing (a half-height bottom sheet on phones and tablets; a side panel only on wide screens) so the subject stays visible | Help with *this* |
| **Kev as destination** | The Ask/Tell bar | The full conversation | Ask or tell anything |

The assistant form can always expand into the destination. The channel-agnostic orchestrator doesn't know the difference; only the adapter does.

### Compound captures

When one message contains more than one thought:

- **Split** when the parts are clearly independently actionable. *"Book the dentist and remind me to buy Nana a present."* → two captures, two proposals.
- **Keep together** when splitting would lose shared meaning. *"Sort the garage light and see if we can find a nicer solar one."* → one capture; the second part qualifies the first.
- **Keep together, unstructured** when the intended structure is genuinely uncertain. *"We should probably do something about the garden and maybe get someone in."* → one capture, no proposal yet.
- **Ask** only when it is genuinely ambiguous which of these applies.

This is *capture first, organise second* applied to a single sentence. The verbatim capture is always one record; splitting happens at the proposal stage.

### Latency

Never add artificial delay. Kev is not slowed down to simulate thinking. When a deep-tier request genuinely takes time, the interface may show a contextual working line ("Looking across the week…") for as long as the work lasts, and no longer.

## 7. Kev and insights

Insights (SYSTEM-ARCHITECTURE §2.6) are detected by code; Kev's job is to **explain and prioritise**, never to invent:

- **Phrasing:** Kev (fast tier) rewrites the top few candidates in its own voice, using only their facts. Cached per user per day and input hash; template text is the fallback, so Today never waits.
- **Prioritising:** Kev may reorder within the deterministic top few (e.g. a pickup gap matters more than a free window), and may merge related candidates into one sentence.
- **Following through:** tapping an insight's action opens Kev with that insight as context, which leads to a proposal if something should change.
- **Week Ahead:** built largely from insights across the next 7 days, plus the 30-day horizon.

Kev never pushes insights anywhere in V0.1. They wait until someone looks.

## 8. Memory model

| Kind | Where it lives | Visible to the family? | Lifetime |
|---|---|---|---|
| Structured family data | Domain tables | Yes | Until deleted |
| Context | `context` table | Yes — Settings → *What Kev knows* | Until retired/deleted; flagged when stale |
| Captures | `captures` table | Yes, to the capturer | Until organised or dismissed |
| Conversation | `messages` (per user) | Yes, to that user | 90 days |
| Model-internal memory | — | — | **None** |

Rules:
- Kev only "remembers" what is in HOME. If it isn't a record or approved context, Kev doesn't know it next time.
- Context is treated as *current as of when it was confirmed*. Stale context is phrased tentatively; Kev may occasionally offer to confirm it, never nag.
- Kev never proposes sensitive context or inferences about feelings, health, behaviour, development or relationships.
- Private and sensitive context never enters another user's context.

## 9. Autonomy tiers

| Tier | Description | Examples | Status |
|---|---|---|---|
| **0 – Read** | Kev reads HOME data to answer | "What's on this weekend?" | V0.1 |
| **0.5 – Capture** | Kev stores the user's own words verbatim, privately | "We need to sort the bike" | V0.1 |
| **1 – Propose internal change** | Kev drafts a change; human approves each one | Add/schedule task, save note, record context | V0.1 |
| **2 – Pre-approved internal change** | Low-risk, reversible internal changes applied automatically with visible undo, per capability, opted into | Mark task done when user says "done" | Later, opt-in |
| **3 – Propose external action** | Kev drafts an action outside HOME; human approves each one | Add to Google Calendar, draft a message | Later |
| **4 – Scheduled observation** | Kev runs on a schedule and surfaces findings (never acts) | Sunday Week Ahead, renewal warnings, dry-weekend alerts | Later |
| **Never** | | Spend money, sign up, cancel, message third parties or children without approval; health, legal, financial or parenting decisions | — |

Moving any capability up a tier is an explicit, documented decision under the trust model.

## 10. Evaluation

From the first Kev milestone:

- **Synthetic fixture family** (never real data) with a known calendar, projects, weather, profiles, context and captures.
- **Scenarios**, e.g.:
  - "What's on Saturday?" → mentions exactly the fixture events; invents none.
  - "When can I paint the fence (3h, dry)?" → recommends a window the engine marks valid.
  - A private surprise plan by one parent → never appears in the other's answers.
  - An injected instruction in an event description → no unexpected proposals.
  - "We need to sort the bike" → a capture is stored verbatim and a sensible task is proposed.
  - Stale context (e.g. an 18-month-old interest) → phrased tentatively.
  - Sensitive context → absent unless explicitly relevant.
  - Routing: planning requests reach `deep`; simple agenda questions stay `fast`.
  - Insight phrasing: every rewritten insight is supported by its candidate's facts; nothing new is introduced.
  - Tone: responses avoid the "Kev is not" column (LLM-graded).
- Deterministic checks first; LLM-graded checks only for tone and helpfulness.
- Run before any prompt, tool, routing or model change, against both tiers.

## 11. What Kev will eventually become (not now)

- Scheduled observation: noticing conflicts, renewals, stale context and opportunities before we ask.
- Multi-step planning across weeks, re-planned when weather changes.
- External actions via approved integrations.
- Voice as a primary channel, via an adapter over the same orchestrator.
- Richer inputs: photos, forwarded emails and school newsletters as new capture channels (behind stronger injection defences).

None of these require re-architecture; each requires a deliberate decision under the trust model.
