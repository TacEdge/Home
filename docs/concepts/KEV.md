# Concept — KEV

> Kev should feel like the simplest way into HOME. Ask or tell anything, without knowing which part of HOME it belongs in.

Underneath, every exchange is one or more of **ask · tell · capture · recommend · propose · approve**. On the surface there is only a conversation, and a card when Kev wants to change something.

## 1. Information hierarchy

**The Kev bar** (every screen): one line — *Ask or tell Kev…*. Nothing else. No modes, no buttons besides send.

**The Kev sheet** (opened from the bar):

| Order | Element | Purpose |
|---|---|---|
| 1 | **Focus line** (only when opened from something) | "About: Isla's 3:00 pickup" — Kev knows what you were looking at |
| 2 | **Conversation** — today's turns; earlier days above, behind a day separator | Continuity without "chats" to manage |
| 3 | **Kev's answer** — the *say* sentence (larger), then optional detail | Answer first, detail second; the first sentence works read aloud |
| 4 | **Cited items** — the events, windows or tasks the answer is based on, as tappable rows | Grounding you can check |
| 5 | **Proposal cards** — what Kev would change, where it goes, who can see it | Nothing changes until you say yes |
| 6 | **Suggestions** (only on an empty turn) — two or three context-aware starters | A gentle way in |
| 7 | **Input** | Same line as the bar |

## 2. Mobile wireframes

### Opening the sheet at 7:03am

```
┌──────────────────────────────────────┐
│ ⌂                  [Today]  Forward  │  ← Today still visible behind
│ Wednesday 14 October                 │
├──────────────────────────────────────┤
│               ───                    │  ← drag handle
│                                      │
│ Anything I need to know today?       │  ← suggestions (tap to ask)
│ What's on this weekend?              │
│ Read the week ahead                  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Ask or tell Kev…                 │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### ASK → answer grounded in HOME

```
│                     When could I get │
│                   three hours to     │
│                   paint the fence?   │  ← you (right-aligned, plain)
│                                      │
│ Saturday, 9 till 12, looks best.     │  ← Kev: say
│ Dry all morning and nothing's on     │  ← detail
│ until football at 1. Sunday turns    │
│ showery after lunch.                 │
│                                      │
│  Sat 17 · 9:00–12:00 · dry, 15°   ›  │  ← cited window
│  Sat 17 · 1:00 Football (Milo)    ›  │  ← cited event
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Put "Paint the back fence" in    │ │  ← proposal card
│ │ Saturday 9:00–12:00?             │ │
│ │ Home · Back fence · Shared       │ │
│ │                                  │ │
│ │  [ Yes ]   Change   Not now      │ │
│ └──────────────────────────────────┘ │
```

### TELL → capture → propose → approve

```
│              Add sorting the garage  │
│                               light. │
│                              ✓ Kept  │  ← captured instantly, before Kev replies
│                                      │
│ Goes with the Garage project, I      │
│ think.                               │
│ ┌──────────────────────────────────┐ │
│ │ Sort the garage light            │ │
│ │ Home · Garage · about an hour    │ │
│ │ Shared with Alex                 │ │  ← who can see it, always explicit
│ │                                  │ │
│ │  [ Add ]   Change   Not now      │ │
│ └──────────────────────────────────┘ │
│                                      │
│ (after Add)                          │
│ Added.                        Undo   │
```

If you tap **Not now**, or just close the sheet, nothing is lost: "Kept in To sort."

### Opened from an insight (focus)

```
│ About: Isla's 3:00 pickup            │
│                                      │
│ Alex finishes at 2:30 and is free    │
│ until swimming at 3:30.              │
│ ┌──────────────────────────────────┐ │
│ │ Alex does Isla's pickup at 3:00  │ │
│ │ Today · Shared                   │ │
│ │  [ Yes ]   Someone else          │ │
│ └──────────────────────────────────┘ │
```

## 3. Tablet / desktop adaptation

- **Tablet:** the same bottom-sheet behaviour as phones — half height when opened from something on screen, full height from the bar. Today is not squeezed beside a panel (ADR 0002).
- **Desktop:** Kev is a persistent right-hand panel. Selecting something in Today/Forward sets Kev's focus line automatically ("About: Thursday 15"); typing is always one click away.
- The conversation layout is the same everywhere; only the container changes. (That same independence is what makes voice a later adapter, not a redesign.)

## 4. Key interactions

| Interaction | Behaviour |
|---|---|
| Type or dictate, send | Kev answers, streaming. Dictation is the phone keyboard's own; HOME adds no microphone of its own in V0.1. |
| Tell HOME something | "✓ Kept" appears immediately (verbatim capture), then Kev's suggestion follows. |
| **Yes / Add** | Approves the proposal; the change is made; "Added." with **Undo** for a few seconds. |
| **Change** | The card becomes editable in place: title, where it goes, when, who, *Shared / Just me*. Then Yes. |
| **Not now** | Proposal set aside; the capture stays in To sort. |
| Several proposals | Stacked cards, plus "Yes to all" when there are three or more. |
| Tap a cited item | Opens its detail sheet over the conversation. |
| **What's this based on?** (small link under an answer) | Shows sources and freshness: "Your calendars (updated 7:00), forecast (6:45), Back fence project." |
| Suggestions | Tap to ask; they change with time of day, day of week and focus. |
| Drag handle | Half → full screen → dismiss. The conversation is always there next time. |
| Kev unavailable | "I can't think straight right now — I've kept that for later." The capture is safe in To sort. |

## 5. What Kev contributes (and what code does)

| Kev | Code |
|---|---|
| Understanding plain language — ask vs tell, what it's about | Storing the words verbatim, instantly (capture) |
| Choosing which tools to call | Agenda, conflicts, free windows, weather, insights, profiles |
| Explaining results in a short, human sentence | Every time, date, availability and permission |
| Suggesting structure for a capture (task, which project, who, when) | Validating the proposal; executing it only on approval; audit |
| Planning across domains (deep tier) | Enforcing visibility — Kev never sees what you can't |
| Knowing when to say "I'm not sure" or "that's all" | Cost and tool-call limits |

The user never sees tiers. When a request escalates to the deeper model, the only visible sign is a quiet "Give me a moment…".

## 6. Deliberately absent

- No list of chats, no "New chat", no thread titles — one continuing conversation per person.
- No mode switches ("Ask" vs "Add"), no forms as the first step, no category pickers.
- No model picker, settings, tokens or tool names in the UI.
- No avatar, cartoon face or typing-dots theatre. Kev is a name and a voice.
- No "Great question!", no "Is there anything else I can help with?".
- No barrage of clarifying questions: at most one, and usually a sensible proposal with *Change* instead.
- No action without a card and a yes (except the verbatim capture).
- No microphone button in V0.1 (keyboard dictation only).

## 7. Empty state

First ever open:

```
│ I'm Kev. Ask me what's coming up,    │
│ or tell me anything you need to      │
│ remember — I'll work out where it    │
│ goes.                                │
│                                      │
│ What's on this week?                 │
│ Anything I need to know today?       │
│ Add sorting the garage light         │
│                                      │
│ Ask or tell Kev…                     │
```

Each new day starts clean (yesterday is a scroll up), with two or three suggestions.

## 8. Busy / complex state

**Planning across domains** — "Help me plan the exterior painting."

```
│ Here's a sensible order: prep, then  │
│ two coats, all needing dry days.     │
│ About 12 hours all up.               │
│                                      │
│ 1 Wash and sand walls    3 hrs · dry │
│ 2 Buy paint and rollers  1 hr        │
│ 3 First coat             4 hrs · dry │
│ 4 Second coat            4 hrs · dry │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Start "Exterior painting" with   │ │
│ │ these 4 tasks                    │ │
│ │ Home · Shared                    │ │
│ │  [ Yes ]   Change   Not now      │ │
│ └──────────────────────────────────┘ │
│ Want me to find a dry window for     │
│ step 1 once that's set up?           │
```

**Several things at once** — "Book Milo's dentist, and Nana Jo's birthday is Tuesday — remind me to get a present."

```
│                              ✓ Kept  │
│ Two things:                          │
│ ┌ Book Milo's dentist · task · Sam ┐ │
│ │ [ Add ]  Change                  │ │
│ └──────────────────────────────────┘ │
│ ┌ Get Nana Jo a present            ┐ │
│ │ by Mon 19 · task · Just you      │ │  ← private: a present
│ │ [ Add ]  Change                  │ │
│ └──────────────────────────────────┘ │
│                         Yes to both  │
```

**Long conversations** — older turns fold into "Earlier today"; cards already approved collapse to one line ("Added: Sort the garage light").

## 9. Why this feels different from a family organiser

| A family organiser | Kev |
|---|---|
| You must know where things go before you can add them | You say it; it's kept instantly; Kev suggests where it goes |
| Forms, fields, categories | Plain words, and one card when something would change |
| Search and scroll to answer "when could I…?" | Ask, and get a specific, reasoned answer from your real week |
| Changes happen as you type | Nothing changes without a visible yes — and it always says who'll see it |
| An assistant bolted on the side | The front door to everything, from every screen |
| Generic, chirpy assistant voice | A calm, perceptive voice that noticed something useful |
