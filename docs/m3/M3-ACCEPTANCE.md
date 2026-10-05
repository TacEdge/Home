# M3 — Manual family data + capture: acceptance check

Checked against `M3-BUILD-CONTRACT.md` §10 on 2026-10-05 (Package 10). Each criterion was checked against the code and tests on `main` at the Package 9 merge (f75cfd3) plus this package, not against earlier PR summaries.

**Verdict: M3 is built and audited, but not yet accepted.** The final audit found no Blocker or Important finding left open: the one acceptance defect it found (touch targets under 44px) and the one test gap (organising into a project untested) are fixed in this package. Criteria 1–8 and 10–13 are met. Criterion 9, the restore rehearsal, is an owner step on Neon and Vercel that has not been run yet. Criterion 14 completes when the owner accepts. The real-data gate stays closed (§4 below).

## 1. Criteria

| # | Criterion (§10) | Status | Evidence |
|---|---|---|---|
| 1 | Every package merged by the owner with CI green; no migration | Met | Packages 0–9: #30–#39, each merged by the owner with CI green; Package 10 is this PR. No file added under `src/db/migrations/` since M2 closed (ea9780f); the journal still has 7 entries. |
| 2 | Every route works for both adults: create, edit, archive, restore for each type; task done and dropped; context confirm, retire, reinstate; link and unlink; calm error copy; intentional empty states; no LLM | Met | `tests/e2e/people.spec.ts`, `events.spec.ts`, `home-tasks.spec.ts`, `capture-sort.spec.ts`, `settings-knows-archived.spec.ts`, `today.spec.ts`, `export.spec.ts`. Every route answers 200 for both adults over every record they can see (`m3-privacy-sweep.spec.ts`). Error copy covers every code (`tests/unit/form-action.test.ts`). There is no `src/kev` and no LLM SDK import in `src`. |
| 3 | Capture keeps the exact words and says "Kept" only after the server, with and without JavaScript; To sort organises into all five types with `origin_capture_id`, several per capture, dismiss and undo; captures never reach the other adult | Met | `capture-sort.spec.ts`: exact words, no-JavaScript path, task, note, event, something to know, **project (added here)**, make another, set aside and undo. `organise-capture.test.ts`: **each of the five kinds through `organiseCapture` (added here)**, provenance `ui`, failure applies nothing. The privacy sweep: the other adult's captures read "Nothing here." at `/sort/[id]` and all five `/sort/[id]/[as]` forms, and never appear on any route. |
| 4 | Two-adult sweep finds no other-adult private record on any screen, in the export or in Activity; sensitive only after an explicit audited reveal, never on Today, Forward, a profile or To sort; the M2 privacy suite passes unchanged | Met | `tests/e2e/m3-privacy-sweep.spec.ts` (§2 below); reveal in `settings-knows-archived.spec.ts`; `tests/integration/privacy.test.ts` unchanged and passing. |
| 5 | Every write audited; export audited with counts only; no audit row carries user-written content | Met | Every domain write runs through `auditedWrite` (`src/domain/common/write.ts`); `tests/integration/audited-write.test.ts`, `privacy.test.ts`. The sweep checks both export audit rows are private to the adult, with numeric or boolean meta only, and that no audit row in the whole run carries canary, sensitive, archived or test words in its summary or meta. |
| 6 | Recurrence tests cover every preset across both NZ DST transitions, all-day and timed, exdates, month-end, 29 February; Today, Forward and Coming up agree | Met | `tests/unit/recurrence.test.ts`, `agenda.test.ts`, `event-occurrences.test.ts`. Today's rows equal Forward's for the same date (`today.spec.ts`); Coming up uses the same loader (`events.spec.ts`). |
| 7 | In Production, domain writes are refused unless `HOME_REAL_DATA` is exactly `open`; auth, audit and boot unaffected; tested both ways | Met | `src/domain/common/guards.ts` is the first step of `auditedWrite`; `tests/unit/real-data-gate.test.ts`; `privacy.test.ts` refuses every exported write function (a completeness list over every domain module) for seven non-`open` values, while sign-in audit and Activity keep working. |
| 8 | Export round-trips through its v1 schema; the completeness guard fails on an unlisted column; the other adult's private records absent; sensitive absent by default | Met | `tests/unit/export-completeness.test.ts`; `tests/integration/export.test.ts`; `export.spec.ts`; the sweep's export tests (§3 below). |
| 9 | Restore rehearsal recorded with dates in DEPLOY.md §E for `home-dev` and `home` | **Open: owner** | Not run: this environment has no Neon or Vercel access, and these are owner steps by design (contract §0). The procedure's SQL was checked locally (§5). Owner steps in §6. |
| 10 | No serious or critical automated violations; keyboard-only operation; visible focus; labelled fields; contrast ≥ 4.5:1; targets ≥ 44px; reduced motion respected | Met (fixed here) | `tests/e2e/m3-device-sweep.spec.ts` (§4 below); `tests/unit/tokens-contrast.test.ts`. The sweep first found controls under 44px; they are fixed in this package (ADR 0006 §60). |
| 11 | Key flows pass at 375×812, 768×1024, 1024×768, 1280×800 with no horizontal scroll | Met | Every M3 screen at all four viewports (`m3-device-sweep.spec.ts`), plus each package's own viewport tests. |
| 12 | Synthetic data only; gitleaks and private-terms clean | Met | Fixture family only (`tests/fixtures/`); test records are prefixed and archived after each spec; gitleaks and the private-terms scan run on every PR. Screenshots are written to `test-results/` and never committed. |
| 13 | No Kev, calendar, insights, weather, purge or import code; only new runtime dependency is `rrule` | Met | Runtime dependencies since M2: `rrule` only. Dev dependency: `@axe-core/playwright`. "Weather" and "purge" appear in `src` only as labels and comments. |
| 14 | Opus adversarial audit completed and its blocking findings fixed before acceptance | Met, pending the owner | Final audit in §7: no Blocker; the Important acceptance defect and test gap are fixed in this package. Acceptance itself is the owner's. |

## 2. Two-adult privacy sweep

`tests/e2e/m3-privacy-sweep.spec.ts` runs, for Sam and then for Alex:

- **Every route.** The 16 fixed places plus every page of every record the adult can see, live or archived: profiles and their edit forms, events and their edit forms, projects and their edit forms, tasks, and the adult's own captures with all five organise forms. On a seeded run that is over 70 routes per adult. Each is fetched as the browser receives it: the whole HTML, including the data a page hands to its client components. Each must answer 200 and must not contain:
  - the other adult's canary strings;
  - any sensitive marker;
  - any archived marker, except on Archived and on an archived record's own page.
- **Today's data.** Before the sweep each adult gets private records dated today: an all-day event, a timed event, a task due today, an overdue task and a waiting capture. There is also an archived event today and an archived overdue task. So Today and Forward are checked on a day that holds the other adult's private items. Each adult's own items are confirmed present on Today, Forward, To do and To sort, so the check is not vacuous.
- **By address.** Every page of the other adult's private people, events, projects, tasks and captures, including edit and organise forms, answers 404 "Nothing here." with no canary.
- **Activity.** Every row id the adult is shown, following "Earlier ›" to the end, is compared with the audit rows about the other adult's private records and about sensitive context. None may be shown. Every non-sensitive row about the adult's own private records must be shown, so the test proves filtering rather than absence.
- **Mutation check.** With the task service's visibility filter removed, the sweep fails on Today, Forward and To do.

## 3. Export acceptance

For each adult, plain and with **Include sensitive items**:

- The file passes the owner's checker: `node scripts/check-export.mts` prints "valid home-export v1, sensitive included: …".
- No record id belongs to the other adult's private records of any type. Ids are checked, not only text.
- The adult's own private records are present. Archived records are present and marked.
- Plain: no sensitive context. With the box ticked: exactly the sensitive context that adult may see, which is household items plus their own private ones. Sam does not get Alex's private sensitive item.
- The export's Activity section excludes rows about the other adult's private records.
- Each download writes one private `export.download` audit row whose meta is numbers and booleans only.

## 4. Accessibility and device pass

`tests/e2e/m3-device-sweep.spec.ts`:

- **Every M3 screen, at each viewport.** 375×812, 768×1024, 1024×768 and 1280×800. The screens are Today, Forward, People, a profile, an archived profile, the person, project, task and event forms and pages, To sort, a capture with its five organise forms, every Settings page and the not-found page. Every folded section in the page is opened first (the ⌂ menu stays closed, since opened it lies over the page by design). On each screen:
  - axe (WCAG 2.0–2.2 A/AA) finds no serious or critical violation;
  - there is no horizontal scroll;
  - every control is at least 44×44px. A checkbox counts with its label, and the skip link is measured when focused.
- **Keyboard only.** The first Tab is "Skip to content". Then the test:
  - keeps a capture with Tab, type and Enter;
  - adds a task from the form with Enter;
  - presses Done on To do, with Undo focused and working;
  - opens and closes the ⌂ menu.
- **Focus after a refusal, at each viewport.** It lands on the invalid field, or on the form's message when no field is named, and is checked unobscured: in view, and the element under it is the field itself, not the sticky header or capture bar. Covered refusals:
  - a field at the top of a long form;
  - a field lower down (an event that ends before it starts);
  - a domain refusal that names no field;
  - the capture bar's own refusal.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, no element has a transition or animation longer than 0.01ms, and scrolling is instant.

Fixed by this package (ADR 0006 §60):

- **Checkboxes.** Each checkbox, and each choice in a set, is now wrapped by its label, so the whole 44px row is the target rather than the 20px box.
- **Standalone links.** "Add an event", "Edit", "Add a task", "To do", the empty-state links, the You link and the subject links on What Kev knows are 44px targets.
- **Disclosures.** The More disclosure is at least 44px wide.
- **Task rows.** A task row's title link fills the row's height.
- **Skip link.** It is 44px tall when focused.
- **Not-found page.** "Back to HOME" is its own 44px line.

## 5. Restore rehearsal: what was checked here

This environment has no Neon or Vercel credentials, and the rehearsal is an owner step by design (contract §0, §7.2). Nothing was improvised around that. What could be checked safely, locally and on synthetic data only:

- The runbook's R2 verification SQL (DEPLOY.md §D) runs as written against the local migrated database.
- `drizzle.__drizzle_migrations` holds 7 rows, the same as `src/db/migrations/meta/_journal.json`.
- The audit triggers `audit_log_no_update_delete` and `audit_log_no_truncate` are present.
- `max(at)` is readable.
- Connected as `home_app`, `update audit_log …` fails with *permission denied* and `alter table audit_log disable trigger all` fails with *must be owner*, as the runbook expects.
- The checker the rehearsal uses validates real exports from the app (§3).

## 6. Owner steps to close criterion 9

Do these yourself, in order, following DEPLOY.md §D *Recovery*, and record each result in DEPLOY.md §E items 7 and 8 using the evidence table there: counts and yes/no only, never record contents, hosts or credentials.

**Rehearsal 1, `home-dev`, end to end (§E item 7)**

1. In the Preview deployment (synthetic data only), add a person named **Rehearsal A** on People. Note the UTC time **T** about a minute later. Then add a person named **Rehearsal B**.
2. In the Neon console, in project `home-dev`, create a branch from the main branch at time **T**, named `restore-YYYYMMDD-HHMM`.
3. From your trusted machine, using `home-dev`'s owner role on the branch's direct host with `sslmode=verify-full`, run the R2 queries:
   - the migrations count equals 7, the journal count at `main`;
   - `select count(*) from person where name like 'Rehearsal%'` returns **1**;
   - the audit triggers are present.

   Then connect as `home_app` and confirm both append-only checks fail.
4. In Vercel, Preview environment only, change only the host in `DATABASE_URL` to the branch's pooled host. Redeploy the Preview branch.
5. Sign in to Preview and check:
   - **Rehearsal A** is on People and **Rehearsal B** is not;
   - Activity loads;
   - Settings › Export downloads, and `node scripts/check-export.mts <file>` prints "valid home-export v1". The repo's Node 22, 22.18 or later, runs the `.mts` file directly.

   Delete the file afterwards.
6. Set Preview's host back to the original `home-dev` host and redeploy. Confirm **Rehearsal B** is visible again. Delete the restore branch in Neon.

**Rehearsal 2, `home`, branch verification only (§E item 8)**

1. In the Neon console, in project `home`, create a restore branch at a time within the last 7 days.
2. From your trusted machine, using `home`'s owner role on the branch's direct host, run the R2 queries:
   - the migrations count equals the journal count at the deployed commit;
   - row counts are numbers only;
   - the trigger names are present;
   - `max(at)` is no later than the restore point.

   Then connect as `home_app` and confirm both append-only checks fail.
3. Delete the branch.

Never point Production at the branch, never copy `home` data to `home-dev`, and never point Preview at a `home` branch.

## 7. Final adversarial audit (Package 10)

The whole milestone was reviewed on `main` for the areas the owner listed.

| Area | Result |
|---|---|
| Privacy consistency | Every page reads through domain services with `requireActor()`. No file under `src/app` or `src/ui` imports `@/db`, `drizzle-orm` or `pg`. Client components import domain types only. The sweep proves the result route by route. |
| Writes | Every server action runs through `formAction`, which uses `requireActor`, or calls `requireActor` itself. Ids from forms are re-read through the services. Return paths go through `localPath`. The only writes outside the domain layer are sign-in and sign-out (M1). |
| Audit | Domain audit rows carry no summary; meta is structural. Activity follows P-1 (`audit-subjects.ts`), proven per row by the sweep. |
| Sensitive context | `includeSensitive` is passed only by What Kev knows (the reveal) and the export (the opt-in), the two call sites `sensitive-context-guard.test.ts` allows. Sensitive markers never appear on any route for either adult. |
| Production gate | One check, first in `auditedWrite`. The proposal executor reaches services only through it. The gate test's completeness list covers every exported write in every domain module. Three screens read the gate only to hide offers (Today's prompt, Settings, You). None writes around it. |
| M1 controls | Unchanged since M2 closed. `src/trust`, auth routes, `next.config.ts`, `vercel.json`, instrumentation and workflows have no diff. `env.ts` only gained the optional `HOME_REAL_DATA`. The sign-in page only moved to the shared form primitives, with its action unchanged. |
| Restore and export | The export is proven per adult (§3). The restore runbook's SQL is valid (§5). The rehearsal itself is owner-run (§6). |
| Accessibility | Touch targets under 44px. **Important; fixed in this package.** Nothing else failed. |
| Tests against criteria | Organising into a project had no test at any level. **Important (test gap); fixed in this package.** |

**Findings**

- **Blocker:** none.
- **Important, fixed in this package:**
  - controls under 44px on most screens (criterion 10);
  - no test for organising a capture into a project (criterion 3).
- **Minor, carried forward and not blocking:**
  - **Overnight events.** A timed event that began yesterday and runs into today sits on its start date (ADR 0006 §59), so it is not on Today. This is for M5 or the agenda semantics.
  - **Duplicate reads on Today.** Today reads tasks and projects again beside the agenda loader. Harmless.
  - **The agenda loader's people lookups.** The loader asks each event's people one event at a time. Fine at household scale; worth batching before M4 brings calendars.
  - **The capture bar's status link.** "in To sort", after "✓ Kept", is a link inside a sentence, so WCAG 2.5.8's inline exception applies. The ⌂ menu is the full-size way to To sort.
  - **`check-export.mts` needs Node 22.18 or later.** The repo pins Node 22.

**Recommendation:** M3's build is complete. Accept M3 once Rehearsals 1 and 2 are recorded in DEPLOY.md §E items 7 and 8. Do not start M4 before then.
