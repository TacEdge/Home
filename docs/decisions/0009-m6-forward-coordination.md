# ADR 0009 — M6 Forward Coordination: scope, architecture and decisions

Status: **Proposed**, 2026-10-09. M6 Package 0, for the owner's approval. Nothing here is approved until the owner merges Package 0. The decisions in §20–§29 are recommendations; each is marked with the recommended option. The contract is `docs/m6/M6-BUILD-CONTRACT.md`.

## Context

M5 is technically accepted on synthetic data (`docs/m5/M5-ACCEPTANCE.md`, ADR 0008 §34), and PR #58 has merged. Its operational acceptance on real family use waits on DEPLOY.md §E items 16–17. M4's waits on items 12–15, M3's on the restore rehearsal (items 7–8), and M1's on items 1–6. The Production real-data gate is closed (ADR 0006 §2).

Forward is still M3's plain 30-day list (ADR 0006 §4), with synced events (M4) and overnight carry-over (ADR 0008 §24). It has no horizons, no headline, no conflicts and no insights.

The ROADMAP M6 row commits M6 to: *"Forward per the M0 concept (week / month / season); delete `/prototype` (tag `m0.6-prototype` keeps it); conflict engine and `conflict` insights on Today and Forward; dismiss / not useful."*

ADR 0008 moved these into M6 or left them for it:

- conflicts (§3);
- "Not useful" (§23; plain Dismiss was built in M5);
- Forward changes (§3);
- sheets (§25).

ADR 0008 §21 also records that M6's conflict engine, as SYSTEM-ARCHITECTURE §2.2 describes it, expects "double-booked responsibilities" and "unassigned responsibilities", and that both depend on a structured transport record that does not exist.

Earlier decisions already settle much of the shape:

- **The Forward concept:** `docs/concepts/FORWARD.md`, with the refinements in `docs/concepts/README.md`.
- **Clashes belong on the affected item** (ADR 0002 §2).
- **"+ N more" counts only genuine insights** (ADR 0002 §3).
- **Forward on phones shows two list items, then "+ N more"** (M0.6 refinement 5).
- **Insights are derived on read; only responses persist** (CLAUDE.md rule 15).
- **The four layers and the absence rule** (ADR 0008 §5, §6): only known facts and deterministic interpretation are shown, and a missing record proves nothing.
- **Kev belongs to M8–M10.** Kev phrasing, "Read the week ahead", "Sort it" and proposals are not M6.

## Decisions

### Scope

1. **M6 is Forward Coordination, computed without Kev.** It moves Forward from "what's on" towards "what's coming up, and what needs a look". It applies written, deterministic rules to records the household has already made. Nothing in M6 calls an LLM. Forward and Today are complete without Kev.

2. **M6 builds:**
   - **Forward with three horizons:** Week (7 days), Month (30 days) and Season (90 days), switched without JavaScript.
   - **A factual horizon headline**, deterministic, from a closed set of templates.
   - **The shape:** one row per unit (days, weeks or months), each with its notable items. Routine is folded into **The usual**.
   - **A conflict engine** with three rules: `conflict.overlap`, `conflict.responsible` and `conflict.away` (§9–§14).
   - **Conflict insights** on Today and Forward: on the affected item where it is drawn, and in Worth knowing where it is not.
   - **"Not useful"** beside Dismiss (§17).
   - **Deletion of `/prototype`**; the tag `m0.6-prototype` keeps it.

3. **M6 does not build** the following:

   | Item | Why, or where it goes |
   |---|---|
   | Transport, getting there, **Who?**, `coordination_gap`, unassigned or double-booked transport | §20: no structured transport record; the recommended option defers it |
   | "Both adults away" | §25: proposed for a later decision, from evidence |
   | "Worth deciding early" and other season observations built on absence ("nothing planned for the break yet") | The absence rule (ADR 0008 §6) |
   | Load phrased as character ("busy midweek, easy weekend") | ADR 0008 §5; the headline states counts and records |
   | Weather, free windows, `alignment`, availability | M7 |
   | Kev phrasing, "Read the week ahead", long-press "Ask Kev about this", the Kev bar | M8–M10 |
   | "Sort it", proposals, "look at what could move" | M9 |
   | Sheets and swipe gestures | §23 |
   | Holidays and school terms as data | Not in the data model; nothing infers them |
   | A month grid, an hour grid, counts like "14 events", a year view | The concept's deliberate absences |
   | Push notifications, background jobs, stored insights, adaptive ranking | ROADMAP "Not yet" |

4. **No new schema.** M6 needs no table, column, enum value or migration. `insight_response.response` already accepts `not_useful` (migration `0006`). Any schema change needs a separate owner decision and its own migration-first package. That includes the transport record in §20.

### What Forward may say

5. **The four layers hold unchanged** (ADR 0008 §5). Forward uses only known facts and deterministic interpretation.

   The concept's example headlines are character, not counts, so M6 does not use them: "Busy midweek, easy weekend.", "Steady till December, then it all happens at once.". Its observations built on absence are also out: "nobody's down for pickup", "nothing planned for the break yet", "worth planning soon?". M6's wording states counts, dates, names and recorded overlaps.

6. **Traceability.** Every headline, row, mark and insight carries:
   - its `rule`, from a closed, documented list;
   - its `facts`: record ids and dates only, never text.

   Each shows its facts in place without JavaScript. A statement with no traceable rule is not shown.

7. **Absence proves nothing** (ADR 0008 §6). A day with nothing recorded is "nothing recorded", never "free". A child's event with no adult recorded is shown as recorded and never flagged. A missing record is never a need, an assignment, an availability, an arrangement or a reassurance.

### Architecture

8. **There is still one agenda engine.** The M3–M5 loader (`readAgendaInputs`, `loadAgenda`) and engine (`src/domain/engines/agenda.ts`) stay the only place that places, expands and orders items. Forward reads 90 days through them, in one read.

   Two pure engines are added under `src/domain/engines/`:
   - **`forward.ts`**: horizons, units, notable or usual, load bands, the headline and caps;
   - **`conflicts.ts`**: the three conflict rules, their identity and their order.

   The insights engine gains the `conflict` family and a window parameter. Today's other detectors are unchanged.

   All three engines are pure functions of the reader's records, the agenda's output, the home zone and an injected `now`. They never read the database or the clock, and never import `db`, `app`, `kev`, `ui` or `integrations`.

### Conflicts

9. **Three classes, and only two are stated.**

   | Class | What it is | In M6 |
   |---|---|---|
   | **A. A proven overlap of records** | The same visible person is recorded on two visible occurrences whose times overlap. Or the person is recorded on an all-day `travel` event and on another event on a day it covers. | **Stated**, as recorded: `conflict.overlap`, `conflict.away` |
   | **B. A recorded responsibility conflict** | The same visible person is recorded as `responsible` on both of two overlapping occurrences | **Stated**: `conflict.responsible` |
   | **C. A possible concern that needs more information** | For example, a child's event with no adult recorded, both adults away, or an event that may need a lift | **Never stated.** No rule produces it in M6. Some of it becomes A or B only if a structured record exists (§20, §25). |

10. **`conflict.overlap`.** Two timed occurrences overlap when each starts before the other ends: `a.start < b.end && b.start < a.end`. Back-to-back occurrences, where one ends exactly when the other starts, do not overlap.

    At least one visible person must be on both occurrences. "On" means the people the agenda shows: the event's own annotations, or else its calendar's usual people, or a changed occurrence's series people (ADR 0007 §14, §46).

    These are excluded:
    - an occurrence that is Today's routine (`routine.regular_week`: a weekly or fortnightly `school` or `work` series with a household person on it). One-offs usually sit inside school and work hours on purpose.
    - a pair where both occurrences are of kind `work`. A work calendar's own double-bookings are not household coordination.

    The two occurrences are distinct occurrences. One occurrence carried over several days is still one occurrence (`occurrenceKey`).

11. **`conflict.responsible`.** The same as §10, but at least one shared person is recorded as `responsible` on both occurrences. It replaces `conflict.overlap` for that pair; it is not added alongside it.

    It says only that the person is recorded as responsible for both. It never says "can't", "double-booked", "needs cover" or anything about getting there. `responsible` keeps the meaning ADR 0008 §21 gave it.

12. **`conflict.away`.** A visible person is recorded on an all-day event of kind `travel`, and on another visible occurrence on a day that event covers. The other occurrence is not of kind `travel`, and it is not Today's routine.

    It states the two records ("Sam is on Sydney trip and on Football on Saturday"). It never says "away", "can't make it" or "needs someone".

    *Proposed rule; the owner approves it separately (§24).*

13. **Identity, deduplication and order.**
    - **One conflict per pair of occurrences.** All the shared people are named in it, and B takes precedence over A.
    - **Key for a pair of occurrences:** `{rule}:{eventA}_{dateA}.{eventB}_{dateB}:s{overlap start, epoch ms}`. The pair is sorted by event id, then date.
      - A change to either occurrence's time is a new key.
      - A change to the people that leaves the rule as it was is the same key.
      - A change between A and B is a new key.
    - **Key for a standing overlap:** `{rule}:{seriesA}.{seriesB}:standing`. This applies when both occurrences are unchanged occurrences of plain weekly or fortnightly series, so their overlap recurs.
      - It is said once, at its next occurrence, and names how many times it falls in the window.
      - A dismissal holds for the series pair, so it is not raised again each week.
    - **Key for `conflict.away`:** `conflict.away:{travelEvent}_{date}.{otherEvent}_{date}:{day}`.
    - **Key limits:** every key fits `insightKey` (at most 200 characters; letters, digits and `: _ . -`). Keys are built from ids and dates only.
    - **Order:**
      - `conflict.responsible`, then `conflict.overlap`, then `conflict.away`;
      - then the earliest overlap start;
      - then the key.

      This is a total order.
    - **Clusters.** Three occurrences that all overlap produce up to three pairs. Pairs are not merged in M6; caps keep the list short. This is recorded as a risk (contract §11).

14. **Explanation.** Each conflict's "Why ›" gives, in Today's row style:
    - the rule in one plain sentence;
    - the two occurrences, with their times and recorded people;
    - the overlap ("from 15:45 to 16:15");
    - for `conflict.responsible`, which person is recorded as responsible on both.

    It never gives locations, travel or reasons.

### Forward

15. **Horizons, units and notable items.**

    - **Units by horizon:**

      | Horizon | Days | Unit |
      |---|---|---|
      | Week | 7, from today | days |
      | Month | 30, from today | weeks: the first from today to Sunday, then Monday to Sunday |
      | Season | 90, from today | months |

      Every unit is drawn, including empty ones.

    - **The usual.** An occurrence is usual when it is an unchanged occurrence of a series in a household person's regular week (the profile engine's `regularWeek`). That is the same test the profile page already shows.
    - **Notable** is everything else:
      - any occurrence in a current conflict for the reader that the reader has not responded to, even a usual one, so a conflict is always drawn on its item;
      - one-offs;
      - changed occurrences;
      - all-day and multi-day events;
      - `travel`;
      - birthdays;
      - project target dates;
      - tasks due;
      - scheduled tasks, if §26 is approved.

      This is broader than Today's routine, which is school and work only, and it is recorded as a decision (§21).
    - **Rows** show notable items only:
      - Week: up to two per day;
      - Month: three per week;
      - Season: three per month;

      then "+ N". Within a row, the order is:
      1. items with a conflict;
      2. birthdays;
      3. all-day and multi-day events;
      4. project targets;
      5. tasks due;
      6. timed items by start;

      then by agenda order. This order is written and tested; it ranks by kind, not by importance.
    - **The usual ›** is a disclosure listing each household person's regular week, from the existing profile engine.

16. **Headline.** A closed set of factual templates per horizon, each a named rule:
    - first run;
    - nothing recorded;
    - only the usual;
    - listed (one or two notable items, named);
    - counted;
    - a second sentence when conflicts fall in the window;
    - the "As far as HOME knows." qualifier when a visible calendar is stale or failing.

    It reports counts, names and dates, never character. Final copy is approved by the owner from screenshots in Package 4.

### Insights, Dismiss and Not useful

17. **Dismiss and Not useful.**
    - **Dismiss** hides that insight, by key, for that adult. It is unchanged from M5.
    - **Not useful** does the same, and records the adult's judgement that this *kind* of observation did not help. It is stored as the existing `insight_response` row with `response = 'not_useful'`, through the existing `respond`, audited and gated.
    - **Neither changes any rule, threshold, ranking or other insight.** There is no adaptive ranking, no learning and no suppression of a whole rule.
    - **What `not_useful` is for:** the household and its developers review it deliberately, in the M10 trial retrospective, from each adult's own export. Any change to a detector that follows is an ADR amendment. Kev does not read it in M6, and any later use by Kev needs its own decision.
    - **Where Not useful is offered:** inside the insight's "Why ›" disclosure, as a secondary action, as TODAY.md §4 has it ("Dismiss, with 'Not useful' as a secondary option").

18. **Where insights appear.**

    | Surface | Families | On the item (not listed) |
    |---|---|---|
    | **Today**, window today + 7 | `data_health`, `conflict`, `preparation`, `busy_day` | Today's conflicts on the person line or Also today row; plus M5's on-object rules |
    | **Forward, Week** | `data_health`, `conflict` | Every conflict, on its day |
    | **Forward, Month and Season** | `data_health`, `conflict` | None. Conflicts are listed, because there are no day rows to put them on. |

    - **Why only these on Forward.** `preparation` and `busy_day` stay Today's. On Forward, birthdays and targets are on the rows, and the load is the row's mark.
    - **Ranking:**
      - by family: `data_health`, then `conflict`, then `preparation`, then `busy_day`;
      - then within the family (§13);
      - then by date;
      - then by key.
    - **How many are shown:** Today shows three. Forward shows two, then "+ N more" (M0.6 refinement 5). "+ N more" counts only listed, undismissed insights.

19. **Dismissal reaches everywhere the reader sees that key.** A conflict dismissed on Today is gone from Forward, and the other way round. A dismissed conflict is neither listed nor marked on its item for that adult. The items themselves are untouched.

    The dismiss service re-derives the reader's own insights over the longest window (90 days) and accepts:
    - a conflict key that is current;
    - any other key that is current and listable on the surface named in the request.

    Everything else is refused as `not_eligible`, as in M5.

### Owner decisions (proposed; none approved)

20. **Transport: recommend Option C, defer to a later milestone.** M6 behaves as Option A meanwhile. It uses explicit facts only, with no transport wording, Who? or `coordination_gap`.
    - **The structured transport record is not dropped.** It is re-decided at M9 planning, when Kev's proposals can fill it in without form-filling. By then, real use (DEPLOY.md §E items 16–17 onwards) will show whether the household would keep it current.
    - **Comparison:** contract §6.
    - **If the owner chooses Option B instead:** it needs:
      - an additive migration in its own migration-first package;
      - a per-event "getting there" field and two `event_person` roles;
      - a change to this ADR before Package 2.

21. **The usual on Forward is the regular week: recommend yes.** It covers all kinds, not only school and work. Today keeps its narrower routine compression.

    "Besides the usual" therefore means school and work on Today, and the regular week on Forward. The difference is written into both headlines' Why.

22. **Load marks and the Season texture: recommend build, with provisional bands.**
    - **What is counted:** notable items per unit. The usual is not counted.
    - **Bands:**

      | Unit | No mark | One | Two | Three |
      |---|---|---|---|---|
      | Day | 0 | 1–2 | 3–4 | 5 or more |
      | Week or month | 0 | 1–4 | 5–9 | 10 or more |

    - **How they are drawn:** in ink tones, never the Sun accent. Each has a text equivalent ("three things recorded").
    - **Status:** code constants, evaluated in the M10 trial, like ADR 0008 §22.
    - **Alternative:** no marks; rows only.

23. **Sheets: recommend defer again, to M10 design polish.**
    - Items keep linking to their full pages.
    - A Month week or a Season month expands in place (`<details>`).
    - The horizon switch is three links.
    - Swipe is not built.
    - **Alternative:** sheets layered over the existing detail URLs, as a progressive enhancement.

24. **`conflict.away`: recommend build** (§12). **Alternative:** overlaps of timed occurrences only (§10, §11).

25. **"Both adults away": recommend not in M6.** It is a fact of records, but its only use is the childcare implication, which is C. Revisit with evidence after real use.

26. **Scheduled tasks on Forward: recommend yes, in Package 1.**
    - V0.1-SCOPE lists "scheduled tasks" on Forward, and M3–M5 never delivered it. The agenda gains a `task_scheduled` item (open tasks with `scheduled_starts_at`).
    - Today already shows these under To do, so Today's no-regression test must place them there and not twice.
    - **Alternative:** leave Forward without them.

27. **Section name and mark: recommend "Worth knowing" on Forward too, and ● (the Sun accent) for conflicts only.**
    - The concept's "Needs sorting" claims a need that no rule establishes.
    - A recorded overlap is the one M6 observation the concept and ADR 0002 reserve the accent for.
    - **Alternative:** ○ for everything, with the Sun still unused.

28. **The individual view is a person's existing Coming up: recommend yes.** It shows the same conflict marks on that person's items, from the same engine. Forward has no per-person filter in M6.

29. **The package plan** in contract §2 (§30 below).

### Process

30. **Packages:**
    - **0:** this ADR and the contract.
    - **1:** Forward groundwork and engine.
    - **2:** the conflict engine.
    - **3:** coordination insights, Not useful and Today.
    - **4:** the Forward screen.
    - **5:** acceptance.

    Builder, review intensity and verification are set per package in contract §2. Review is risk-based: high for the conflict engine and for the feedback write path, medium elsewhere. Package 1 cannot start until the owner approves this ADR and the contract.

31. **Production.** M6 is built and accepted on synthetic data, and `HOME_REAL_DATA` stays closed. M6 adds no migration and no Production setting. Its operational acceptance on real records waits on the gate, through two new DEPLOY.md §E items added in Package 5.

## Consequences

- **ROADMAP.** The M6 row records Package 0 and points here. The M5 row is updated to show that Package 5 has merged.
- **SYSTEM-ARCHITECTURE §2.2 and §2.6, and KEV-AGENT-MODEL's `get_conflicts`.** These keep the long-term design: double or missing responsibilities, "both adults away", and `coordination_gap`. M6 narrows them as §9 and §20 record. Their prerequisite remains a structured transport record.
- **FAMILY-DATA-MODEL.** Unchanged; there is no schema change.
- **Concepts.** In Package 4, `docs/concepts/FORWARD.md` is annotated where M6 differs:
  - factual headlines;
  - "Worth knowing";
  - no Week Ahead, Kev, weather, sheets, swipe, "worth deciding early" or transport gaps.
- **CLAUDE.md rule 14.** It is fulfilled in Package 1, when `/prototype` and its build, lint, format and deploy exclusions are removed.
