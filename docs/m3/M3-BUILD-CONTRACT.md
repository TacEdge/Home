# M3 — Manual Family Data + Capture: Build Contract

Status: **Approved** by the owner, 2026-10-04 (decisions in ADR 0006). This contract is Package 0; it changes no code.
Implementers: per package (§2.3). Reviewer: Opus reviews every package before the owner merges it.

M3 is the milestone where HOME becomes visibly usable. At the end of M3 each adult can open HOME on a phone or iPad, see the household, enter and correct it by hand, look at today and the next 30 days, capture anything in one input and sort it later, look after what Kev knows, review Activity, and download their data. **There is no Kev, no calendar sync, no insights and no weather.** Everything is deterministic and works without an LLM.

Authoritative references: `CLAUDE.md`, `docs/PRODUCT-PRINCIPLES.md`, `docs/BRAND.md`, `docs/concepts/`, `docs/FAMILY-DATA-MODEL.md`, `docs/SYSTEM-ARCHITECTURE.md`, `docs/decisions/0001–0006`, `docs/runbooks/`. Where this contract narrows or defers part of those documents, ADR 0006 records it. If anything else conflicts, stop and ask.

---

## 0. Relationship to M1 and M2

- **M2 is complete** (ADR 0005, `docs/m2/M2-ACCEPTANCE.md`, closed by PR #29). Every service, rule and test M2 established stays in force; M3 builds on them and changes none of their guarantees.
- **M1 is deployed but not accepted** (`docs/runbooks/DEPLOY.md` §E). M3 *development* proceeds now on synthetic data in local and Preview (ADR 0006 §1). **Real household data in Production stays blocked** until the real-data gate (§6) opens, which requires every §E item, including Neon recovery, plus M3's restore rehearsal and export check.
- M3 must not change any M1 security control (sign-in gate, the single public auth endpoint, allowlist layers, fixed sessions, the runtime/app role, boot guards, headers, CI and workflow boundaries), nor credentials or Vercel, Neon, Postmark or GitHub settings. Owner-run steps (setting `HOME_REAL_DATA`, the restore rehearsal on `home`) are written as runbook steps, never automated.

---

## 1. Scope

### 1.1 Build

| Area | What |
|---|---|
| **Shell** | The ⌂ menu of quiet places, the Today/Forward switch, the capture bar on every place, the `src/ui` primitive set, the server-action and error-copy pattern (§4). |
| **Real-data gate** | `HOME_REAL_DATA`, fail-closed in Production (§6). |
| **Screens** | Today (factual), Forward (plain 30 days), People and profiles, Home projects, To do, events, notes on their subject, To sort, Settings (You, What Kev knows, Archived, Activity, Export) (§3). |
| **Engines** | `recurrence` (limited RRULE model) and `agenda` (day and range views), pure and exhaustively tested (§5). |
| **Capture organisation** | One domain function that organises a capture by hand through the proposal executor (§3.8). |
| **Export** | Versioned JSON of the actor's authorised view, sensitive context only on explicit opt-in (§7.1). |
| **Recovery** | Restore runbook and a recorded rehearsal (§7.2). |
| **Brand fix** | Accessible Mist for text (ADR 0006 §5, amending ADR 0004). |
| **Tests** | Engine unit tests, integration tests for new domain code, Playwright flows at four viewports with an accessibility scan, a two-adult privacy sweep over the UI (§8). |

### 1.2 Do not build

- **No migrations planned.** M2's schema already holds everything M3 uses (ADR 0006 §9). If one turns out to be needed, it is a contract amendment and follows migration-first (`docs/runbooks/MIGRATIONS.md`) as its own migration-only PR.
- No Kev: no orchestrator, model calls, prompts, tools, Kev UI or Kev transcript/usage recording (decision moved to M8, ADR 0006 §12). The capture bar is not a Kev input.
- No calendar sync, CalendarConnection/CalendarSource, ICS, credential storage, imported-calendar recurrence or editing a single occurrence (M4).
- No regular-week derivation (M4, ADR 0005 §4).
- No Today intelligence (M5): no meaning headline, per-person day, getting-there runs, **Who?** chips, *Worth knowing*, insights engine, evening mode or time-of-day orb.
- No Forward intelligence (M6): no conflicts, coordination, 7/30/90 switch or Week Ahead.
- No weather, free windows or other M7 work.
- No purge execution (archived 30-day, dismissed captures, 90-day conversations): deferred (ADR 0006 §8).
- No import, no restore from export.
- No sheets or intercepting routes; full pages only (ADR 0006 §10).
- No seeding of `home-dev` or Production; the fixture seed stays local and CI only.
- No push notifications, background jobs, scheduled workflows or service workers. No PWA install (M10).
- No new runtime dependency except `rrule` (§5). Dev dependencies (e.g. an axe-core Playwright integration) need a one-line justification in their PR.
- No real household data anywhere in the repository, tests, screenshots, PR text or logs.

---

## 2. Implementation order

### 2.1 Packages are acceptance boundaries

Each package below is an acceptance boundary, not a one-PR limit. A package may be split into smaller PRs when its size warrants it, without changing its approved architecture or scope (ADR 0006 §13). Every PR is application-only, stops when CI is green, and is merged by the owner.

### 2.2 Packages

| # | Package | Contents | Depends on |
|---|---|---|---|
| **0** | Contract and doc truth | This contract, ADR 0006, corrected status in ROADMAP, CLAUDE.md, README, M2-ACCEPTANCE, DEPLOY, MIGRATIONS, BRAND/ADR 0004 amendment. Docs only. | — |
| **1** | Shell, primitives, real-data gate | ⌂ menu and `places.ts` update; a layout slot for the capture bar (nothing rendered until Package 7, so no input ever appears that cannot keep what is typed); `src/ui` primitives (§4.2); server-action + error-copy pattern (§4.3); accessible Mist tokens with a contrast test; `HOME_REAL_DATA` gate (§6) with tests and DEPLOY.md env table row; Playwright helper signing in as a fixture adult over seeded data; accessibility scan wiring. No product screens. | 0 |
| **2** | Export and recovery runbook | Export service and route (§7.1), completeness guard, sensitive opt-in, audit; `/settings/export`; DEPLOY.md §D restore procedure and §E rehearsal steps (§7.2). | 1 |
| **3** | People and You | `/people`, profile, create, edit, archive, restore; `/settings/you` linking (§3.4); the Today "Which one is you?" line. | 1 |
| **4** | Recurrence and agenda engines | `src/domain/engines/recurrence.ts`, `agenda.ts`; the `rrule` dependency; exhaustive unit tests (§5). Engines only, no screens. | 0 |
| **5** | Events and Forward | Event create, edit, archive, restore; recurrence picker; skip one occurrence; attending/responsible; `/forward`; "Coming up" on a profile. | 3, 4 |
| **6** | Home projects, tasks, notes | `/home`, project pages, `/tasks`, task done/dropped, notes inline on project, person and event. | 3, 5 |
| **7** | Capture and To sort | Capture bar on every place, `/sort`, `organiseCapture` (§3.8), dismiss and undo. | 5, 6 |
| **8** | What Kev knows and Archived | `/settings/knows` (staleness, confirm, retire, reinstate, edit, explicit sensitive reveal); `/settings/archived`; Activity paging and labels. | 3, 6, 7 |
| **9** | Today | The factual Today (§3.2). | 5, 6, 7 |
| **10** | Acceptance and audit | Two-adult UI privacy sweep, accessibility and device pass, export and restore evidence, adversarial audit, `docs/m3/M3-ACCEPTANCE.md`. | all |

Order: 0 → 1 → (2, 3, 4 in parallel) → 5 → 6 → 7 → 8 → 9 → 10.

### 2.3 Implementer by package

| Opus | Fable |
|---|---|
| 0, 1, 2, 4, 7, 10 (contracts, patterns others copy, privacy, export and restore, time correctness, capture provenance, final audit) | 3, 5, 6, 8, 9 (screens on settled services and Package 1's patterns) |

Opus reviews every Fable PR before the owner merges it.

---

## 3. Screens and behaviour

Every detail has its own URL; M3 uses full pages (sheets come later over the same URLs). Every page is a server component reading through the domain services with `requireActor()`; nothing filters private or sensitive data in the UI (CLAUDE.md rule 1).

### 3.1 Routes

| Route | Purpose |
|---|---|
| `/today` | Factual Today (§3.2). |
| `/forward` | Plain 30-day agenda (§3.3). |
| `/people`, `/people/new`, `/people/[id]`, `/people/[id]/edit` | People and profiles (§3.4). |
| `/home`, `/home/projects/new`, `/home/projects/[id]`, `/home/projects/[id]/edit` | Home projects (§3.5). |
| `/tasks`, `/tasks/new`, `/tasks/[id]` | To do (§3.5). |
| `/events/new`, `/events/[id]`, `/events/[id]/edit` | Events (§3.6). |
| `/sort` | To sort (§3.8). |
| `/settings` | Index: You · What Kev knows · Archived · Activity · Export. Calendars (M4) and Usage (M8) are not listed. |
| `/settings/you` | Link or unlink yourself; sign out (§3.4). |
| `/settings/knows` | What Kev knows (§3.9). |
| `/settings/archived` | Archived records and dismissed captures, with restore (§3.10). |
| `/settings/activity` | Exists; gains paging and readable labels. |
| `/settings/export` | Export (§7.1). |

The ⌂ menu lists People, Home, To do, To sort and Settings, driven by `src/ui/places.ts`. The top switch stays Today and Forward. Places still unbuilt (Family, Us, Life admin) are not shown.

### 3.2 Today (factual)

- Headline: the date, written by code ("Wednesday 14 October"). Never a meaning sentence in M3.
- Today's events from the `agenda` engine, all-day first, then by start.
- Tasks due today or earlier and still open; overdue shown in words ("from Tuesday"), never in red.
- "2 things to sort", in words, only when the actor has captures waiting.
- "Which one is you? ›" when the actor has no linked person.
- An intentional empty state ("Nothing on today.").
- No sensitive context, ever.

### 3.3 Forward (plain)

The next 30 days from today in the home time zone, grouped by day, empty days omitted: events (expanded by `agenda`), birthdays (`profile`), open tasks with a due date, active project target dates. No conflicts, coordination marks, horizons switch or Week Ahead. An empty 30 days says so calmly.

### 3.4 People and linking

- List: household people first, then others; colour dot and name; "you" beside the actor's own linked person.
- Profile: name, age and next birthday (`profile`), relationship, stage note as written, *Things to know* (normal context about the person), *Coming up* (agenda for events the person attends or is responsible for, next 30 days), notes. Never sensitive context.
- Create, edit, archive, restore. Rules the services enforce (`linked_person`, `referenced_by_household`) are explained in words on the form, not merely disabled.
- **Linking** (`linkSelf`/`unlinkSelf`, ADR 0005 §19, §22): `/settings/you` lists unlinked, household-visible parents with "This is me". **Add me** creates a parent with the typed name and links it in one transaction. A person already linked to someone else is never offered; a race reads "Someone's already linked to that person." **Not me** unlinks after a confirmation. Nobody can link or unlink another adult. In Production linking is a domain write, so it waits for the gate.

### 3.5 Home projects and To do

- `/home`: projects grouped by status (active, idea, paused, done collapsed). Project page: summary, target date, its tasks, its notes. V0.1 accepts only `domain = home`.
- `/tasks`: open tasks ordered by due date (none last), then project. Done and dropped collapsed. Marking done or dropped is one tap; undo is available.
- Task form: title; then under **More**: notes, project, assignee, about person, due date, estimate, needs, scheduled window, visibility.

### 3.6 Events

- Create and edit timed (start, end, zone defaulting to `HOME_TIMEZONE`) and all-day (date range shown inclusively, stored with the exclusive end, ADR 0005 §26) events: title, kind, domain, location, description, visibility, attending and responsible people.
- **Recurrence** (§5): none, daily, weekly on chosen days, fortnightly, monthly on the same date, yearly; ends never, on a date, or after N times. Edits apply to the **whole series**. **Skip this one** adds an exdate for one occurrence. No single-occurrence edits.
- Synced events render read-only (none exist until M4).

### 3.7 Notes

Notes always live on a subject: a project, person or event. Create and edit inline on the subject's page; archive and restore. There is no notes place and the M3 UI never creates a subject-less note; a free-floating thought is a capture.

### 3.8 Capture and To sort

- **Capture bar** on every place. Placeholder "Tell HOME something…". A plain server-action form that works without JavaScript and calls `captureVerbatim(actor, { text })`. "✓ Kept · in To sort" shows only after the server confirms. On failure the text stays in the box with a calm retry; nothing is persisted on the device. No parsing, classification or modes. (In M8 the same bar becomes "Ask or tell Kev…".)
- **To sort** (`/sort`): the actor's own `new` and `proposed` captures, newest first, words shown exactly, soft relative time. Actions:
  - **Make it a…** task, event, project, note (on a subject) or *Something to know* (context). Opens the normal form prefilled from the words, all editable.
  - **Make another**: a capture may organise into several records.
  - **Not needed**: `dismissCapture`, with Undo (`undismissCapture`). Dismissed captures appear under Archived.
- **`organiseCapture`** (new domain function, `src/domain/captures/` or `src/domain/proposals/`): in **one transaction**, the person creates a proposal for the chosen action against their own capture and approves it, and the existing executor runs it. This reuses the tested executor and capture settlement: the record gets `origin_capture_id`, the capture's `organised_into` and status are settled, provenance is `ui` (ADR 0005 §43), and context so created is sourced `capture`. A failed execution returns the stored outcome and the form shows the reason; nothing half-applies. No second organising path is added.
- No counts beyond "N things to sort", no ageing colours, no reminders.

### 3.9 What Kev knows

- Context grouped by subject (household, each person, each project). Possibly-out-of-date items (`staleness`) first, phrased gently ("Still true?"), with **Confirm**, **Retire**, **Edit**; retired items collapsed with **Reinstate**; archive and restore.
- **Sensitive context** appears only after the person presses **Show sensitive items**: a request that calls the context service with `includeSensitive` (the existing, audited `context.sensitive_read` path). The reveal lasts for that page view only, is never remembered, and is never available on any other screen. Adding the call site updates `tests/unit/sensitive-context-guard.test.ts` deliberately.
- Creating context: subject, content, category, optional valid-until, visibility, and a sensitivity choice explained in plain words.

### 3.10 Archived

Archived records of every type the actor can see, plus their dismissed captures, each with **Restore** (or **Back to To sort**). Copy never implies permanent deletion: no "deleted", "gone" or "removed for good" (ADR 0006 §8).

---

## 4. UI architecture

### 4.1 Rendering and writes

- Pages are server components. Writes are server actions that call domain services with the actor from `requireActor()`, validating with the service's own Zod schema.
- Client components only for: disclosure, date/time inputs, the recurrence picker, inline confirm, the capture bar's pending state. No client-side data layer, no global state, no client import of server modules.
- Core forms submit and work without JavaScript.
- After a write, the action redirects or revalidates; responses are never cached (`no-store` where relevant).

### 4.2 Primitives (`src/ui`)

Page, Headline, Label (mono caps), ItemRow (time · title · who), PersonDot, List (on hairline rules, not boxes), Field (label, hint, error), Button (primary, quiet), EmptyState, ConfirmInline, More (disclosure). One column on phones; from 768px a detail page may use a second column. No tables, card grids, dashboards, badges or counters.

### 4.3 Errors

One table maps domain error codes (`NotFoundError`, `NotPermittedError` codes, Zod issues, the gate) to calm, specific copy. A not-found and an invisible record read the same. Error copy never echoes another person's data.

### 4.4 Brand and copy

- Colour and type only from `src/ui/tokens.css`. Sun only for "needs you" (in M3: overdue tasks and To sort, quietly). People are dots. Nothing is ever red. Headlines never bold.
- Text uses the accessible Mist (ADR 0006 §5); the original Mist is for decorative marks only.
- Copy: warm, calm, concise NZ English; no exclamation marks; private and sensitive explained at the point of choice.

### 4.5 Accessibility and devices

WCAG 2.2 AA: text contrast ≥ 4.5:1 (≥ 3:1 for large text and meaningful non-text marks), every field labelled, logical headings, visible focus, full keyboard operation, touch targets ≥ 44×44px, `prefers-reduced-motion` respected, no horizontal page scroll. Checked at 375×812, 768×1024, 1024×768 and 1280×800.

---

## 5. Engines

Pure, deterministic, under `src/domain/engines/`, importing nothing from `db` or `trust`, exhaustively unit-tested (CLAUDE.md rule 5).

- **`recurrence`**: builds and validates the limited model as an RFC 5545 RRULE string, and expands an event's occurrences within a range in the event's IANA zone, honouring `exdates`.
  - Model: `none`; `daily`; `weekly` with one or more weekdays; `fortnightly` (`FREQ=WEEKLY;INTERVAL=2`, with weekdays); `monthly` on the start's day of month; `yearly` on the start's date. Ends: never, `UNTIL` a date (inclusive, in the event's zone), or `COUNT`.
  - Monthly on the 29th–31st skips months without that day (RFC 5545 behaviour, stated in the UI). Yearly on 29 February occurs only in leap years for events (birthdays keep P-4 via `profile`).
  - Timed occurrences keep their local wall-clock time across DST; a local time that does not exist (spring forward) moves forward by the gap; an ambiguous one (fall back) takes the first instance. All-day occurrences are dates, untouched by DST.
  - Any stored RRULE outside the model is shown read-only as "Repeats (custom)" and is never silently rewritten.
- **`agenda`**: day and range views over manual events (expanded), with all-day items first and timed items by start (ADR 0005 §27); used by Today, Forward and *Coming up*.
- Dependency: **`rrule`** (approved stack, CLAUDE.md). Justified in Package 4's PR. Nothing else is added for time handling.
- Tests: every preset across both NZ DST transitions; all-day and timed; `UNTIL` and `COUNT`; exdates; month-end; 29 February; range boundaries; a zone other than `Pacific/Auckland`.

---

## 6. The real-data gate (ADR 0006 §2)

- **Where:** one check in the domain write path (`src/domain/common/`), reached by **every** function that writes a family-domain table: people, events and annotations, projects, tasks, notes, captures, context, proposals (including approval execution), conversations and messages, `kev_usage`, `insight_response`, and `organiseCapture`.
- **Rule:** when `VERCEL_ENV === 'production'`, a domain write proceeds only if `HOME_REAL_DATA` is exactly the string `open`. Missing, blank, whitespace-padded, differently cased, or any other value keeps the gate **closed**. Outside Production (local, CI, Preview) the gate does not apply, so synthetic development continues.
- **Closed behaviour:** the write is refused with `NotPermittedError('real_data_closed')` before any row is locked or written; the UI shows "HOME isn't open for family data yet." Reads, sign-in, sign-out, session handling, auth audit rows, Activity, boot guards and headers are unaffected.
- **Parsing:** read once in `src/lib/env.ts` as an optional raw string; the gate compares the exact value. An unexpected value never fails boot (so authentication stays operational) and is never logged.
- **Tests:** unit tests for the predicate (exact `open` only; every other value closed; non-production always open). An integration test that, with the production condition simulated, every exported domain write function is refused (reusing the privacy suite's completeness list so a new write function cannot escape), while sign-in audit still writes.
- **Docs:** DEPLOY.md env table gains `HOME_REAL_DATA` (Production only, unset until the gate opens; never set in Preview). Opening the gate is the owner's step in DEPLOY.md §E.

---

## 7. Export and recovery

### 7.1 Export (ADR 0006 §6)

- `/settings/export`: **Download my HOME data**, with an unticked **Include sensitive items**.
- Route handler `POST /settings/export/download` (`Cache-Control: no-store`, `Content-Disposition: attachment`; ADR 0006 §25), server-side actor, built only through the domain services (no second visibility implementation).
- Contents, for the actor: every household and own-private person, event (with annotations), project, task, note, context (normal; sensitive only when ticked, via the audited `includeSensitive` read), own captures, own proposals, own conversations and messages, own insight responses, and the actor's own Activity as Activity shows it. Archived records are included and marked. The other adult's private records never appear.
- Format: JSON `{ "format": "home-export", "version": 1, "exportedAt", "timeZone", "exportedBy": { "personId" }, "includesSensitive", "records": { "<type>": [...] } }` (`src/domain/export/spec.ts`, ADR 0006 §22), ids preserved, stable order (type, then `created_at`, then id). A Zod schema describes version 1.
- Audit: `export.download`, private to the actor, structural meta only (counts per type, whether sensitive was included).
- **Completeness guard** (unit test): fails if any column of an exported domain table is neither exported nor listed as deliberately excluded, so a future column cannot silently fall out of the export.
- No import. Restore is Neon point-in-time restore.

### 7.2 Recovery (ADR 0006 §7)

- Backup: Neon point-in-time restore with ≥ 7 days on `home` (M1-D5; DEPLOY.md §E item 6). No scheduled dump.
- Runbook (`DEPLOY.md` §D): restore to a new branch of `home`, verify (migrations table, row counts, `audit_log` intact and append-only), switch the runtime credential's host, confirm boot, roll back by switching back. Never restore production data into `home-dev`.
- Rehearsal before the gate opens, recorded with dates in DEPLOY.md §E:
  1. `home-dev`, end to end: synthetic data entered through the Preview UI, restore to a branch, switch Preview's runtime host, app boots and shows the data, switch back.
  2. `home`: create a restore branch, verify schema, migrations and `audit_log`, delete the branch. No family data is involved.

---

## 8. Testing requirements

### 8.1 Unit
Engines (§5); the gate predicate; the export schema and completeness guard; token contrast (≥ 4.5:1 for text tokens on `--paper` and `--paper-2`, day and night); error-copy mapping covers every domain error code.

### 8.2 Integration (as `home_app`)
`organiseCapture` for each target type, several records from one capture, failure leaves nothing applied, provenance `ui`; the gate across every write function; export contents per actor (no other adult's private, sensitive only when asked, audited); the M2 suites and the privacy suite unchanged and passing.

### 8.3 End to end (Playwright, seeded fixture family)
- Each package's happy paths at the four viewports in §4.5, with the accessibility scan reporting no serious or critical violations.
- **Two-adult privacy sweep** (Package 10): signed in as each adult, every route, the export file and Activity are checked for the other adult's canary strings and for sensitive markers; none may appear (sensitive only after the owner's explicit reveal on `/settings/knows`).
- Capture works with JavaScript disabled.

### 8.4 Unchanged
`pnpm lint`, `pnpm typecheck`, unit, integration, previous-schema check, bundle check, gitleaks, private-terms scan: all green on every PR.

---

## 9. Documentation

- ADR 0006 records decisions and any implementation clarification a package adds (numbered sections, as ADR 0005 did).
- DEPLOY.md: env table (`HOME_REAL_DATA`), §D restore, §E gate items and rehearsal records.
- `docs/m3/M3-ACCEPTANCE.md` (Package 10).
- ROADMAP and CLAUDE.md status lines at each milestone change.
- FAMILY-DATA-MODEL only if a package changes data behaviour (none planned).

---

## 10. Acceptance criteria

M3 is accepted by the owner when:

1. **Packages:** every package merged by the owner with CI green; no migration (or, if one proved necessary, migration-first followed).
2. **UI behaviour:** every route in §3.1 works for both fixture adults: create, edit, archive and restore for each type; task done and dropped; context confirm, retire, reinstate; link and unlink; calm, specific error copy; intentional empty states; no screen calls or waits on an LLM.
3. **Capture:** the bar stores the exact words and shows "Kept" only after the server confirms, with and without JavaScript; To sort organises into each of the five types with `origin_capture_id`, supports several records per capture, dismiss and undo; captures never reach the other adult anywhere.
4. **Privacy:** the two-adult sweep (§8.3) finds no other-adult private record on any screen, in the export or in Activity; sensitive context appears only after an explicit, audited reveal by an authorised person and never on Today, Forward, a profile or To sort; the M2 privacy suite passes unchanged.
5. **Audit:** every write audited; export audited with counts only; no audit row carries user-written content.
6. **Recurrence:** engine tests cover every preset across both NZ DST transitions, all-day and timed, exdates, month-end and 29 February; Today, Forward and *Coming up* agree with the engine.
7. **Gate:** in Production, domain writes are refused unless `HOME_REAL_DATA` is exactly `open`; auth, audit and boot are unaffected; tested both ways.
8. **Export:** round-trips through its version-1 schema; the completeness guard fails on an unlisted column; the other adult's private records are absent and sensitive is absent by default.
9. **Restore:** the rehearsal (§7.2) is recorded with dates in DEPLOY.md §E for `home-dev` and `home`.
10. **Accessibility:** no serious or critical automated violations on any screen; keyboard-only operation; visible focus; labelled fields; text contrast ≥ 4.5:1; targets ≥ 44px; reduced motion respected.
11. **Devices:** key flows pass at 375×812, 768×1024, 1024×768 and 1280×800 with no horizontal scroll.
12. **Data:** synthetic data only in tests, fixtures, screenshots and PR text; gitleaks and the private-terms scan clean.
13. **Scope:** no Kev, calendar, insights, weather, purge or import code; the only new runtime dependency is `rrule`.
14. **Handover:** Opus adversarial audit completed and its blocking findings fixed before the owner's acceptance.

**Real household data** enters Production only after acceptance criteria 7 and 9 are met **and** every DEPLOY.md §E item is recorded, at which point the owner sets `HOME_REAL_DATA=open` (§6).
