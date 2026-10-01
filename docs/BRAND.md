# HOME brand identity — 01 “The day, rising”

Adopted 2026-10-01 (ADR 0004). This is the visual identity of HOME: the one direction, not a menu. Code reads the tokens in `src/ui/tokens.css`; this document says what they mean and how to use them. The concept board that proposed it is a standalone page kept outside the repository.

## 00. The idea

The O in **HOME** is a sun that has just cleared the horizon: something is on its way up, and it isn’t urgent yet. That is the feeling HOME gives a family every morning. Because the mark is only ever a disc and a line of ground, it can tell the time: low in the morning, clear of the line by day, and at night it goes pale and becomes a moon on a deep green ground. It is the one small piece of play in the system.

## 01. Wordmark

- Four letters, display face at medium weight (500), tracking −0.035em, set tight.
- The O is replaced by the mark: an orb with a thin line of ground cut through its lower third. The line is drawn in the page colour, so the mark reads on any surface.
- The accessible name is always `HOME`; the drawing is decorative (`aria-hidden`).
- Sizes in code: `sm` (26px, the shell header), `md` (44px), `lg` (72px, sign-in).
- Mono version: the orb in Moss, for the rare place colour isn’t available.
- Component: `src/ui/wordmark.tsx`.

## 02. Mark and app icon

- The mark is a disc and a horizon line, nothing else. No house, no heart, no calendar.
- By day the orb is **Sun**; in dark mode it is **Moon** (`--orb`). Future: the Today screen and the icon may move the orb through the day (early · day · evening · night). Only when it says something.
- App icon: Pine tile, the Sun rising from the bottom edge, a Moon-coloured horizon line. Files: `src/app/icon.svg` (favicon, any size) and `src/app/apple-icon.png` (180px). Night and inverse variants exist on the concept board; the app ships the primary.

## 03. Colour

| Brand name | Hex (day) | Hex (night) | Token | Use |
|---|---|---|---|---|
| Pine | `#1F3B36` | `#ECE8DE` (Moon) | `--ink` | Primary ink. Headlines, body, the icon tile. |
| Morning | `#F6F4EE` | `#161D1B` | `--paper` | Ground. Every screen starts here. |
| Linen | `#EBE7DC` | `#212A27` | `--paper-2` | Second surface: inputs, the Kev bar, chips. |
| Moss | `#4F6B62` | `#B9C4BF` | `--ink-2` | Secondary text, detail, “who”. |
| Mist | `#8C9C95` | `#7F8D88` | `--muted` | Labels, times, muted marks. |
| Rule | `#D9D4C6` | `#303936` | `--line` | Horizon rules under lists. |
| **Sun** | `#F0A05A` | `#F2B072` | `--accent` | **The one warm colour.** The O by day; “needs you”. |
| Sun, soft | `#FBE7D3` | `#3A2A1B` | `--accent-soft` | The Who? chip and similar. |
| Sage | `#A8C3A0` | `#7E9A78` | `--ok` | Secondary: done, covered, calm. |
| Sky | `#C9DCE6` | `#3B5565` | `--sky` | Secondary: Forward, weather. |
| Plum | `#6E5A86` | `#A893C3` | `--plum` | Secondary: Us, and the edge of a Kev proposal. |
| Moon | `#E9E4D6` | — | `--orb` at night | The O after dark. |

Rules:
- Ratios on a typical screen: Morning ≈ 85%, Pine and Moss ≈ 12%, Sun ≤ 2%, the rest as dots and hairlines. More than one Sun-coloured thing on a screen means the day is genuinely busy, and that is information.
- Sun means a person needs to decide. Sage means it’s handled. **Nothing is ever red.**
- Secondary colours are small marks (dots, edges), never fills behind text.
- People are dots: each person has a soft hue (Sam moss, Alex sky, Milo sun-soft, Isla plum in the fixture family). A dot before a name, never an avatar.
- Night is a treatment, not an inversion: Pine ground, Moon ink, Sun stays warm for “needs you”, and the O becomes the Moon.

## 04. Typography

| Role | Face | Spec | Token |
|---|---|---|---|
| Headline | Bricolage Grotesque | 400 · 27px on phones (34px with room) · 1.15–1.18 · −0.015em | `--font-display` |
| Kev says | Bricolage Grotesque | 500 · 22px · 1.25 | `--font-display` |
| Body / interface | Figtree | 400–600 · 15–17px · 1.5 | `--font-sans` |
| Label | DM Mono | 400 · 11.5px · +0.14em · uppercase · Mist | `--font-mono` |
| Time, date | DM Mono | 400 · tabular numerals | `--font-mono` |

- Headlines are never bold. The headline is the product: one sentence, written by code, read in five seconds.
- The three faces are self-hosted from `public/fonts/` (latin subsets, SIL OFL; see `public/fonts/LICENSE.md`). HOME never fetches type from a third party at build or runtime.

## 05. Icons and graphic language

- Icons are built from the mark’s two ideas: discs and horizon lines. 36-unit grid, one stroke (1.75), round caps and joins, no fills except Sun when something needs you.
- Places: Today (disc on a line) · Forward (an arc rising off the line) · Family (two small discs) · Us (two overlapping discs) · Home (a roof on a line) · Life admin (a card) · Kev (a soft four-point spark, never a face).
- Horizon rules: lists sit on hairlines, not inside boxes. A line is where the day stands.
- Load reads as dots in Mist: `●` `●●` `●●●`. No bars, no percentages, no colour-coding by severity.
- Insight marks: `●` Sun — needs you; `○` Mist — good to know.
- No illustration. HOME doesn’t draw families. The mark is the only picture.
- Motion: things settle, nothing bounces. 250ms, ease-out, only when it says something. Respect reduced motion.

## 06. Personality and principles

1. **Serious simplicity.** Every element earns its place by removing a thought from a parent’s head. If it adds one, it goes.
2. **Warm, not cute.** Warmth comes from the ground colour, the rounded forms and the voice. Never from mascots, emoji or exclamation marks.
3. **Quietly intelligent.** Kev speaks like a perceptive friend who has read the calendar: short, specific, with the facts underneath if you want them.
4. **Healthy quiet.** An empty Today is a good Today. The brand must look finished when there is nothing to show.
5. **Human scale.** Phone-first, one column, type you can read with a toddler on your hip. Desktop is the same page with more room.
6. **Private by feel.** Nothing about HOME looks shareable. No badges, streaks or scores. It feels like the inside of your own house.

Voice, in three pairs:

| Not this | This |
|---|---|
| You have 3 unassigned events requiring action! | Nobody’s down for Isla’s 3:00 pickup. |
| Great job! Your week is 87% organised 🎉 | A quiet week. Just the usual. |
| AI Insight: Optimal painting window detected | Saturday, 9 till 12, looks best. |

## 07. In the product

- The shell header: wordmark (sm) left, the place switch centred, a quiet settings glyph right.
- Sign-in: the wordmark (lg) as the page’s `h1`, then the calm copy and one input.
- The Sun appears only where a person is needed: the “needs you” dot, the Who? chip, “Sort it”. On a quiet day there are none.
- Kev is a voice, not a face: a spark in the input, a Plum edge on a proposal. No avatar, no bubble colour, no name in a headline.
- Places share one grammar. No place has its own colour or layout.
