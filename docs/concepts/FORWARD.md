# Concept — FORWARD

> Understand the shape of the next 7, 30 and 90 days without looking at a dense calendar. The purpose is anticipation, not calendar administration.

Scenario: Wednesday 14 October, fixture family (see [README](./README.md)).

## 1. Information hierarchy

Forward has one control — the horizon — and the same four-part structure at every horizon. What changes with the horizon is the **unit** (days → weeks → months) and **what counts as notable**.

| Order | Block | Week (7 days) | Month (30 days) | Season (90 days) |
|---|---|---|---|---|
| 1 | **Shape headline** | "Busy midweek, easy weekend." | "Sam's away twice; Labour weekend is clear." | "Steady till December, then it all happens at once." |
| 2 | **Needs sorting** (insights for the horizon, max 3–5) | Clashes, gaps, prep | Clashes, gaps, prep, busy weeks | Big dates needing early decisions |
| 3 | **The shape** — one row per unit, each with a load mark and only its notable items | Days | Weeks | Months |
| 4 | **The usual** — routine, collapsed | "School, work, swimming Wed, football Sat" | same | same |

Plus, on the Week horizon only: **Read the week ahead ›** — Kev's weekly briefing.

What counts as *notable* (shown) vs *usual* (collapsed): anything non-recurring, anything involving travel, birthdays, holidays, deadlines, project target dates, and any *exception* to a recurring pattern (a cancelled swim, a moved football game). Recurring routine is collapsed into "The usual".

## 2. Mobile wireframes

### Week (default)

```
┌──────────────────────────────────────┐
│ ⌂                  Today  [Forward]  │
│                                      │
│    [Week]     Month      Season      │
│                                      │
│ Busy midweek, easy weekend.          │  ← shape headline
│ Read the week ahead               ›  │
│                                      │
│ NEEDS SORTING                        │
│ ● Thu — Sam's in two places at 4.    │
│ ● Fri — nobody's down for pickup     │
│   (Sam's away).                      │
│ ○ Tue — Nana Jo's birthday; nothing  │
│   planned yet.                       │
│                                      │
│ Thu 15  ●●●   Parent interviews 4:00 │
│               Sam flies out 6pm      │
│ Fri 16  ●●    Sam away               │
│ Sat 17  ●     Football 9:00          │
│               Dry morning            │
│ Sun 18  ·     Nothing on             │
│ Mon 19  ●●●   Dentist (Milo) 3:30    │
│ Tue 20  ●●    Nana Jo's birthday     │
│                                      │
│ The usual                         ›  │  ← school, work, swimming…
│                                      │
│ Ask or tell Kev…                     │
└──────────────────────────────────────┘
```

Load marks (`·` `●` `●●` `●●●`) express how full a day is for the household — a texture, not a count. Rain or dry weather only appears where it matters (a project is waiting, or something is outdoors).

### Month

```
│    Week     [Month]     Season       │
│                                      │
│ Sam's away twice. Labour weekend     │
│ is clear.                            │
│                                      │
│ NEEDS SORTING                        │
│ ● Fri 16 & Tue 27 — pickups while    │
│   Sam's away.                        │
│ ○ Back fence: 2 of 5 done; target    │
│   end of October.                    │
│                                      │
│ This week        ●●●  busy midweek   │
│   Interviews Thu · Sam away Fri      │
│ 19–25 Oct        ●●   steady         │
│   Nana Jo's birthday Tue             │
│ 26 Oct–1 Nov     ●    quiet          │
│   Labour Day Mon · Sam away Tue      │
│ 2–8 Nov          ●●   steady         │
│   School cross-country Fri           │
│                                      │
│ The usual                         ›  │
```

### Season

```
│    Week      Month     [Season]      │
│                                      │
│ Steady till December, then it all    │
│ happens at once.                     │
│                                      │
│ ▁▃▂▁▂▂▁▂▃▅▆▇▅                        │  ← 13-week texture, one mark per week
│ Oct       Nov        Dec             │
│                                      │
│ WORTH DECIDING EARLY                 │
│ ○ School finishes 16 Dec; nothing    │
│   planned for the break yet.         │
│ ○ Nana Jo's 70th is 21 Nov — worth   │
│   planning soon?                     │
│                                      │
│ OCTOBER                              │
│   Labour weekend · Nana Jo's bday    │
│ NOVEMBER                             │
│   Nana Jo's 70th (21st) · Sam in     │
│   Sydney 10–12                       │
│ DECEMBER                             │
│   School ends 16th · Christmas ·     │
│   Back fence target (if slipped)     │
```

The texture strip is the only graphic on the screen: a quiet impression of busy and quiet stretches, with no axis numbers.

## 3. Tablet / desktop adaptation

- **Tablet:** the shape list on the left; tapping a day or week shows its detail on the right (a Today-style view of that day, or the notable items for that week). The horizon switch stays at the top.
- **Desktop:** Season can show three month columns side by side; Month can show weeks as a vertical list with detail alongside. Kev sits in the right panel, so "What about the week of the 26th?" is always one line away.
- Forward never becomes a grid of hours. A wider screen means more *context* per row, not smaller cells.

## 4. Key interactions

| Gesture | Result |
|---|---|
| Switch horizon | Tap Week / Month / Season, or swipe left/right on the list. |
| Tap a day (Week) | Opens that day as a Today-style sheet: headline, getting everyone there, everyone's day. |
| Tap a week (Month) / month (Season) | Expands to show its notable items; tap again to zoom into the finer horizon at that point. |
| Tap an insight | Shows the facts it's based on; action opens Kev with it as focus (e.g. "Who can do Friday pickup?"). |
| **Read the week ahead ›** | Opens Kev with the Week Ahead briefing (deep tier), streaming in the Kev sheet. |
| **The usual ›** | Lists the recurring routine, so it's visible but not in the way. |
| Long-press a day or week | "Ask Kev about this…" — opens Kev with that range as focus. |

## 5. What Kev contributes

- **Shape headlines** for each horizon (templated from load and insights; phrased by Kev when cached).
- **Phrasing and ordering** of horizon insights ("worth deciding early" at the Season horizon).
- **The Week Ahead** briefing (deep tier, on request): Needs coordination · Potential conflicts · Family opportunities · Home · You two · Coming over the horizon · To sort.
- **Answers about any period**, via the Kev bar.
- Code determines load, notable vs usual, conflicts, gaps, and every date.

## 6. Deliberately absent

- No month-grid calendar and no week-by-hour grid.
- No drag-and-drop event editing, no inline event forms.
- No category colour legend (no "work = blue, school = green").
- No counts ("14 events this week").
- No routine clutter: recurring items live in "The usual".
- No year view — 90 days is the horizon; beyond it is Kev's job to mention.

## 7. Empty state

```
│    [Week]     Month      Season      │
│                                      │
│ A quiet week. Just the usual.        │
│                                      │
│ ○ Both weekends are clear — the back │
│   fence could fit either Saturday.   │
│                                      │
│ The usual                         ›  │
```

No "No upcoming events" message. Quiet is presented as a good thing, and if a quiet stretch creates an opportunity, that is the insight.

## 8. Busy / complex state

December, Season horizon: end-of-year events, two birthdays, travel, holidays.

- The headline names it: "December's packed. Three things are worth deciding now."
- **Worth deciding early** holds at most five, date-ordered; "See all" beyond that.
- Each month row shows up to three anchors, then "+4".
- Week horizon on a heavy week: each day shows at most two notable items, then "+3".
- Kev offers, once, in the headline area: "This is a big stretch — want me to look at what could move?" → a deep-tier conversation that ends in proposals, never automatic changes.

## 9. Why this feels different from a family organiser

| A family organiser | HOME Forward |
|---|---|
| A calendar: slots of time, equally weighted | A **shape**: busy stretches, quiet stretches, what's different |
| Routine fills every cell | Routine is folded away as "The usual" |
| You discover problems when you get to that week | Problems and decisions surface weeks or months early |
| Zooming changes cell size | Zooming changes **what matters**: days → decisions; season → anchors and early choices |
| Built for entering and editing events | Built for looking ahead and deciding |
