# M0 — Experience Concepts

Status: **Approved with refinements (below).** Next: M0.5 experience prototype (`/prototype`).

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

## Refinements agreed at review

1. **The name stays FORWARD** — looking ahead deliberately, not listing what's coming.
2. **Navigation is not permanently two-screen.** Today, Forward and Kev are the primary V0.1 experience. HOME has other **places** — People, Home (projects), Family, Us, Life Admin — that don't need primary navigation yet but must be able to emerge into it naturally later (see the model below).
3. **Evening mode is contextual, not a clock rule.** Today shows what is useful *now*. When nothing meaningful remains today, it may lead with *Tonight — nothing else needs you*, then *Tomorrow morning*. If something still needs attention tonight, that stays first.
4. **The Today headline is deterministic.** It renders instantly and never changes when an LLM response arrives. Kev adds colour only when asked or when an insight is opened.
5. **Tablet/desktop per-person layouts are calm cards/columns, never hourly timeline lanes.**
6. **Healthy quiet.** HOME is comfortable saying "Thursday looks easy. Nothing needs sorting." Insights are never manufactured; Kev is not rewarded for finding problems.

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

- **Places.** HOME is made of places: *Today*, *Forward*, and — over time — *People*, *Home*, *Family*, *Us*, *Life Admin*. In V0.1 two places are **primary** (the switch at the top); the rest are **quiet** (reached through the ⌂ menu or by tapping content). The model is a single ordered list of places with a `primary` flag, so a place can be promoted into the top switch later without redesigning navigation — the switch grows from two items to three or four, and on desktop the rail already lists every place.
- **Kev is not a place.** It's the conversation, present at the bottom of every place.
- **No tab bar in V0.1.** Six icons at the bottom is how organisers look. Quiet places live behind the ⌂ menu and, more often, are reached by tapping the thing you care about (a person, a project, "2 to sort").
- **Sheets, not pages, for detail.** Tapping an event, insight or person opens a sheet over the current screen; dismiss it and you're exactly where you were.
- **Kev as a sheet.** Tapping the Kev bar raises a sheet over the current screen (≈70% height), drag up for full screen. Kev knows what you were looking at (`focus`).
- **Landing:** HOME always opens on Today.
- **Tablet (≥768px):** same model; content gains a second column; Kev opens as a side sheet.
- **Desktop (≥1200px):** the ⌂ menu becomes a slim left rail listing every place (primary ones first); Kev becomes a persistent right-hand panel; the current place fills the middle.

```
Desktop ≥1200px
┌────┬───────────────────────────────────────┬──────────────────┐
│ Td │  Today   Forward                      │  Kev             │
│ Fw │                                       │                  │
│ ·  │   …Today or Forward content,          │  …conversation…  │
│ Pp │    two columns…                       │                  │
│ Hm │                                       │                  │
│ …  │                                       │ [Ask or tell…  ] │
└────┴───────────────────────────────────────┴──────────────────┘
```

## Design test (used to judge the M0.5 prototype)

1. Can I understand Today in approximately five seconds?
2. Does a busy day still feel calm?
3. Does an empty day feel intentionally empty rather than unfinished?
4. Does Forward provide anticipation rather than becoming another calendar?
5. Does Kev feel like the easiest way to interact with HOME?
6. Can I tell Kev something without understanding HOME's data structure?
7. Are recommendations clearly different from facts?
8. Is approval obvious without being bureaucratic?
9. Does HOME feel like a household operating system rather than a productivity app?
10. Does the experience feel useful enough that we would genuinely open it every morning?

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
| **Headline** | Today, Forward | One or two sentences of meaning. **Deterministic, instant, never replaced by LLM text.** Kev expands on it only when asked. |
| **Insight row** | Today, Forward, Kev | Mark + one sentence + optional action ("Sort it ›"). Tap to see what it's based on. Swipe to dismiss. |
| **Person line** | Today | Colour dot, name, one or two lines of their day. Tap → profile. |
| **Item row** | everywhere | Time · title · who. Tap → detail sheet. |
| **Kev bar** | everywhere | "Ask or tell Kev…" — one input, no modes. |
| **Proposal card** | Kev | What Kev would do, in plain words; where it goes; who can see it; **Yes / Change / Not now**. |

## Review questions — answered

1. Naming → **Forward** stays.
2. Evening mode → yes, contextual (refinement 3).
3. Headline → always deterministic (refinement 4).
4. Wide screens → per-person cards/columns, never hourly lanes (refinement 5).
5. Rendered low-fi → yes: **M0.5 experience prototype**, evaluated with six fixture states (see ROADMAP).
