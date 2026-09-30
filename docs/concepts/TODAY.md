# Concept — TODAY

> Open HOME at 7:03 on a Wednesday. Within about five seconds: what today looks like, where the family needs to be, what needs coordinating, what deserves attention, and whether Kev has noticed something useful. Calm even when the day is busy.

Scenario: Wednesday 14 October, 7:03am (fixture family — see [README](./README.md)).

## 1. Information hierarchy

The five-second test maps to the first three blocks. Everything below them is supporting detail.

| Order | Block | Answers | Source |
|---|---|---|---|
| 1 | **Date + headline** (one or two sentences) + weather as words | *What does today look like?* | Deterministic template from `agenda` load + insights. **Never replaced by Kev text.** |
| 2 | **Worth knowing** — up to 3 insights, most important first; or the single line *Nothing needs sorting.* | *What deserves my attention? Has Kev noticed anything?* | `insights` engine; Kev may order/phrase, never invent |
| 3 | **Getting everyone there** — drop-offs, pickups, runs, with who's doing each | *Where does the family need to be? What needs coordinating?* | `agenda` + `EventPerson(responsible)` |
| 4 | **Everyone's day** — one line or two per person | *Who's where?* | `agenda` per person; routine compressed |
| 5 | **To do** — tasks due or scheduled today (max 3 shown) | *Anything to get done?* | tasks |
| 6 | **"2 things to sort"** — only if captures are waiting | Quiet reminder that nothing's lost | captures |
| 7 | **Kev bar** | *Anything else* | — |

Rules: empty sections disappear. Routine items (school, regular work hours) are compressed to a word. Past items fade and fold into "Earlier" as the day goes on.

## 2. Mobile wireframe (7:03am)

```
┌──────────────────────────────────────┐
│ ⌂                  [Today]  Forward  │
│                                      │
│ Wednesday 14 October                 │
│                                      │
│ Easy morning. One thing to sort      │  ← headline (serif)
│ before 3.                            │
│ Fine until mid-afternoon, then       │  ← weather, as words
│ showers.                             │
│                                      │
│ WORTH KNOWING                        │
│ ○ Saturday morning looks clear and   │  ← connections only; the pickup
│   dry — enough for the back fence.   │     gap is shown on the run itself
│ ○ Nana Jo's birthday is Tuesday.     │
│                                      │
│ GETTING EVERYONE THERE               │
│ 8:30   School drop-off   ● Alex      │
│ 3:00   Isla — pickup  Who? · Sort it │  ← the gap lives on the run
│ 3:30   Milo — swimming   ● Alex      │
│                                      │
│ EVERYONE'S DAY                       │
│ ● Sam    Client site, all day        │
│          7:00pm Board meeting        │
│ ● Alex   Work till 2:30              │
│          6:15pm Pilates              │
│ ● Milo   School · swimming 3:30      │
│ ● Isla   School                      │
│                                      │
│ TO DO                                │
│ ○ Pay swimming term fees             │
│                                      │
│ 2 things to sort                  ›  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Ask or tell Kev…                 │ │  ← fixed at bottom
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

On a typical phone, blocks 1–3 sit above the fold: the five-second answer is visible without scrolling.

## 3. Tablet / desktop adaptation

**Tablet (≥768px)** — two columns. Left: headline, Worth knowing, Getting everyone there, To do. Right: Everyone's day as **one calm card per person** — name, then their day as a few lines (morning / afternoon / evening as words, not a time axis). Never hourly lanes. Kev bar spans the bottom; Kev opens as a side sheet.

**Desktop (≥1200px)** — the same two columns in the middle, the ⌂ rail on the left, and Kev as a persistent panel on the right (see README).

```
Tablet
┌───────────────────────────────┬───────────────────────────────┐
│ Wednesday 14 October          │ EVERYONE'S DAY                │
│ Easy morning. One thing to    │ ┌ Sam ────────┐ ┌ Alex ─────┐ │
│ sort before 3.                │ │ Client site │ │ Work–2:30 │ │
│                               │ │ 7pm Board   │ │ 6:15 Pil. │ │
│ WORTH KNOWING                 │ └─────────────┘ └───────────┘ │
│ ● Nobody's down for Isla's…   │ ┌ Milo ───────┐ ┌ Isla ─────┐ │
│ ○ Saturday morning…           │ │ School      │ │ School    │ │
│                               │ │ 3:30 Swim   │ │ 3:00 ?    │ │
│ GETTING EVERYONE THERE        │ └─────────────┘ └───────────┘ │
│ 8:30 Drop-off   Alex          │ TO DO                         │
│ 3:00 Isla       ?             │ ○ Pay swimming term fees      │
│                               │ 2 things to sort           ›  │
├───────────────────────────────┴───────────────────────────────┤
│ Ask or tell Kev…                                              │
└───────────────────────────────────────────────────────────────┘
```

A future kitchen/wall display would be this tablet layout, read-only, larger type.

## 4. Key interactions

| Gesture | Result |
|---|---|
| Tap an insight | Expands in place: the facts it's based on ("Isla — pickup 3:00 · Alex — work till 2:30 · Sam — client site") and its action. |
| **Sort it ›** | Opens Kev with the insight as focus. Kev: "Alex is free from 2:30. Put Alex down for Isla's pickup?" → **Yes** / Someone else. |
| Swipe an insight | Dismiss (with "Not useful" as a secondary option). Gone for the day; doesn't come back. |
| Tap `?` in Getting everyone there | Choose who's doing it directly (a person picker) — no Kev needed. |
| Tap a person | Their profile sheet: age, regular week, things to know, coming up. |
| Tap an event | Detail sheet: time, place, who, which calendar, notes. |
| Tick a to-do | Done, with a brief *Undo*. |
| Pull down | Refresh calendars and weather; a quiet "Updated just now". |
| Tap the headline | Opens Kev with "Tell me about today" — a slightly fuller spoken-style briefing. |
| **Evening** (contextual, not a clock rule) | When nothing meaningful remains today, Today leads with **Tonight — nothing else needs you**, then **Tomorrow morning** with the first commitments and a leave-by time. If something still needs attention tonight, it stays first. Principle: *Today shows what is useful now.* |

## 5. What Kev contributes

- **Phrasing** of insights in Kev's voice (fast tier, cached for the day), from their facts only. The headline itself stays deterministic. Today never waits for, and never visibly changes because of, Kev.
- **Prioritising** the top few insights (a pickup gap outranks a free window).
- **Follow-through**: "Sort it" leads to a proposal, approved in one tap.
- Everything else on Today — times, who's where, gaps, weather, free windows — is computed by code.

## 6. Deliberately absent

- No hour grid, no month grid, no calendar chrome.
- No badges, counters, overdue lists, progress bars, streaks or red.
- No "Good morning, Sam! ☀️" greeting or motivational quote.
- No weather widget (icons, temperatures table) — one sentence, only when it matters.
- No "+" / add-event button — tell Kev, or tap a gap to fill it.
- No chat transcript on Today — Kev lives in its sheet.
- No routine noise: "School" is one word, not two events with times.
- No more than three insights; no insight that isn't actionable or genuinely useful.

## 7. Empty states — healthy quiet

HOME must be comfortable saying nothing needs attention. Insights are never manufactured to look clever; Kev is not rewarded for finding problems.

**An easy weekday**
```
│ Thursday 15 October                  │
│                                      │
│ Thursday looks easy.                 │
│ Nothing needs sorting.               │
│                                      │
│ GETTING EVERYONE THERE               │
│ 8:30   School drop-off   ● Alex      │
│ 3:00   Pickup            ● Alex      │
│                                      │
│ EVERYONE'S DAY                       │
│ …                                    │
```

**A clear day**
```
│ Saturday 17 October                  │
│                                      │
│ Nothing on today.                    │
│ Dry and mild all day.                │
│                                      │
│ WORTH KNOWING                        │
│ ○ Good morning for the back fence,   │
│   if you're keen. About 3 hours.     │
│                                      │
│ Ask or tell Kev…                     │
```
No empty headers, no "You have no events" message, no nudges to add things.

**First run (no calendars yet)**
```
│ Wednesday 14 October                 │
│                                      │
│ HOME is quiet because it doesn't     │
│ know your calendars yet.             │
│                                      │
│      Connect Google Calendar  ›      │
│                                      │
│ Or just tell Kev what's on.          │
```

**Stale data** — shown as an insight, not an error banner: "○ Alex's calendar hasn't updated since yesterday."

## 8. Busy / complex state

Monday: both parents working late, three kids' activities, a dentist appointment, two clashes.

```
│ Monday 19 October                    │
│                                      │
│ Full one. Two clashes, and the       │
│ 3:30 runs need sorting.              │
│                                      │
│ WORTH KNOWING                        │
│ ● Sam's in two places at 3:30 —      │
│   dentist and the site meeting.      │
│ ● Nobody's down for either 3:30      │
│   pickup.                  Sort it › │
│ ○ You're both out until after 6      │
│   tonight.                           │
│   2 more ›                           │
│                                      │
│ GETTING EVERYONE THERE               │
│ Morning                              │
│ 8:30   School drop-off   ● Sam       │
│ Afternoon                            │
│ 3:00   Isla — pickup     ● Alex      │
│ 3:30   Milo — dentist    ● ?         │
│ 3:30   Milo — swimming   ● ?  ⚬ clash│
│ 5:15   Swimming pickup   ● ?         │
│                                      │
│ EVERYONE'S DAY                       │
│ ● Sam   Office · site 3:30 · +2      │
│ …                                    │
```

How calm survives a busy day:
- The **headline carries the load**, so the list doesn't have to shout.
- Worth knowing stays capped at three, with "2 more ›".
- Getting everyone there groups into Morning / Afternoon / Evening and is the one section allowed to be long — because it's the one that matters.
- Each person gets at most two lines, then "+2".
- Same spacing, same colours as a quiet day. Busy is expressed in words, not alarm.

## 9. Why this feels different from a family organiser

| A family organiser | HOME Today |
|---|---|
| Opens on a grid of everything, all equally weighted | Opens on one sentence of meaning |
| You work out the clashes and gaps | Clashes and gaps are found for you and named plainly |
| Organised around time slots | Organised around **people and movement** — who needs to be where, and who's taking them |
| Routine and exceptions look the same | Routine is quiet; exceptions get the space |
| Alerts and badges compete for attention | At most three things worth knowing, then silence |
| Adding means forms and categories | One place to say anything |
| Feels like administration | Feels like someone who knows the house has already had a look |
