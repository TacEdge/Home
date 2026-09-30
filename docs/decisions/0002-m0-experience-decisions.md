# ADR 0002 — Final M0 experience decisions

Status: **Accepted**, 2026-09-30. Closes M0 / M0.5 / M0.6.

## Context

The M0.5 and M0.6 prototypes (`/prototype`, tagged `m0.6-prototype`) exercised Today, Forward and Kev across six fixture states at phone, tablet and desktop widths. The review left three open points.

## Decisions

1. **Tablet Kev.** At narrower tablet and portrait widths, Kev uses the contextual **bottom-sheet** behaviour (half height when opened from something on screen, full height as a destination), exactly as on phones. A side-by-side Kev panel appears only where there is genuinely enough horizontal space for both the content and Kev without squeezing either — initially the desktop breakpoint (≥1200px). Today is never compressed to preserve a desktop interaction.

2. **Clashes.** A clash belongs to the affected event / run / commitment and is shown on it. The corrective interaction (e.g. **Who?**, **Sort it**) is the primary visual element; the clash status is secondary and quieter. People care more about fixing it than seeing a label.

3. **Insight counts.** "+ N more" counts only genuine insights shown in that list. Problems already represented on their underlying object (on-object gaps and clashes) are excluded from both the list and its count.

## Consequences

- `docs/concepts/README.md`, `docs/concepts/KEV.md` and `docs/KEV-AGENT-MODEL.md` updated to match.
- The insights engine must mark candidates that are represented on an object, so the Today/Forward list and its count can exclude them deterministically.
- M0 is complete. No further prototyping; next is M1 (`docs/m1/M1-BUILD-CONTRACT.md`).
