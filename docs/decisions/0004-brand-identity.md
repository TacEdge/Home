# ADR 0004 — Brand identity 01, “The day, rising”

Status: **Accepted**, 2026-10-01 (owner approved the concept board and asked for it to be applied).

## Context

M0 set an interim visual direction for the prototype: warm paper, a humanist serif for the headline, one terracotta accent. It was deliberately low fidelity. With M1 complete and deployment under way, HOME needed its own identity before real screens are built in M2+, so that Today, Forward and Kev are designed into a system rather than retrofitted.

## Decision

1. **Identity.** HOME adopts the identity in `docs/BRAND.md`: the sun-and-horizon mark as the O of the wordmark; a green-black ink (Pine) on a warm chalk ground (Morning); exactly one warm colour (Sun) reserved for “needs you”; Sage, Sky and Plum as small secondary marks; Bricolage Grotesque for headlines, Figtree for interface text, DM Mono for labels and times. Dark mode is “night”: Pine ground, Moon ink, the O becomes a moon.
2. **Tokens, not restyling.** Components keep their semantic token names (`--paper`, `--ink`, `--accent`, …); the identity changes the values and adds `--sky`, `--plum`, `--orb`, `--font-display`, `--font-mono`. `docs/BRAND.md` holds the brand-name ↔ token mapping.
3. **Fonts are self-hosted.** This amends ADR 0003 §17 (“system font stacks, no font fetches at build or runtime”). The *intent* of §17 — no third-party fetch, nothing leaking a visitor’s presence to a font CDN — stands. The *letter* changes: the three faces ship as latin-subset woff2 files in `public/fonts/` (114 KB total, SIL OFL), declared with `@font-face` in `src/ui/tokens.css`, and served from HOME’s own origin. `next/font/google` remains out; nothing is fetched at build.
4. **App icon** is `src/app/icon.svg` (favicon) and `src/app/apple-icon.png`, both the primary Pine-and-Sun tile.
5. **Scope.** This changes the M1 shell, sign-in and the calm pages only. No product behaviour, copy or data changes. M2+ screens are built on these tokens and the rules in `docs/BRAND.md`.

## Consequences

- `docs/PRODUCT-PRINCIPLES.md` (design language) and `docs/concepts/README.md` (design language table) now defer to `docs/BRAND.md` for type and colour; their layout, density and motion rules are unchanged.
- The prototype at tag `m0.6-prototype` keeps its interim styling as a record; it is not updated.
- The time-of-day orb (early · day · evening · night) is a brand affordance, not an M1 feature. It may be implemented when Today exists, as a deterministic, display-only detail.
- Font files are binary assets in the repository; updates come with a licence note in `public/fonts/LICENSE.md`.
