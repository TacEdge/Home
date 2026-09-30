# HOME — Roadmap

Status: **Proposed.** Only V0.1 is committed. Everything after it is a direction, re-prioritised after each release's retrospective.

## V0.1 — Coordination core (committed, pending approval)

Prove: *Kev understanding our family context makes coordination meaningfully easier.*

Scope: Today, Forward (7/30/90), Home Projects (tasks + notes), Kev with read + proposal tools, read-only calendar sync, weather, free-window finder, conflicts, Week Ahead on demand, facts, visibility, audit, backups, export. See [V0.1-SCOPE.md](./V0.1-SCOPE.md).

### Build milestones

Each milestone ends deployed, usable and tested. No milestone starts until the previous one is merged.

| # | Milestone | Outcome |
|---|---|---|
| **M1** | **Foundations** | Repo scaffold (Next.js, TS strict, Tailwind, Drizzle, Vitest, Playwright), lint rules incl. layer boundaries, CI (lint, typecheck, test), deploy to hosting, magic-link auth with allowlist, empty authenticated shell with calm base design tokens. |
| **M2** | **Knowledge core** | Schema + migrations for People, Users, Events, EventPerson, Tasks, Projects, Notes, Facts, Proposals, AuditLog. Actor context, visibility filtering and audit in the domain layer, with tests proving private records never leak. Synthetic fixture family + seed. |
| **M3** | **Manual family data** | Minimal, calm UI to manage people, manual events (with recurrence), tasks, projects and notes. Settings pages. Export to JSON. Backups configured and a restore tested. |
| **M4** | **Calendar sync** | ICS adapter (encrypted URLs, lazy refresh, freshness), recurrence + time-zone handling, person/responsibility annotations on synced events. Exhaustive tests for all-day, DST boundaries, RRULE exceptions. |
| **M5** | **Today** | The Today screen from real data: per-person day, pickups/drop-offs, tasks due/scheduled, weather line. |
| **M6** | **Forward + conflicts** | 7/30/90-day horizon, deterministic conflict engine, quiet conflict surfacing on Today and Forward. |
| **M7** | **Weather + free windows** | Open-Meteo adapter with caching; `windows` engine (people × calendar × daylight × weather × duration), tested against fixtures. |
| **M8** | **Kev: read** | Chat UI (streaming, dictation-friendly), context assembly, read tools, citations to items, limits and spend cap, audit of tool calls, first eval scenarios running in CI. |
| **M9** | **Kev: propose** | Proposal tools, approval cards (approve / edit / reject / approve all), execution through domain services, facts proposals and *What Kev knows* screen, injection and privacy evals. |
| **M10** | **Week Ahead + trial** | Week Ahead template, polish pass on design and tone, PWA install, then a 3–4 week live family trial and retrospective. |

## V0.2 — Home, properly (likely next)

- Photos and attachments (private object storage, signed URLs) on projects, notes and tasks.
- Project depth: measurements, materials, rough costs — only as structure proven necessary by V0.1 notes.
- Kev planning a project end-to-end, scheduled around weather, re-planned when forecasts change (still proposal-based).
- Life Admin basics: Assets (vehicles, appliances), renewals and recurring maintenance generating tasks/events.

## V0.3 — Family and Us

- Ideas & Places (things to do, restaurants, weekends away, things one of us mentioned) with private visibility for surprises.
- Us: date-night finder, anniversaries, intentional-time opportunities — suggestions, never scores.
- Family: activities, experiences, traditions, age/stage-appropriate ideas, milestones and memories (with photos).
- Kev suggestions using web search for local events and ideas (clearly sourced).

## V0.4 — Kev looks ahead (scheduled observation)

- Sunday Week Ahead generated automatically; one gentle notification.
- Proactive but quiet findings: upcoming renewals, birthdays needing a gift, unassigned pickups, good weather windows for waiting projects.
- Notification design principles: few, batched, dismissible, never nagging.

## V0.5 — Kev reaches out (external actions, with approval)

- Two-way calendar integration (Google/Apple APIs) — Kev proposes, human approves each write.
- Inbound email forwarding address (school newsletters, bookings, bills) → Kev extracts proposals. Requires a dedicated prompt-injection and sensitive-data review first.
- Drafting (not sending) messages.

## Later / maybe

- Tier-2 autonomy for specific low-risk actions, opted into per capability.
- Wall/kitchen display mode for Today.
- Custom voice interface.
- Accounts for older children or grandparents, with scoped visibility.
- Field-level encryption for sensitive Life Admin records; document vault.

## Not yet — deliberately not building

These are excluded on purpose. Revisiting any of them is a decision, not drift.

- **Vector database / embeddings / RAG** — the data fits in structured queries.
- **Hidden or automatic AI memory** — facts only, approved by humans.
- **Any autonomous action** — every change is proposed and approved.
- **Writes to external systems** (calendars, email, messaging, bookings, payments).
- **Email/inbox ingestion** — biggest privacy and injection risk; later and carefully.
- **Notifications and background jobs** — V0.1 is pull-only.
- **Native mobile apps** — PWA is enough.
- **Custom voice stack** — use phone dictation.
- **Children as users; child development tracking of any kind.**
- **Relationship metrics, streaks, scores or gamification.**
- **Multi-household / SaaS / multi-tenancy.**
- **Microservices, queues, event buses, Kubernetes.**
- **AI image generation / design concepts** — fun, not core; revisit after V0.2.
- **Budgeting and finance tracking.**
- **Generic "widgets" or a configurable dashboard.**
