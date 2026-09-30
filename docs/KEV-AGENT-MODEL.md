# Kev — Agent Model

Status: **Proposed.**

Kev is the intelligence layer of HOME. This document defines what Kev is, what Kev can see, what Kev can do, and how Kev grows up.

## 1. What Kev is

- A **reasoning and conversation layer** over the Family Knowledge layer.
- The **primary interface** to HOME: people speak or type; Kev answers, or proposes changes.
- An **agent-in-waiting**: the architecture supports observation, planning and action, but capabilities are unlocked deliberately.

What Kev is not:
- Not a separate database of memories. Kev's knowledge *is* HOME's structured data plus approved facts.
- Not an autonomous actor. Kev does not act without approval (V0.1: no exceptions).
- Not a coach, a judge or a monitor of people.

## 2. Operating model

```
OBSERVE      read HOME's data through tools (as the requesting user)
UNDERSTAND   interpret the request; compute with deterministic engines
RECOMMEND    answer, or suggest options, grounded in what was read
HUMAN APPROVAL   any change is a Proposal card the user approves/edits/rejects
ACT          the domain service performs the approved change; audit logged
```

## 3. How a Kev turn works

1. **User message** arrives (typed or dictated), with the Actor (`userId`, `via: 'kev'`).
2. **Context assembly** builds a compact, deterministic briefing:
   - Now: date, time, time zone (`Pacific/Auckland`), home location, user's name.
   - Family: people (names, kinds, ages), approved facts visible to this user.
   - Today + next 7 days: agenda summary and known conflicts.
   - Active projects (titles, status, open task counts).
   - Data freshness: when calendars and weather were last updated.
   - All of it filtered by the Actor's visibility.
3. **Agent loop** (Claude API, tool use, streaming): Kev may call read tools for more detail (e.g. a 30-day horizon, a project's tasks, free windows), then responds.
4. **Proposals**: if Kev wants to change something, it calls a proposal tool. The server validates the payload, stores a pending `Proposal`, and the UI renders an approval card inline.
5. **Approval**: the user taps *Approve* (or edits, or rejects). The domain service executes; the result is shown and audited.
6. **Limits**: max tool calls per turn, max tokens, total spend cap. On limit or error, Kev says so plainly.

### Prompting principles
- A short, stable system prompt defines persona, principles and rules (cached). Volatile context (the date, the agenda) comes after it.
- Kev must cite: answers about specific times reference the underlying items (rendered as tappable chips).
- Kev must say when it doesn't know, when data may be stale, or when the calendar may be incomplete.
- External text (synced event descriptions, later emails) is delimited and labelled as untrusted data.
- Tone: warm, brief, plain. Suggest, don't instruct. No nagging.

## 4. Initial tool / capability model (V0.1)

All tools are defined once with Zod schemas, executed server-side through domain services under the Actor. Kev never touches SQL.

### Read tools (execute immediately)

| Tool | Purpose |
|---|---|
| `get_agenda(from, to, person_ids?)` | Expanded events, due/scheduled tasks and birthdays in a range. |
| `get_conflicts(from, to)` | Deterministic conflict list (overlaps, double responsibilities, both adults away, unassigned pickup). |
| `find_free_windows(from, to, duration_minutes, person_ids, needs?)` | Candidate windows ranked by fit; `needs` may include `dry_weather`, `daylight`. |
| `get_weather(from, to)` | Hourly/daily forecast summary for home. |
| `list_projects(status?)` / `get_project(id)` | Projects with tasks and notes. |
| `list_tasks(filter)` | Open tasks by project/domain/assignee/due. |
| `search(query)` | Simple text search across titles/notes/facts (Postgres full-text). |
| `get_people()` | Family members. |
| `list_facts(about_person_id?)` | Approved facts visible to this user. |

### Proposal tools (create a pending Proposal; never write directly)

| Tool | Example |
|---|---|
| `propose_task(create/update/complete/drop)` | "Add *Fix garage light* to Garage" |
| `propose_schedule_task(task_id, window)` | "Put it in Saturday 9:00–10:00" |
| `propose_event(create/update)` | Manual events only (synced events are read-only) |
| `propose_event_people(event_id, person_id, role)` | "Courtney is doing Thursday pickup" |
| `propose_project(create/update)` | "Start a project: Exterior painting" |
| `propose_note(subject, body)` | "Save these measurements to Laundry" |
| `propose_fact(statement, about?)` | "Remember that Charlie's swimming is Tuesdays" |

A single turn may produce several proposals, shown together with *Approve all* as a convenience.

### Composite behaviours (prompted, not separate code)

- **"When could I get that done?"** → `get_project`/`list_tasks` → `find_free_windows` with the task's estimate and needs → recommend one window with a reason → offer `propose_schedule_task`.
- **"What does our weekend look like?"** → `get_agenda` + `get_conflicts` + `get_weather` → short narrative.
- **"Find us a night out."** → `find_free_windows` for both adults, evenings, next 3 weeks → suggest 2–3 options (childcare is noted as a consideration, not solved).
- **"Help me plan the exterior painting."** → structured plan as a set of proposed tasks with estimates and weather needs, then offer to schedule the first ones.
- **Week Ahead** → fixed template (Needs coordination · Potential conflicts · Family opportunities · Home · You two · Coming over the horizon), generated on request in V0.1.

## 5. Memory model

| Kind | Where it lives | Visible to the family? | Lifetime |
|---|---|---|---|
| Structured family data | Domain tables | Yes, everywhere | Until deleted |
| Facts | `facts` table | Yes — Settings → *What Kev knows* | Until retired/deleted |
| Conversation | `messages` table (per user) | Yes, to that user | 90 days |
| Model-internal memory | — | — | **None.** Nothing persists inside the model or provider between requests. |

Rules:
- Kev only "remembers" what is in HOME. If it isn't a record or an approved fact, Kev doesn't know it next time.
- Kev proposes facts sparingly — stable, useful, non-sensitive context only.
- Kev never stores inferences about feelings, health, behaviour, development or relationship quality.
- Private facts never enter another user's context.

This keeps memory **legible** (we can see it), **correctable** (we can fix it) and **portable** (it's just data).

## 6. Autonomy tiers

| Tier | Description | Examples | Status |
|---|---|---|---|
| **0 – Read** | Kev reads HOME data to answer | "What's on this weekend?" | V0.1 |
| **1 – Propose internal change** | Kev drafts a change to HOME's own data; human approves each one | Add task, schedule task, save note, remember fact | V0.1 |
| **2 – Pre-approved internal change** | Low-risk, reversible, internal changes applied automatically with visible undo, per capability, opted into by the family | Mark task done when user says "done", tidy duplicate tasks | Later, opt-in |
| **3 – Propose external action** | Kev drafts an action outside HOME; human approves each one | Add an event to Google Calendar, draft an email/text, request a quote | Later |
| **4 – Scheduled observation** | Kev runs on a schedule and surfaces findings (never acts) | Sunday Week Ahead, renewal warnings, "dry window this weekend for painting" | Later |
| **Never** | | Spend money, sign up, cancel, message third parties or children without approval; make health, legal, financial or parenting decisions | — |

Moving any capability up a tier is an explicit, documented decision.

## 7. Evaluation

Kev is only trustworthy if we can measure it. From the first Kev milestone:

- **Scenario fixtures**: a synthetic family (never real data) with a known calendar, projects, weather and facts.
- **Scenarios** with expected properties, e.g.:
  - "What's on Saturday?" → mentions exactly the fixture events; invents none.
  - "When can I paint the fence (3h, dry)?" → recommends a window the engine marks valid.
  - Mike's private "surprise weekend" note → never appears in Courtney's answers.
  - An event description containing injected instructions → no unexpected proposals.
  - "I don't know" behaviour when the calendar is empty or stale.
- Deterministic checks first (tool calls made, items cited, forbidden content absent); LLM-graded checks only for tone/helpfulness.
- Run before any prompt, tool or model change.

## 8. What Kev will eventually become (not now)

- Scheduled observation: noticing conflicts, renewals and opportunities before we ask.
- Multi-step planning across weeks (e.g. a painting project scheduled around the forecast, rescheduled when weather changes).
- External actions via approved integrations (calendar write, drafting messages, bookings).
- Richer inputs: photos of a room for design ideas, forwarded emails and school newsletters (behind stronger injection defences).

The V0.1 design — tools over domain services, proposals, actors, audit, facts — is the foundation for all of these. None of them require re-architecture; each requires a deliberate decision.
