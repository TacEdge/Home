# M0 — Experience Concepts

Status: **Draft for review.** No code. Approve, change or reject before any UI is built.

M0 covers exactly three primary experiences:

| Concept | File | The test it must pass |
|---|---|---|
| **Today** | [TODAY.md](./TODAY.md) | Open at 7:03 on a Wednesday; within ~5 seconds understand the day, where everyone needs to be, what needs coordinating, what deserves attention, and whether Kev has noticed something. |
| **Forward** | [FORWARD.md](./FORWARD.md) | Understand the *shape* of the next 7, 30 and 90 days without a dense calendar. Anticipation, not administration. |
| **Kev** | [KEV.md](./KEV.md) | The simplest way into HOME. Ask or tell anything without knowing where it belongs. |

Settings, Projects, People and To sort are deliberately not designed yet; they appear here only where the three primary experiences lead to them.

## The design idea in one line

> **HOME should feel like opening the front door to an organised house.** Calm, warm, clear, useful. Power underneath, simplicity on the surface.

Three consequences run through every concept:

1. **Meaning before data.** Every screen opens with a sentence that says what things *mean* ("Easy morning. One thing to sort before 3."), then shows the supporting detail.
2. **Exceptions before routine.** School, work and the usual Tuesday swimming are known but quiet. What's *different* — a clash, a gap, an opportunity — is what gets space.
3. **One way in.** There is one input on every screen: *Ask or tell Kev…*. No "add event" buttons, no forms as the primary path, no modes.

## Fixture family (used in every example)

Per D18, no real family information appears in the repository. All concepts use this synthetic household:

| Person | Role | Notes |
|---|---|---|
| **Sam** | Parent | Office job with regular client-site days; evening board meeting monthly |
| **Alex** | Parent | Works 9:00–2:30 weekdays; Pilates Wednesday evenings |
| **Milo** | Child, 9 | School; swimming Wed 3:30; Saturday football |
| **Isla** | Child, 6 | School |
| **Nana Jo** | Other (not in household) | Sam's mum; birthday 20 October |

Home projects: *Back fence* (paint; 3 hours, needs dry weather) and *Garage* (light needs sorting).
Scenario date: **Wednesday 14 October 2026**, 7:03am, Pacific/Auckland.

## Global navigation model

```
                 ┌──────────────────────────────┐
   ⌂ menu ◄──────┤   Today   ⇄   Forward        │   two places, side by side
 (Projects,      │                              │   (tap the switch or swipe)
  People,        │   …content…                  │
  To sort,       │   tap a person  → People     │   everything else is reached
  Settings)      │   tap a project → Projects   │   through the content itself
                 │   "2 to sort"   → To sort    │
                 │                              │
                 │ [ Ask or tell Kev…         ] │   Kev on every screen; opening
                 └──────────────────────────────┘   Kev never navigates away
```

- **Two places, one conversation.** *Today* (now) and *Forward* (ahead) are the only primary destinations. Kev is not a place you go; it's always at the bottom of wherever you are.
- **No tab bar.** Six icons at the bottom is how organisers look. Secondary areas live behind a quiet ⌂ menu (top-left) and, more often, are reached by tapping the thing you care about.
- **Sheets, not pages, for detail.** Tapping an event, insight or person opens a sheet over the current screen; dismiss it and you're exactly where you were.
- **Kev as a sheet.** Tapping the Kev bar raises a sheet over the current screen (≈70% height), drag up for full screen. Kev knows what you were looking at (`focus`).
- **Landing:** HOME always opens on Today.
- **Tablet (≥768px):** same model; content gains a second column; Kev opens as a side sheet.
- **Desktop (≥1200px):** ⌂ menu becomes a slim left rail; Kev becomes a persistent right-hand panel; Today/Forward fill the middle.

```
Desktop ≥1200px
┌────┬───────────────────────────────────────┬──────────────────┐
│ ⌂  │  Today   Forward                      │  Kev             │
│    │                                       │                  │
│ ▢  │   …Today or Forward content,          │  …conversation…  │
│ ▢  │    two columns…                       │                  │
│ ▢  │                                       │                  │
│ ▢  │                                       │ [Ask or tell…  ] │
└────┴───────────────────────────────────────┴──────────────────┘
```

## Shared visual language (low fidelity)

These are directions for the concepts, not a finished design system.

| Element | Direction |
|---|---|
| **Surface** | Warm off-white "paper" (dark mode: warm charcoal). Generous margins. One column on phones. |
| **Type** | A warm, humanist serif for the one headline sentence per screen; a clean sans for everything else. Few sizes. |
| **Colour** | Near-monochrome. One warm accent (terracotta/amber) reserved for *needs you*. Each person has a soft identifying colour, used only as a small dot next to their name. **No red.** |
| **Section labels** | Small, muted capitals ("WORTH KNOWING"). Sections with nothing in them are not shown at all. |
| **Insight marks** | `●` accent — needs you (coordination, conflict). `○` muted — good to know (opportunity, heads-up). |
| **Numbers** | No badges, counters or streaks. Where a count helps, it's words: "2 things to sort". |
| **Motion** | Minimal. Sheets slide; Kev's wording fades in quietly; nothing bounces. |
| **Icons** | Almost none. Words are clearer. |

## Shared building blocks

| Block | Used in | Notes |
|---|---|---|
| **Headline** | Today, Forward | One or two sentences of meaning. Deterministic template first; Kev's phrasing when cached. Never waits for Kev. |
| **Insight row** | Today, Forward, Kev | Mark + one sentence + optional action ("Sort it ›"). Tap to see what it's based on. Swipe to dismiss. |
| **Person line** | Today | Colour dot, name, one or two lines of their day. Tap → profile. |
| **Item row** | everywhere | Time · title · who. Tap → detail sheet. |
| **Kev bar** | everywhere | "Ask or tell Kev…" — one input, no modes. |
| **Proposal card** | Kev | What Kev would do, in plain words; where it goes; who can see it; **Yes / Change / Not now**. |

## Open questions for review

1. **Naming.** Is "Forward" the right user-facing word, or should the switch read *Today · Ahead* or *Today · Coming up*?
2. **Evening mode.** After ~8pm, should Today lead with *Tomorrow morning* (proposed in TODAY.md)?
3. **Headline authorship.** Comfortable with Kev's phrasing replacing the deterministic headline once cached, or should the Today headline always be the plain template?
4. **Desktop lanes.** On wide screens, is a simple one-day "lanes per person" view welcome, or too calendar-like?
5. **Visual next step.** Would a clickable, rendered low-fi version of these three screens help before M1?
