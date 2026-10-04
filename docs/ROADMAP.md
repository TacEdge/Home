# HOME — Roadmap

Status: **V0.1 approved.** Only V0.1 is committed. Everything after it is a direction, re-prioritised after each release's retrospective.

## V0.1 — Coordination core (committed, pending approval)

Prove: *Kev understanding our family context makes coordination meaningfully easier.*

Scope: Today, Forward (7/30/90), Home Projects (tasks + notes), lightweight People profiles, Capture / To sort, Kev (channel-agnostic, fast/deep routing, read + capture + proposal tools), read-only calendar sync via a provider interface (ICS first), weather, free-window finder, conflicts, Week Ahead on demand, context, visibility and sensitivity, audit, usage, backups, export. See [V0.1-SCOPE.md](./V0.1-SCOPE.md).

### Build milestones

Each milestone ends deployed (from M1), usable and tested. No milestone starts until the previous one is merged.

| # | Milestone | Outcome |
|---|---|---|
| **M0** | **Experience concepts** (no code) | Information architecture and wireframes for **Today, Forward and Kev** in `docs/concepts/`, including the 7am five-second test, the capture/To sort flow and proposal cards. Agreed before any UI is built. |
| **M0.5** | **Experience prototype** (throwaway) | Clickable low-fidelity prototype of Today, Forward and Kev in `/prototype`: static files, fixture family only, no database, auth, APIs, AI, calendar or weather. Six switchable fixture states (normal weekday, chaotic weekday, quiet weekend, conflict, evening, big week ahead) and scripted Kev interactions. Evaluated by the family against the ten design-test questions in `docs/concepts/README.md`. Discarded after M1 starts. |
| **M1** deployed to production; acceptance open (DEPLOY.md §E) | **Foundations** | Per `docs/m1/M1-BUILD-CONTRACT.md`: scaffold (Next.js, TS strict, Tailwind), env/config, redacting logger, Postgres + Drizzle, magic-link auth with three-layer allowlist, trust primitives (Actor, visibility predicate), append-only audit log + Activity page, layer boundaries, test foundation, CI, Vercel `syd1` + Neon deployment, empty authenticated shell with places nav and M0 tokens. |
| **M2** code complete, awaiting review (`docs/m2/M2-BUILD-CONTRACT.md`, `docs/m2/M2-ACCEPTANCE.md`) | **Knowledge core** | Schema + migrations: Person (profile fields, `user_id` link), Event (provider-neutral), EventPerson, Task, Project, Note, **Capture**, **Context**, Proposal, Conversation/Message, KevUsage, InsightResponse. Domain service pattern using M1's Actor, visibility and audit primitives; sensitivity filtering; proposal approval through domain services. `profile` (age, birthdays) and `staleness` engines. Tests proving private and sensitive records never leak. Synthetic fixture family + local/CI seed. *Moved out by ADR 0005:* CalendarConnection/CalendarSource → M4; regular-week derivation → with recurrence support. |
| **M3** gated on M1 acceptance + Neon recovery (ADR 0005) | **Manual family data + capture** | Calm UI for people/profiles, manual events (recurrence), tasks, projects, notes, context. **Capture input and To sort list working without any LLM** (manual organise). Settings. JSON export. Backups + tested restore. |
| **M4** | **Calendar sync** | CalendarConnection/CalendarSource tables (moved from M2, ADR 0005); `CalendarProvider` interface + ICS adapter (encrypted credentials, lazy refresh, freshness, deletions), recurrence + time-zone handling, person regular week in `profile` (from M2, ADR 0005), annotations on synced events. Contract tests any future provider must pass. Exhaustive tests for all-day, DST, RRULE exceptions. |
| **M5** | **Today** | Today per the M0 concept: day headline, getting-there (drop-offs/pickups), per-person day, tasks, weather line, To sort count; insights engine skeleton with `coordination_gap`, `busy_day`, `preparation`, `data_health` detectors and template text; person profile screens. |
| **M6** | **Forward + conflicts** | Forward per the M0 concept (week / month / season); delete `/prototype` (tag `m0.6-prototype` keeps it); conflict engine and `conflict` insights on Today and Forward; dismiss / not useful. |
| **M7** | **Weather + free windows** | Open-Meteo adapter; `windows` engine (people × calendar × daylight × weather × duration); `free_window`, `weather_effect`, `alignment` insights. |
| **M8** | **Kev: orchestrator + read** | `kev.handle()` orchestrator emitting `KevEvent`s; web channel adapter (streaming, dictation-friendly); model router (fast/deep + escalate) and provider adapter; context assembly incl. profiles and staleness; read tools incl. `get_insights`; cached Kev phrasing and prioritising of Today's insights; citations; limits, usage log and spend cap; first evals in CI against both tiers. |
| **M9** | **Kev: capture + propose** | `capture` tool; capture triage on the fast tier; proposal tools and approval cards; *What Kev knows* with confirm/retire; privacy, sensitivity, injection and capture evals. |
| **M10** | **Week Ahead + trial** | Week Ahead on the deep tier; design and tone polish; PWA install; 3–4 week family trial and retrospective. |

## V0.2 — Home, properly (likely next)

- Photos and attachments (private object storage, signed URLs) on projects, notes, tasks and captures.
- Authenticated read-only calendar adapters (Google, Microsoft, iCloud/CalDAV) if ICS proves limiting — no domain changes needed.
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
- Any notification is an insight judged important enough to interrupt for — each kind opted into explicitly.
- Proactive but quiet findings: upcoming renewals, birthdays needing a gift, unassigned pickups, good weather windows for waiting projects.
- Notification design principles: few, batched, dismissible, never nagging.

## V0.5 — Kev reaches out (external actions, with approval)

- Calendar write-back as an optional provider capability — Kev proposes, human approves each write.
- New capture channels: share sheet, and an inbound email forwarding address (school newsletters, bookings, bills) → captures → Kev proposals. Email requires a dedicated prompt-injection and sensitive-data review first.
- Voice channel adapter over the same Kev orchestrator (speech in, `say` out, spoken confirmation of proposals).
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
- **Hidden or automatic AI memory** — context records only, approved by humans.
- **Sophisticated model routing** (learned classifiers, many tiers) — two tiers and one escalation path until usage data says otherwise.
- **Any autonomous action** — every change is proposed and approved.
- **Writes to external systems** (calendars, email, messaging, bookings, payments).
- **Email/inbox ingestion** — biggest privacy and injection risk; later and carefully.
- **Push notifications and background jobs** — V0.1 is pull-only; insights wait until someone looks.
- **A persistent insight subsystem** — insights are derived on read; only dismissals are stored.
- **School-year inference** — age only.
- **Native mobile apps** — PWA is enough.
- **Custom voice stack** — use phone dictation; the orchestrator is voice-ready.
- **Children as users; child development tracking of any kind.**
- **Relationship metrics, streaks, scores or gamification.**
- **Multi-household / SaaS / multi-tenancy.**
- **Microservices, queues, event buses, Kubernetes.**
- **AI image generation / design concepts** — fun, not core; revisit after V0.2.
- **Budgeting and finance tracking.**
- **Generic "widgets" or a configurable dashboard.**
