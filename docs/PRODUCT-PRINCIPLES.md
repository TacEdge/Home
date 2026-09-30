# HOME — Product Principles

These principles resolve arguments. When a design or build decision is unclear, check it against this list. Earlier principles win over later ones when they conflict.

## 1. Trust before capability

HOME will hold the most personal information our family has. A feature that erodes trust is a net loss, however clever. We would rather Kev do less, correctly and privately, than more, unpredictably.

- Nothing leaves HOME without a human choosing it.
- Everything Kev "knows" about us is visible, editable and deletable — and treated as context that can change or go stale, not as permanent truth.
- Private stays private — including between the two of us (surprises, gifts, personal notes).

## 2. Calm by default

HOME should reduce cognitive load, never add to it.

- Show less. Every element on screen must earn its place.
- No red badges, streaks, scores, gamification or guilt.
- Surface issues *early and quietly* rather than late and loudly.
- Empty is fine. "Nothing needs your attention today" is a good screen.

## 3. Tell Kev; don't file things — capture first, organise second

Users should not need to decide which domain, list or project something belongs to.

- Anything said to HOME is **captured immediately, verbatim**, before any organising happens. Capture never fails because Kev is unsure, slow or offline.
- Kev then **proposes** how to organise it (a task in the Garage project, an event, something to know about a person); the human confirms.
- Unorganised captures wait quietly in a "To sort" list. They are never lost and never nag.
- Manual editing always exists as a fallback, but it is never the primary path.

## 4. Grounded, never invented

Kev answers from what HOME actually knows, and says so when it doesn't.

- Kev must never fabricate an event, time, commitment or fact about a person.
- Answers about time ("Saturday is free") come from deterministic computation, not model intuition.
- Kev shows its working lightly: the items an answer is based on are one tap away.
- "I don't know — nothing in the calendar for that day" beats a confident guess.

## 5. Human approval before action

HOME's permanent trust model:

```
OBSERVE → UNDERSTAND → RECOMMEND → HUMAN APPROVAL → ACT
```

Kev observes, understands and recommends. Humans approve. Kev then acts. This governs every future agent capability, not just V0.1.

- Every change Kev makes is proposed first (in V0.1, without exception).
- Anything that touches the outside world (sending, booking, paying, writing to external calendars) is out of scope until explicitly designed and approved.
- Autonomy is granted per capability, deliberately, after trust is earned — never by default.

## 6. Human, not clinical

Family, children and relationships are not datasets.

- No child "tracking", development scores, or behavioural monitoring.
- No relationship scoring, balance sheets or "you haven't had a date in 34 days" nags.
- Language is warm and positive: opportunities, ideas, things to look forward to.
- Kev does not infer emotional states, health conditions or relationship dynamics.

## 7. Anticipation over administration

The value of HOME is in *noticing* — the clash, the renewal, the free window, the birthday in three weeks. Not in maintaining lists. If a feature mostly creates data-entry work, it is probably wrong.

## 8. Small, coherent, finished

Each release is small and complete. A few things that work beautifully beat many that half-work. We deliberately leave things out and write down that we did.

## 9. Boring technology, clean seams

Use well-understood, widely-supported technology. Keep clear boundaries between layers so that the clever parts (Kev) can evolve without destabilising the reliable parts (data, auth, privacy).

## 10. The family owns its data

Everything is exportable in an open format. Everything is backed up. Deleting something deletes it. No lock-in to any vendor, including the AI provider.

---

## Design language (initial)

- **Tone:** warm, plain, brief. Kev speaks like a thoughtful, capable friend — not a butler, not a coach, not a corporate assistant. No exclamation marks, no emoji by default, no filler.
- **Layout:** generous whitespace, one primary column, strong typographic hierarchy, few colours. Each person has a soft, consistent colour.
- **Density:** Today fits on one phone screen in the common case.
- **Motion:** minimal, purposeful.
- **Mobile first:** HOME is used standing in the kitchen, in the car park, on the couch. Desktop is secondary.
- **Voice:** speaking to Kev will likely become a primary interface. V0.1 relies on the phone's built-in dictation, but everything Kev does must work through a channel-agnostic conversation layer so voice can later be added as an adapter, not a redesign. Kev's answers lead with a short, speakable sentence.
